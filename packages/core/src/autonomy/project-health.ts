import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { OpportunityRegistry, type OpportunityRecord } from "../registries/opportunity.js";
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";
import { RunEngine, type RunRecord } from "../runs/engine.js";
import { listDocs, readDoc } from "../registries/base.js";

export type ProjectHealthRisk = "blocked" | "needs_human" | "approval" | "watch" | "clear";

export interface ProjectHealthItem {
  project: ProjectRecord;
  client?: ClientRecord;
  risk: ProjectHealthRisk;
  score: number;
  reasons: string[];
  next_action: string;
  pending_approvals: number;
  active_runs: number;
  runs_needing_human: number;
  github_failing_checks: number;
  github_stale_items: number;
  github_open_pull_requests: number;
  latest_github_signal_at: string;
  open_pipeline_value: number;
  latest_run_at: string;
}

export interface ProjectHealthReviewInput {
  runId?: string;
  projectId?: string;
  now?: Date;
}

export interface ProjectHealthReviewResult {
  generated_at: string;
  report: ArtifactRecord;
  projects: ProjectHealthItem[];
}

export interface ProjectHealthReviewDeps {
  projects?: ProjectRegistry;
  clients?: ClientRegistry;
  opportunities?: OpportunityRegistry;
  approvals?: ApprovalRegistry;
  artifacts?: ArtifactStore;
  audit?: AuditLog;
  runs?: RunEngine;
}

const ACTIVE_STATUSES = new Set(["proposal", "approved", "in_progress", "intake"]);
const CLOSED_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function daysBetween(now: Date, iso: string): number | undefined {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.floor((now.getTime() - timestamp) / (24 * 60 * 60 * 1000));
}

function latestRunAt(runs: readonly RunRecord[]): string {
  return (
    runs
      .map((run) => run.updated || run.created)
      .filter(Boolean)
      .sort()
      .at(-1) ?? ""
  );
}

function latestArtifact(records: readonly ArtifactRecord[]): ArtifactRecord | undefined {
  return records
    .filter((record) => record.created)
    .sort((a, b) => a.created.localeCompare(b.created))
    .at(-1);
}

function frontNumber(record: ArtifactRecord | undefined, key: string): number {
  const value = record?.[key];
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function approvalMatchesProject(scope: string, target: string, project: ProjectRecord): boolean {
  const haystack = `${scope} ${target}`.toLowerCase();
  return (
    haystack.includes(project.id.toLowerCase()) || haystack.includes(project.name.toLowerCase())
  );
}

function riskFor(args: {
  project: ProjectRecord;
  pendingApprovals: number;
  activeRuns: number;
  runsNeedingHuman: number;
  githubFailingChecks: number;
  githubStaleItems: number;
  ageDays?: number;
}): ProjectHealthRisk {
  if (args.project.status === "blocked") return "blocked";
  if (args.runsNeedingHuman > 0) return "needs_human";
  if (args.pendingApprovals > 0) return "approval";
  if (args.githubFailingChecks > 0 || args.githubStaleItems > 0) return "watch";
  if (
    ACTIVE_STATUSES.has(args.project.status) &&
    (args.activeRuns === 0 || (args.ageDays !== undefined && args.ageDays >= 7))
  ) {
    return "watch";
  }
  return "clear";
}

function scoreFor(args: {
  risk: ProjectHealthRisk;
  pendingApprovals: number;
  activeRuns: number;
  runsNeedingHuman: number;
  githubFailingChecks: number;
  githubStaleItems: number;
  openPipelineValue: number;
  ageDays?: number;
}): number {
  let score = 100;
  if (args.risk === "blocked") score -= 45;
  if (args.risk === "needs_human") score -= 35;
  if (args.risk === "approval") score -= 20;
  if (args.risk === "watch") score -= 15;
  score -= Math.min(15, args.pendingApprovals * 5);
  score -= Math.min(20, args.runsNeedingHuman * 10);
  score -= Math.min(25, args.githubFailingChecks * 10);
  score -= Math.min(15, args.githubStaleItems * 5);
  if (args.activeRuns === 0) score -= 8;
  if (args.openPipelineValue > 0) score += 5;
  if (args.ageDays !== undefined && args.ageDays >= 14) score -= 10;
  return Math.max(0, Math.min(100, score));
}

function reasonsFor(args: {
  project: ProjectRecord;
  pendingApprovals: number;
  activeRuns: number;
  runsNeedingHuman: number;
  githubFailingChecks: number;
  githubStaleItems: number;
  openPipelineValue: number;
  ageDays?: number;
}): string[] {
  const reasons: string[] = [];
  if (args.project.status === "blocked") reasons.push("project is blocked");
  if (args.runsNeedingHuman > 0) reasons.push(`${args.runsNeedingHuman} run(s) need owner input`);
  if (args.pendingApprovals > 0) reasons.push(`${args.pendingApprovals} pending approval gate(s)`);
  if (args.githubFailingChecks > 0)
    reasons.push(`${args.githubFailingChecks} failing GitHub check signal(s)`);
  if (args.githubStaleItems > 0)
    reasons.push(`${args.githubStaleItems} stale GitHub issue/PR signal(s)`);
  if (args.activeRuns === 0 && ACTIVE_STATUSES.has(args.project.status)) {
    reasons.push("no active run is moving this project");
  }
  if (args.ageDays !== undefined && args.ageDays >= 7) {
    reasons.push(`project memory has not changed for ${args.ageDays} day(s)`);
  }
  if (args.openPipelineValue > 0)
    reasons.push(`client has ${money(args.openPipelineValue)} open pipeline`);
  if (reasons.length === 0) reasons.push("no immediate delivery risk detected");
  return reasons;
}

function nextAction(risk: ProjectHealthRisk): string {
  switch (risk) {
    case "blocked":
      return "Start or review an unblock triage run before assigning more delivery work.";
    case "needs_human":
      return "Resolve owner input requests so autonomous work can continue.";
    case "approval":
      return "Review approval gates before external commitments or delivery escalation.";
    case "watch":
      return "Dispatch the Project Manager to refresh scope, next tasks, and delivery cadence.";
    case "clear":
      return "Keep the cadence and continue monitoring repository, approvals, and run signals.";
  }
}

function reportBody(generatedAt: string, items: readonly ProjectHealthItem[]): string {
  return `# Project Health Review

Generated: ${generatedAt}

## Portfolio

${
  items.length === 0
    ? "- No projects recorded."
    : items
        .map((item) => {
          return `- ${item.project.name}: risk ${item.risk}, score ${item.score}/100, approvals ${item.pending_approvals}, active runs ${item.active_runs}, GitHub failing checks ${item.github_failing_checks}, stale GitHub items ${item.github_stale_items}, pipeline ${money(item.open_pipeline_value)}. Next: ${item.next_action}`;
        })
        .join("\n")
}

## Findings

${
  items.length === 0
    ? "- Create or import the first project before project health checks can act."
    : items
        .map((item) => {
          return `### ${item.project.name}

${item.reasons.map((reason) => `- ${reason}`).join("\n")}`;
        })
        .join("\n\n")
}

## Operating Boundary

- Safe autonomous work: internal triage, PM dispatch packets, issue drafts, report updates, and test/review planning.
- Owner approval is still required for external commitments, client messages, production deploys, billing, legal terms, destructive actions, and scope or price changes.
`;
}

export class ProjectHealthReviewService {
  private readonly projects: ProjectRegistry;
  private readonly clients: ClientRegistry;
  private readonly opportunities: OpportunityRegistry;
  private readonly approvals: ApprovalRegistry;
  private readonly artifacts: ArtifactStore;
  private readonly audit: AuditLog;
  private readonly runs?: RunEngine;

  constructor(
    public readonly workspaceRoot: string,
    deps: ProjectHealthReviewDeps = {},
  ) {
    this.projects = deps.projects ?? new ProjectRegistry(workspaceRoot);
    this.clients = deps.clients ?? new ClientRegistry(workspaceRoot);
    this.opportunities = deps.opportunities ?? new OpportunityRegistry(workspaceRoot);
    this.approvals = deps.approvals ?? new ApprovalRegistry(workspaceRoot);
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.runs = deps.runs;
  }

  private async listRuns(): Promise<RunRecord[]> {
    if (this.runs) return this.runs.list();
    const files = await listDocs(workspacePaths(this.workspaceRoot).runsDir);
    const out: RunRecord[] = [];
    for (const file of files) {
      const doc = await readDoc<RunRecord>(file);
      out.push(doc.front);
    }
    return out;
  }

  async generate(input: ProjectHealthReviewInput = {}): Promise<ProjectHealthReviewResult> {
    const now = input.now ?? new Date();
    const generatedAt = now.toISOString();
    const [projects, clients, opportunities, approvals, runs, githubSignalReports] =
      await Promise.all([
        this.projects.list(),
        this.clients.list(),
        this.opportunities.list(),
        this.approvals.listPending(),
        this.listRuns(),
        this.artifacts.list({ type: "github-signal-report" }),
      ]);
    const clientsById = new Map(clients.map((client) => [client.id, client]));
    const selectedProjects = input.projectId
      ? projects.filter((project) => project.id === input.projectId)
      : projects;
    const items = selectedProjects.map((project): ProjectHealthItem => {
      const projectRuns = runs.filter((run) => run.project_id === project.id);
      const latestGithubSignal = latestArtifact(
        githubSignalReports.filter((report) => report.project_id === project.id),
      );
      const githubFailingChecks = frontNumber(latestGithubSignal, "failing_checks_count");
      const githubStaleItems =
        frontNumber(latestGithubSignal, "stale_issues_count") +
        frontNumber(latestGithubSignal, "stale_pull_requests_count");
      const githubOpenPullRequests = frontNumber(latestGithubSignal, "pull_requests_count");
      const activeRuns = projectRuns.filter((run) => !CLOSED_RUN_STATUSES.has(run.status));
      const runsNeedingHuman = activeRuns.filter((run) => run.status === "needs_human").length;
      const pendingApprovals = approvals.filter((approval) =>
        approvalMatchesProject(approval.scope, approval.target, project),
      ).length;
      const clientOpportunities = opportunities.filter(
        (opportunity: OpportunityRecord) =>
          opportunity.client_id === project.client_id &&
          !["won", "lost"].includes(opportunity.status),
      );
      const openPipelineValue = clientOpportunities.reduce(
        (sum, opportunity) => sum + (opportunity.expected_value || 0),
        0,
      );
      const ageDays = daysBetween(now, project.updated);
      const risk = riskFor({
        project,
        pendingApprovals,
        activeRuns: activeRuns.length,
        runsNeedingHuman,
        githubFailingChecks,
        githubStaleItems,
        ageDays,
      });
      return {
        project,
        ...(clientsById.get(project.client_id)
          ? { client: clientsById.get(project.client_id)! }
          : {}),
        risk,
        score: scoreFor({
          risk,
          pendingApprovals,
          activeRuns: activeRuns.length,
          runsNeedingHuman,
          githubFailingChecks,
          githubStaleItems,
          openPipelineValue,
          ageDays,
        }),
        reasons: reasonsFor({
          project,
          pendingApprovals,
          activeRuns: activeRuns.length,
          runsNeedingHuman,
          githubFailingChecks,
          githubStaleItems,
          openPipelineValue,
          ageDays,
        }),
        next_action: nextAction(risk),
        pending_approvals: pendingApprovals,
        active_runs: activeRuns.length,
        runs_needing_human: runsNeedingHuman,
        github_failing_checks: githubFailingChecks,
        github_stale_items: githubStaleItems,
        github_open_pull_requests: githubOpenPullRequests,
        latest_github_signal_at: latestGithubSignal?.created ?? "",
        open_pipeline_value: openPipelineValue,
        latest_run_at: latestRunAt(projectRuns),
      };
    });

    const report = await this.artifacts.write({
      type: "project-health-report",
      createdBy: "supreme_coordinator",
      ...(input.runId ? { runId: input.runId } : {}),
      status: "submitted",
      metadata: {
        generated_at: generatedAt,
        project_count: items.length,
        blocked_count: items.filter((item) => item.risk === "blocked").length,
        needs_human_count: items.filter((item) => item.risk === "needs_human").length,
        approval_count: items.filter((item) => item.risk === "approval").length,
        watch_count: items.filter((item) => item.risk === "watch").length,
        github_attention_count: items.filter(
          (item) => item.github_failing_checks > 0 || item.github_stale_items > 0,
        ).length,
      },
      body: reportBody(generatedAt, items),
    });
    await this.audit.append({
      actor: "supreme_coordinator",
      action: "project.health_review.generated",
      target: input.projectId ?? "portfolio",
      artifact_id: report.id,
      result: "ok",
    });

    return {
      generated_at: generatedAt,
      report,
      projects: items,
    };
  }
}
