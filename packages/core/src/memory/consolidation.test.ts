import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ClientRegistry } from "../registries/client.js";
import { OpportunityRegistry } from "../registries/opportunity.js";
import { ProjectRegistry } from "../registries/project.js";
import {
  RootMemoryConsolidationService,
  buildRootMemoryView,
  renderRootMemory,
  type RootMemoryView,
} from "./consolidation.js";

const baseView: RootMemoryView = {
  organization: "Demo Agency",
  generatedAt: "2026-05-30T00:00:00.000Z",
  summary: "1 client(s) in play, 1 active project(s), 1 open opportunity(ies) (pipeline 5000).",
  activeClients: [{ name: "Acme", status: "active", industry: "fintech" }],
  activeProjects: [{ name: "Landing", client: "Acme", status: "in_progress" }],
  priorities: ["Acme: New site -> qualify"],
  blockers: [],
  risks: [],
  recentDecisions: [{ date: "2026-05-29", what: "Picked the stack" }],
  topics: { clients: ["Acme"], projects: ["Landing"], opportunities: ["New site"] },
};

describe("renderRootMemory", () => {
  it("renders every managed section with filled content", () => {
    const md = renderRootMemory(baseView);
    expect(md).toContain("> Workspace: Demo Agency");
    expect(md).toContain("> Generated: 2026-05-30T00:00:00.000Z");
    expect(md).toContain("- Acme (active) - fintech");
    expect(md).toContain("- Landing (Acme) - in_progress");
    expect(md).toContain("- Acme: New site -> qualify");
    expect(md).toContain("- 2026-05-29: Picked the stack");
    expect(md).toContain("Clients: Acme");
    // Static scaffolding preserved.
    expect(md).toContain("## Retrieval Map");
    expect(md).toContain("See POLICIES.md.");
  });

  it("falls back to (none)/(empty) for empty sections", () => {
    const md = renderRootMemory({
      ...baseView,
      activeClients: [],
      blockers: [],
      risks: [],
      recentDecisions: [],
    });
    expect(md).toMatch(/## Active Clients\n\n\(none\)/);
    expect(md).toMatch(/## Blockers\n\n\(none\)/);
    expect(md).toMatch(/## Recent Decisions\n\n\(none\)/);
    expect(md).toMatch(/## Risk Register\n\n\(empty\)/);
  });
});

describe("buildRootMemoryView", () => {
  it("separates active/blocked work and surfaces open opportunities and risks", () => {
    const view = buildRootMemoryView({
      organization: "Demo",
      now: new Date("2026-05-30T00:00:00.000Z"),
      clients: [
        { id: "c1", slug: "acme", name: "Acme", status: "active", industry: "fintech" },
        { id: "c3", slug: "prospect", name: "Prospect", status: "lead", industry: "saas" },
        { id: "c2", slug: "old", name: "Old Co", status: "churned", industry: "retail" },
      ],
      projects: [
        {
          id: "p1",
          slug: "lp",
          name: "Landing",
          client_id: "c1",
          status: "in_progress",
          repository: "",
          stack: "",
        },
        {
          id: "p2",
          slug: "bk",
          name: "Booking",
          client_id: "c1",
          status: "blocked",
          repository: "",
          stack: "",
        },
      ],
      opportunities: [
        {
          id: "o1",
          title: "New site",
          client_id: "c1",
          status: "qualified",
          expected_value: 5000,
          expected_margin: 0,
          next_action: "qualify",
        },
        {
          id: "o2",
          title: "Closed deal",
          client_id: "c1",
          status: "won",
          expected_value: 9000,
          expected_margin: 0,
        },
        {
          id: "o3",
          title: "Stuck deal",
          client_id: "c1",
          status: "stalled",
          expected_value: 1000,
          expected_margin: 0,
        },
      ],
      pendingApprovals: [
        {
          id: "a1",
          action: "client_send",
          actor: "owner",
          target: "Proposal v2",
          scope: "send",
          risk_level: "high",
          status: "pending",
        },
        {
          id: "a2",
          action: "note",
          actor: "owner",
          target: "Low risk thing",
          scope: "x",
          risk_level: "low",
          status: "pending",
        },
      ],
      blockedRuns: [],
      recentDecisions: [{ date: "2026-05-29", what: "Chose Next.js" }],
    });

    // Live book = leads + active (churned excluded); churned still appears in risks.
    expect(view.activeClients.map((c) => c.name)).toEqual(["Acme", "Prospect"]);
    expect(view.activeProjects.map((p) => p.name)).toEqual(["Landing"]);
    expect(view.priorities).toContain("Acme: New site -> qualify");
    // Closed (won) opportunity excluded from priorities.
    expect(view.priorities.some((p) => /Closed deal/.test(p))).toBe(false);
    expect(view.blockers.some((b) => /Booking/.test(b))).toBe(true);
    // Risk register: high-risk approval + stalled opportunity + churned client; low-risk excluded.
    expect(view.risks.some((r) => /Proposal v2/.test(r))).toBe(true);
    expect(view.risks.some((r) => /Stuck deal/.test(r))).toBe(true);
    expect(view.risks.some((r) => /Old Co/.test(r))).toBe(true);
    expect(view.risks.some((r) => /Low risk thing/.test(r))).toBe(false);
    // Open = not won/lost: qualified + stalled (won excluded). Pipeline 5000 + 1000.
    expect(view.summary).toContain("2 open opportunity(ies) (pipeline 6000)");
  });
});

describe("RootMemoryConsolidationService", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-consolidate-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("rewrites ROOT.md from live state and is idempotent for the same clock", async () => {
    const client = await new ClientRegistry(dir).create({
      name: "Acme Co.",
      industry: "fintech",
      status: "active",
    });
    await new ProjectRegistry(dir).create({
      name: "Landing Redesign",
      clientId: client.id,
      status: "in_progress",
    });
    await new OpportunityRegistry(dir).create({
      title: "Retainer",
      source: "referral",
      clientId: client.id,
    });

    const service = new RootMemoryConsolidationService(dir);
    const now = new Date("2026-05-30T12:00:00.000Z");
    const result = await service.consolidate({ now });

    const root = await readFile(workspacePaths(dir).rootMemory, "utf8");
    expect(root).toContain("- Acme Co. (active) - fintech");
    expect(root).toContain("- Landing Redesign (Acme Co.) - in_progress");
    expect(root).toContain("Auto-consolidated from live workspace state.");
    expect(result.counts.activeClients).toBe(1);
    expect(result.counts.activeProjects).toBe(1);
    expect(result.counts.openOpportunities).toBe(1);
    expect(result.audit.action).toBe("memory.root.consolidated");

    // Same clock + same state => byte-identical ROOT (idempotent).
    await service.consolidate({ now });
    const rootAgain = await readFile(workspacePaths(dir).rootMemory, "utf8");
    expect(rootAgain).toBe(root);
  });

  it("yields a clean (none) template for an empty workspace", async () => {
    const result = await new RootMemoryConsolidationService(dir).consolidate({
      now: new Date("2026-05-30T00:00:00.000Z"),
    });
    const root = await readFile(workspacePaths(dir).rootMemory, "utf8");
    expect(root).toMatch(/## Active Clients\n\n\(none\)/);
    expect(root).toMatch(/## Active Projects\n\n\(none\)/);
    expect(result.counts.activeClients).toBe(0);
    expect(result.counts.openOpportunities).toBe(0);
  });
});
