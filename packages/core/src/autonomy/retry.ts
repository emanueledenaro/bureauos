import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import type { PolicyDecision, PolicyEngine } from "../policy/engine.js";
import { dispatchRun, type CoordinatorDeps } from "../runs/coordinator.js";
import { RunEngine, type RunRecord } from "../runs/engine.js";

export type AutonomousRetryStatus = "blocked" | "failed";

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
  reason: "max_attempts_reached";
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
  coordinator?: CoordinatorDeps;
}

interface Candidate {
  run: RunRecord;
  attempts: number;
  nextAttempt: number;
  triggerSource: string;
  action: "retry" | "escalate";
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

function reportBody(now: Date, maxAttempts: number, candidates: readonly Candidate[]): string {
  return `# Autonomous Retry Report

Generated: ${now.toISOString()}

Policy: retry failed or blocked runs up to ${maxAttempts} attempt(s), then escalate to the owner.

## Actions

${candidates
  .map((candidate) => {
    return `- ${candidate.action}: ${candidate.run.id} (${candidate.run.type})
  - Status: ${candidate.run.status}
  - Attempt: ${candidate.nextAttempt}/${maxAttempts}
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

  constructor(
    private readonly workspaceRoot: string,
    private readonly deps: AutonomousRetryDeps,
  ) {
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
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
      candidates.push({
        run,
        attempts,
        nextAttempt,
        triggerSource,
        action: nextAttempt > maxAttempts ? "escalate" : "retry",
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
        await this.deps.runs.patch(candidate.run.id, {
          retry_attempts: candidate.attempts,
          retry_escalated_at: now.toISOString(),
          retry_escalation_reason: "max_attempts_reached",
        });
        escalated.push({
          run: candidate.run,
          attempts: candidate.attempts,
          reason: "max_attempts_reached",
        });
        await this.deps.audit.append({
          actor: "supreme_coordinator",
          action: "autonomy.retry.escalated",
          target: candidate.run.id,
          capability: "bureauos.retry",
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
      }

      await this.deps.runs.patch(candidate.run.id, {
        retry_attempts: candidate.nextAttempt,
        last_retry_at: now.toISOString(),
        ...(retryRun.status === "completed" ? { retry_recovered_at: now.toISOString() } : {}),
        retry_child_runs: [
          ...stringList(candidate.run["retry_child_runs"]),
          retryRun.id,
        ],
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
