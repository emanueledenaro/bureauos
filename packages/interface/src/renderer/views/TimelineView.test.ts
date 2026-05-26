import { describe, expect, it } from "vitest";
import type { AuditEvent, RunRecord } from "../lib/api";
import {
  runBlockingReason,
  runNextAction,
  runRiskLevel,
  runSourceIssue,
  timelineEventPresentation,
} from "./TimelineView";

const event: AuditEvent = {
  timestamp: "2026-05-26T10:00:00.000Z",
  actor: "test",
  action: "memory.search",
  target: "company",
  result: "ok",
};

const run = (overrides: Partial<RunRecord>): RunRecord => ({
  id: "run_test",
  type: "development",
  status: "completed",
  scope: "Implement timeline",
  created: "2026-05-26T10:00:00.000Z",
  created_by: "supreme_coordinator",
  trigger_source: "linear://issue/SER-86",
  ...overrides,
});

describe("timelineEventPresentation", () => {
  it("prioritizes failed audit events as danger", () => {
    expect(timelineEventPresentation({ ...event, result: "error" })).toMatchObject({
      icon: "audit",
      tone: "danger",
    });
  });

  it("maps common audit categories to compact icons", () => {
    expect(timelineEventPresentation(event)).toMatchObject({ icon: "memory", tone: "success" });
    expect(
      timelineEventPresentation({ ...event, action: "github.signal.report", target: "repo" }),
    ).toMatchObject({ icon: "github", tone: "info" });
    expect(
      timelineEventPresentation({ ...event, action: "policy.evaluate", target: "approval" }),
    ).toMatchObject({ icon: "approval", tone: "warning" });
  });
});

describe("run timeline helpers", () => {
  it("derives risk levels from run status", () => {
    expect(runRiskLevel(run({ status: "completed" }))).toBe("low");
    expect(runRiskLevel(run({ status: "in_progress" }))).toBe("medium");
    expect(runRiskLevel(run({ status: "needs_human" }))).toBe("high");
    expect(runRiskLevel(run({ status: "failed" }))).toBe("critical");
  });

  it("extracts Linear source issues from trigger sources", () => {
    expect(runSourceIssue(run({ trigger_source: "linear://issue/ser-86" }))).toBe("SER-86");
    expect(runSourceIssue(run({ trigger_source: "electron" }))).toBe("No linked issue");
  });

  it("surfaces blockers and next action for failed or blocked runs", () => {
    const blocked = run({
      status: "blocked",
      blockers: ["Missing repository access", "Policy approval pending"],
    });
    expect(runBlockingReason(blocked)).toBe("Missing repository access, Policy approval pending");
    expect(runNextAction(blocked)).toBe("Resolve the blocker before dispatching more work.");

    const failed = run({
      status: "failed",
      dispatch_error: "Provider returned malformed tool payload",
    });
    expect(runBlockingReason(failed)).toBe("Provider returned malformed tool payload");
    expect(runNextAction(failed)).toBe(
      "Review the failure evidence and retry only after the blocker is clear.",
    );
  });
});
