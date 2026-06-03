import { useEffect, useState } from "react";
import { Hammer, Loader2 } from "lucide-react";
import { BaseCard } from "../dashboard/BaseCard";
import { StatusPill } from "../dashboard/StatusPill";
import { Api, type RunRecord } from "../../lib/api";
import {
  deriveBuildProgress,
  isTerminalBuildStatus,
  type BuildPhase,
  type BuildProgress,
} from "../../lib/build-progress";
import type { Tone } from "../../lib/tone";
import { useT } from "../../i18n/i18n";

/** Poll cadence for the project's feature run while a build is in flight. */
const BUILD_POLL_INTERVAL_MS = 3000;

const PHASE_TONE: Record<BuildPhase, Tone> = {
  pending: "info",
  building: "info",
  completed: "success",
  blocked: "warning",
  failed: "danger",
};

const EMPTY_PROGRESS: BuildProgress = {
  phase: "pending",
  stageLabel: "",
  artifactCount: 0,
  blockers: [],
};

/**
 * Persistent post-turn progress card for an async owner-triggered build
 * (Unit 3B). Mounted by CoordinatorPanel beneath a coordinator message whose
 * `meta.build` is set. Polls `GET /runs?project=` every ~3 s, feeds the pure
 * `deriveBuildProgress`, and stops once the feature run is terminal
 * (completed / failed / cancelled). The `alreadyRunning` case needs no special
 * handling here: it just means the latest feature run is already in progress,
 * which the same poll surfaces.
 */
export function BuildProgressCard({
  projectId,
  projectSlug,
}: {
  projectId: string;
  projectSlug: string;
}) {
  const t = useT();
  const [progress, setProgress] = useState<BuildProgress>(EMPTY_PROGRESS);

  useEffect(() => {
    // Cleanup-safe polling, mirroring useDashboard: one AbortController tears
    // down the in-flight fetch on unmount, a `cancelled` flag drops late
    // results, and the interval is cleared. Polling stops as soon as the run is
    // terminal so we never poll a finished build forever.
    let cancelled = false;
    const controller = new AbortController();
    let timer: ReturnType<typeof setInterval> | undefined;

    const stop = (): void => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    };

    const poll = async (): Promise<void> => {
      let runs: RunRecord[];
      try {
        runs = await Api.runsByProject(projectId, controller.signal);
      } catch {
        // Transient API failure: keep the last-known progress and let the next
        // tick recover, exactly like the dashboard's resilient polling.
        return;
      }
      if (cancelled) return;
      const next = deriveBuildProgress(runs);
      setProgress(next);
      // Once the run is terminal there is nothing more to observe — stop the
      // interval (the card stays rendered showing the final state).
      if (
        next.runId &&
        isTerminalBuildStatus(runs.find((run) => run.id === next.runId)?.status ?? "")
      ) {
        stop();
      }
    };

    // Immediate first fetch (don't wait a full interval), then poll.
    void poll();
    timer = setInterval(() => void poll(), BUILD_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      stop();
    };
  }, [projectId]);

  const tone = PHASE_TONE[progress.phase];
  const building = progress.phase === "pending" || progress.phase === "building";

  return (
    <BaseCard
      padding="compact"
      variant="accent"
      accentTone={tone}
      className="mt-2 w-full max-w-md gap-2 bg-surface-raised"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-eyebrow flex items-center gap-1.5">
            <Hammer className="h-3 w-3" />
            {t("buildProgress.eyebrow", "Build")}
          </div>
          <div className="text-card-title mt-1 truncate">{projectSlug}</div>
        </div>
        <StatusPill value={statusLabel(progress.phase, t)} tone={tone} className="shrink-0" />
      </div>

      <div className="text-body-secondary flex items-center gap-1.5 text-foreground">
        {building ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-info" /> : null}
        <span className="min-w-0 truncate">{statusLine(progress, t)}</span>
      </div>

      {progress.phase !== "pending" ? (
        <div className="text-meta">
          {t("buildProgress.artifacts", "Artifacts")}: {progress.artifactCount}
        </div>
      ) : null}
    </BaseCard>
  );
}

function statusLabel(phase: BuildPhase, t: ReturnType<typeof useT>): string {
  switch (phase) {
    case "completed":
      return t("buildProgress.statusCompleted", "Completed");
    case "blocked":
      return t("buildProgress.statusBlocked", "Blocked");
    case "failed":
      return t("buildProgress.statusFailed", "Failed");
    default:
      return t("buildProgress.statusBuilding", "Building");
  }
}

/**
 * The one-line human description, composed from the derived phase plus localized
 * frames. The building pipeline stage is rendered from i18n (not from the pure
 * fn's hardcoded `stageLabel`) so it reads naturally in each locale; the blocked
 * reason uses `stageLabel` because it carries the backend blocker string.
 */
function statusLine(progress: BuildProgress, t: ReturnType<typeof useT>): string {
  switch (progress.phase) {
    case "pending":
      return t("buildProgress.linePending", "Starting the build…");
    case "completed":
      return t("buildProgress.lineCompleted", "Completed — {count} artifact").replace(
        "{count}",
        String(progress.artifactCount),
      );
    case "blocked":
      return t("buildProgress.lineBlocked", "Blocked — {reason}").replace(
        "{reason}",
        progress.stageLabel,
      );
    case "failed":
      return t("buildProgress.lineFailed", "Build did not complete");
    default:
      return t("buildProgress.lineBuilding", "Building — {stage}").replace(
        "{stage}",
        t("buildProgress.pipelineStage", "Dev → QA → review"),
      );
  }
}
