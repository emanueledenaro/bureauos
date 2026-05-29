import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { workspacePaths } from "../paths.js";
import { ClientIntelligenceService, type ClientIntelligenceItem } from "./intelligence.js";

export interface ClientSuccessStatusInput {
  runId?: string;
  clientId?: string;
  now?: Date;
}

export interface ClientSuccessStatusResult {
  generated_at: string;
  reports: ArtifactRecord[];
  clients: ClientIntelligenceItem[];
}

export interface ClientSuccessStatusDeps {
  intelligence?: ClientIntelligenceService;
  artifacts?: ArtifactStore;
  audit?: AuditLog;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function followUpDraft(item: ClientIntelligenceItem): string {
  if (!item.relationship.follow_up_due) {
    return "No follow-up is currently due. Keep monitoring relationship memory.";
  }

  return `Ciao ${item.client.name},

ti scrivo per fare un punto rapido e assicurarci che il prossimo passo sia chiaro.

Da parte nostra il prossimo movimento interno suggerito e: ${item.next_action}

Prima di inviarti qualsiasi proposta, modifica di scope, timeline o prezzo, faccio una verifica finale e ti aggiorno con una versione confermata.`;
}

function statusBody(item: ClientIntelligenceItem, generatedAt: string): string {
  const projects =
    item.projects.length === 0
      ? "- No projects recorded."
      : item.projects
          .slice(0, 5)
          .map(
            (project) =>
              `- ${project.name}: ${project.status}, repo ${project.repository || "not linked"}`,
          )
          .join("\n");
  const opportunities =
    item.opportunities.length === 0
      ? "- No opportunities recorded."
      : item.opportunities
          .slice(0, 5)
          .map(
            (opportunity) =>
              `- ${opportunity.title}: ${opportunity.status}, ${money(
                opportunity.expected_value,
              )}, margin ${opportunity.expected_margin}%, next ${opportunity.next_action}`,
          )
          .join("\n");

  return `# Client Success Status Report

Generated: ${generatedAt}

## Client

- Name: ${item.client.name}
- Status: ${item.client.status}
- Industry: ${item.client.industry}
- Risk: ${item.risk}
- Value score: ${item.value_score.score}/100

## Relationship

- Last client message: ${item.relationship.last_client_message_at || "(none recorded)"}
- Last owner response: ${item.relationship.last_owner_response_at || "(none recorded)"}
- Next follow-up: ${item.relationship.next_follow_up_at || "(none scheduled)"}
- Follow-up due: ${item.relationship.follow_up_due ? "yes" : "no"}
- Relationship health: ${item.classification.relationship_health}

## Commercial Context

- Open pipeline: ${money(item.revenue.pipeline_value)}
- Won value: ${money(item.revenue.won_value)}
- Open opportunities: ${item.revenue.open_opportunities}
- Revenue tier: ${item.classification.revenue_tier}
- Upsell potential: ${item.classification.upsell_potential}

## Delivery Context

- Projects total: ${item.delivery.projects_total}
- Active projects: ${item.delivery.active_projects}
- Blocked projects: ${item.delivery.blocked_projects}
- Pending approvals: ${item.delivery.pending_approvals}

## Projects

${projects}

## Opportunities

${opportunities}

## Draft Follow-Up

${followUpDraft(item)}

## Next Internal Action

${item.next_action}

## Approval Boundary

- This is an internal client-success report and draft reply.
- Do not send the message without owner approval or an explicit communication policy.
- Do not change price, scope, legal terms, deadlines, billing, or production commitments without owner approval.
`;
}

export class ClientSuccessStatusService {
  private readonly intelligence: ClientIntelligenceService;
  private readonly artifacts: ArtifactStore;
  private readonly audit: AuditLog;

  constructor(
    public readonly workspaceRoot: string,
    deps: ClientSuccessStatusDeps = {},
  ) {
    this.intelligence = deps.intelligence ?? new ClientIntelligenceService(workspaceRoot);
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
  }

  async generate(input: ClientSuccessStatusInput = {}): Promise<ClientSuccessStatusResult> {
    const now = input.now ?? new Date();
    const generatedAt = now.toISOString();
    const summary = await this.intelligence.summarize(now);
    const clients = input.clientId
      ? summary.clients.filter((item) => item.client.id === input.clientId)
      : summary.clients;
    const reports: ArtifactRecord[] = [];

    for (const item of clients) {
      const report = await this.artifacts.write({
        type: "client-success-status-report",
        createdBy: "client_success",
        ...(input.runId ? { runId: input.runId } : {}),
        clientId: item.client.id,
        status: "submitted",
        metadata: {
          generated_at: generatedAt,
          client_name: item.client.name,
          risk: item.risk,
          value_score: item.value_score.score,
          follow_up_due: item.relationship.follow_up_due,
          next_follow_up_at: item.relationship.next_follow_up_at,
          approval_required: true,
        },
        body: statusBody(item, generatedAt),
      });
      reports.push(report);
      await this.audit.append({
        actor: "client_success",
        action: "client.success_status.generated",
        target: item.client.id,
        artifact_id: report.id,
        result: "ok",
      });
    }

    if (reports.length === 0) {
      await this.audit.append({
        actor: "client_success",
        action: "client.success_status.skipped",
        target: input.clientId ?? "all",
        result: "ok",
      });
    }

    return {
      generated_at: generatedAt,
      reports,
      clients,
    };
  }
}
