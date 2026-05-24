import type { BureauConfig } from "../config/schema.js";
import type { RunEngine, RunType } from "../runs/engine.js";
import { dispatchRun, type CoordinatorDeps } from "../runs/coordinator.js";
import { BusinessReportService } from "../reports/business.js";

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

  private log(message: string): void {
    if (this.options.logger) this.options.logger(message);
    else console.log(`[bureauos] ${message}`);
  }
}
