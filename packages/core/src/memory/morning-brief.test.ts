import { describe, expect, it } from "vitest";
import {
  buildMorningBrief,
  renderMorningBrief,
  type MorningBriefSignals,
} from "./morning-brief.js";
import type { RootMemoryView } from "./consolidation.js";

const NOW = new Date("2026-05-31T06:00:00.000Z");

function makeView(overrides: Partial<RootMemoryView> = {}): RootMemoryView {
  return {
    organization: "Acme Studio",
    generatedAt: NOW.toISOString(),
    summary: "",
    activeClients: [],
    activeProjects: [],
    priorities: [],
    blockers: [],
    risks: [],
    recentDecisions: [],
    topics: { clients: [], projects: [], opportunities: [] },
    ...overrides,
  };
}

const NO_SIGNALS: MorningBriefSignals = {
  pipelineValue: 0,
  openOpportunities: 0,
  pendingApprovals: 0,
};

describe("buildMorningBrief", () => {
  it("reports a clean company when there are no blockers or approvals", () => {
    const brief = buildMorningBrief(makeView(), NO_SIGNALS, NOW);
    expect(brief.headline).toBe("Company operating clean.");
    expect(brief.state).toMatchObject({ activeClients: 0, blockers: 0, pendingApprovals: 0 });
    expect(brief.lookToday).toEqual(["Nothing urgent — keep the pipeline moving."]);
  });

  it("headline surfaces both blockers and pending approvals with correct pluralization", () => {
    const view = makeView({ blockers: ["Repo not linked", "Build failing"] });
    const brief = buildMorningBrief(
      view,
      { pipelineValue: 0, openOpportunities: 0, pendingApprovals: 1 },
      NOW,
    );
    expect(brief.headline).toBe("2 blockers and 1 approval waiting need your attention.");
  });

  it("lookToday leads with approvals, then blockers, then priorities, capped at 3", () => {
    const view = makeView({
      blockers: ["Repo not linked"],
      priorities: ["Send proposal", "Call client", "Review pricing"],
    });
    const brief = buildMorningBrief(
      view,
      { pipelineValue: 0, openOpportunities: 0, pendingApprovals: 2 },
      NOW,
    );
    expect(brief.lookToday).toEqual([
      "Resolve 2 pending approvals.",
      "Unblock: Repo not linked",
      "Send proposal",
    ]);
  });

  it("connections surface open pipeline and the qualification gap", () => {
    const view = makeView({
      activeClients: [{ name: "Nimbus", status: "lead", industry: "saas" }],
    });
    const brief = buildMorningBrief(
      view,
      { pipelineValue: 14000, openOpportunities: 1, pendingApprovals: 0 },
      NOW,
    );
    expect(brief.connections[0]).toBe("1 open opportunity worth $14K waiting on the next move.");
    expect(brief.connections).toContain(
      "1 client in memory but no active project yet — qualification gap.",
    );
  });

  it("flags delivery underway with an empty pipeline", () => {
    const view = makeView({
      activeProjects: [{ name: "Site", client: "Nimbus", status: "build" }],
    });
    const brief = buildMorningBrief(view, NO_SIGNALS, NOW);
    expect(brief.connections).toContain(
      "Delivery is underway but the new-business pipeline is empty — top up the funnel.",
    );
  });

  it("caps connections at four entries", () => {
    const view = makeView({
      activeClients: [{ name: "A", status: "lead", industry: "x" }],
      blockers: ["b1", "b2", "b3"],
      risks: ["r1", "r2"],
    });
    const brief = buildMorningBrief(
      view,
      { pipelineValue: 5000, openOpportunities: 1, pendingApprovals: 0 },
      NOW,
    );
    expect(brief.connections.length).toBe(4);
  });
});

describe("renderMorningBrief", () => {
  it("renders headline, state, connections and look-at-today sections", () => {
    const view = makeView({ blockers: ["Repo not linked"], priorities: ["Send proposal"] });
    const brief = buildMorningBrief(
      view,
      { pipelineValue: 20000, openOpportunities: 2, pendingApprovals: 1 },
      NOW,
    );
    const md = renderMorningBrief(brief);
    expect(md).toContain("# Morning Brief — 2026-05-31");
    expect(md).toContain("Acme Studio · 1 blocker and 1 approval waiting need your attention.");
    expect(md).toContain("- Pipeline: $20K across 2 open opportunities");
    expect(md).toContain("## Connections");
    expect(md).toContain("## Look at today");
    expect(md).toContain("1. Resolve 1 pending approval.");
  });

  it("shows a placeholder when there are no connections", () => {
    const md = renderMorningBrief(buildMorningBrief(makeView(), NO_SIGNALS, NOW));
    expect(md).toContain("_No cross-cutting patterns flagged today._");
  });
});
