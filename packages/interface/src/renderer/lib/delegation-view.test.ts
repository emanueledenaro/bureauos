import { describe, expect, it } from "vitest";
import type { CoordinatorIntakeResult } from "./api";
import { toDelegationView } from "./delegation-view";

const intake = (): CoordinatorIntakeResult => ({
  summary: "Created",
  next_actions: ["Qualify the opportunity"],
  client: { id: "cli_1", slug: "acme", name: "Acme Labs", status: "active", industry: "SaaS" },
  project: { id: "prj_1", slug: "site", name: "Acme Website", client_id: "cli_1", status: "in_progress", repository: "", stack: "" },
  opportunity: { id: "opp_1", title: "Website", client_id: "cli_1", status: "open", expected_value: 12000, expected_margin: 0.4 },
  run: { id: "run_1", type: "intake", status: "in_progress", scope: "Intake", created: "2026-06-02T10:00:00.000Z" },
  artifacts: [{ id: "art_1", type: "intake-report", status: "submitted" }],
  approvals: [],
});

describe("delegation-view", () => {
  it("builds a card view model from an intake result", () => {
    const view = toDelegationView(intake());
    expect(view).toMatchObject({
      opportunityId: "opp_1",
      projectName: "Acme Website",
      clientName: "Acme Labs",
      runId: "run_1",
      runTone: "neutral",
      artifactCount: 1,
      approvalCount: 0,
      nextAction: "Qualify the opportunity",
    });
  });

  it("leaves nextAction undefined when there are no next actions", () => {
    expect(toDelegationView({ ...intake(), next_actions: [] }).nextAction).toBeUndefined();
  });
});
