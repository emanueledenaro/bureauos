import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { appendDailyNote } from "../memory/daily.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry, type ApprovalRecord } from "../registries/approval.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { OpportunityRegistry, type OpportunityRecord } from "../registries/opportunity.js";
import {
  ProjectRegistry,
  type ProjectOwnershipRecord,
  type ProjectRecord,
} from "../registries/project.js";
import { RunEngine, type RunRecord } from "../runs/engine.js";
import { PolicyEngine } from "../policy/engine.js";
import { defaultConfig } from "../config/loader.js";
import type { BureauConfig } from "../config/schema.js";

export interface BusinessReportResult {
  generated_at: string;
  executive_report: ArtifactRecord;
  cross_project_report: ArtifactRecord;
  business_operating_report: ArtifactRecord;
  metrics: BusinessMetrics;
  portfolio: ProjectPortfolioItem[];
  next_actions: string[];
}

export type ProjectPortfolioRisk = "blocked" | "needs_human" | "approval" | "watch" | "clear";

export interface ProjectPortfolioItem {
  project_id: string;
  project_slug: string;
  project_name: string;
  client_id: string;
  client_name: string;
  status: string;
  manager_agent_id: string;
  team_id: string;
  assigned_agents: string[];
  repository: string;
  stack: string;
  pending_approvals: number;
  active_runs: number;
  runs_needing_human: number;
  client_pipeline_value: number;
  risk: ProjectPortfolioRisk;
  next_action: string;
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
    actions.push(`Review ${metrics.approvals_pending} serious owner decision(s).`);
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

function riskForProject(args: {
  project: ProjectRecord;
  pendingApprovals: number;
  activeRuns: number;
  runsNeedingHuman: number;
  clientPipelineValue: number;
}): ProjectPortfolioRisk {
  const { project, pendingApprovals, activeRuns, runsNeedingHuman, clientPipelineValue } = args;
  if (project.status === "blocked") return "blocked";
  if (runsNeedingHuman > 0) return "needs_human";
  if (pendingApprovals > 0) return "approval";
  if (activeRuns === 0 && project.status !== "delivered" && project.status !== "cancelled") {
    return "watch";
  }
  if (clientPipelineValue > 0 && project.status === "intake") return "watch";
  return "clear";
}

function nextProjectAction(item: Omit<ProjectPortfolioItem, "next_action">): string {
  switch (item.risk) {
    case "blocked":
      return "Escalate blocker review with the Supreme Coordinator.";
    case "needs_human":
      return "Resolve run needing human input before continuing autonomous work.";
    case "approval":
      return "Review serious owner decisions before external commitments.";
    case "watch":
      return "Schedule or dispatch the next project-manager run.";
    case "clear":
      return "Keep project cadence and monitor for drift.";
  }
}

function buildPortfolio(args: {
  clients: ClientRecord[];
  projects: ProjectRecord[];
  ownership: ProjectOwnershipRecord[];
  opportunities: OpportunityRecord[];
  approvals: ApprovalRecord[];
  runs: RunRecord[];
}): ProjectPortfolioItem[] {
  const clientsById = new Map(args.clients.map((client) => [client.id, client]));
  const ownershipByProjectId = new Map(args.ownership.map((item) => [item.project_id, item]));
  return args.projects
    .map((project) => {
      const client = clientsById.get(project.client_id);
      const owner = ownershipByProjectId.get(project.id);
      const activeRuns = args.runs.filter(
        (run) =>
          run.project_id === project.id &&
          !["completed", "failed", "cancelled"].includes(run.status),
      );
      const runsNeedingHuman = activeRuns.filter((run) => run.status === "needs_human").length;
      const pendingApprovals = args.approvals.filter(
        (approval) => approval.target === project.id || approval.scope.includes(project.name),
      ).length;
      const clientPipelineValue = args.opportunities
        .filter((opportunity) => opportunity.client_id === project.client_id)
        .reduce((sum, opportunity) => sum + (opportunity.expected_value || 0), 0);
      const base = {
        project_id: project.id,
        project_slug: project.slug,
        project_name: project.name,
        client_id: project.client_id,
        client_name: client?.name ?? project.client_id,
        status: project.status,
        manager_agent_id: owner?.manager_agent_id ?? "project_manager",
        team_id: owner?.team_id ?? `team_${project.slug}`,
        assigned_agents: owner?.assigned_agents ?? ["project_manager"],
        repository: project.repository,
        stack: project.stack,
        pending_approvals: pendingApprovals,
        active_runs: activeRuns.length,
        runs_needing_human: runsNeedingHuman,
        client_pipeline_value: clientPipelineValue,
        risk: "clear" as ProjectPortfolioRisk,
      };
      const risk = riskForProject({
        project,
        pendingApprovals,
        activeRuns: activeRuns.length,
        runsNeedingHuman,
        clientPipelineValue,
      });
      return { ...base, risk, next_action: nextProjectAction({ ...base, risk }) };
    })
    .sort((left, right) => {
      const priority: Record<ProjectPortfolioRisk, number> = {
        blocked: 0,
        needs_human: 1,
        approval: 2,
        watch: 3,
        clear: 4,
      };
      return (
        priority[left.risk] - priority[right.risk] ||
        left.project_name.localeCompare(right.project_name)
      );
    });
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

function crossProjectBody(args: {
  generatedAt: string;
  portfolio: ProjectPortfolioItem[];
}): string {
  const { generatedAt, portfolio } = args;
  const managerRows = new Map<string, ProjectPortfolioItem[]>();
  for (const item of portfolio) {
    const rows = managerRows.get(item.manager_agent_id) ?? [];
    rows.push(item);
    managerRows.set(item.manager_agent_id, rows);
  }

  return `# Cross-Project Executive Report

Generated: ${generatedAt}

## Portfolio Control Table

${
  portfolio.length === 0
    ? "- No projects yet."
    : portfolio
        .map((item) => {
          return `- ${item.project_name} (${item.client_name}): ${item.status}, PM ${item.manager_agent_id}, risk ${item.risk}, approvals ${item.pending_approvals}, active runs ${item.active_runs}, client pipeline ${money(item.client_pipeline_value)}. Next: ${item.next_action}`;
        })
        .join("\n")
}

## Manager Load

${
  managerRows.size === 0
    ? "- No project managers assigned yet."
    : [...managerRows.entries()]
        .map(([manager, rows]) => {
          const risks = rows.filter((row) => row.risk !== "clear").length;
          return `- ${manager}: ${rows.length} project(s), ${risks} requiring attention.`;
        })
        .join("\n")
}

## Executive Rule

The Supreme Coordinator may compare all project memory, but each Project Manager and specialist team remains scoped to its assigned project unless a cross-project escalation is approved.
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
        recordDecisions: this.config.memory.write_decision_records,
      });
  }

  async generate(): Promise<BusinessReportResult> {
    const [clients, projects, ownership, opportunities, approvals, runs] = await Promise.all([
      this.clients.list(),
      this.projects.list(),
      this.projects.listOwnership(),
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
    const portfolio = buildPortfolio({
      clients,
      projects,
      ownership,
      opportunities,
      approvals,
      runs,
    });
    const actions = nextActions(metrics);

    const executive = await this.artifacts.write({
      type: "executive-report",
      createdBy: "supreme_coordinator",
      body: executiveBody({ generatedAt, metrics, actions }),
      status: "submitted",
    });
    const crossProject = await this.artifacts.write({
      type: "cross-project-executive-report",
      createdBy: "supreme_coordinator",
      body: crossProjectBody({ generatedAt, portfolio }),
      status: "submitted",
      metadata: {
        projects_count: portfolio.length,
        projects_at_risk: portfolio.filter((item) => item.risk !== "clear").length,
        managers_count: [...new Set(portfolio.map((item) => item.manager_agent_id))].length,
      },
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
      `Generated business reports ${executive.id}, ${crossProject.id}, and ${operating.id}.`,
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
      cross_project_report: crossProject,
      business_operating_report: operating,
      metrics,
      portfolio,
      next_actions: actions,
    };
  }
}
