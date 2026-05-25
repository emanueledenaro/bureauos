import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { workspacePaths } from "../paths.js";
import { ClientIntelligenceService, type ClientIntelligenceItem } from "./intelligence.js";

export interface ClientAccountPlanInput {
  runId?: string;
  clientId?: string;
  now?: Date;
}

export interface ClientAccountPlanResult {
  generated_at: string;
  plans: ArtifactRecord[];
  clients: ClientIntelligenceItem[];
}

export interface ClientAccountPlanDeps {
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

function planBody(item: ClientIntelligenceItem, generatedAt: string): string {
  const topProjects =
    item.projects.length === 0
      ? "- No projects recorded."
      : item.projects
          .slice(0, 5)
          .map((project) => {
            return `- ${project.name}: ${project.status}, repo ${project.repository || "not linked"}`;
          })
          .join("\n");
  const topOpportunities =
    item.opportunities.length === 0
      ? "- No opportunities recorded."
      : item.opportunities
          .slice(0, 5)
          .map((opportunity) => {
            return `- ${opportunity.title}: ${opportunity.status}, ${money(
              opportunity.expected_value,
            )}, margin ${opportunity.expected_margin}%, next ${opportunity.next_action}`;
          })
          .join("\n");
  const factors =
    item.value_score.factors.length === 0
      ? "- No commercial evidence yet."
      : item.value_score.factors.map((factor) => `- ${factor}`).join("\n");

  return `# Client Account Plan

Generated: ${generatedAt}

## Client

- Name: ${item.client.name}
- Status: ${item.client.status}
- Industry: ${item.client.industry}
- Risk: ${item.risk}

## Value Classification

- Value score: ${item.value_score.score}/100
- Revenue tier: ${item.classification.revenue_tier}
- Strategic value: ${item.classification.strategic_value}
- Relationship health: ${item.classification.relationship_health}
- Payment reliability: ${item.classification.payment_reliability}
- Upsell potential: ${item.classification.upsell_potential}
- Referral potential: ${item.classification.referral_potential}
- Public proof allowed: ${item.classification.public_proof_allowed}

## Score Factors

${factors}

## Revenue

- Open pipeline: ${money(item.revenue.pipeline_value)}
- Won value: ${money(item.revenue.won_value)}
- Lost value: ${money(item.revenue.lost_value)}
- Average expected margin: ${Math.round(item.revenue.average_expected_margin)}%
- Open opportunities: ${item.revenue.open_opportunities}
- Stalled opportunities: ${item.revenue.stalled_opportunities}

## Delivery

- Projects total: ${item.delivery.projects_total}
- Active projects: ${item.delivery.active_projects}
- Blocked projects: ${item.delivery.blocked_projects}
- Delivered projects: ${item.delivery.delivered_projects}
- Repositories linked: ${item.delivery.repositories_linked}
- Pending approvals: ${item.delivery.pending_approvals}

## Projects

${topProjects}

## Opportunities

${topOpportunities}

## Relationship

- Last client message: ${item.relationship.last_client_message_at || "(none recorded)"}
- Last owner response: ${item.relationship.last_owner_response_at || "(none recorded)"}
- Next follow-up: ${item.relationship.next_follow_up_at || "(none scheduled)"}
- Follow-up due: ${item.relationship.follow_up_due ? "yes" : "no"}

## Next Account Move

${item.next_action}

## Approval Boundary

- Do not send client messages without owner approval or an explicit communication policy.
- Do not change price, scope, deadlines, legal terms, ad budget, or public proof permissions without owner approval.
- Safe autonomous work: internal account planning, proposal drafts, pricing drafts, project dispatch packets, issue drafts, and follow-up drafts.
`;
}

export class ClientAccountPlanService {
  private readonly intelligence: ClientIntelligenceService;
  private readonly artifacts: ArtifactStore;
  private readonly audit: AuditLog;

  constructor(
    public readonly workspaceRoot: string,
    deps: ClientAccountPlanDeps = {},
  ) {
    this.intelligence = deps.intelligence ?? new ClientIntelligenceService(workspaceRoot);
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
  }

  async generate(input: ClientAccountPlanInput = {}): Promise<ClientAccountPlanResult> {
    const now = input.now ?? new Date();
    const summary = await this.intelligence.summarize(now);
    const clients = input.clientId
      ? summary.clients.filter((item) => item.client.id === input.clientId)
      : summary.clients;
    const generatedAt = now.toISOString();
    const plans: ArtifactRecord[] = [];

    for (const item of clients) {
      const plan = await this.artifacts.write({
        type: "client-account-plan",
        createdBy: "supreme_coordinator",
        ...(input.runId ? { runId: input.runId } : {}),
        clientId: item.client.id,
        status: "submitted",
        metadata: {
          client_name: item.client.name,
          risk: item.risk,
          value_score: item.value_score.score,
          revenue_tier: item.classification.revenue_tier,
          strategic_value: item.classification.strategic_value,
          relationship_health: item.classification.relationship_health,
          next_action: item.next_action,
        },
        body: planBody(item, generatedAt),
      });
      plans.push(plan);
      await this.audit.append({
        actor: "supreme_coordinator",
        action: "client.account_plan.generated",
        target: item.client.id,
        artifact_id: plan.id,
        result: "ok",
      });
    }

    if (plans.length === 0) {
      await this.audit.append({
        actor: "supreme_coordinator",
        action: "client.account_plan.skipped",
        target: input.clientId ?? "all",
        result: "ok",
      });
    }

    return {
      generated_at: generatedAt,
      plans,
      clients,
    };
  }
}
