import type { ArtifactStore, ArtifactRecord } from "../artifacts/store.js";
import type { AuditLog } from "../audit/log.js";
import type { BureauConfig } from "../config/schema.js";
import type { PolicyEngine } from "../policy/engine.js";
import type { RunCommitResult } from "../execution/project-workspace.js";
import type { ApprovalRegistry } from "../registries/approval.js";
import type { ClientRegistry } from "../registries/client.js";
import type { ProjectRegistry } from "../registries/project.js";
import type { RunRecord } from "../runs/engine.js";
import type { ProjectRecord } from "../registries/project.js";
import {
  GitHubPullRequestPublishService,
  type GitHubPullRequestPublishClient,
  type GitHubPullRequestPublishResult,
} from "../github/pr-publisher.js";
import { parseGitHubRepository } from "../github/repository-utils.js";

/**
 * The narrow git push surface the delivery step needs: point the project repo at
 * its linked remote and push the run branch. {@link ProjectWorkspaceService}
 * implements this against a real git repo; tests inject a stub that targets a
 * local bare repo so a push never reaches a real GitHub account (SER-241).
 */
export interface DispatchBranchPusher {
  setProjectRemote(slug: string, remoteUrl: string): Promise<void>;
  pushRunBranch(slug: string, runId: string): Promise<string>;
}

/**
 * Outcome of the dispatch delivery step (SER-241): pushing a successful run's
 * branch and opening a policy-gated draft PR.
 *
 * - `delivered`: branch pushed and a draft PR was created; `pullRequestUrl` set.
 * - `blocked`: an autonomy/approval gate stopped the push or the PR (a pending
 *   owner decision); `reason` explains which gate, `approvalId` when one exists.
 * - `skipped`: a delivery precondition was not met (no linked repo, nothing
 *   committed, run blocked, repo unparseable). Off-by-default safe; not surfaced
 *   as a blocker — it is today's no-delivery behavior, audited for traceability.
 */
export interface DispatchDeliveryResult {
  status: "delivered" | "blocked" | "skipped";
  reason: string;
  branch?: string;
  pushed?: boolean;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
  approvalId?: string;
}

export interface DispatchDeliveryDeps {
  workspaceRoot: string;
  config: BureauConfig;
  workspace: DispatchBranchPusher;
  policy: PolicyEngine;
  audit: AuditLog;
  artifacts: ArtifactStore;
  projects: ProjectRegistry;
  clients: ClientRegistry;
  approvals: ApprovalRegistry;
  /**
   * GitHub client for opening the draft PR. Undefined when no owner token is
   * configured (and no fake injected): delivery then surfaces a pending owner
   * decision instead of opening a PR — never an implicit real GitHub call.
   */
  githubClient?: GitHubPullRequestPublishClient;
}

export interface DispatchDeliveryInput {
  project: ProjectRecord;
  run: RunRecord;
  scope: string;
  /** Result of committing the run's worktree work; only commits get delivered. */
  commit: RunCommitResult;
  /** True when a development worktree existed for this run (Codex/dev path). */
  hadWorktree: boolean;
  /** True when no specialist step blocked the run. */
  runOk: boolean;
  /** All artifacts the run produced, used to derive PR evidence. */
  producedArtifacts: readonly ArtifactRecord[];
}

function evidenceArtifactIds(artifacts: readonly ArtifactRecord[]): string[] {
  // The PR publisher validates qa (`test-plan`), reviewer (`pr-review`) and
  // security (`security-review`) evidence; pass exactly those run artifacts so
  // its evidence gate can confirm the run was reviewed (SER-241).
  const types = new Set(["test-plan", "pr-review", "security-review"]);
  return artifacts.filter((artifact) => types.has(artifact.type)).map((artifact) => artifact.id);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * Collect QA/test verification lines from the run's evidence so the PR publisher's
 * `tests_required` gate (when configured) can be satisfied by real run evidence
 * rather than a hand-supplied string. Reads the QA `test-plan` and any
 * `test-evidence-report` produced by the run.
 */
function testEvidence(artifacts: readonly ArtifactRecord[]): string[] {
  const lines: string[] = [];
  for (const artifact of artifacts) {
    if (artifact.type === "test-evidence-report") {
      lines.push(...stringArrayValue(artifact["commands"]));
      const summary = stringValue(artifact["summary"]);
      if (summary) lines.push(summary);
    }
    if (artifact.type === "test-plan") {
      const readiness = stringValue(artifact["qa_readiness"]);
      if (readiness) lines.push(`QA readiness: ${readiness} (${artifact.id})`);
    }
  }
  return Array.from(new Set(lines.filter(Boolean)));
}

/**
 * Derive the GitHub issue numbers linked to the run, for the PR publisher's
 * `linked_issue` gate. Only a numeric `source_work_item_id` is a GitHub issue
 * number; non-numeric ids (e.g. a Linear identifier) are surfaced separately as
 * the linked Linear issue.
 */
function linkedIssueNumbers(run: RunRecord): number[] {
  const raw = run.source_work_item_id?.trim();
  if (!raw) return [];
  const numeric = raw.replace(/^#/, "");
  return /^\d+$/.test(numeric) ? [Number(numeric)] : [];
}

function deliveryTitle(project: ProjectRecord, scope: string): string {
  return `BureauOS: ${project.name} — ${scope}`;
}

function deliveryBody(args: {
  project: ProjectRecord;
  run: RunRecord;
  scope: string;
  producedArtifacts: readonly ArtifactRecord[];
}): string {
  const { project, run, scope, producedArtifacts } = args;
  const artifactLines = producedArtifacts.length
    ? producedArtifacts.map((artifact) => `- ${artifact.type}: ${artifact.id}`).join("\n")
    : "- (none)";
  return `## Summary

Autonomous delivery for ${project.name}.

- Run: ${run.id}
- Scope: ${scope}

## What Changed

- Committed the run's work on branch \`${run.id}\` and opened this draft PR for review.

## Produced Artifacts

${artifactLines}

## Risk

- Human approval required: yes; merge and production deploy remain separate approval-gated actions.
`;
}

/**
 * Deliver a successful, committed run: push its branch behind the `push_commits`
 * gate, then open a policy-gated draft PR via {@link GitHubPullRequestPublishService}
 * (which owns the `open_pull_requests` gate, approval, evidence checks, and
 * recording). Fires ONLY when the run was not blocked, a commit was produced, the
 * project has a linked repository, and a development worktree existed.
 *
 * Never throws for an expected gate/parse failure — returns a `skipped` or
 * `blocked` result so the caller can surface a pending owner decision instead of
 * crashing the dispatch (SER-241).
 */
export async function deliverDispatchedRun(
  deps: DispatchDeliveryDeps,
  input: DispatchDeliveryInput,
): Promise<DispatchDeliveryResult> {
  const { project, run } = input;

  // Off-by-default safe: these are today's no-delivery conditions. No audit noise
  // — the run simply produced nothing to deliver.
  if (!input.runOk) return { status: "skipped", reason: "run blocked" };
  if (!input.hadWorktree) return { status: "skipped", reason: "no development worktree" };
  if (!input.commit.committed) return { status: "skipped", reason: "no committed work" };
  if (!project.repository?.trim()) return { status: "skipped", reason: "no linked repository" };

  const branch = input.commit.branch;

  // A committed run on a linked repo wants to deliver, but a PR cannot be opened
  // without a GitHub client (no owner token, no injected fake). Surface that as a
  // pending owner decision rather than pretend nothing was deliverable.
  if (!deps.githubClient) {
    const reason = "no GitHub token configured for pull request delivery";
    await deps.audit.append({
      actor: "supreme_coordinator",
      action: "project.dispatch.delivery_blocked",
      target: run.id,
      error: reason,
      result: "ok",
    });
    return { status: "blocked", reason, branch, pushed: false };
  }

  const parsed = parseGitHubRepository(project.repository);
  if (!parsed) {
    // A malformed linked repository is a configuration issue, not a policy gate:
    // skip delivery with a clear audited reason rather than crash the dispatch.
    const reason = `unparseable repository "${project.repository}"`;
    await deps.audit.append({
      actor: "supreme_coordinator",
      action: "project.dispatch.delivery_skipped",
      target: run.id,
      error: reason,
      result: "ok",
    });
    return { status: "skipped", reason, branch };
  }

  const target = `${parsed.owner}/${parsed.repo}`;

  // Gate the push exactly like the PR publisher gates the PR: an enabled
  // `push_commits` autonomy OR a matching owner approval allows it; otherwise we
  // push nothing and surface a pending owner decision (never a silent skip).
  const pushDecision = await deps.policy.evaluate({
    action: "push_commits",
    actor: "supreme_coordinator",
    target,
    capability: "github.push_commits",
    riskClass: "medium",
  });
  if (!pushDecision.allowed) {
    await deps.audit.append({
      actor: "supreme_coordinator",
      action: "project.dispatch.delivery_blocked",
      target: run.id,
      ...(pushDecision.approval_id ? { approval_id: pushDecision.approval_id } : {}),
      policy_result:
        pushDecision.outcome === "require_more_context" ? "escalate" : pushDecision.outcome,
      error: `push blocked: ${pushDecision.reason}`,
      result: "ok",
    });
    return {
      status: "blocked",
      reason: `push blocked: ${pushDecision.reason}`,
      branch,
      pushed: false,
      ...(pushDecision.approval_id ? { approvalId: pushDecision.approval_id } : {}),
    };
  }

  // Point the project repo at its linked remote, then push the run branch (which
  // survives the released worktree). The remote URL is allow-list validated by
  // setProjectRemote; a real push targets the linked repo, a local bare repo in
  // tests — never an implicit real GitHub account.
  try {
    await deps.workspace.setProjectRemote(project.slug, project.repository);
    await deps.workspace.pushRunBranch(project.slug, run.id);
  } catch (error) {
    const reason = `push failed: ${error instanceof Error ? error.message : String(error)}`;
    await deps.audit.append({
      actor: "supreme_coordinator",
      action: "project.dispatch.delivery_blocked",
      target: run.id,
      error: reason,
      result: "error",
    });
    return { status: "blocked", reason, branch, pushed: false };
  }
  await deps.audit.append({
    actor: "supreme_coordinator",
    action: "project.dispatch.branch_pushed",
    target: run.id,
    capability: "github.push_commits",
    policy_result:
      pushDecision.outcome === "require_more_context" ? "escalate" : pushDecision.outcome,
    result: "ok",
  });

  // The PR publisher owns the `open_pull_requests` gate + approval + evidence
  // gates + memory/run-report recording. Pass the run's qa/reviewer/security
  // evidence and any linked issue so its gates can clear on real run evidence.
  const prPublisher = new GitHubPullRequestPublishService(deps.workspaceRoot, {
    config: deps.config,
    githubClient: deps.githubClient,
    projects: deps.projects,
    clients: deps.clients,
    artifacts: deps.artifacts,
    approvals: deps.approvals,
    policy: deps.policy,
    audit: deps.audit,
  });
  const issueNumbers = linkedIssueNumbers(run);
  const tests = testEvidence(input.producedArtifacts);
  let publish: GitHubPullRequestPublishResult;
  try {
    publish = await prPublisher.publish({
      projectSlug: project.slug,
      owner: parsed.owner,
      repo: parsed.repo,
      head: branch,
      base: "main",
      title: deliveryTitle(project, input.scope),
      body: deliveryBody({
        project,
        run,
        scope: input.scope,
        producedArtifacts: input.producedArtifacts,
      }),
      draft: true,
      runId: run.id,
      evidenceArtifactIds: evidenceArtifactIds(input.producedArtifacts),
      ...(issueNumbers.length ? { linkedIssueNumbers: issueNumbers } : {}),
      ...(tests.length ? { testEvidence: tests } : {}),
      ...(run.linear_identifier?.trim()
        ? {
            linkedLinearIssue: {
              identifier: run.linear_identifier,
              ...(run.linear_url?.trim() ? { url: run.linear_url } : {}),
            },
          }
        : {}),
    });
  } catch (error) {
    const reason = `pull request failed: ${error instanceof Error ? error.message : String(error)}`;
    await deps.audit.append({
      actor: "supreme_coordinator",
      action: "project.dispatch.delivery_blocked",
      target: run.id,
      error: reason,
      result: "error",
    });
    return { status: "blocked", reason, branch, pushed: true };
  }

  if (publish.status === "blocked") {
    const reason = `pull request blocked: ${publish.policy.reason}`;
    await deps.audit.append({
      actor: "supreme_coordinator",
      action: "project.dispatch.delivery_blocked",
      target: run.id,
      ...(publish.approval ? { approval_id: publish.approval.id } : {}),
      error: reason,
      result: "ok",
    });
    return {
      status: "blocked",
      reason,
      branch,
      pushed: true,
      ...(publish.approval ? { approvalId: publish.approval.id } : {}),
    };
  }

  await deps.audit.append({
    actor: "supreme_coordinator",
    action: "project.dispatch.delivered",
    target: run.id,
    ...(publish.report ? { artifact_id: publish.report.id } : {}),
    result: "ok",
  });
  return {
    status: "delivered",
    reason: "branch pushed and draft pull request opened",
    branch,
    pushed: true,
    ...(publish.pull_request ? { pullRequestUrl: publish.pull_request.url } : {}),
    ...(publish.pull_request ? { pullRequestNumber: publish.pull_request.number } : {}),
  };
}
