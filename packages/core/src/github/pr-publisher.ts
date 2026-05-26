import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import type { BureauConfig } from "../config/schema.js";
import { workspacePaths } from "../paths.js";
import { PolicyEngine, type PolicyDecision } from "../policy/engine.js";
import { ApprovalRegistry, type ApprovalRecord } from "../registries/approval.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";

export interface GitHubPullRequestPublishClientPr {
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

export interface GitHubPullRequestPublishClient {
  createPullRequest(
    owner: string,
    repo: string,
    input: { title: string; body: string; head: string; base: string; draft?: boolean },
  ): Promise<GitHubPullRequestPublishClientPr>;
}

export interface GitHubPullRequestPublishInput {
  projectSlug: string;
  owner: string;
  repo: string;
  head: string;
  base?: string;
  title: string;
  body?: string;
  draft?: boolean;
  linkedIssueNumbers?: readonly number[];
  testEvidence?: readonly string[];
}

export interface GitHubPullRequestPublishResult {
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
  pull_request?: GitHubPullRequestPublishClientPr;
  report?: ArtifactRecord;
}

export interface GitHubPullRequestPublishDeps {
  config: BureauConfig;
  githubClient: GitHubPullRequestPublishClient;
  projects?: ProjectRegistry;
  clients?: ClientRegistry;
  artifacts?: ArtifactStore;
  approvals?: ApprovalRegistry;
  policy?: PolicyEngine;
  audit?: AuditLog;
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

function auditPolicyResult(
  outcome: PolicyDecision["outcome"],
): "allow" | "deny" | "require_approval" | "escalate" {
  return outcome === "require_more_context" ? "escalate" : outcome;
}

function formatIssues(issues: readonly number[]): string {
  return issues.length ? issues.map((issue) => `#${issue}`).join(", ") : "(none)";
}

function defaultBody(args: {
  body?: string;
  project: ProjectRecord;
  linkedIssues: readonly number[];
  testEvidence: readonly string[];
}): string {
  const explicit = args.body?.trim();
  if (explicit) return explicit;
  return `## BureauOS Pull Request

Project: ${args.project.name}
Linked issues: ${formatIssues(args.linkedIssues)}

## Test Evidence

${
  args.testEvidence.length
    ? args.testEvidence.map((item) => `- ${item}`).join("\n")
    : "- No test evidence supplied."
}

## Policy Boundary

Created by BureauOS under open-pull-request policy. Merge and production deployment remain separate approval-gated actions.
`;
}

function reportBody(args: {
  project: ProjectRecord;
  client?: ClientRecord;
  repositoryUrl: string;
  pullRequest: GitHubPullRequestPublishClientPr;
  linkedIssues: readonly number[];
  testEvidence: readonly string[];
  policy: PolicyDecision;
}): string {
  return `# GitHub Pull Request Publish Report

## Context

- Client: ${args.client?.name ?? args.project.client_id}
- Project: ${args.project.name}
- Repository: ${args.repositoryUrl}
- Policy: ${args.policy.outcome} (${args.policy.reason})
- Linked issues: ${formatIssues(args.linkedIssues)}

## Created Pull Request

- #${args.pullRequest.number} ${args.pullRequest.title}: ${args.pullRequest.url}
- Head: ${args.pullRequest.head}
- Base: ${args.pullRequest.base}

## Test Evidence

${
  args.testEvidence.length
    ? args.testEvidence.map((item) => `- ${item}`).join("\n")
    : "- No test evidence supplied."
}

## Still Requires Separate Approval

- Merge pull request
- Production deploy
- Client-facing announcement
`;
}

export class GitHubPullRequestPublishService {
  private readonly projects: ProjectRegistry;
  private readonly clients: ClientRegistry;
  private readonly artifacts: ArtifactStore;
  private readonly approvals: ApprovalRegistry;
  private readonly policy: PolicyEngine;
  private readonly audit: AuditLog;
  private readonly githubClient: GitHubPullRequestPublishClient;

  constructor(
    private readonly workspaceRoot: string,
    deps: GitHubPullRequestPublishDeps,
  ) {
    this.projects = deps.projects ?? new ProjectRegistry(workspaceRoot);
    this.clients = deps.clients ?? new ClientRegistry(workspaceRoot);
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.approvals = deps.approvals ?? new ApprovalRegistry(workspaceRoot);
    this.policy = deps.policy ?? new PolicyEngine(deps.config, this.approvals);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.githubClient = deps.githubClient;
  }

  async publish(input: GitHubPullRequestPublishInput): Promise<GitHubPullRequestPublishResult> {
    const repository = normalizeRepoTarget(input.owner, input.repo);
    const project = await this.projects.get(input.projectSlug);
    if (!project) throw new Error(`project not found: ${input.projectSlug}`);
    const allClients = await this.clients.list();
    const client = allClients.find((item) => item.id === project.client_id);
    const linkedIssues = input.linkedIssueNumbers ?? [];
    const testEvidence = input.testEvidence ?? [];

    const decision = await this.policy.evaluate({
      action: "open_pull_requests",
      actor: "supreme_coordinator",
      target: `${repository.owner}/${repository.repo}`,
      capability: "github.open_pull_request",
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
        action: "github.pr_publish.blocked",
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
      };
    }

    const missingGates: string[] = [];
    if (decision.required_gates.includes("linked_issue") && linkedIssues.length === 0) {
      missingGates.push("linked_issue");
    }
    if (decision.required_gates.includes("tests_required") && testEvidence.length === 0) {
      missingGates.push("tests_required");
    }
    if (missingGates.length > 0) {
      const approval = await this.findOrRequestApproval({
        project,
        repositoryUrl: repository.url,
        reason: `missing required PR gate(s): ${missingGates.join(", ")}`,
      });
      await this.audit.append({
        actor: "supreme_coordinator",
        action: "github.pr_publish.blocked",
        target: `${repository.owner}/${repository.repo}`,
        approval_id: approval.id,
        policy_result: "require_approval",
        result: "ok",
      });
      return {
        status: "blocked",
        project,
        ...(client ? { client } : {}),
        repository,
        policy: {
          ...decision,
          allowed: false,
          outcome: "require_approval",
          reason: `missing required PR gate(s): ${missingGates.join(", ")}`,
          required_gates: missingGates,
          approval_id: approval.id,
        },
        approval,
      };
    }

    const pullRequest = await this.githubClient.createPullRequest(
      repository.owner,
      repository.repo,
      {
        title: input.title,
        body: defaultBody({ body: input.body, project, linkedIssues, testEvidence }),
        head: input.head,
        base: input.base ?? "main",
        ...(input.draft !== undefined ? { draft: input.draft } : {}),
      },
    );

    const report = await this.artifacts.write({
      type: "github-pr-publish-report",
      createdBy: "supreme_coordinator",
      projectId: project.id,
      ...(client ? { clientId: client.id } : {}),
      metadata: {
        owner: repository.owner,
        repo: repository.repo,
        pr_url: pullRequest.url,
        pr_number: pullRequest.number,
        head: pullRequest.head,
        base: pullRequest.base,
        linked_issues: linkedIssues.map(String),
        test_evidence: [...testEvidence],
      },
      body: reportBody({
        project,
        client,
        repositoryUrl: repository.url,
        pullRequest,
        linkedIssues,
        testEvidence,
        policy: decision,
      }),
    });

    if (!project.repository) {
      await this.projects.update(project.slug, { repository: repository.url });
    }

    await this.audit.append({
      actor: "supreme_coordinator",
      action: "github.pr_publish.created",
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
      pull_request: pullRequest,
      report,
    };
  }

  private async findOrRequestApproval(args: {
    project: ProjectRecord;
    repositoryUrl: string;
    reason: string;
  }): Promise<ApprovalRecord> {
    const target = args.repositoryUrl.replace("https://github.com/", "");
    const pending = await this.approvals.listPending();
    const existing = pending.find(
      (approval) => approval.action === "open_pull_requests" && approval.target === target,
    );
    if (existing) return existing;
    return this.approvals.request({
      action: "open_pull_requests",
      actor: "supreme_coordinator",
      target,
      scope: args.project.id,
      body: `# Approval: open GitHub pull request

Project: ${args.project.name}
Repository: ${args.repositoryUrl}
Reason: ${args.reason}
`,
    });
  }
}
