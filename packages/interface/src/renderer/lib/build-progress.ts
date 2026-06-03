import type { RunRecord } from "./api";

/**
 * Phase of an async owner-triggered build, derived purely from the project's
 * feature run. Drives the BuildProgressCard copy + indicator (Unit 3B):
 * - "pending"   no feature run yet (the kickoff just fired; the run file may
 *               not be visible on the very first poll).
 * - "building"  the run exists and is not terminal.
 * - "completed" the run reached `completed`.
 * - "blocked"   the run is `blocked` / `needs_human` (owner intervention).
 * - "failed"    the run reached `failed` or `cancelled`.
 */
export type BuildPhase = "pending" | "building" | "completed" | "blocked" | "failed";

export interface BuildProgress {
  runId?: string;
  phase: BuildPhase;
  stageLabel: string;
  artifactCount: number;
  blockers: string[];
}

/** Run statuses that end polling: no further progress will arrive. */
export const TERMINAL_BUILD_STATUSES = ["completed", "failed", "cancelled"] as const;

/** Whether a feature-run status is terminal (stop polling). */
export function isTerminalBuildStatus(status: string): boolean {
  return (TERMINAL_BUILD_STATUSES as readonly string[]).includes(status);
}

/**
 * Normalise the loosely-typed `blockers` / `dispatch_blockers` fields (each is
 * `string[] | string | undefined`) into a clean, non-empty string list.
 */
function normalizeBlockers(value: RunRecord["dispatch_blockers"]): string[] {
  if (Array.isArray(value)) return value.map((entry) => entry.trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

/**
 * Pick the latest `type: "feature"` run. The API returns runs oldest-first, so
 * the last feature run in the list is the most recent; fall back to comparing
 * `created` so the selection stays correct regardless of input ordering.
 */
function latestFeatureRun(runs: RunRecord[]): RunRecord | undefined {
  let latest: RunRecord | undefined;
  for (const run of runs) {
    if (run.type !== "feature") continue;
    if (!latest || run.created >= latest.created) latest = run;
  }
  return latest;
}

/**
 * Derive build progress from a project's runs. Pure: no I/O, no clock, fully
 * unit-tested. The card calls this on every poll with the freshest run list.
 */
export function deriveBuildProgress(runs: RunRecord[]): BuildProgress {
  const run = latestFeatureRun(runs);
  if (!run) {
    return { phase: "pending", stageLabel: "In coda", artifactCount: 0, blockers: [] };
  }

  const artifactCount = run.artifacts?.length ?? 0;
  const blockers = normalizeBlockers(run.dispatch_blockers ?? run.blockers);

  if (run.status === "completed") {
    return { runId: run.id, phase: "completed", stageLabel: "Completata", artifactCount, blockers };
  }
  if (run.status === "failed" || run.status === "cancelled") {
    return { runId: run.id, phase: "failed", stageLabel: "Non riuscita", artifactCount, blockers };
  }
  if (run.status === "blocked" || run.status === "needs_human") {
    return {
      runId: run.id,
      phase: "blocked",
      stageLabel: blockers[0] ?? "In attesa dell'owner",
      artifactCount,
      blockers,
    };
  }
  // Any other non-terminal status (in_progress, planning, dispatching, …).
  return {
    runId: run.id,
    phase: "building",
    stageLabel: "Sviluppo → QA → review",
    artifactCount,
    blockers,
  };
}
