import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ClientRegistry } from "../registries/client.js";
import { OpportunityRegistry } from "../registries/opportunity.js";
import { ProjectRegistry } from "../registries/project.js";
import { ClientAccountPlanService } from "./account-plans.js";

describe("ClientAccountPlanService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-client-account-plan-"));
    await initWorkspace({ root: dir, organizationName: "Client Account Plans", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes account plans from real client intelligence without inventing clients", async () => {
    const clients = new ClientRegistry(dir);
    const projects = new ProjectRegistry(dir);
    const opportunities = new OpportunityRegistry(dir);
    const client = await clients.create({
      name: "Miraglia Pizza",
      status: "active",
      industry: "food_and_beverage",
    });
    await clients.update(client.slug, {
      next_follow_up_at: "2026-05-20T10:00:00.000Z",
    });
    await projects.create({
      name: "Miraglia Booking Website",
      clientId: client.id,
      status: "in_progress",
      repository: "https://github.com/example/miraglia",
    });
    await opportunities.create({
      title: "Booking website",
      source: "owner_intake",
      clientId: client.id,
      expectedValue: 5000,
      expectedMargin: 45,
    });

    const result = await new ClientAccountPlanService(dir).generate({
      runId: "run_account_review",
      now: new Date("2026-05-25T10:00:00.000Z"),
    });

    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]).toMatchObject({
      type: "client-account-plan",
      run_id: "run_account_review",
      client_id: client.id,
      status: "submitted",
      client_name: "Miraglia Pizza",
      revenue_tier: "medium",
      strategic_value: "medium",
      relationship_health: "at_risk",
    });

    const written = await new ArtifactStore(dir).read(result.plans[0]!.id);
    expect(written?.body).toContain("# Client Account Plan");
    expect(written?.body).toContain("Value score:");
    expect(written?.body).toContain("Open pipeline: $5,000");
    expect(written?.body).toContain("Miraglia Booking Website");
    expect(written?.body).toContain("Do not send client messages without owner approval");

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("client.account_plan.generated");
  });

  it("does not create account plan artifacts when the workspace has no clients", async () => {
    const result = await new ClientAccountPlanService(dir).generate({
      now: new Date("2026-05-25T10:00:00.000Z"),
    });

    expect(result.plans).toEqual([]);
    expect(await new ArtifactStore(dir).list({ type: "client-account-plan" })).toEqual([]);
  });
});
