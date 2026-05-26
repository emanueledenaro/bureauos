import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../lib/api";
import { mergeAuditEvents } from "./useDashboard";

const baseEvent: AuditEvent = {
  timestamp: "2026-05-26T10:00:00.000Z",
  actor: "test",
  action: "memory.search",
  target: "company",
  result: "ok",
};

describe("mergeAuditEvents", () => {
  it("dedupes matching audit events and keeps chronological order", () => {
    const duplicate: AuditEvent = { ...baseEvent };
    const later: AuditEvent = {
      ...baseEvent,
      timestamp: "2026-05-26T10:01:00.000Z",
      action: "provider.route",
    };

    expect(mergeAuditEvents([later, baseEvent], [duplicate])).toEqual([baseEvent, later]);
  });

  it("keeps only the latest events inside the limit", () => {
    const events = Array.from(
      { length: 5 },
      (_, index): AuditEvent => ({
        ...baseEvent,
        timestamp: `2026-05-26T10:0${index}:00.000Z`,
        action: `event.${index}`,
      }),
    );

    expect(mergeAuditEvents([], events, 3).map((event) => event.action)).toEqual([
      "event.2",
      "event.3",
      "event.4",
    ]);
  });
});
