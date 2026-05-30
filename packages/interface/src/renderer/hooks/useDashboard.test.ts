import { describe, expect, it } from "vitest";
import type { AuditEvent, ClientRecord, CompanyPulse } from "../lib/api";
import type { DashboardState } from "../lib/types";
import { applyCoreResults, mergeAuditEvents } from "./useDashboard";

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

// Index positions in the settled tuple consumed by applyCoreResults. Mirrors
// the order of coreRequests() in useDashboard.ts.
const CORE = {
  pulse: 0,
  clients: 1,
  clientIntelligence: 2,
  projects: 3,
  projectOwnership: 4,
  opportunities: 5,
  growthMemory: 6,
  approvals: 7,
  resolvedApprovals: 8,
  notifications: 9,
  runs: 10,
  agents: 11,
  capabilities: 12,
  artifacts: 13,
  policyExplain: 14,
  providers: 15,
  settings: 16,
  providerConnectors: 17,
} as const;

const CORE_LENGTH = 18;

type CoreResults = Parameters<typeof applyCoreResults>[1];

function fulfilled<T>(value: T): PromiseSettledResult<T> {
  return { status: "fulfilled", value };
}

function rejected(reason: unknown): PromiseSettledResult<never> {
  return { status: "rejected", reason };
}

/** Builds an all-fulfilled core batch with empty arrays / minimal scalars. */
function allFulfilled(): PromiseSettledResult<unknown>[] {
  const batch = Array.from(
    { length: CORE_LENGTH },
    (): PromiseSettledResult<unknown> => fulfilled([]),
  );
  batch[CORE.pulse] = fulfilled({ organization: "BureauOS" } as unknown as CompanyPulse);
  batch[CORE.clientIntelligence] = fulfilled(undefined);
  batch[CORE.growthMemory] = fulfilled(undefined);
  batch[CORE.policyExplain] = fulfilled(undefined);
  batch[CORE.settings] = fulfilled(undefined);
  return batch;
}

function asResults(batch: PromiseSettledResult<unknown>[]): CoreResults {
  return batch as unknown as CoreResults;
}

const client: ClientRecord = { id: "c-1", name: "Acme" } as unknown as ClientRecord;

const previousState: DashboardState = {
  clients: [client],
  projects: [],
  projectOwnership: [],
  opportunities: [],
  approvals: [],
  resolvedApprovals: [],
  notifications: [],
  runs: [],
  agents: [],
  capabilities: [],
  providers: [],
  providerConnectors: [],
  artifacts: [],
  audit: [],
  loading: true,
  hasLoaded: false,
};

describe("applyCoreResults", () => {
  it("marks the dashboard as loaded and clears loading after the first settle", () => {
    const next = applyCoreResults(previousState, asResults(allFulfilled()), undefined);
    expect(next.loading).toBe(false);
    expect(next.hasLoaded).toBe(true);
    expect(next.error).toBeUndefined();
  });

  it("keeps the last-good slice when a single endpoint rejects", () => {
    const batch = allFulfilled();
    // Clients endpoint fails, but projects succeeds with fresh data.
    batch[CORE.clients] = rejected(new Error("clients down"));
    batch[CORE.projects] = fulfilled([{ id: "p-1" }]);

    const next = applyCoreResults(previousState, asResults(batch), undefined);

    // Last-good clients are preserved (not blanked).
    expect(next.clients).toEqual([client]);
    // Fresh projects come through.
    expect(next.projects).toEqual([{ id: "p-1" }]);
    // A single non-health failure must not raise the global error banner.
    expect(next.error).toBeUndefined();
  });

  it("sets the global error when the health probe (pulse) fails", () => {
    const batch = allFulfilled();
    batch[CORE.pulse] = rejected(new Error("API server unreachable"));
    // Everything else still succeeds.

    const next = applyCoreResults(previousState, asResults(batch), undefined);

    expect(next.error).toBe("API server unreachable");
    // Pulse keeps its prior (undefined) value rather than blanking other slices.
    expect(next.pulse).toBeUndefined();
    expect(next.hasLoaded).toBe(true);
  });

  it("sets the global error when every core request fails", () => {
    const batch = Array.from({ length: CORE_LENGTH }, () => rejected(new Error("boom")));

    const next = applyCoreResults(previousState, asResults(batch), undefined);

    expect(next.error).toBe("boom");
    // Last-good clients survive a total outage.
    expect(next.clients).toEqual([client]);
  });

  it("treats a recovered partial batch as healthy (clears a stale error)", () => {
    const erroredState: DashboardState = { ...previousState, error: "API server unreachable" };
    const batch = allFulfilled();
    // One non-health slice still fails, but pulse recovered.
    batch[CORE.runs] = rejected(new Error("runs flaky"));

    const next = applyCoreResults(erroredState, asResults(batch), undefined);

    expect(next.error).toBeUndefined();
  });

  it("merges fresh audit events when an audit result is provided", () => {
    const batch = allFulfilled();
    const stateWithAudit: DashboardState = { ...previousState, audit: [baseEvent] };
    const newer: AuditEvent = {
      ...baseEvent,
      timestamp: "2026-05-26T10:05:00.000Z",
      action: "provider.route",
    };

    const next = applyCoreResults(stateWithAudit, asResults(batch), fulfilled([newer]));

    expect(next.audit.map((event) => event.action)).toEqual(["memory.search", "provider.route"]);
  });

  it("keeps existing audit when the audit request rejects", () => {
    const batch = allFulfilled();
    const stateWithAudit: DashboardState = { ...previousState, audit: [baseEvent] };

    const next = applyCoreResults(
      stateWithAudit,
      asResults(batch),
      rejected(new Error("audit down")),
    );

    expect(next.audit).toEqual([baseEvent]);
    // An audit-only failure (with healthy core) must not raise a global error.
    expect(next.error).toBeUndefined();
  });
});
