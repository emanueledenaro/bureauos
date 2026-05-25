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
import { parseGitHubRepository } from "../github/repository-utils.js";

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
];

export class Scheduler {
  private interval: NodeJS.Timeout | undefined;
  private jobs: TickJob[];

  constructor(private readonly options: SchedulerOptions) {
    this.jobs = TICKS.map((t) => ({ ...t }));
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
    for (const job of this.jobs) {
      const due = job.last === undefined || now - job.last >= job.everyMs;
      if (!due) continue;
      job.last = now;
      try {
        if (job.name === "github_project_signal_sync") {
          await this.syncGitHubProjectSignals();
          continue;
        }
        if (job.name === "operational_signal_scan") {
          await this.scanOperationalSignals();
          continue;
        }
        if (job.name === "memory_trigger_scan") {
          await this.scanMemoryTriggers(now);
          continue;
        }
        if (job.name === "autonomous_retry_scan") {
          await this.scanAutonomousRetries();
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
            this.log(
              `scheduler: generated ${accountPlans.plans.length} client account plan(s)`,
            );
          }
          this.log(
            `scheduler: ran ${job.name} -> ${run.id} (${run.status}, ${result.steps.length} steps)`,
          );
        } else {
          this.log(`scheduler: ran ${job.name} -> ${run.id} (${run.status})`);
        }
      } catch (err) {
        this.log(`scheduler: ${job.name} failed: ${(err as Error).message}`);
      }
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
      const verification = await new ProjectRepositoryVerificationService(this.options.workspaceRoot, {
        ...(this.options.coordinator
          ? {
              audit: this.options.coordinator.audit,
              artifacts: this.options.coordinator.artifacts,
            }
          : {}),
      }).verify();
      this.log(
        `scheduler: repository verification ${verification.report.id} found no linked GitHub repositories`,
      );
      return;
    }

    const verification = await new ProjectRepositoryVerificationService(this.options.workspaceRoot, {
      ...(this.options.githubClient ? { githubClient: this.options.githubClient } : {}),
      ...(this.options.coordinator
        ? {
            audit: this.options.coordinator.audit,
            artifacts: this.options.coordinator.artifacts,
          }
        : {}),
    }).verify({
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
    }).scan({
      maxAttempts: this.options.config.limits.max_retries_per_task,
    });
    this.log(
      `scheduler: autonomous_retry_scan retried ${result.triggered.length} runs, escalated ${result.escalated.length}, skipped ${result.skipped.length}`,
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
