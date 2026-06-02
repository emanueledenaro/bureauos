import { describe, expect, it } from "vitest";
import type { CoordinatorIntakeResult } from "./intake.js";
import { intakeToStreamEvents } from "./stream-events.js";

const intake = (): CoordinatorIntakeResult =>
  ({
    summary: "Created",
    next_actions: ["Qualify the opportunity"],
    client: { id: "cli_1", slug: "acme", name: "Acme Labs", status: "active", industry: "SaaS" },
    project: {
      id: "prj_1",
      slug: "site",
      name: "Acme Website",
      client_id: "cli_1",
      status: "in_progress",
      repository: "",
      stack: "",
    },
    opportunity: {
      id: "opp_1",
      title: "Website",
      client_id: "cli_1",
      status: "open",
      expected_value: 12000,
      expected_margin: 0.4,
    },
    run: {
      id: "run_1",
      type: "intake",
      status: "in_progress",
      scope: "Intake",
      created: "2026-06-02T10:00:00.000Z",
      created_by: "supreme_coordinator",
    },
    artifacts: [{ id: "art_1", type: "intake-report", status: "submitted" }],
    approvals: [],
  }) as unknown as CoordinatorIntakeResult;

describe("intakeToStreamEvents", () => {
  it("emits a dispatched delegation, a run_status, and one artifact event per artifact", () => {
    const events = intakeToStreamEvents(intake());
    expect(events.map((e) => e.type)).toEqual(["delegation", "run_status", "artifact"]);
    const delegation = events.find((e) => e.type === "delegation");
    expect(delegation).toMatchObject({ phase: "dispatched", runId: "run_1", agentRole: "supreme_coordinator" });
    const run = events.find((e) => e.type === "run_status");
    expect(run).toMatchObject({ runId: "run_1", status: "in_progress" });
    const artifact = events.find((e) => e.type === "artifact");
    expect(artifact).toMatchObject({ artifactId: "art_1", artifactType: "intake-report" });
  });
});
