import { AuditLog } from "../audit/log.js";
import type { PolicyEngine } from "../policy/engine.js";
import { dispatchRun, type CoordinatorDeps } from "../runs/coordinator.js";
import { RunEngine, type RunRecord, type RunType } from "../runs/engine.js";
import type {
  GitHubSignalCheckRun,
  GitHubSignalIssue,
  GitHubSignalPullRequest,
} from "./signal-sync.js";
import type { ArtifactRecord } from "../artifacts/store.js";

export type GitHubSignalTriggerKind = "failing_check" | "stale_issue" | "stale_pull_request";

export interface GitHubSignalTriggerInput {
  repository: string;
  report: ArtifactRecord;
  failingChecks?: readonly GitHubSignalCheckRun[];
  staleIssues?: readonly GitHubSignalIssue[];
  stalePullRequests?: readonly GitHubSignalPullRequest[];
}

export interface TriggeredGitHubRun {
  kind: GitHubSignalTriggerKind;
  triggerSource: string;
  run: RunRecord;
}

export interface SkippedGitHubSignal {
  kind: GitHubSignalTriggerKind;
  triggerSource: string;
  reason: "duplicate" | "policy_blocked";
}

export interface GitHubSignalTriggerResult {
  triggered: TriggeredGitHubRun[];
  skipped: SkippedGitHubSignal[];
}

export interface GitHubSignalTriggerDeps {
  runs: RunEngine;
  audit: AuditLog;
  policy: PolicyEngine;
  workspaceRoot?: string;
  coordinator?: CoordinatorDeps;
}

interface Candidate {
  kind: GitHubSignalTriggerKind;
  runType: RunType;
  triggerSource: string;
  scope: string;
  briefing: string;
}

function checkCandidate(repository: string, check: GitHubSignalCheckRun): Candidate {
  return {
    kind: "failing_check",
    runType: "bug",
    triggerSource: `github.check_failed:${repository}@${check.headSha}:${check.id}`,
    scope: `Investigate failing GitHub check "${check.name}" on ${repository}`,
    briefing: [
      `Repository: ${repository}`,
      `Check: ${check.name}`,
      `Conclusion: ${check.conclusion ?? check.status}`,
      `Head SHA: ${check.headSha}`,
      `URL: ${check.url}`,
    ].join("\n"),
  };
}

function staleIssueCandidate(repository: string, issue: GitHubSignalIssue): Candidate {
  return {
    kind: "stale_issue",
    runType: "health_check",
    triggerSource: `github.issue_stale:${repository}#${issue.number}`,
    scope: `Review stale GitHub issue #${issue.number}: ${issue.title}`,
    briefing: [
      `Repository: ${repository}`,
      `Issue: #${issue.number} ${issue.title}`,
      `State: ${issue.state}`,
      `Updated: ${issue.updatedAt}`,
      `URL: ${issue.url}`,
    ].join("\n"),
  };
}

function stalePullRequestCandidate(
  repository: string,
  pullRequest: GitHubSignalPullRequest,
): Candidate {
  return {
    kind: "stale_pull_request",
    runType: "health_check",
    triggerSource: `github.pr_stale:${repository}#${pullRequest.number}`,
    scope: `Review stale GitHub pull request #${pullRequest.number}: ${pullRequest.title}`,
    briefing: [
      `Repository: ${repository}`,
      `Pull Request: #${pullRequest.number} ${pullRequest.title}`,
      `State: ${pullRequest.state}`,
      `Updated: ${pullRequest.updatedAt}`,
      `Head: ${pullRequest.head} (${pullRequest.headSha})`,
      `Base: ${pullRequest.base}`,
      `URL: ${pullRequest.url}`,
    ].join("\n"),
  };
}

function candidatesFrom(input: GitHubSignalTriggerInput): Candidate[] {
  return [
    ...(input.failingChecks ?? []).map((check) => checkCandidate(input.repository, check)),
    ...(input.staleIssues ?? []).map((issue) => staleIssueCandidate(input.repository, issue)),
    ...(input.stalePullRequests ?? []).map((pr) => stalePullRequestCandidate(input.repository, pr)),
  ];
}

export class GitHubSignalTriggerService {
  constructor(private readonly deps: GitHubSignalTriggerDeps) {}

  async trigger(input: GitHubSignalTriggerInput): Promise<GitHubSignalTriggerResult> {
    const existing = await this.deps.runs.list();
    const knownSources = new Set(existing.map((run) => run.trigger_source));
    const triggered: TriggeredGitHubRun[] = [];
    const skipped: SkippedGitHubSignal[] = [];

    for (const candidate of candidatesFrom(input)) {
      if (knownSources.has(candidate.triggerSource)) {
        skipped.push({
          kind: candidate.kind,
          triggerSource: candidate.triggerSource,
          reason: "duplicate",
        });
        continue;
      }

      const decision = await this.deps.policy.evaluate({
        action: "start_triage_runs",
        actor: "supreme_coordinator",
        target: candidate.triggerSource,
        capability: "github.signal_trigger",
      });
      if (!decision.allowed) {
        skipped.push({
          kind: candidate.kind,
          triggerSource: candidate.triggerSource,
          reason: "policy_blocked",
        });
        await this.deps.audit.append({
          actor: "supreme_coordinator",
          action: "github.signal_trigger.blocked",
          target: candidate.triggerSource,
          capability: "github.signal_trigger",
          policy_result:
            decision.outcome === "allow"
              ? "allow"
              : decision.outcome === "deny"
                ? "deny"
                : decision.outcome === "escalate"
                  ? "escalate"
                  : "require_approval",
          result: "ok",
        });
        continue;
      }

      const run = await this.deps.runs.start({
        type: candidate.runType,
        triggerType: "threshold",
        triggerSource: candidate.triggerSource,
        scope: candidate.scope,
      });
      await this.deps.runs.attachArtifacts(run.id, [input.report.id]);
      knownSources.add(candidate.triggerSource);
      triggered.push({ kind: candidate.kind, triggerSource: candidate.triggerSource, run });
      await this.deps.audit.append({
        actor: "supreme_coordinator",
        action: "github.signal_trigger.run_started",
        target: run.id,
        capability: candidate.kind,
        artifact_id: input.report.id,
        result: "ok",
      });

      if (this.deps.workspaceRoot && this.deps.coordinator && run.status !== "needs_human") {
        await dispatchRun(this.deps.coordinator, {
          workspaceRoot: this.deps.workspaceRoot,
          run,
          scope: candidate.scope,
          briefing: candidate.briefing,
          contextArtifactIds: [input.report.id],
        });
      }
    }

    return { triggered, skipped };
  }
}
