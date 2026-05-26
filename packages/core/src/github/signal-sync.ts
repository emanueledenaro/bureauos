import { join } from "node:path";
import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { workspacePaths } from "../paths.js";
import { readDoc, writeDoc, type FrontMatter } from "../registries/base.js";
import { ClientRegistry } from "../registries/client.js";
import { OpportunityRegistry, type OpportunityRecord } from "../registries/opportunity.js";
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";
import { createGitHubIssueOpportunities } from "./opportunity-import.js";
import { parseGitHubRepository } from "./repository-utils.js";

export interface GitHubSignalIssue {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  labels: readonly string[];
  state: "open" | "closed";
  updatedAt: string;
}

export interface GitHubSignalPullRequest {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  head: string;
  headSha: string;
  base: string;
  state: "open" | "closed" | "merged";
  updatedAt: string;
}

export type GitHubSignalCheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "startup_failure"
  | "stale"
  | null;

export interface GitHubSignalCheckRun {
  owner: string;
  repo: string;
  id: number;
  name: string;
  url: string;
  status: "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";
  conclusion: GitHubSignalCheckConclusion;
  headSha: string;
  startedAt: string;
  completedAt: string;
}

export interface GitHubSignalClient {
  listIssues(
    owner: string,
    repo: string,
    filter?: { state?: "open" | "closed" | "all" },
  ): Promise<readonly GitHubSignalIssue[]>;
  listPullRequests(
    owner: string,
    repo: string,
    filter?: { state?: "open" | "closed" | "all" },
  ): Promise<readonly GitHubSignalPullRequest[]>;
  listCheckRunsForRef(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<readonly GitHubSignalCheckRun[]>;
}

export interface GitHubSignalSyncInput {
  owner: string;
  repo: string;
  state?: "open" | "closed" | "all";
  clientSlug?: string;
  projectSlug?: string;
  includeIssues?: boolean;
  includePullRequests?: boolean;
  includeChecks?: boolean;
  staleDays?: number;
}

export interface GitHubSignalSyncResult {
  repository: string;
  issues: readonly GitHubSignalIssue[];
  pullRequests: readonly GitHubSignalPullRequest[];
  checks: readonly GitHubSignalCheckRun[];
  failingChecks: readonly GitHubSignalCheckRun[];
  staleIssues: readonly GitHubSignalIssue[];
  stalePullRequests: readonly GitHubSignalPullRequest[];
  createdOpportunities: OpportunityRecord[];
  project?: ProjectRecord;
  report: ArtifactRecord;
}

export interface GitHubSignalSyncDeps {
  githubClient: GitHubSignalClient;
  artifacts?: ArtifactStore;
  audit?: AuditLog;
  clients?: ClientRegistry;
  opportunities?: OpportunityRegistry;
  projects?: ProjectRegistry;
}

const FAILING_CONCLUSIONS = new Set<GitHubSignalCheckConclusion>([
  "failure",
  "timed_out",
  "action_required",
  "startup_failure",
  "cancelled",
  "stale",
]);

function repoTarget(owner: string, repo: string): string {
  const cleanOwner = owner.trim();
  const cleanRepo = repo.trim();
  if (!cleanOwner || !cleanRepo) throw new Error("owner and repo are required");
  return `${cleanOwner}/${cleanRepo}`;
}

function isFailingCheck(check: GitHubSignalCheckRun): boolean {
  return check.status === "completed" && FAILING_CONCLUSIONS.has(check.conclusion);
}

function staleCutoff(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function isStale(updatedAt: string, cutoff: number): boolean {
  if (!updatedAt) return false;
  const value = Date.parse(updatedAt);
  return Number.isFinite(value) && value < cutoff;
}

function checkKey(check: GitHubSignalCheckRun): string {
  return `${check.headSha}:${check.id}`;
}

function uniqueChecks(checks: readonly GitHubSignalCheckRun[]): GitHubSignalCheckRun[] {
  const seen = new Set<string>();
  const out: GitHubSignalCheckRun[] = [];
  for (const check of checks) {
    const key = checkKey(check);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(check);
  }
  return out;
}

function checksForPullRequest(
  checks: readonly GitHubSignalCheckRun[],
  pullRequest: GitHubSignalPullRequest,
): readonly GitHubSignalCheckRun[] {
  return checks.filter((check) => check.headSha === pullRequest.headSha);
}

function pullRequestCheckSummary(
  checks: readonly GitHubSignalCheckRun[],
  pullRequest: GitHubSignalPullRequest,
): string {
  const prChecks = checksForPullRequest(checks, pullRequest);
  const failed = prChecks.filter(isFailingCheck);
  return `#${pullRequest.number} ${pullRequest.state} checks=${prChecks.length} failing=${failed.length} head=${pullRequest.headSha.slice(0, 12)}`;
}

function repositoryMatchesProject(project: ProjectRecord, repository: string): boolean {
  const parsed = parseGitHubRepository(project.repository);
  return parsed?.repository.toLowerCase() === repository.toLowerCase();
}

function reportBody(args: {
  repository: string;
  project?: ProjectRecord;
  issues: readonly GitHubSignalIssue[];
  pullRequests: readonly GitHubSignalPullRequest[];
  checks: readonly GitHubSignalCheckRun[];
  failingChecks: readonly GitHubSignalCheckRun[];
  staleIssues: readonly GitHubSignalIssue[];
  stalePullRequests: readonly GitHubSignalPullRequest[];
  createdOpportunities: readonly OpportunityRecord[];
  staleDays: number;
}): string {
  const {
    repository,
    project,
    issues,
    pullRequests,
    checks,
    failingChecks,
    staleIssues,
    stalePullRequests,
    createdOpportunities,
    staleDays,
  } = args;
  return `# GitHub Signal Report

## Repository

- Repository: ${repository}
- Project: ${project ? `${project.name} (${project.slug})` : "(unlinked)"}
- Issues observed: ${issues.length}
- Pull requests observed: ${pullRequests.length}
- Check runs observed: ${checks.length}
- Failing checks: ${failingChecks.length}
- Stale threshold: ${staleDays} days
- Stale issues: ${staleIssues.length}
- Stale pull requests: ${stalePullRequests.length}
- New opportunities: ${createdOpportunities.length}

## Issues

${
  issues.length
    ? issues
        .map((issue) => `- #${issue.number} ${issue.state} ${issue.title} (${issue.url})`)
        .join("\n")
    : "- none"
}

## Pull Requests

${
  pullRequests.length
    ? pullRequests
        .map((pr) => {
          const prChecks = checksForPullRequest(checks, pr);
          const failed = prChecks.filter(isFailingCheck);
          return `- #${pr.number} ${pr.state} ${pr.title} (${pr.url}) - checks: ${prChecks.length}, failing: ${failed.length}`;
        })
        .join("\n")
    : "- none"
}

## Run And Health Summary

${
  pullRequests.length
    ? pullRequests.map((pr) => `- ${pullRequestCheckSummary(checks, pr)}`).join("\n")
    : "- no pull request check state observed"
}

- Failing check trigger candidates: ${failingChecks.length}
- Stale issue trigger candidates: ${staleIssues.length}
- Stale pull request trigger candidates: ${stalePullRequests.length}

## Failing Checks

${
  failingChecks.length
    ? failingChecks
        .map(
          (check) =>
            `- ${check.name} ${check.conclusion ?? check.status} on ${check.headSha.slice(0, 12)} (${check.url})`,
        )
        .join("\n")
    : "- none"
}

## Stale Work

${
  [
    ...staleIssues.map((issue) => `- issue #${issue.number}: ${issue.title}`),
    ...stalePullRequests.map((pr) => `- pr #${pr.number}: ${pr.title}`),
  ].join("\n") || "- none"
}

## Autonomous Interpretation

BureauOS observed GitHub as an external delivery signal. Failed checks and stale work should become health-check or bug triage runs before owner attention is requested.
`;
}

function projectSignalMemorySection(args: {
  generatedAt: string;
  repository: string;
  report: ArtifactRecord;
  issues: readonly GitHubSignalIssue[];
  pullRequests: readonly GitHubSignalPullRequest[];
  checks: readonly GitHubSignalCheckRun[];
  failingChecks: readonly GitHubSignalCheckRun[];
  staleIssues: readonly GitHubSignalIssue[];
  stalePullRequests: readonly GitHubSignalPullRequest[];
}): string {
  const {
    generatedAt,
    repository,
    report,
    issues,
    pullRequests,
    checks,
    failingChecks,
    staleIssues,
    stalePullRequests,
  } = args;
  return `## GitHub Signal Sync - ${generatedAt}

- Repository: ${repository}
- Report: ${report.id}
- Issues: ${issues.length} observed, ${staleIssues.length} stale
- Pull requests: ${pullRequests.length} observed, ${stalePullRequests.length} stale
- Check runs: ${checks.length} observed, ${failingChecks.length} failing

### Issue State

${
  issues.length
    ? issues
        .slice(0, 10)
        .map((issue) => `- Issue #${issue.number} ${issue.state}: ${issue.title}`)
        .join("\n")
    : "- none"
}

### Pull Request State

${
  pullRequests.length
    ? pullRequests
        .map((pr) => `- PR ${pullRequestCheckSummary(checks, pr)}: ${pr.title}`)
        .join("\n")
    : "- none"
}

### Check State

${
  failingChecks.length
    ? failingChecks
        .map(
          (check) =>
            `- ${check.name} ${check.conclusion ?? check.status} on ${check.headSha.slice(0, 12)}`,
        )
        .join("\n")
    : "- no failing checks"
}
`;
}

export class GitHubSignalSyncService {
  private readonly artifacts: ArtifactStore;
  private readonly audit: AuditLog;
  private readonly clients: ClientRegistry;
  private readonly opportunities: OpportunityRegistry;
  private readonly projects: ProjectRegistry;
  private readonly githubClient: GitHubSignalClient;

  constructor(
    private readonly workspaceRoot: string,
    deps: GitHubSignalSyncDeps,
  ) {
    this.githubClient = deps.githubClient;
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.clients = deps.clients ?? new ClientRegistry(workspaceRoot);
    this.opportunities = deps.opportunities ?? new OpportunityRegistry(workspaceRoot);
    this.projects = deps.projects ?? new ProjectRegistry(workspaceRoot);
  }

  private async resolveProject(
    input: GitHubSignalSyncInput,
    repository: string,
  ): Promise<ProjectRecord | undefined> {
    if (input.projectSlug) {
      const project = await this.projects.get(input.projectSlug);
      if (!project) throw new Error(`project not found: ${input.projectSlug}`);
      return project;
    }

    const projects = await this.projects.list();
    return projects.find((project) => repositoryMatchesProject(project, repository));
  }

  private async appendProjectMemory(args: {
    project: ProjectRecord;
    generatedAt: string;
    repository: string;
    report: ArtifactRecord;
    issues: readonly GitHubSignalIssue[];
    pullRequests: readonly GitHubSignalPullRequest[];
    checks: readonly GitHubSignalCheckRun[];
    failingChecks: readonly GitHubSignalCheckRun[];
    staleIssues: readonly GitHubSignalIssue[];
    stalePullRequests: readonly GitHubSignalPullRequest[];
  }): Promise<void> {
    const path = join(workspacePaths(this.workspaceRoot).projectsDir, args.project.slug, "RUNS.md");
    const doc = await readDoc<FrontMatter>(path);
    const body = `${doc.body.trimEnd()}\n\n${projectSignalMemorySection(args)}\n`;
    await writeDoc(path, doc.front, body);
    await this.projects.update(args.project.slug, {});
  }

  async sync(input: GitHubSignalSyncInput): Promise<GitHubSignalSyncResult> {
    const repository = repoTarget(input.owner, input.repo);
    const [owner, repo] = repository.split("/") as [string, string];
    const state = input.state ?? "open";
    const includeIssues = input.includeIssues !== false;
    const includePullRequests = input.includePullRequests !== false;
    const includeChecks = input.includeChecks !== false;
    const staleDays = input.staleDays ?? 14;

    const issues = includeIssues
      ? await this.githubClient.listIssues(owner, repo, { state })
      : ([] as GitHubSignalIssue[]);
    const pullRequests = includePullRequests
      ? await this.githubClient.listPullRequests(owner, repo, { state })
      : ([] as GitHubSignalPullRequest[]);
    const checks = includeChecks
      ? uniqueChecks(
          (
            await Promise.all(
              pullRequests
                .filter((pr) => pr.headSha)
                .map((pr) => this.githubClient.listCheckRunsForRef(owner, repo, pr.headSha)),
            )
          ).flat(),
        )
      : [];

    const failingChecks = checks.filter(isFailingCheck);
    const cutoff = staleCutoff(staleDays);
    const staleIssues = issues.filter(
      (issue) => issue.state === "open" && isStale(issue.updatedAt, cutoff),
    );
    const stalePullRequests = pullRequests.filter(
      (pr) => pr.state === "open" && isStale(pr.updatedAt, cutoff),
    );
    const project = await this.resolveProject(input, repository);
    const createdOpportunities = await createGitHubIssueOpportunities({
      clients: this.clients,
      opportunities: this.opportunities,
      owner,
      repo,
      issues,
      clientSlug: input.clientSlug,
    });

    const report = await this.artifacts.write({
      type: "github-signal-report",
      createdBy: "supreme_coordinator",
      ...(project ? { projectId: project.id, clientId: project.client_id } : {}),
      metadata: {
        repository,
        ...(project
          ? { project_slug: project.slug, project_name: project.name, linked_project: true }
          : { linked_project: false }),
        issues_count: issues.length,
        issue_state_refs: issues
          .slice(0, 10)
          .map((issue) => `#${issue.number} ${issue.state} ${issue.title}`),
        pull_requests_count: pullRequests.length,
        pull_request_refs: pullRequests
          .slice(0, 3)
          .map((pr) => `#${pr.number} ${pr.state} ${pr.title}`),
        pull_request_urls: pullRequests.slice(0, 3).map((pr) => pr.url),
        pull_request_check_summary: pullRequests
          .slice(0, 10)
          .map((pr) => pullRequestCheckSummary(checks, pr)),
        checks_count: checks.length,
        failing_checks_count: failingChecks.length,
        failing_check_refs: failingChecks
          .slice(0, 10)
          .map((check) => `${check.name} ${check.conclusion ?? check.status} ${check.headSha}`),
        stale_issues_count: staleIssues.length,
        stale_pull_requests_count: stalePullRequests.length,
      },
      body: reportBody({
        repository,
        ...(project ? { project } : {}),
        issues,
        pullRequests,
        checks,
        failingChecks,
        staleIssues,
        stalePullRequests,
        createdOpportunities,
        staleDays,
      }),
    });

    if (project) {
      await this.appendProjectMemory({
        project,
        generatedAt: report.created,
        repository,
        report,
        issues,
        pullRequests,
        checks,
        failingChecks,
        staleIssues,
        stalePullRequests,
      });
      await this.audit.append({
        actor: "supreme_coordinator",
        action: "github.signals.project_memory_updated",
        target: project.id,
        capability: "github.sync",
        artifact_id: report.id,
        result: "ok",
      });
    }

    for (const check of failingChecks) {
      await this.audit.append({
        actor: "supreme_coordinator",
        action: "github.check_failed.detected",
        target: `${repository}@${check.headSha}:${check.name}`,
        capability: "github.checks.read",
        artifact_id: report.id,
        result: "ok",
      });
    }

    for (const pr of stalePullRequests) {
      await this.audit.append({
        actor: "supreme_coordinator",
        action: "github.pr_stale.detected",
        target: `${repository}#${pr.number}`,
        capability: "github.pulls.read",
        artifact_id: report.id,
        result: "ok",
      });
    }

    for (const issue of staleIssues) {
      await this.audit.append({
        actor: "supreme_coordinator",
        action: "github.issue_stale.detected",
        target: `${repository}#${issue.number}`,
        capability: "github.issues.read",
        artifact_id: report.id,
        result: "ok",
      });
    }

    await this.audit.append({
      actor: "supreme_coordinator",
      action: "github.signals.synced",
      target: repository,
      capability: "github.sync",
      artifact_id: report.id,
      result: "ok",
    });

    return {
      repository,
      issues,
      pullRequests,
      checks,
      failingChecks,
      staleIssues,
      stalePullRequests,
      createdOpportunities,
      ...(project ? { project } : {}),
      report,
    };
  }
}
