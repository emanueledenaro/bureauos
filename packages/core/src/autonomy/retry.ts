import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import type { PolicyDecision, PolicyEngine } from "../policy/engine.js";
import { ApprovalRegistry, type ApprovalRecord } from "../registries/approval.js";
import { dispatchRun, type CoordinatorDeps } from "../runs/coordinator.js";
import { RunEngine, type RunRecord } from "../runs/engine.js";

export type AutonomousRetryStatus = "blocked" | "failed";
export type AutonomousRetryEscalationReason = "max_attempts_reached" | "non_retryable_failure";
export type RetryClassificationReason =
  | "retryable_failure"
  | "retryable_blocker"
  | "non_retryable_credentials"
  | "non_retryable_owner_decision"
  | "non_retryable_policy"
  | "non_retryable_scope"
  | "non_retryable_explicit";

export interface AutonomousRetryInput {
  now?: Date;
  maxAttempts?: number;
  statuses?: readonly AutonomousRetryStatus[];
}

export interface TriggeredAutonomousRetry {
  originalRun: RunRecord;
  retryRun: RunRecord;
  attempt: number;
  triggerSource: string;
}

export interface EscalatedAutonomousRetry {
  run: RunRecord;
  attempts: number;
  reason: AutonomousRetryEscalationReason;
  blocker: string;
  approval?: ApprovalRecord;
}

export interface SkippedAutonomousRetry {
  run: RunRecord;
  reason:
    | "duplicate"
    | "policy_blocked"
    | "already_escalated"
    | "already_recovered"
    | "retry_child";
  triggerSource?: string;
}

export interface AutonomousRetryResult {
  triggered: TriggeredAutonomousRetry[];
  escalated: EscalatedAutonomousRetry[];
  skipped: SkippedAutonomousRetry[];
  report?: ArtifactRecord;
}

export interface AutonomousRetryDeps {
  runs: RunEngine;
  audit: AuditLog;
  policy: PolicyEngine;
  artifacts?: ArtifactStore;
  approvals?: ApprovalRegistry;
  coordinator?: CoordinatorDeps;
}

interface Candidate {
  run: RunRecord;
  attempts: number;
  nextAttempt: number;
  triggerSource: string;
  action: "retry" | "escalate";
  nextRetryAt?: string;
  classification: RetryClassification;
  escalationReason?: AutonomousRetryEscalationReason;
}

interface RetryClassification {
  retryable: boolean;
  reason: RetryClassificationReason;
  detail: string;
}

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_STATUSES: readonly AutonomousRetryStatus[] = ["blocked", "failed"];

function policyResult(
  decision: PolicyDecision,
): "allow" | "deny" | "escalate" | "require_approval" {
  if (decision.outcome === "allow") return "allow";
  if (decision.outcome === "deny") return "deny";
  if (decision.outcome === "escalate") return "escalate";
  return "require_approval";
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return undefined;
}

function isRetryChild(run: RunRecord): boolean {
  return run.trigger_source.startsWith("bureauos.retry:");
}

function alreadyEscalated(run: RunRecord): boolean {
  return typeof run["retry_escalated_at"] === "string" && run["retry_escalated_at"].length > 0;
}

function alreadyRecovered(run: RunRecord): boolean {
  return typeof run["retry_recovered_at"] === "string" && run["retry_recovered_at"].length > 0;
}

function retrySource(run: RunRecord, attempt: number): string {
  return `bureauos.retry:${run.id}:${attempt}`;
}

function nextRetryAt(now: Date, attempt: number): string {
  const delayMs = Math.min(24 * 60 * 60 * 1000, Math.max(1, attempt) * 30 * 60 * 1000);
  return new Date(now.getTime() + delayMs).toISOString();
}

function runFailureText(run: RunRecord): string {
  return [
    run.scope,
    run.status,
    run["dispatch_status"],
    run["blocking_reason"],
    run["dispatch_error"],
    run["error"],
    ...stringList(run["blockers"]),
    ...stringList(run["dispatch_blockers"]),
  ]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function classifyRetry(run: RunRecord): RetryClassification {
  const explicitRetryable = booleanValue(run["retryable"] ?? run["dispatch_retryable"]);
  if (explicitRetryable === false) {
    return {
      retryable: false,
      reason: "non_retryable_explicit",
      detail: "Run metadata marks this failure as non-retryable.",
    };
  }
  if (explicitRetryable === true) {
    return {
      retryable: true,
      reason: run.status === "blocked" ? "retryable_blocker" : "retryable_failure",
      detail: "Run metadata allows bounded retry.",
    };
  }

  const text = runFailureText(run);
  if (/\b(secret|credential|credentials|oauth|token|api key|forbidden|unauthorized)\b/.test(text)) {
    return {
      retryable: false,
      reason: "non_retryable_credentials",
      detail: "Failure needs credential or access intervention before retry.",
    };
  }
  if (/\b(policy|approval|human|owner|needs_human|permission|client approval)\b/.test(text)) {
    return {
      retryable: false,
      reason: "non_retryable_policy",
      detail: "Failure is blocked by policy or owner approval.",
    };
  }
  if (
    /\b(ambiguous|clarification|acceptance criteria|missing context|scope unclear)\b/.test(text)
  ) {
    return {
      retryable: false,
      reason: "non_retryable_scope",
      detail: "Failure needs clearer scope before another retry.",
    };
  }
  if (
    /\b(billing|payment|stripe|legal|delete|destructive|production deploy|deploy production)\b/.test(
      text,
    )
  ) {
    return {
      retryable: false,
      reason: "non_retryable_owner_decision",
      detail: "Failure touches a sensitive decision that needs owner intervention.",
    };
  }

  return {
    retryable: true,
    reason: run.status === "blocked" ? "retryable_blocker" : "retryable_failure",
    detail:
      run.status === "blocked"
        ? "Blocked run can be retried once within policy."
        : "Failed run can be retried once within policy.",
  };
}

function escalationBlocker(candidate: Candidate): string {
  if (candidate.escalationReason === "max_attempts_reached") {
    return `Retry limit reached after ${candidate.attempts} attempt(s). Owner intervention required before another retry.`;
  }
  return candidate.classification.detail;
}

function reportBody(now: Date, maxAttempts: number, candidates: readonly Candidate[]): string {
  return `# Autonomous Retry Report

Generated: ${now.toISOString()}

Policy: retry failed or blocked runs up to ${maxAttempts} attempt(s), then escalate to the owner.

## Actions

${candidates
  .map((candidate) => {
    return `- ${candidate.action}: ${candidate.run.id} (${candidate.run.type})
  - Status: ${candidate.run.status}
  - Attempts used: ${candidate.attempts}/${maxAttempts}
  - Next attempt: ${candidate.action === "retry" ? `${candidate.nextAttempt}/${maxAttempts}` : "(blocked)"}
  - Classification: ${candidate.classification.reason}
  - Retryable: ${candidate.classification.retryable ? "yes" : "no"}
  - Blocker: ${candidate.action === "escalate" ? escalationBlocker(candidate) : "(none)"}
  - Scope: ${candidate.run.scope}
  - Trigger: ${candidate.triggerSource}`;
  })
  .join("\n")}

## Boundary

- Retry runs are deduplicated by trigger source.
- Retry child runs are not recursively retried.
- Repeated failure after the retry limit is escalated instead of looped.
`;
}

export class AutonomousRetryService {
  private readonly artifacts: ArtifactStore;
  private readonly approvals: ApprovalRegistry;

  constructor(
    private readonly workspaceRoot: string,
    private readonly deps: AutonomousRetryDeps,
  ) {
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.approvals = deps.approvals ?? new ApprovalRegistry(workspaceRoot);
  }

  async scan(input: AutonomousRetryInput = {}): Promise<AutonomousRetryResult> {
    const now = input.now ?? new Date();
    const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const statuses = new Set(input.statuses ?? DEFAULT_STATUSES);
    const runs = await this.deps.runs.list();
    const knownSources = new Set(runs.map((run) => run.trigger_source));
    const triggered: TriggeredAutonomousRetry[] = [];
    const escalated: EscalatedAutonomousRetry[] = [];
    const skipped: SkippedAutonomousRetry[] = [];
    const candidates: Candidate[] = [];

    for (const run of runs) {
      if (!statuses.has(run.status as AutonomousRetryStatus)) continue;
      if (isRetryChild(run)) {
        skipped.push({ run, reason: "retry_child" });
        continue;
      }
      if (alreadyEscalated(run)) {
        skipped.push({ run, reason: "already_escalated" });
        continue;
      }
      if (alreadyRecovered(run)) {
        skipped.push({ run, reason: "already_recovered" });
        continue;
      }

      const attempts = numberValue(run["retry_attempts"]);
      const nextAttempt = attempts + 1;
      const triggerSource = retrySource(run, nextAttempt);
      if (knownSources.has(triggerSource)) {
        skipped.push({ run, reason: "duplicate", triggerSource });
        continue;
      }
      const classification = classifyRetry(run);
      const overLimit = nextAttempt > maxAttempts;
      candidates.push({
        run,
        attempts,
        nextAttempt,
        triggerSource,
        action: !classification.retryable || overLimit ? "escalate" : "retry",
        ...(classification.retryable ? { nextRetryAt: nextRetryAt(now, nextAttempt) } : {}),
        classification,
        ...(!classification.retryable || overLimit
          ? {
              escalationReason: classification.retryable
                ? "max_attempts_reached"
                : "non_retryable_failure",
            }
          : {}),
      });
    }

    const report =
      candidates.length > 0
        ? await this.artifacts.write({
            type: "autonomy-retry-report",
            createdBy: "supreme_coordinator",
            status: "submitted",
            metadata: {
              generated_at: now.toISOString(),
              candidate_count: candidates.length,
              max_attempts: maxAttempts,
              retry_count: candidates.filter((candidate) => candidate.action === "retry").length,
              escalation_count: candidates.filter((candidate) => candidate.action === "escalate")
                .length,
            },
            body: reportBody(now, maxAttempts, candidates),
          })
        : undefined;

    for (const candidate of candidates) {
      if (candidate.action === "escalate") {
        const blocker = escalationBlocker(candidate);
        const approval = await this.approvals.request({
          action: "resolve_retry_blocker",
          actor: "supreme_coordinator",
          target: candidate.run.id,
          scope: `Resolve retry blocker for ${candidate.run.scope}`,
          runId: candidate.run.id,
          riskLevel: "medium",
          body: `# Retry Blocker

- Run: ${candidate.run.id}
- Status: ${candidate.run.status}
- Attempts used: ${candidate.attempts}/${maxAttempts}
- Reason: ${candidate.escalationReason ?? "non_retryable_failure"}
- Classification: ${candidate.classification.reason}
- Blocker: ${blocker}
${report ? `- Report: ${report.id}\n` : ""}
Owner intervention is required before BureauOS should retry this run again.
`,
        });
        await this.deps.runs.patch(candidate.run.id, {
          retry_attempts: candidate.attempts,
          next_retry_at: "",
          retry_escalated_at: now.toISOString(),
          retry_escalation_reason: candidate.escalationReason ?? "non_retryable_failure",
          retry_classification: candidate.classification.reason,
          retry_blocker_reason: blocker,
          retry_blocker_approval_id: approval.id,
          ...(report ? { retry_report_id: report.id } : {}),
        });
        escalated.push({
          run: candidate.run,
          attempts: candidate.attempts,
          reason: candidate.escalationReason ?? "non_retryable_failure",
          blocker,
          approval,
        });
        await this.deps.audit.append({
          actor: "supreme_coordinator",
          action: "autonomy.retry.escalated",
          target: candidate.run.id,
          capability: "bureauos.retry",
          approval_id: approval.id,
          ...(report ? { artifact_id: report.id } : {}),
          result: "ok",
        });
        continue;
      }

      const decision = await this.deps.policy.evaluate({
        action: "start_triage_runs",
        actor: "supreme_coordinator",
        target: candidate.triggerSource,
        capability: "bureauos.retry",
      });
      if (!decision.allowed) {
        skipped.push({
          run: candidate.run,
          reason: "policy_blocked",
          triggerSource: candidate.triggerSource,
        });
        await this.deps.audit.append({
          actor: "supreme_coordinator",
          action: "autonomy.retry.blocked",
          target: candidate.triggerSource,
          capability: "bureauos.retry",
          policy_result: policyResult(decision),
          ...(report ? { artifact_id: report.id } : {}),
          result: "ok",
        });
        continue;
      }

      const retryRun = await this.deps.runs.start({
        type: candidate.run.type,
        triggerType: "threshold",
        triggerSource: candidate.triggerSource,
        scope: `Retry ${candidate.nextAttempt}/${maxAttempts}: ${candidate.run.scope}`,
        ...(candidate.run.project_id ? { projectId: candidate.run.project_id } : {}),
        ...(candidate.run.client_id ? { clientId: candidate.run.client_id } : {}),
      });
      if (report) await this.deps.runs.attachArtifacts(retryRun.id, [report.id]);

      // Track the retry's TRUE terminal outcome. The retry run starts through
      // the stub path (which always completes), so `retryRun.status` alone lies
      // when the coordinator dispatch actually blocks. We apply the dispatch
      // result to the retry run and only treat it as recovered when the real
      // pipeline completed with no blockers.
      let retryRecovered = retryRun.status === "completed";
      let retryBlockers: string[] = [];
      if (this.deps.coordinator && retryRun.status !== "needs_human") {
        const dispatch = await dispatchRun(this.deps.coordinator, {
          workspaceRoot: this.workspaceRoot,
          run: retryRun,
          scope: retryRun.scope,
          briefing: [
            `Retrying original run: ${candidate.run.id}`,
            `Original status: ${candidate.run.status}`,
            `Original scope: ${candidate.run.scope}`,
            `Attempt: ${candidate.nextAttempt}/${maxAttempts}`,
            "",
            "Goal: recover the work with bounded autonomy. If this attempt cannot move safely, leave explicit blockers and evidence.",
          ].join("\n"),
          ...(report ? { contextArtifactIds: [report.id] } : {}),
        });
        await this.deps.runs.attachArtifacts(retryRun.id, [
          dispatch.briefingArtifactId,
          ...dispatch.steps.flatMap((step) => step.artifactIds),
        ]);

        const blockedSteps = dispatch.steps.filter((step) => !step.ok);
        retryBlockers = blockedSteps.flatMap((step) =>
          step.blockers.length > 0
            ? step.blockers.map((blocker) => `${step.role}: ${blocker}`)
            : [`${step.role}: ${step.notes}`],
        );
        retryRecovered = blockedSteps.length === 0;
        if (blockedSteps.length > 0) {
          // Persist the truthful blocked outcome on the retry run so a later
          // scan classifies and retries/escalates it rather than treating the
          // stub completion as success.
          await this.deps.runs.patch(retryRun.id, {
            status: "blocked",
            dispatch_status: "blocked",
            dispatch_blockers: retryBlockers,
          });
        }
      }

      await this.deps.runs.patch(candidate.run.id, {
        retry_attempts: candidate.nextAttempt,
        last_retry_at: now.toISOString(),
        next_retry_at: candidate.nextRetryAt ?? nextRetryAt(now, candidate.nextAttempt),
        retry_classification: candidate.classification.reason,
        ...(report ? { retry_report_id: report.id } : {}),
        ...(retryRecovered ? { retry_recovered_at: now.toISOString() } : {}),
        retry_child_runs: [...stringList(candidate.run["retry_child_runs"]), retryRun.id],
      });
      await this.deps.runs.patch(retryRun.id, {
        retry_parent_run_id: candidate.run.id,
        retry_attempt: candidate.nextAttempt,
        retry_max_attempts: maxAttempts,
        retry_classification: candidate.classification.reason,
        ...(report ? { retry_report_id: report.id } : {}),
      });
      knownSources.add(candidate.triggerSource);
      triggered.push({
        originalRun: candidate.run,
        retryRun,
        attempt: candidate.nextAttempt,
        triggerSource: candidate.triggerSource,
      });
      await this.deps.audit.append({
        actor: "supreme_coordinator",
        action: "autonomy.retry.started",
        target: retryRun.id,
        capability: "bureauos.retry",
        ...(report ? { artifact_id: report.id } : {}),
        result: "ok",
      });
    }

    return { triggered, escalated, skipped, ...(report ? { report } : {}) };
  }
}
