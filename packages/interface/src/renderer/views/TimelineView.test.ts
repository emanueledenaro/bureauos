import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../lib/api";
import { timelineEventPresentation } from "./TimelineView";

const event: AuditEvent = {
  timestamp: "2026-05-26T10:00:00.000Z",
  actor: "test",
  action: "memory.search",
  target: "company",
  result: "ok",
};

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
