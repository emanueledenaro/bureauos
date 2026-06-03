import { describe, expect, it } from "vitest";
import type { RunRecord } from "./api";
import { deriveBuildProgress, isTerminalBuildStatus } from "./build-progress";

function run(partial: Partial<RunRecord>): RunRecord {
  return {
    id: "run_x",
    type: "feature",
    status: "in_progress",
    scope: "Build something",
    created: "2026-06-03T10:00:00.000Z",
    ...partial,
  };
}

describe("deriveBuildProgress", () => {
  it("returns pending for an empty list", () => {
    expect(deriveBuildProgress([])).toEqual({
      phase: "pending",
      stageLabel: "In coda",
      artifactCount: 0,
      blockers: [],
    });
  });

  it("returns pending when no feature run exists", () => {
    const progress = deriveBuildProgress([
      run({ id: "r1", type: "health_check", status: "in_progress" }),
      run({ id: "r2", type: "bug", status: "completed" }),
    ]);
    expect(progress.phase).toBe("pending");
    expect(progress.runId).toBeUndefined();
  });

  it("maps a non-terminal feature run to building with the pipeline stage label", () => {
    const progress = deriveBuildProgress([run({ id: "r1", status: "in_progress" })]);
    expect(progress).toEqual({
      runId: "r1",
      phase: "building",
      stageLabel: "Sviluppo → QA → review",
      artifactCount: 0,
      blockers: [],
    });
  });

  it("treats every non-terminal status (e.g. planning, dispatching) as building", () => {
    for (const status of ["created", "planning", "dispatching", "verifying"]) {
      expect(deriveBuildProgress([run({ status })]).phase).toBe("building");
    }
  });

  it("maps a completed feature run to completed and counts artifacts", () => {
    const progress = deriveBuildProgress([
      run({ id: "r1", status: "completed", artifacts: ["a1", "a2", "a3"] }),
    ]);
    expect(progress.phase).toBe("completed");
    expect(progress.stageLabel).toBe("Completata");
    expect(progress.artifactCount).toBe(3);
  });

  it("maps a blocked run to blocked and surfaces the first dispatch blocker", () => {
    const progress = deriveBuildProgress([
      run({
        id: "r1",
        status: "blocked",
        dispatch_blockers: ["awaiting owner approval", "secrets touched"],
      }),
    ]);
    expect(progress.phase).toBe("blocked");
    expect(progress.stageLabel).toBe("awaiting owner approval");
    expect(progress.blockers).toEqual(["awaiting owner approval", "secrets touched"]);
  });

  it("maps needs_human to blocked", () => {
    expect(deriveBuildProgress([run({ status: "needs_human" })]).phase).toBe("blocked");
  });

  it("falls back to a generic blocked label when no blockers are present", () => {
    const progress = deriveBuildProgress([run({ status: "blocked" })]);
    expect(progress.phase).toBe("blocked");
    expect(progress.stageLabel).toBe("In attesa dell'owner");
  });

  it("normalises a single-string blockers field into a list", () => {
    const progress = deriveBuildProgress([
      run({ status: "blocked", dispatch_blockers: "one blocker" }),
    ]);
    expect(progress.blockers).toEqual(["one blocker"]);
    expect(progress.stageLabel).toBe("one blocker");
  });

  it("maps failed and cancelled runs to failed", () => {
    expect(deriveBuildProgress([run({ status: "failed" })]).phase).toBe("failed");
    expect(deriveBuildProgress([run({ status: "cancelled" })]).phase).toBe("failed");
  });

  it("selects the latest feature run by created when several exist", () => {
    const progress = deriveBuildProgress([
      run({ id: "old", status: "completed", created: "2026-06-01T10:00:00.000Z" }),
      run({ id: "new", status: "in_progress", created: "2026-06-03T10:00:00.000Z" }),
    ]);
    expect(progress.runId).toBe("new");
    expect(progress.phase).toBe("building");
  });

  it("ignores non-feature runs even when they are newer", () => {
    const progress = deriveBuildProgress([
      run({ id: "feat", status: "in_progress", created: "2026-06-01T10:00:00.000Z" }),
      run({ id: "bug", type: "bug", status: "completed", created: "2026-06-09T10:00:00.000Z" }),
    ]);
    expect(progress.runId).toBe("feat");
  });

  it("prefers dispatch_blockers over the generic blockers field", () => {
    const progress = deriveBuildProgress([
      run({ status: "blocked", dispatch_blockers: ["dispatch reason"], blockers: ["other"] }),
    ]);
    expect(progress.blockers).toEqual(["dispatch reason"]);
  });
});

describe("isTerminalBuildStatus", () => {
  it("treats completed/failed/cancelled as terminal", () => {
    expect(isTerminalBuildStatus("completed")).toBe(true);
    expect(isTerminalBuildStatus("failed")).toBe(true);
    expect(isTerminalBuildStatus("cancelled")).toBe(true);
  });

  it("treats in-progress and blocked as non-terminal", () => {
    expect(isTerminalBuildStatus("in_progress")).toBe(false);
    expect(isTerminalBuildStatus("blocked")).toBe(false);
    expect(isTerminalBuildStatus("needs_human")).toBe(false);
  });
});
