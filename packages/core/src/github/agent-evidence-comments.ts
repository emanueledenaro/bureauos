import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { CapabilityUseService, type CapabilityUseResult } from "../capabilities/usage.js";
import type { BureauConfig } from "../config/schema.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry } from "../registries/approval.js";

export interface GitHubAgentEvidenceComment {
  id: number;
  body: string;
  url: string;
}

export interface GitHubAgentEvidenceCommentClient {
  listComments(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<readonly GitHubAgentEvidenceComment[]>;
  createComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<GitHubAgentEvidenceComment>;
  updateComment(
    owner: string,
    repo: string,
    commentId: number,
    body: string,
  ): Promise<GitHubAgentEvidenceComment>;
}

export interface GitHubAgentEvidenceCommentInput {
  agent: "development" | "qa" | "reviewer" | "security" | "compliance";
  owner: string;
  repo: string;
  issueNumber: number;
  targetType: "issue" | "pull_request";
  runId: string;
  artifactIds: readonly string[];
  summary: string;
  status: "ready" | "blocked" | "changes_requested" | "passed" | "failed";
  testEvidence?: readonly string[];
}

export interface GitHubAgentEvidenceCommentResult {
  status: "posted" | "updated" | "blocked";
  target: string;
  capability: CapabilityUseResult;
  comment?: GitHubAgentEvidenceComment;
  report?: ArtifactRecord;
}

export interface GitHubAgentEvidenceCommentDeps {
  config: BureauConfig;
  githubClient: GitHubAgentEvidenceCommentClient;
  artifacts?: ArtifactStore;
  approvals?: ApprovalRegistry;
  audit?: AuditLog;
  capabilityUse?: CapabilityUseService;
}

interface LoadedArtifact {
  id: string;
  type: string;
  createdBy: string;
  exists: boolean;
}

function cleanPart(value: string, name: string): string {
  const clean = value.trim();
  if (!clean) throw new Error(`${name} is required`);
  return clean;
}

function targetFor(input: GitHubAgentEvidenceCommentInput): string {
  return `github://${input.owner}/${input.repo}/${input.targetType === "pull_request" ? "pull" : "issues"}/${input.issueNumber}`;
}

function commentMarker(input: GitHubAgentEvidenceCommentInput): string {
  return `<!-- bureauos:agent-evidence agent="${input.agent}" run="${input.runId}" target="${targetFor(input)}" -->`;
}

function artifactLines(artifacts: readonly LoadedArtifact[]): string {
  if (artifacts.length === 0) return "- (none)";
  return artifacts
    .map((artifact) =>
      artifact.exists
        ? `- \`${artifact.id}\` (${artifact.type}, by \`${artifact.createdBy}\`)`
        : `- \`${artifact.id}\` (missing)`,
    )
    .join("\n");
}

function testEvidenceLines(input: GitHubAgentEvidenceCommentInput): string {
  const tests = input.testEvidence ?? [];
  return tests.length ? tests.map((item) => `- ${item}`).join("\n") : "- (none supplied)";
}

function commentBody(args: {
  input: GitHubAgentEvidenceCommentInput;
  target: string;
  artifacts: readonly LoadedArtifact[];
  capabilityArtifactId: string;
}): string {
  return `${commentMarker(args.input)}

## BureauOS Agent Evidence

- Agent: \`${args.input.agent}\`
- Run: \`${args.input.runId}\`
- Target: \`${args.target}\`
- Status: \`${args.input.status}\`
- Capability gate: \`${args.capabilityArtifactId}\`

## Summary

${args.input.summary.trim()}

## Artifacts

${artifactLines(args.artifacts)}

## Verification

${testEvidenceLines(args.input)}

## Boundary

This is an evidence handoff comment only. Merge, deployment, client contact, publishing, billing, and destructive actions remain separate policy-gated operations.
`;
}

function reportBody(args: {
  input: GitHubAgentEvidenceCommentInput;
  target: string;
  operation: "posted" | "updated";
  comment: GitHubAgentEvidenceComment;
  artifacts: readonly LoadedArtifact[];
  capability: CapabilityUseResult;
}): string {
  return `# GitHub Agent Evidence Comment Report

## Context

- Agent: ${args.input.agent}
- Run: ${args.input.runId}
- Target: ${args.target}
- Operation: ${args.operation}
- Comment: ${args.comment.url}
- Policy: ${args.capability.policy.outcome} (${args.capability.policy.reason})
- Capability audit: ${args.capability.artifact.id}

## Evidence Artifacts

${artifactLines(args.artifacts)}

## Summary

${args.input.summary.trim()}
`;
}

export class GitHubAgentEvidenceCommentService {
  private readonly artifacts: ArtifactStore;
  private readonly approvals: ApprovalRegistry;
  private readonly audit: AuditLog;
  private readonly capabilityUse: CapabilityUseService;
  private readonly githubClient: GitHubAgentEvidenceCommentClient;

  constructor(
    private readonly workspaceRoot: string,
    deps: GitHubAgentEvidenceCommentDeps,
  ) {
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.approvals = deps.approvals ?? new ApprovalRegistry(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.capabilityUse =
      deps.capabilityUse ??
      new CapabilityUseService(workspaceRoot, {
        config: deps.config,
        artifacts: this.artifacts,
        approvals: this.approvals,
        audit: this.audit,
      });
    this.githubClient = deps.githubClient;
  }

  async publish(input: GitHubAgentEvidenceCommentInput): Promise<GitHubAgentEvidenceCommentResult> {
    const normalized: GitHubAgentEvidenceCommentInput = {
      ...input,
      owner: cleanPart(input.owner, "owner"),
      repo: cleanPart(input.repo, "repo"),
      runId: cleanPart(input.runId, "runId"),
      summary: cleanPart(input.summary, "summary"),
    };
    const target = targetFor(normalized);
    const capability = await this.capabilityUse.check({
      agent: normalized.agent,
      capabilityId: "github",
      action: "comment",
      target,
      testEvidence: normalized.testEvidence,
    });

    if (capability.status !== "allowed") {
      await this.audit.append({
        actor: normalized.agent,
        action: "github.agent_evidence_comment.blocked",
        target,
        artifact_id: capability.artifact.id,
        policy_result:
          capability.policy.outcome === "require_more_context"
            ? "escalate"
            : capability.policy.outcome,
        result: "ok",
      });
      return { status: "blocked", target, capability };
    }

    const artifacts = await this.loadArtifacts(normalized.artifactIds);
    const body = commentBody({
      input: normalized,
      target,
      artifacts,
      capabilityArtifactId: capability.artifact.id,
    });
    const marker = commentMarker(normalized);
    const existing = (
      await this.githubClient.listComments(
        normalized.owner,
        normalized.repo,
        normalized.issueNumber,
      )
    ).find((comment) => comment.body.includes(marker));
    const operation = existing ? "updated" : "posted";
    const comment = existing
      ? await this.githubClient.updateComment(normalized.owner, normalized.repo, existing.id, body)
      : await this.githubClient.createComment(
          normalized.owner,
          normalized.repo,
          normalized.issueNumber,
          body,
        );

    const report = await this.artifacts.write({
      type: "github-agent-evidence-comment-report",
      createdBy: normalized.agent,
      runId: normalized.runId,
      metadata: {
        agent: normalized.agent,
        owner: normalized.owner,
        repo: normalized.repo,
        issue_number: normalized.issueNumber,
        target_type: normalized.targetType,
        target,
        status: operation,
        comment_id: comment.id,
        comment_url: comment.url,
        artifact_ids: [...normalized.artifactIds],
        capability_audit_artifact_id: capability.artifact.id,
      },
      body: reportBody({
        input: normalized,
        target,
        operation,
        comment,
        artifacts,
        capability,
      }),
    });

    await this.audit.append({
      actor: normalized.agent,
      action: `github.agent_evidence_comment.${operation}`,
      target,
      artifact_id: report.id,
      policy_result:
        capability.policy.outcome === "require_more_context"
          ? "escalate"
          : capability.policy.outcome,
      result: "ok",
    });

    return { status: operation, target, capability, comment, report };
  }

  private async loadArtifacts(ids: readonly string[]): Promise<LoadedArtifact[]> {
    const out: LoadedArtifact[] = [];
    for (const id of ids) {
      const read = await this.artifacts.read(id);
      out.push(
        read
          ? {
              id,
              type: read.record.type,
              createdBy: read.record.created_by,
              exists: true,
            }
          : { id, type: "", createdBy: "", exists: false },
      );
    }
    return out;
  }
}
