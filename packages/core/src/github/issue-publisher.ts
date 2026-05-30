import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import type { BureauConfig } from "../config/schema.js";
import { PolicyEngine, type PolicyDecision } from "../policy/engine.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry, type ApprovalRecord } from "../registries/approval.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";

export interface GitHubIssuePublishClientIssue {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  labels: readonly string[];
  state: "open" | "closed";
}

export interface GitHubIssuePublishClient {
  createIssue(
    owner: string,
    repo: string,
    input: { title: string; body: string; labels?: readonly string[] },
  ): Promise<GitHubIssuePublishClientIssue>;
  ensureLabels?(
    owner: string,
    repo: string,
    labels: readonly { name: string; color?: string; description?: string }[],
  ): Promise<void>;
}

export interface GitHubIssuePublishInput {
  projectSlug: string;
  owner: string;
  repo: string;
  draftArtifactIds?: readonly string[];
  ensureLabels?: boolean;
}

export interface GitHubIssuePublishResult {
  status: "created" | "blocked";
  project: ProjectRecord;
  client?: ClientRecord;
  repository: {
    owner: string;
    repo: string;
    url: string;
  };
  policy: PolicyDecision;
  approval?: ApprovalRecord;
  created: GitHubIssuePublishClientIssue[];
  source_artifacts: string[];
  report?: ArtifactRecord;
}

export interface EnsureRepositoryLabelsInput {
  owner: string;
  repo: string;
  labels: readonly { name: string; color?: string; description?: string }[];
}

export interface EnsureRepositoryLabelsResult {
  status: "ensured" | "blocked";
  repository: {
    owner: string;
    repo: string;
    url: string;
  };
  policy: PolicyDecision;
  approval?: ApprovalRecord;
  labels: { name: string }[];
}

export interface GitHubIssuePublishDeps {
  config: BureauConfig;
  githubClient: GitHubIssuePublishClient;
  projects?: ProjectRegistry;
  clients?: ClientRegistry;
  artifacts?: ArtifactStore;
  approvals?: ApprovalRegistry;
  policy?: PolicyEngine;
  audit?: AuditLog;
}

interface LoadedDraft {
  artifact: ArtifactRecord;
  title: string;
  body: string;
  labels: string[];
}

function normalizeRepoTarget(
  owner: string,
  repo: string,
): { owner: string; repo: string; url: string } {
  const cleanOwner = owner.trim();
  const cleanRepo = repo.trim();
  if (!cleanOwner || !cleanRepo) throw new Error("owner and repo are required");
  return {
    owner: cleanOwner,
    repo: cleanRepo,
    url: `https://github.com/${cleanOwner}/${cleanRepo}`,
  };
}

function parseTitle(body: string): string {
  const line = body
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.startsWith("# "));
  return line ? line.replace(/^#\s+/, "").trim() : "BureauOS generated issue";
}

function parseLabels(body: string): string[] {
  const marker = body.indexOf("## Labels");
  if (marker < 0) return [];
  return body
    .slice(marker)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^-\s+/, "").trim())
    .filter(Boolean);
}

function issueBody(body: string): string {
  return `${body.replace(/\n## Labels\n[\s\S]*$/m, "").trim()}\n`;
}

function metadataLabels(record: ArtifactRecord): string[] {
  const labels = record["labels"];
  return Array.isArray(labels)
    ? labels.filter((item): item is string => typeof item === "string")
    : [];
}

function uniqueLabels(drafts: readonly LoadedDraft[]): string[] {
  return Array.from(new Set(drafts.flatMap((draft) => draft.labels))).sort();
}

function auditPolicyResult(
  outcome: PolicyDecision["outcome"],
): "allow" | "deny" | "require_approval" | "escalate" {
  return outcome === "require_more_context" ? "escalate" : outcome;
}

function publishReportBody(args: {
  project: ProjectRecord;
  client?: ClientRecord;
  repositoryUrl: string;
  created: readonly GitHubIssuePublishClientIssue[];
  sourceArtifacts: readonly string[];
  policy: PolicyDecision;
}): string {
  const { project, client, repositoryUrl, created, sourceArtifacts, policy } = args;
  return `# GitHub Issue Publish Report

## Context

- Client: ${client?.name ?? project.client_id}
- Project: ${project.name}
- Repository: ${repositoryUrl}
- Policy: ${policy.outcome} (${policy.reason})

## Created Issues

${created.map((issue) => `- #${issue.number} ${issue.title}: ${issue.url}`).join("\n")}

## Source Draft Artifacts

${sourceArtifacts.map((id) => `- ${id}`).join("\n")}
`;
}

export class GitHubIssuePublishService {
  private readonly projects: ProjectRegistry;
  private readonly clients: ClientRegistry;
  private readonly artifacts: ArtifactStore;
  private readonly approvals: ApprovalRegistry;
  private readonly policy: PolicyEngine;
  private readonly audit: AuditLog;
  private readonly githubClient: GitHubIssuePublishClient;

  constructor(
    private readonly workspaceRoot: string,
    deps: GitHubIssuePublishDeps,
  ) {
    this.projects = deps.projects ?? new ProjectRegistry(workspaceRoot);
    this.clients = deps.clients ?? new ClientRegistry(workspaceRoot);
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.approvals = deps.approvals ?? new ApprovalRegistry(workspaceRoot);
    this.policy = deps.policy ?? new PolicyEngine(deps.config, this.approvals);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.githubClient = deps.githubClient;
  }

  async publishProjectDrafts(input: GitHubIssuePublishInput): Promise<GitHubIssuePublishResult> {
    const repository = normalizeRepoTarget(input.owner, input.repo);
    const project = await this.projects.get(input.projectSlug);
    if (!project) throw new Error(`project not found: ${input.projectSlug}`);

    const allClients = await this.clients.list();
    const client = allClients.find((item) => item.id === project.client_id);
    const drafts = await this.loadDrafts(project, input.draftArtifactIds);
    if (drafts.length === 0) {
      throw new Error(`no github issue drafts found for project: ${project.slug}`);
    }
    const sourceArtifacts = drafts.map((draft) => draft.artifact.id);
    const decision = await this.policy.evaluate({
      action: "create_issues",
      actor: "supreme_coordinator",
      target: `${repository.owner}/${repository.repo}`,
      capability: "github.create_issue",
      riskClass: "medium",
    });

    if (!decision.allowed) {
      const approval = await this.findOrRequestApproval({
        project,
        repositoryUrl: repository.url,
        reason: decision.reason,
      });
      await this.audit.append({
        actor: "supreme_coordinator",
        action: "github.issue_publish.blocked",
        target: `${repository.owner}/${repository.repo}`,
        approval_id: approval.id,
        policy_result: auditPolicyResult(decision.outcome),
        result: "ok",
      });
      return {
        status: "blocked",
        project,
        ...(client ? { client } : {}),
        repository,
        policy: decision,
        approval,
        created: [],
        source_artifacts: sourceArtifacts,
      };
    }

    if (input.ensureLabels !== false && this.githubClient.ensureLabels) {
      await this.githubClient.ensureLabels(
        repository.owner,
        repository.repo,
        uniqueLabels(drafts).map((name) => ({ name })),
      );
    }

    const created: GitHubIssuePublishClientIssue[] = [];
    try {
      for (const draft of drafts) {
        created.push(
          await this.githubClient.createIssue(repository.owner, repository.repo, {
            title: draft.title,
            body: draft.body,
            labels: draft.labels,
          }),
        );
      }
    } catch (e) {
      await this.audit.append({
        actor: "supreme_coordinator",
        action: "github.issue_publish.failed",
        target: `${repository.owner}/${repository.repo}`,
        policy_result: auditPolicyResult(decision.outcome),
        result: "error",
        error: (e as Error).message,
      });
      throw e;
    }

    const report = await this.artifacts.write({
      type: "github-issue-publish-report",
      createdBy: "supreme_coordinator",
      projectId: project.id,
      ...(client ? { clientId: client.id } : {}),
      metadata: {
        owner: repository.owner,
        repo: repository.repo,
        created_issues: created.map((issue) => issue.url),
        source_artifacts: sourceArtifacts,
      },
      body: publishReportBody({
        project,
        client,
        repositoryUrl: repository.url,
        created,
        sourceArtifacts,
        policy: decision,
      }),
    });

    if (!project.repository) {
      await this.projects.update(project.slug, { repository: repository.url });
    }

    await this.audit.append({
      actor: "supreme_coordinator",
      action: "github.issue_publish.created",
      target: `${repository.owner}/${repository.repo}`,
      artifact_id: report.id,
      policy_result: auditPolicyResult(decision.outcome),
      result: "ok",
    });

    return {
      status: "created",
      project: project.repository ? project : { ...project, repository: repository.url },
      ...(client ? { client } : {}),
      repository,
      policy: decision,
      created,
      source_artifacts: sourceArtifacts,
      report,
    };
  }

  /**
   * Apply a label taxonomy to a repository behind the same policy gate + audit
   * trail as issue creation (SER-208). Previously the `github ensure-labels`
   * path called Octokit directly with no `PolicyEngine.evaluate` and no
   * `AuditLog` entry — a repo-mutating external write that bypassed the autonomy
   * boundary gating every other GitHub write. When policy blocks, no labels are
   * created, an approval is requested, and the block is reported; on success the
   * write is audited.
   */
  async ensureRepositoryLabels(
    input: EnsureRepositoryLabelsInput,
  ): Promise<EnsureRepositoryLabelsResult> {
    const repository = normalizeRepoTarget(input.owner, input.repo);
    const target = `${repository.owner}/${repository.repo}`;
    const decision = await this.policy.evaluate({
      action: "create_issues",
      actor: "supreme_coordinator",
      target,
      capability: "github.create_issue",
      riskClass: "medium",
    });

    if (!decision.allowed) {
      const approval = await this.findOrRequestLabelApproval(repository, decision.reason);
      await this.audit.append({
        actor: "supreme_coordinator",
        action: "github.labels.blocked",
        target,
        approval_id: approval.id,
        policy_result: auditPolicyResult(decision.outcome),
        result: "ok",
      });
      return { status: "blocked", repository, policy: decision, approval, labels: [] };
    }

    if (!this.githubClient.ensureLabels) {
      throw new Error("configured GitHub client does not support ensureLabels");
    }
    await this.githubClient.ensureLabels(repository.owner, repository.repo, [...input.labels]);
    await this.audit.append({
      actor: "supreme_coordinator",
      action: "github.labels.ensured",
      target,
      policy_result: auditPolicyResult(decision.outcome),
      result: "ok",
    });
    return {
      status: "ensured",
      repository,
      policy: decision,
      labels: input.labels.map((label) => ({ name: label.name })),
    };
  }

  private async findOrRequestLabelApproval(
    repository: { owner: string; repo: string; url: string },
    reason: string,
  ): Promise<ApprovalRecord> {
    const target = `${repository.owner}/${repository.repo}`;
    const pending = await this.approvals.listPending();
    const existing = pending.find(
      (approval) => approval.action === "create_issues" && approval.target === target,
    );
    if (existing) return existing;
    return this.approvals.request({
      action: "create_issues",
      actor: "supreme_coordinator",
      target,
      scope: target,
      body: `# Approval: apply GitHub labels

Repository: ${repository.url}
Reason: ${reason}
`,
    });
  }

  private async loadDrafts(
    project: ProjectRecord,
    draftArtifactIds?: readonly string[],
  ): Promise<LoadedDraft[]> {
    const all = await this.artifacts.list({ type: "github-issue-draft", project_id: project.id });
    const allowed = draftArtifactIds ? new Set(draftArtifactIds) : undefined;
    const selected = allowed ? all.filter((artifact) => allowed.has(artifact.id)) : all;
    const out: LoadedDraft[] = [];
    for (const artifact of selected) {
      const read = await this.artifacts.read(artifact.id);
      if (!read) continue;
      const labels = metadataLabels(artifact);
      out.push({
        artifact,
        title: typeof artifact["title"] === "string" ? artifact["title"] : parseTitle(read.body),
        body: issueBody(read.body),
        labels: labels.length ? labels : parseLabels(read.body),
      });
    }
    return out;
  }

  private async findOrRequestApproval(args: {
    project: ProjectRecord;
    repositoryUrl: string;
    reason: string;
  }): Promise<ApprovalRecord> {
    const target = args.repositoryUrl.replace("https://github.com/", "");
    const pending = await this.approvals.listPending();
    const existing = pending.find(
      (approval) => approval.action === "create_issues" && approval.target === target,
    );
    if (existing) return existing;
    return this.approvals.request({
      action: "create_issues",
      actor: "supreme_coordinator",
      target,
      scope: args.project.id,
      body: `# Approval: create GitHub issues

Project: ${args.project.name}
Repository: ${args.repositoryUrl}
Reason: ${args.reason}
`,
    });
  }
}
