import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import type { BureauConfig } from "../config/schema.js";
import { workspacePaths } from "../paths.js";
import { PolicyEngine, type PolicyDecision } from "../policy/engine.js";
import { ApprovalRegistry, type ApprovalRecord } from "../registries/approval.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";

export interface GitHubRepositoryProvisionClientRepo {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
  private: boolean;
  defaultBranch: string;
  createdAt: string;
}

export interface GitHubRepositoryProvisionClient {
  createRepository(input: {
    owner: string;
    name: string;
    ownerType: "user" | "org";
    private: boolean;
    description?: string;
    autoInit?: boolean;
  }): Promise<GitHubRepositoryProvisionClientRepo>;
}

export interface GitHubRepositoryProvisionInput {
  projectSlug: string;
  owner: string;
  repo?: string;
  ownerType?: "user" | "org";
  private?: boolean;
  description?: string;
  autoInit?: boolean;
}

export interface GitHubRepositoryProvisionResult {
  status: "created" | "blocked";
  project: ProjectRecord;
  client?: ClientRecord;
  repository: {
    owner: string;
    repo: string;
    url: string;
    private: boolean;
    owner_type: "user" | "org";
  };
  policy: PolicyDecision;
  approval?: ApprovalRecord;
  created?: GitHubRepositoryProvisionClientRepo;
  report?: ArtifactRecord;
}

export interface GitHubRepositoryProvisionDeps {
  config: BureauConfig;
  githubClient: GitHubRepositoryProvisionClient;
  projects?: ProjectRegistry;
  clients?: ClientRegistry;
  artifacts?: ArtifactStore;
  approvals?: ApprovalRegistry;
  policy?: PolicyEngine;
  audit?: AuditLog;
}

function normalizeRepoName(repo: string): string {
  const clean = repo.trim();
  if (!clean) throw new Error("repo is required");
  return clean;
}

function repositoryUrl(owner: string, repo: string): string {
  const cleanOwner = owner.trim();
  if (!cleanOwner) throw new Error("owner is required");
  return `https://github.com/${cleanOwner}/${repo}`;
}

function auditPolicyResult(
  outcome: PolicyDecision["outcome"],
): "allow" | "deny" | "require_approval" | "escalate" {
  return outcome === "require_more_context" ? "escalate" : outcome;
}

function reportBody(args: {
  project: ProjectRecord;
  client?: ClientRecord;
  repository: GitHubRepositoryProvisionClientRepo;
  policy: PolicyDecision;
}): string {
  return `# Repository Provisioning Report

## Context

- Client: ${args.client?.name ?? args.project.client_id}
- Project: ${args.project.name}
- Repository: ${args.repository.url}
- Visibility: ${args.repository.private ? "private" : "public"}
- Default branch: ${args.repository.defaultBranch || "(unknown)"}
- Policy: ${args.policy.outcome} (${args.policy.reason})

## Linked Project Memory

Project memory now references ${args.repository.url}.

## Still Requires Separate Approval

- Create GitHub issues when issue creation policy is disabled
- Push code changes without linked issue and test evidence
- Open, merge, or deploy pull requests beyond configured policy
`;
}

export class GitHubRepositoryProvisionService {
  private readonly projects: ProjectRegistry;
  private readonly clients: ClientRegistry;
  private readonly artifacts: ArtifactStore;
  private readonly approvals: ApprovalRegistry;
  private readonly policy: PolicyEngine;
  private readonly audit: AuditLog;
  private readonly githubClient: GitHubRepositoryProvisionClient;

  constructor(
    private readonly workspaceRoot: string,
    deps: GitHubRepositoryProvisionDeps,
  ) {
    this.projects = deps.projects ?? new ProjectRegistry(workspaceRoot);
    this.clients = deps.clients ?? new ClientRegistry(workspaceRoot);
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.approvals = deps.approvals ?? new ApprovalRegistry(workspaceRoot);
    this.policy = deps.policy ?? new PolicyEngine(deps.config, this.approvals);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.githubClient = deps.githubClient;
  }

  async provision(input: GitHubRepositoryProvisionInput): Promise<GitHubRepositoryProvisionResult> {
    const project = await this.projects.get(input.projectSlug);
    if (!project) throw new Error(`project not found: ${input.projectSlug}`);
    const allClients = await this.clients.list();
    const client = allClients.find((item) => item.id === project.client_id);
    const repo = normalizeRepoName(input.repo ?? project.slug);
    const owner = input.owner.trim();
    if (!owner) throw new Error("owner is required");
    const ownerType = input.ownerType ?? "user";
    const isPrivate = input.private ?? true;
    const url = repositoryUrl(owner, repo);
    const target = `${owner}/${repo}`;

    const decision = await this.policy.evaluate({
      action: "create_repositories",
      actor: "supreme_coordinator",
      target,
      capability: "github.repository.create",
      riskClass: "medium",
      // Preview here so the one-off approval is not burned before we have
      // actually provisioned the repository (and the public-visibility gate
      // below can still see it). It is consumed once provisioning succeeds.
      preview: true,
    });

    if (!decision.allowed) {
      const approval = await this.findOrRequestApproval({
        project,
        target,
        repositoryUrl: url,
        reason: decision.reason,
      });
      await this.audit.append({
        actor: "supreme_coordinator",
        action: "github.repository_provision.blocked",
        target,
        approval_id: approval.id,
        policy_result: auditPolicyResult(decision.outcome),
        result: "ok",
      });
      return {
        status: "blocked",
        project,
        ...(client ? { client } : {}),
        repository: { owner, repo, url, private: isPrivate, owner_type: ownerType },
        policy: decision,
        approval,
      };
    }

    // Track the one-off approval (if any) that authorizes this provisioning so
    // it can be consumed exactly once, after the repository is actually created.
    let grantApprovalId = decision.approval_id ?? "";

    if (!isPrivate) {
      const approval = await this.approvals.match("create_repositories", target);
      if (!approval) {
        const requested = await this.findOrRequestApproval({
          project,
          target,
          repositoryUrl: url,
          reason: "public repository visibility requires explicit owner approval",
        });
        const blockedPolicy: PolicyDecision = {
          ...decision,
          allowed: false,
          outcome: "require_approval",
          reason: "public repository visibility requires explicit owner approval",
          required_gates: ["public_repository_visibility"],
          approval_id: requested.id,
        };
        await this.audit.append({
          actor: "supreme_coordinator",
          action: "github.repository_provision.blocked",
          target,
          approval_id: requested.id,
          policy_result: "require_approval",
          result: "ok",
        });
        return {
          status: "blocked",
          project,
          ...(client ? { client } : {}),
          repository: { owner, repo, url, private: isPrivate, owner_type: ownerType },
          policy: blockedPolicy,
          approval: requested,
        };
      }
      grantApprovalId = grantApprovalId || approval.id;
    }

    const created = await this.githubClient.createRepository({
      owner,
      name: repo,
      ownerType,
      private: isPrivate,
      ...(typeof input.description === "string" ? { description: input.description } : {}),
      ...(typeof input.autoInit === "boolean" ? { autoInit: input.autoInit } : {}),
    });

    const report = await this.artifacts.write({
      type: "repository-provisioning-report",
      createdBy: "supreme_coordinator",
      projectId: project.id,
      ...(client ? { clientId: client.id } : {}),
      metadata: {
        owner: created.owner,
        repo: created.repo,
        full_name: created.fullName,
        repository_url: created.url,
        private: String(created.private),
      },
      body: reportBody({ project, client, repository: created, policy: decision }),
    });

    await this.projects.update(project.slug, { repository: created.url });

    await this.audit.append({
      actor: "supreme_coordinator",
      action: "github.repository_provision.created",
      target: created.fullName,
      artifact_id: report.id,
      policy_result: auditPolicyResult(decision.outcome),
      result: "ok",
    });

    // The repository now exists: burn the one-off approval that authorized it so
    // it cannot silently authorize a second provisioning.
    if (grantApprovalId) await this.approvals.consume(grantApprovalId);

    return {
      status: "created",
      project: { ...project, repository: created.url },
      ...(client ? { client } : {}),
      repository: {
        owner: created.owner,
        repo: created.repo,
        url: created.url,
        private: created.private,
        owner_type: ownerType,
      },
      policy: decision,
      created,
      report,
    };
  }

  private async findOrRequestApproval(args: {
    project: ProjectRecord;
    target: string;
    repositoryUrl: string;
    reason: string;
  }): Promise<ApprovalRecord> {
    const pending = await this.approvals.listPending();
    const existing = pending.find(
      (approval) => approval.action === "create_repositories" && approval.target === args.target,
    );
    if (existing) return existing;
    return this.approvals.request({
      action: "create_repositories",
      actor: "supreme_coordinator",
      target: args.target,
      scope: args.project.id,
      body: `# Approval: create GitHub repository

Project: ${args.project.name}
Repository: ${args.repositoryUrl}
Reason: ${args.reason}
`,
    });
  }
}
