import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { appendDailyNote } from "../memory/daily.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { OpportunityRegistry, type OpportunityRecord } from "../registries/opportunity.js";
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";
import { RunEngine, type RunRecord } from "../runs/engine.js";
import { PolicyEngine } from "../policy/engine.js";
import { defaultConfig } from "../config/loader.js";
import type { BureauConfig } from "../config/schema.js";

export interface BusinessReportResult {
  generated_at: string;
  executive_report: ArtifactRecord;
  business_operating_report: ArtifactRecord;
  metrics: BusinessMetrics;
  next_actions: string[];
}

export interface BusinessMetrics {
  clients_total: number;
  clients_active: number;
  projects_total: number;
  projects_blocked: number;
  opportunities_total: number;
  pipeline_value: number;
  average_expected_margin: number;
  approvals_pending: number;
  runs_total: number;
  runs_needing_human: number;
}

export interface BusinessReportDeps {
  config?: BureauConfig;
  clients?: ClientRegistry;
  projects?: ProjectRegistry;
  opportunities?: OpportunityRegistry;
  approvals?: ApprovalRegistry;
  artifacts?: ArtifactStore;
  audit?: AuditLog;
  runs?: RunEngine;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function computeMetrics(args: {
  clients: ClientRecord[];
  projects: ProjectRecord[];
  opportunities: OpportunityRecord[];
  approvalsPending: number;
  runs: RunRecord[];
}): BusinessMetrics {
  const { clients, projects, opportunities, approvalsPending, runs } = args;
  const pipelineValue = opportunities.reduce((acc, opportunity) => {
    return acc + (opportunity.expected_value || 0);
  }, 0);
  const averageMargin =
    opportunities.length === 0
      ? 0
      : opportunities.reduce((acc, opportunity) => {
          return acc + (opportunity.expected_margin || 0);
        }, 0) / opportunities.length;

  return {
    clients_total: clients.length,
    clients_active: clients.filter((client) => client.status === "active").length,
    projects_total: projects.length,
    projects_blocked: projects.filter((project) => project.status === "blocked").length,
    opportunities_total: opportunities.length,
    pipeline_value: pipelineValue,
    average_expected_margin: averageMargin,
    approvals_pending: approvalsPending,
    runs_total: runs.length,
    runs_needing_human: runs.filter((run) => run.status === "needs_human").length,
  };
}

function nextActions(metrics: BusinessMetrics): string[] {
  const actions: string[] = [];
  if (metrics.approvals_pending > 0) {
    actions.push(`Review ${metrics.approvals_pending} pending approval gates.`);
  }
  if (metrics.projects_blocked > 0) {
    actions.push(`Unblock ${metrics.projects_blocked} blocked project(s).`);
  }
  if (metrics.opportunities_total === 0) {
    actions.push("Create or import the first revenue opportunity.");
  }
  if (metrics.pipeline_value > 0) {
    actions.push("Prioritize the highest-value opportunity and prepare proposal follow-up.");
  }
  if (actions.length === 0) {
    actions.push("Run a growth review and generate the next client acquisition campaign draft.");
  }
  return actions;
}

function executiveBody(args: {
  generatedAt: string;
  metrics: BusinessMetrics;
  actions: string[];
}): string {
  const { generatedAt, metrics, actions } = args;
  return `# Executive Report

Generated: ${generatedAt}

## Company Pulse

- Clients: ${metrics.clients_total}
- Active clients: ${metrics.clients_active}
- Projects: ${metrics.projects_total}
- Blocked projects: ${metrics.projects_blocked}
- Opportunities: ${metrics.opportunities_total}
- Pipeline value: ${money(metrics.pipeline_value)}
- Average expected margin: ${Math.round(metrics.average_expected_margin)}%
- Pending approvals: ${metrics.approvals_pending}
- Runs needing human input: ${metrics.runs_needing_human}

## Recommended Next Actions

${actions.map((action) => `- ${action}`).join("\n")}

## Executive Interpretation

BureauOS should protect owner control while moving all safe draft work forward. External commitments remain approval-gated.
`;
}

function operatingBody(args: {
  generatedAt: string;
  metrics: BusinessMetrics;
  clients: ClientRecord[];
  projects: ProjectRecord[];
  opportunities: OpportunityRecord[];
  runs: RunRecord[];
}): string {
  const { generatedAt, metrics, clients, projects, opportunities, runs } = args;
  return `# Business Operating Report

Generated: ${generatedAt}

## Metrics

- Pipeline value: ${money(metrics.pipeline_value)}
- Average expected margin: ${Math.round(metrics.average_expected_margin)}%
- Pending approvals: ${metrics.approvals_pending}
- Blocked projects: ${metrics.projects_blocked}
- Runs needing human input: ${metrics.runs_needing_human}

## Clients

${
  clients.length === 0
    ? "- No clients yet."
    : clients.map((client) => `- ${client.name}: ${client.status}, ${client.industry}`).join("\n")
}

## Projects

${
  projects.length === 0
    ? "- No projects yet."
    : projects
        .map((project) => `- ${project.name}: ${project.status}, stack ${project.stack || "tbd"}`)
        .join("\n")
}

## Opportunities

${
  opportunities.length === 0
    ? "- No opportunities yet."
    : opportunities
        .map((opportunity) => {
          return `- ${opportunity.title}: ${opportunity.status}, ${money(opportunity.expected_value || 0)}, margin ${opportunity.expected_margin || 0}%`;
        })
        .join("\n")
}

## Recent Runs

${
  runs.length === 0
    ? "- No runs yet."
    : runs
        .slice(-10)
        .map((run) => `- ${run.id}: ${run.type}, ${run.status}, ${run.scope}`)
        .join("\n")
}
`;
}

export class BusinessReportService {
  private readonly config: BureauConfig;
  private readonly clients: ClientRegistry;
  private readonly projects: ProjectRegistry;
  private readonly opportunities: OpportunityRegistry;
  private readonly approvals: ApprovalRegistry;
  private readonly artifacts: ArtifactStore;
  private readonly audit: AuditLog;
  private readonly runs: RunEngine;

  constructor(
    private readonly workspaceRoot: string,
    deps: BusinessReportDeps = {},
  ) {
    this.config = deps.config ?? defaultConfig("freelancer");
    this.clients = deps.clients ?? new ClientRegistry(workspaceRoot);
    this.projects = deps.projects ?? new ProjectRegistry(workspaceRoot);
    this.opportunities = deps.opportunities ?? new OpportunityRegistry(workspaceRoot);
    this.approvals = deps.approvals ?? new ApprovalRegistry(workspaceRoot);
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    const policy = new PolicyEngine(this.config, this.approvals);
    this.runs =
      deps.runs ??
      new RunEngine(workspaceRoot, {
        audit: this.audit,
        artifacts: this.artifacts,
        policy,
      });
  }

  async generate(): Promise<BusinessReportResult> {
    const [clients, projects, opportunities, approvals, runs] = await Promise.all([
      this.clients.list(),
      this.projects.list(),
      this.opportunities.list(),
      this.approvals.listPending(),
      this.runs.list(),
    ]);
    const generatedAt = new Date().toISOString();
    const metrics = computeMetrics({
      clients,
      projects,
      opportunities,
      approvalsPending: approvals.length,
      runs,
    });
    const actions = nextActions(metrics);

    const executive = await this.artifacts.write({
      type: "executive-report",
      createdBy: "supreme_coordinator",
      body: executiveBody({ generatedAt, metrics, actions }),
      status: "submitted",
    });
    const operating = await this.artifacts.write({
      type: "business-operating-report",
      createdBy: "supreme_coordinator",
      body: operatingBody({ generatedAt, metrics, clients, projects, opportunities, runs }),
      status: "submitted",
    });

    await appendDailyNote(
      this.workspaceRoot,
      "Runs",
      `Generated business reports ${executive.id} and ${operating.id}.`,
    );
    await this.audit.append({
      actor: "supreme_coordinator",
      action: "report.business.generated",
      target: operating.id,
      artifact_id: operating.id,
      result: "ok",
    });

    return {
      generated_at: generatedAt,
      executive_report: executive,
      business_operating_report: operating,
      metrics,
      next_actions: actions,
    };
  }
}
