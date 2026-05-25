import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initWorkspace } from "../init/initializer.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { ClientRegistry } from "../registries/client.js";
import { OpportunityRegistry } from "../registries/opportunity.js";
import { ProjectRegistry } from "../registries/project.js";
import { ClientIntelligenceService } from "./intelligence.js";

describe("ClientIntelligenceService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-client-intelligence-"));
    await initWorkspace({ root: dir, organizationName: "Client Intelligence", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("summarizes client value, delivery, relationship, and memory paths from real registries", async () => {
    const clients = new ClientRegistry(dir);
    const projects = new ProjectRegistry(dir);
    const opportunities = new OpportunityRegistry(dir);
    const approvals = new ApprovalRegistry(dir);

    const followUpDate = "2026-05-20T10:00:00.000Z";
    const client = await clients.create({
      name: "Miraglia Pizza",
      status: "active",
      industry: "food_and_beverage",
    });
    await clients.update(client.slug, {
      next_follow_up_at: followUpDate,
      last_client_message_at: "2026-05-19T10:00:00.000Z",
    });

    const website = await projects.create({
      name: "Miraglia Booking Website",
      clientId: client.id,
      status: "in_progress",
      repository: "https://github.com/example/miraglia",
      stack: "Electron, React",
    });
    await projects.create({
      name: "Miraglia Loyalty App",
      clientId: client.id,
      status: "blocked",
    });

    await opportunities.create({
      title: "Booking website",
      source: "owner_intake",
      clientId: client.id,
      expectedValue: 5000,
      expectedMargin: 45,
    });
    const won = await opportunities.create({
      title: "Menu landing page",
      source: "upsell",
      clientId: client.id,
      expectedValue: 1200,
      expectedMargin: 50,
    });
    await opportunities.update(won.id, { status: "won" });

    await approvals.request({
      action: "client_send",
      actor: "sales",
      target: website.id,
      scope: "Miraglia Pizza proposal",
    });

    const summary = await new ClientIntelligenceService(dir).summarize(
      new Date("2026-05-25T10:00:00.000Z"),
    );

    expect(summary.totals).toMatchObject({
      clients: 1,
      pipeline_value: 5000,
      won_value: 1200,
      active_projects: 1,
      blocked_projects: 1,
      follow_ups_due: 1,
    });
    expect(summary.clients[0]).toMatchObject({
      client: { id: client.id, name: "Miraglia Pizza" },
      risk: "blocked",
      revenue: {
        pipeline_value: 5000,
        won_value: 1200,
        open_opportunities: 1,
        won_opportunities: 1,
      },
      delivery: {
        projects_total: 2,
        active_projects: 1,
        blocked_projects: 1,
        repositories_linked: 1,
        pending_approvals: 1,
      },
      relationship: {
        follow_up_due: true,
        next_follow_up_at: followUpDate,
      },
      value_score: {
        score: 16,
      },
      classification: {
        revenue_tier: "medium",
        strategic_value: "medium",
        relationship_health: "at_risk",
        payment_reliability: "good",
        upsell_potential: "medium",
        referral_potential: "medium",
        public_proof_allowed: "unknown",
      },
      memory_paths: {
        profile: "clients/miraglia-pizza/CLIENT.md",
        revenue: "clients/miraglia-pizza/REVENUE.md",
      },
    });
    expect(summary.clients[0]?.projects.map((project) => project.slug)).toContain(
      "miraglia-booking-website",
    );
    expect(JSON.stringify(summary)).not.toContain(dir);
  });

  it("returns an empty summary without inventing demo clients", async () => {
    const summary = await new ClientIntelligenceService(dir).summarize(
      new Date("2026-05-25T10:00:00.000Z"),
    );

    expect(summary.totals.clients).toBe(0);
    expect(summary.clients).toEqual([]);
  });
});
