import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { workspacePaths } from "../paths.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";
import {
  GitHubSignalSyncService,
  type GitHubSignalClient,
  type GitHubSignalSyncResult,
} from "../github/signal-sync.js";
import { parseGitHubRepository } from "../github/repository-utils.js";

export type RepositoryVerificationStatus =
  | "missing"
  | "unsupported"
  | "unverified"
  | "verified"
  | "attention";

export interface RepositoryVerificationItem {
  project: ProjectRecord;
  client?: ClientRecord;
  repository: string;
  parsed_repository: string;
  status: RepositoryVerificationStatus;
  reasons: string[];
  issues_count: number;
  pull_requests_count: number;
  checks_count: number;
  failing_checks_count: number;
  stale_issues_count: number;
  stale_pull_requests_count: number;
  signal_report_id: string;
  signal?: GitHubSignalSyncResult;
}

export interface ProjectRepositoryVerificationInput {
  projectId?: string;
  runId?: string;
  staleDays?: number;
}

export interface ProjectRepositoryVerificationResult {
  generated_at: string;
  report: ArtifactRecord;
  projects: RepositoryVerificationItem[];
}

export interface ProjectRepositoryVerificationDeps {
  projects?: ProjectRegistry;
  clients?: ClientRegistry;
  artifacts?: ArtifactStore;
  audit?: AuditLog;
  githubClient?: GitHubSignalClient;
}

function summarize(items: readonly RepositoryVerificationItem[]) {
  return {
    project_count: items.length,
    missing_count: items.filter((item) => item.status === "missing").length,
    unsupported_count: items.filter((item) => item.status === "unsupported").length,
    unverified_count: items.filter((item) => item.status === "unverified").length,
    verified_count: items.filter((item) => item.status === "verified").length,
    attention_count: items.filter((item) => item.status === "attention").length,
  };
}

function reportBody(generatedAt: string, items: readonly RepositoryVerificationItem[]): string {
  return `# Project Repository Verification

Generated: ${generatedAt}

## Portfolio

${
  items.length === 0
    ? "- No projects recorded."
    : items
        .map((item) => {
          const repo = item.parsed_repository || item.repository || "(none)";
          return `- ${item.project.name}: ${item.status}, repo ${repo}, issues ${item.issues_count}, PRs ${item.pull_requests_count}, failing checks ${item.failing_checks_count}, stale work ${item.stale_issues_count + item.stale_pull_requests_count}.`;
        })
        .join("\n")
}

## Findings

${
  items.length === 0
    ? "- Create or import the first project before repository verification can act."
    : items
        .map(
          (item) => `### ${item.project.name}

${item.reasons.map((reason) => `- ${reason}`).join("\n")}`,
        )
        .join("\n\n")
}

## Operating Boundary

- Repository verification observes delivery state; it does not modify code.
- Failed checks, stale PRs, and stale issues should feed triage runs before owner interruption.
- Missing or unsupported repositories should be handled by the Project Manager or repository provisioning flow.
`;
}

export class ProjectRepositoryVerificationService {
  private readonly projects: ProjectRegistry;
  private readonly clients: ClientRegistry;
  private readonly artifacts: ArtifactStore;
  private readonly audit: AuditLog;
  private readonly githubClient?: GitHubSignalClient;

  constructor(
    private readonly workspaceRoot: string,
    deps: ProjectRepositoryVerificationDeps = {},
  ) {
    this.projects = deps.projects ?? new ProjectRegistry(workspaceRoot);
    this.clients = deps.clients ?? new ClientRegistry(workspaceRoot);
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.githubClient = deps.githubClient;
  }

  async verify(
    input: ProjectRepositoryVerificationInput = {},
  ): Promise<ProjectRepositoryVerificationResult> {
    const generatedAt = new Date().toISOString();
    const [projects, clients] = await Promise.all([this.projects.list(), this.clients.list()]);
    const clientsById = new Map(clients.map((client) => [client.id, client]));
    const selectedProjects = input.projectId
      ? projects.filter((project) => project.id === input.projectId)
      : projects;
    const items: RepositoryVerificationItem[] = [];
    const sync = this.githubClient
      ? new GitHubSignalSyncService(this.workspaceRoot, {
          githubClient: this.githubClient,
          artifacts: this.artifacts,
          audit: this.audit,
          clients: this.clients,
        })
      : undefined;

    for (const project of selectedProjects) {
      const client = clientsById.get(project.client_id);
      const repository = project.repository.trim();
      if (!repository) {
        items.push({
          project,
          ...(client ? { client } : {}),
          repository,
          parsed_repository: "",
          status: "missing",
          reasons: ["project has no repository linked"],
          issues_count: 0,
          pull_requests_count: 0,
          checks_count: 0,
          failing_checks_count: 0,
          stale_issues_count: 0,
          stale_pull_requests_count: 0,
          signal_report_id: "",
        });
        continue;
      }

      const parsed = parseGitHubRepository(repository);
      if (!parsed) {
        items.push({
          project,
          ...(client ? { client } : {}),
          repository,
          parsed_repository: "",
          status: "unsupported",
          reasons: ["repository is not a supported GitHub URL or owner/repo shorthand"],
          issues_count: 0,
          pull_requests_count: 0,
          checks_count: 0,
          failing_checks_count: 0,
          stale_issues_count: 0,
          stale_pull_requests_count: 0,
          signal_report_id: "",
        });
        continue;
      }

      if (!sync) {
        items.push({
          project,
          ...(client ? { client } : {}),
          repository,
          parsed_repository: parsed.repository,
          status: "unverified",
          reasons: [
            "GitHub client is not configured; repository shape was parsed but live state was not checked",
          ],
          issues_count: 0,
          pull_requests_count: 0,
          checks_count: 0,
          failing_checks_count: 0,
          stale_issues_count: 0,
          stale_pull_requests_count: 0,
          signal_report_id: "",
        });
        continue;
      }

      const signal = await sync.sync({
        owner: parsed.owner,
        repo: parsed.repo,
        ...(input.staleDays !== undefined ? { staleDays: input.staleDays } : {}),
      });
      const staleCount = signal.staleIssues.length + signal.stalePullRequests.length;
      const attention = signal.failingChecks.length > 0 || staleCount > 0;
      const reasons = attention
        ? [
            ...(signal.failingChecks.length
              ? [`${signal.failingChecks.length} failing check(s) detected`]
              : []),
            ...(staleCount ? [`${staleCount} stale GitHub work item(s) detected`] : []),
          ]
        : ["repository live state verified; no failing checks or stale work detected"];
      items.push({
        project,
        ...(client ? { client } : {}),
        repository,
        parsed_repository: parsed.repository,
        status: attention ? "attention" : "verified",
        reasons,
        issues_count: signal.issues.length,
        pull_requests_count: signal.pullRequests.length,
        checks_count: signal.checks.length,
        failing_checks_count: signal.failingChecks.length,
        stale_issues_count: signal.staleIssues.length,
        stale_pull_requests_count: signal.stalePullRequests.length,
        signal_report_id: signal.report.id,
        signal,
      });
    }

    const summary = summarize(items);
    const report = await this.artifacts.write({
      type: "repository-verification-report",
      createdBy: "supreme_coordinator",
      status: "submitted",
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      metadata: {
        ...summary,
        stale_days: input.staleDays ?? 14,
      },
      body: reportBody(generatedAt, items),
    });

    await this.audit.append({
      actor: "supreme_coordinator",
      action: "project.repositories.verified",
      target: input.projectId ?? "all",
      artifact_id: report.id,
      result: "ok",
    });

    return { generated_at: generatedAt, report, projects: items };
  }
}
