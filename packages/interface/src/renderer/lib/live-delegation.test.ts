import { describe, expect, it } from "vitest";
import type { CoordinatorChatStreamEvent } from "./api";
import { EMPTY_DELEGATION, reduceDelegationEvent } from "./live-delegation";

const ev = (e: CoordinatorChatStreamEvent) => e;

describe("live-delegation", () => {
  it("accumulates delegation, run status, and artifacts", () => {
    let s = EMPTY_DELEGATION;
    s = reduceDelegationEvent(
      s,
      ev({
        type: "delegation",
        phase: "dispatched",
        label: "Acme Website",
        runId: "run_1",
        agentRole: "supreme_coordinator",
      }),
    );
    s = reduceDelegationEvent(s, ev({ type: "run_status", runId: "run_1", status: "in_progress" }));
    s = reduceDelegationEvent(
      s,
      ev({ type: "artifact", artifactId: "a1", artifactType: "intake-report" }),
    );
    s = reduceDelegationEvent(s, ev({ type: "artifact", artifactId: "a2", artifactType: "brief" }));
    expect(s.active).toBe(true);
    expect(s.label).toBe("Acme Website");
    expect(s.runId).toBe("run_1");
    expect(s.status).toBe("in_progress");
    expect(s.artifactCount).toBe(2);
  });

  it("ignores unrelated events and dedupes artifacts by id", () => {
    let s = EMPTY_DELEGATION;
    s = reduceDelegationEvent(s, ev({ type: "delta", text: "hi" }));
    expect(s).toBe(EMPTY_DELEGATION);
    s = reduceDelegationEvent(s, ev({ type: "artifact", artifactId: "a1", artifactType: "x" }));
    s = reduceDelegationEvent(s, ev({ type: "artifact", artifactId: "a1", artifactType: "x" }));
    expect(s.artifactCount).toBe(1);
  });
});
