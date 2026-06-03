import type { BureauConfig } from "../config/schema.js";
import type { RunEngine, RunType } from "../runs/engine.js";
import { dispatchRun, type CoordinatorDeps } from "../runs/coordinator.js";
import { BusinessReportService } from "../reports/business.js";
import { ProjectRegistry } from "../registries/project.js";
import { ClientAccountPlanService } from "../clients/account-plans.js";
import { ProjectHealthReviewService } from "../autonomy/project-health.js";
import { ProjectRepositoryVerificationService } from "../autonomy/repository-verification.js";
import { GrowthReviewService } from "../growth/review.js";
import type { GitHubSignalClient } from "../github/signal-sync.js";
import { GitHubSignalTriggerService } from "../github/signal-triggers.js";
import { OperationalSignalTriggerService } from "../autonomy/operational-triggers.js";
import { MemoryTriggerService } from "../autonomy/memory-triggers.js";
import { AutonomousRetryService } from "../autonomy/retry.js";
import { RootMemoryConsolidationService } from "../memory/consolidation.js";
import { MorningBriefService } from "../memory/morning-brief.js";
import { parseGitHubRepository } from "../github/repository-utils.js";
import { ArtifactStore } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { workspacePaths } from "../paths.js";
import { DaemonSchedulerStateStore } from "./state.js";

/**
 * Always-on scheduler.
 *
 * Wires schedule, threshold, and memory triggers from `bureauos.yaml` into
 * the run engine. Phase 7 of the BACKLOG. Right now we support time-based
 * schedules only; GitHub webhooks and CI events arrive when the GitHub
 * adapter lands (Phase 3 follow-up).
 */

export interface SchedulerOptions {
  config: BureauConfig;
  runs: RunEngine;
  workspaceRoot?: string;
  coordinator?: CoordinatorDeps;
  githubClient?: GitHubSignalClient;
  schedulerState?: DaemonSchedulerStateStore;
  logger?: (message: string) => void;
}

interface TickJob {
  name: string;
  type: RunType;
  scope: string;
  everyMs: number;
  last?: number;
}

const TICKS: Array<Omit<TickJob, "last">> = [
  {
    name: "project_health_check",
    type: "health_check",
    scope: "hourly project health check",
    everyMs: 60 * 60 * 1000,
  },
  {
    name: "daily_executive_report",
    type: "planning",
    scope: "daily executive report",
    everyMs: 24 * 60 * 60 * 1000,
  },
  {
    name: "growth_review",
    type: "planning",
    scope: "weekly growth review",
    everyMs: 7 * 24 * 60 * 60 * 1000,
  },
  {
    name: "client_account_review",
    type: "client_success",
    scope: "weekly client account review",
    everyMs: 7 * 24 * 60 * 60 * 1000,
  },
  {
    name: "operational_signal_scan",
    type: "health_check",
    scope: "scan internal operating signals",
    everyMs: 30 * 60 * 1000,
  },
  {
    name: "memory_trigger_scan",
    type: "client_success",
    scope: "scan durable memory for due follow-ups",
    everyMs: 30 * 60 * 1000,
  },
  {
    name: "autonomous_retry_scan",
    type: "health_check",
    scope: "retry failed or blocked autonomous runs within policy limits",
    everyMs: 30 * 60 * 1000,
  },
  {
    name: "github_project_signal_sync",
    type: "health_check",
    scope: "sync GitHub signals for linked project repositories",
    everyMs: 15 * 60 * 1000,
  },
  {
    name: "consolidate_root_memory",
    type: "health_check",
    scope: "consolidate durable ROOT memory from live workspace state",
    everyMs: 24 * 60 * 60 * 1000,
  },
];

function failureReportBody(
  job: Omit<TickJob, "last">,
  occurredAt: string,
  error: string,
  failureCount: number,
): string {
  return `# Daemon Job Failure

The always-on scheduler job **${job.name}** threw and did not complete.

- Job: ${job.name}
- Run type: ${job.type}
- Scope: ${job.scope}
- Occurred at: ${occurredAt}
- Consecutive failures: ${failureCount}
- Error: ${error}

## What this means

This is a reliability signal, not an action. The daemon recorded the failure and
backed the job off by its normal interval (it will be retried on a later tick).
No external action was taken.

## Owner next steps

- Inspect the daemon heartbeat (\`bureau daemon status\`) for the latest error and failure count.
- If the failure persists across ticks, investigate the underlying job before the next interval.
`;
}

export class Scheduler {
  private interval: NodeJS.Timeout | undefined;
  private jobs: TickJob[];
  private running = false;
  private readonly state?: DaemonSchedulerStateStore;
  // Stores used to make a job failure durable + owner-visible (SER-16). Prefer
  // the coordinator's wired instances; otherwise fall back to workspace-rooted
  // stores so failures still leave an artifact + audit trail even on the
  // lightweight (no-coordinator) daemon path. Undefined only when neither a
  // coordinator nor a workspace root is configured (e.g. a pure unit harness),
  // in which case failure recording degrades to logging.
  private readonly failureArtifacts?: ArtifactStore;
  private readonly failureAudit?: AuditLog;

  constructor(private readonly options: SchedulerOptions) {
    // ROOT consolidation is gated by the owner's memory policy: when
    // `promote_daily_notes_to_durable_memory` is off, the job is never scheduled
    // (so it leaves no cursor and never runs).
    const promoteRoot = options.config.memory.promote_daily_notes_to_durable_memory;
    this.jobs = TICKS.filter((t) => t.name !== "consolidate_root_memory" || promoteRoot).map(
      (t) => ({ ...t }),
    );
    this.state =
      options.schedulerState ??
      (options.workspaceRoot ? new DaemonSchedulerStateStore(options.workspaceRoot) : undefined);
    this.failureArtifacts =
      options.coordinator?.artifacts ??
      (options.workspaceRoot ? new ArtifactStore(options.workspaceRoot) : undefined);
    this.failureAudit =
      options.coordinator?.audit ??
      (options.workspaceRoot
        ? new AuditLog(workspacePaths(options.workspaceRoot).auditLog)
        : undefined);
  }

  start(everyMs = 60_000): void {
    if (this.interval) return;
    this.interval = setInterval(() => void this.tick(), everyMs);
    this.log(`scheduler: started (tick=${everyMs}ms, jobs=${this.jobs.length})`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
      this.log("scheduler: stopped");
    }
  }

  async tick(now = Date.now()): Promise<void> {
    // In-flight guard: a tick can run longer than the interval (jobs make
    // network calls and write files). Without this, the next `setInterval`
    // fire would overlap the running tick and double-execute due jobs,
    // producing duplicate reports, runs, and spend. Overlapping ticks are
    // skipped; the next interval picks up any still-due work.
    if (this.running) {
      this.log("scheduler: tick skipped (previous tick still running)");
      return;
    }
    this.running = true;
    try {
      await this.runTick(now);
    } finally {
      this.running = false;
    }
  }

  private async runTick(now: number): Promise<void> {
    for (const job of this.jobs) {
      const lastActivity = await this.lastActivityMs(job);
      const due = lastActivity === undefined || now - lastActivity >= job.everyMs;
      if (!due) continue;
      await this.state?.markStarted(job.name, new Date(now));
      // Record the attempt time in-memory up front, not only on success. The
      // persisted `last_started_at` already backs off a started job, but
      // `markStarted` is a no-op when no state store is configured; without
      // this, a failing job (whose `job.last` stays unset) would be
      // re-attempted on every tick instead of once per `everyMs` (SER-226).
      job.last = now;
      try {
        if (job.name === "github_project_signal_sync") {
          await this.syncGitHubProjectSignals();
          await this.markSucceeded(job, now);
          continue;
        }
        if (job.name === "operational_signal_scan") {
          await this.scanOperationalSignals();
          await this.markSucceeded(job, now);
          continue;
        }
        if (job.name === "memory_trigger_scan") {
          await this.scanMemoryTriggers(now);
          await this.markSucceeded(job, now);
          continue;
        }
        if (job.name === "autonomous_retry_scan") {
          await this.scanAutonomousRetries();
          await this.markSucceeded(job, now);
          continue;
        }
        if (job.name === "consolidate_root_memory") {
          await this.consolidateRootMemory(now);
          await this.markSucceeded(job, now);
          continue;
        }
        const run = await this.options.runs.start({
          type: job.type,
          triggerType: "schedule",
          triggerSource: job.name,
          scope: job.scope,
        });
        if (this.options.coordinator && this.options.workspaceRoot) {
          const result = await dispatchRun(this.options.coordinator, {
            workspaceRoot: this.options.workspaceRoot,
            run,
            scope: job.scope,
          });
          if (job.name === "daily_executive_report") {
            const report = await new BusinessReportService(this.options.workspaceRoot, {
              config: this.options.config,
              artifacts: this.options.coordinator.artifacts,
              audit: this.options.coordinator.audit,
              runs: this.options.runs,
            }).generate();
            this.log(
              `scheduler: generated reports ${report.executive_report.id}, ${report.business_operating_report.id}`,
            );
            // Also leave the owner a concise Morning Brief (SER-235): the short
            // proactive digest, complementing the full reports above.
            const brief = await new MorningBriefService(this.options.workspaceRoot, {
              artifacts: this.options.coordinator.artifacts,
              audit: this.options.coordinator.audit,
            }).generate({ now: new Date(now) });
            await this.options.runs.attachArtifacts(run.id, [brief.artifact.id]);
            this.log(`scheduler: generated morning brief ${brief.artifact.id}`);
          }
          if (job.name === "project_health_check") {
            const health = await new ProjectHealthReviewService(this.options.workspaceRoot, {
              artifacts: this.options.coordinator.artifacts,
              audit: this.options.coordinator.audit,
              runs: this.options.runs,
            }).generate({ runId: run.id, now: new Date(now) });
            await this.options.runs.attachArtifacts(run.id, [health.report.id]);
            this.log(
              `scheduler: generated project health review ${health.report.id} for ${health.projects.length} project(s)`,
            );
          }
          if (job.name === "growth_review") {
            const growth = await new GrowthReviewService(this.options.workspaceRoot, {
              artifacts: this.options.coordinator.artifacts,
              audit: this.options.coordinator.audit,
            }).generate({ runId: run.id, now: new Date(now) });
            await this.options.runs.attachArtifacts(run.id, [growth.report.id]);
            this.log(`scheduler: generated growth review ${growth.report.id}`);
          }
          if (job.name === "client_account_review") {
            const accountPlans = await new ClientAccountPlanService(this.options.workspaceRoot, {
              artifacts: this.options.coordinator.artifacts,
              audit: this.options.coordinator.audit,
            }).generate({ runId: run.id, now: new Date(now) });
            if (accountPlans.plans.length > 0) {
              await this.options.runs.attachArtifacts(
                run.id,
                accountPlans.plans.map((plan) => plan.id),
              );
            }
            this.log(`scheduler: generated ${accountPlans.plans.length} client account plan(s)`);
          }
          this.log(
            `scheduler: ran ${job.name} -> ${run.id} (${run.status}, ${result.steps.length} steps)`,
          );
        } else {
          this.log(`scheduler: ran ${job.name} -> ${run.id} (${run.status})`);
        }
        await this.markSucceeded(job, now, run.id);
      } catch (err) {
        const message = (err as Error).message;
        const cursor = await this.state?.markFailed({
          trigger: job.name,
          now: new Date(now),
          error: message,
        });
        this.log(`scheduler: ${job.name} failed: ${message}`);
        // A thrown job must not fail silently: leave a durable artifact + audit
        // event so the owner sees it in the Operating Room, not only in the
        // ephemeral cursor/log (SER-16). Recording is best-effort and must never
        // surface its own error — a logging failure cannot be allowed to crash
        // the always-on daemon or abort the remaining due jobs in this tick.
        await this.recordJobFailure(job, now, message, cursor?.failure_count);
      }
    }
  }

  /**
   * Most recent moment this job was either started or succeeded.
   *
   * The due-check must consider `last_started_at`, not only `last_success_at`:
   * a job that has been started but has not yet finished (it is mid-run, or a
   * prior run crashed before recording success) must not be re-triggered just
   * because no success was recorded within the interval. Using the later of the
   * started/success timestamps keeps a long-running or interrupted job from
   * double-executing.
   */
  private async lastActivityMs(job: TickJob): Promise<number | undefined> {
    const cursor = await this.state?.cursor(job.name);
    const candidates: number[] = [];
    if (job.last !== undefined) candidates.push(job.last);
    const started =
      cursor?.last_started_at && Number.isFinite(Date.parse(cursor.last_started_at))
        ? Date.parse(cursor.last_started_at)
        : undefined;
    if (started !== undefined) candidates.push(started);
    const succeeded =
      cursor?.last_success_at && Number.isFinite(Date.parse(cursor.last_success_at))
        ? Date.parse(cursor.last_success_at)
        : undefined;
    if (succeeded !== undefined) candidates.push(succeeded);
    if (candidates.length === 0) return undefined;
    return Math.max(...candidates);
  }

  private async markSucceeded(job: TickJob, now: number, runId?: string): Promise<void> {
    job.last = now;
    await this.state?.markSucceeded({
      trigger: job.name,
      now: new Date(now),
      everyMs: job.everyMs,
      ...(runId ? { runId } : {}),
    });
  }

  /**
   * Make a thrown tick job durably owner-visible (SER-16).
   *
   * Writes a `daemon-job-failure-report` artifact and appends a
   * `daemon.job.failed` audit event (linking the artifact). This complements the
   * scheduler cursor — which only surfaces the latest error via the heartbeat
   * and only when a state store is configured — with a permanent record in the
   * artifact store and the append-only audit log, the two surfaces the owner
   * actually inspects. It records visibility only; it never retries or takes any
   * external action. The whole operation is best-effort: any error raised while
   * recording is swallowed (and logged) so it cannot crash the always-on daemon
   * or abort the rest of the tick.
   */
  private async recordJobFailure(
    job: TickJob,
    now: number,
    message: string,
    failureCount?: number,
  ): Promise<void> {
    try {
      const occurredAt = new Date(now).toISOString();
      const attempts = failureCount ?? 1;
      const artifact = await this.failureArtifacts?.write({
        type: "daemon-job-failure-report",
        createdBy: "daemon_scheduler",
        status: "submitted",
        metadata: {
          job: job.name,
          run_type: job.type,
          scope: job.scope,
          every_ms: job.everyMs,
          failure_count: attempts,
          error: message,
          occurred_at: occurredAt,
        },
        body: failureReportBody(job, occurredAt, message, attempts),
      });
      await this.failureAudit?.append({
        actor: "daemon_scheduler",
        action: "daemon.job.failed",
        target: job.name,
        capability: "bureauos.daemon",
        ...(artifact ? { artifact_id: artifact.id } : {}),
        result: "error",
        error: message,
      });
    } catch (recordError) {
      this.log(
        `scheduler: failed to record failure artifact for ${job.name}: ${(recordError as Error).message}`,
      );
    }
  }

  private async syncGitHubProjectSignals(): Promise<void> {
    if (!this.options.workspaceRoot) {
      this.log("scheduler: github_project_signal_sync skipped (workspace not configured)");
      return;
    }

    const projects = await new ProjectRegistry(this.options.workspaceRoot).list();
    const repositories = new Map<string, { owner: string; repo: string }>();
    for (const project of projects) {
      const parsed = parseGitHubRepository(project.repository);
      if (!parsed) continue;
      repositories.set(`${parsed.owner}/${parsed.repo}`, parsed);
    }

    if (repositories.size === 0) {
      const verification = await new ProjectRepositoryVerificationService(
        this.options.workspaceRoot,
        {
          ...(this.options.coordinator
            ? {
                audit: this.options.coordinator.audit,
                artifacts: this.options.coordinator.artifacts,
              }
            : {}),
        },
      ).verify();
      this.log(
        `scheduler: repository verification ${verification.report.id} found no linked GitHub repositories`,
      );
      return;
    }

    const verification = await new ProjectRepositoryVerificationService(
      this.options.workspaceRoot,
      {
        ...(this.options.githubClient ? { githubClient: this.options.githubClient } : {}),
        ...(this.options.coordinator
          ? {
              audit: this.options.coordinator.audit,
              artifacts: this.options.coordinator.artifacts,
            }
          : {}),
      },
    ).verify({
      staleDays: this.options.config.triggers.thresholds.stale_pr_hours / 24,
    });

    if (!this.options.githubClient) {
      this.log(
        `scheduler: repository verification ${verification.report.id} completed without GitHub client (${verification.projects.length} project(s) unverified)`,
      );
      return;
    }

    const trigger = this.options.coordinator
      ? new GitHubSignalTriggerService({
          runs: this.options.runs,
          audit: this.options.coordinator.audit,
          policy: this.options.coordinator.policy,
          workspaceRoot: this.options.workspaceRoot,
          coordinator: this.options.coordinator,
        })
      : undefined;
    let triggered = 0;
    for (const item of verification.projects) {
      if (trigger && item.signal) {
        const runs = await trigger.trigger({
          repository: item.signal.repository,
          report: item.signal.report,
          failingChecks: item.signal.failingChecks,
          staleIssues: item.signal.staleIssues,
          stalePullRequests: item.signal.stalePullRequests,
        });
        triggered += runs.triggered.length;
      }
    }
    this.log(
      `scheduler: repository verification ${verification.report.id} checked ${repositories.size} repositories, triggered ${triggered} runs`,
    );
  }

  private async scanOperationalSignals(): Promise<void> {
    if (!this.options.workspaceRoot || !this.options.coordinator) {
      this.log("scheduler: operational_signal_scan skipped (coordinator not configured)");
      return;
    }

    const result = await new OperationalSignalTriggerService(this.options.workspaceRoot, {
      runs: this.options.runs,
      audit: this.options.coordinator.audit,
      artifacts: this.options.coordinator.artifacts,
      policy: this.options.coordinator.policy,
      coordinator: this.options.coordinator,
    }).scan({
      thresholds: {
        blockedProjectDays: this.options.config.triggers.thresholds.blocked_issue_hours / 24,
        blockedRunDays: this.options.config.triggers.thresholds.blocked_issue_hours / 24,
        unansweredClientMessageDays:
          this.options.config.triggers.thresholds.unanswered_client_message_hours / 24,
        emptyContentPipelineDays:
          this.options.config.triggers.thresholds.empty_content_pipeline_days,
      },
    });
    this.log(
      `scheduler: operational_signal_scan triggered ${result.triggered.length} runs, skipped ${result.skipped.length}`,
    );
  }

  private async scanAutonomousRetries(): Promise<void> {
    if (!this.options.workspaceRoot || !this.options.coordinator) {
      this.log("scheduler: autonomous_retry_scan skipped (coordinator not configured)");
      return;
    }

    const result = await new AutonomousRetryService(this.options.workspaceRoot, {
      runs: this.options.runs,
      audit: this.options.coordinator.audit,
      artifacts: this.options.coordinator.artifacts,
      policy: this.options.coordinator.policy,
      coordinator: this.options.coordinator,
      // Code-run retries re-run through the full provider-codegen + worktree
      // pipeline (not a template-only stub). config (+ default env) lets the
      // retry build a ProjectDispatchService mirroring the owner-build wiring.
      config: this.options.config,
      providerEnv: process.env,
    }).scan({
      maxAttempts: this.options.config.limits.max_retries_per_task,
    });
    this.log(
      `scheduler: autonomous_retry_scan retried ${result.triggered.length} runs, escalated ${result.escalated.length}, skipped ${result.skipped.length}`,
    );
  }

  private async consolidateRootMemory(now: number): Promise<void> {
    if (!this.options.workspaceRoot) {
      this.log("scheduler: consolidate_root_memory skipped (workspace not configured)");
      return;
    }
    const result = await new RootMemoryConsolidationService(this.options.workspaceRoot, {
      ...(this.options.coordinator ? { audit: this.options.coordinator.audit } : {}),
    }).consolidate({ now: new Date(now) });
    this.log(
      `scheduler: consolidated ROOT memory (${result.counts.activeClients} client(s), ` +
        `${result.counts.activeProjects} project(s), ${result.counts.openOpportunities} opportunity(ies))`,
    );
  }

  private async scanMemoryTriggers(now: number): Promise<void> {
    if (!this.options.workspaceRoot || !this.options.coordinator) {
      this.log("scheduler: memory_trigger_scan skipped (coordinator not configured)");
      return;
    }

    const result = await new MemoryTriggerService(this.options.workspaceRoot, {
      runs: this.options.runs,
      audit: this.options.coordinator.audit,
      artifacts: this.options.coordinator.artifacts,
      policy: this.options.coordinator.policy,
      coordinator: this.options.coordinator,
    }).scan({ now: new Date(now) });
    this.log(
      `scheduler: memory_trigger_scan triggered ${result.triggered.length} runs, skipped ${result.skipped.length}`,
    );
  }

  private log(message: string): void {
    if (this.options.logger) this.options.logger(message);
    else console.log(`[bureauos] ${message}`);
  }
}
