import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { ClientRegistry } from "../registries/client.js";
import { ArtifactStore } from "../artifacts/store.js";
import { CoordinatorIntakeService } from "./intake.js";

describe("CoordinatorIntakeService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-intake-"));
    await initWorkspace({ root: dir, organizationName: "BOS Test Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("turns a raw owner message into company memory, project work, artifacts, and approvals", async () => {
    const service = new CoordinatorIntakeService(dir, { config: defaultConfig("agency") });

    const result = await service.process({
      message:
        "Oggi ho parlato con una pizzeria: vogliono un sito con prenotazioni, identita, logo, posizione e contenuti per farsi conoscere.",
      source: "owner_chat",
      clientName: "Pizzeria Aurora",
      expectedValue: 4_500,
    });

    expect(result.client.name).toBe("Pizzeria Aurora");
    expect(result.client.industry).toBe("food_and_beverage");
    expect(result.project.name).toBe("Pizzeria Aurora Booking Website");
    expect(result.project.client_id).toBe(result.client.id);
    expect(result.opportunity.expected_value).toBe(4_500);
    expect(result.opportunity.expected_margin).toBe(35);
    expect(result.run.status).toBe("completed");

    const artifactTypes = result.artifacts.map((artifact) => artifact.type);
    expect(artifactTypes).toEqual(
      expect.arrayContaining([
        "client-project-intake",
        "project-brief",
        "proposal-brief",
        "pricing-brief",
        "repository-provisioning-plan",
        "compliance-review",
        "client-account-plan",
        "social-post-brief",
        "ad-campaign-brief",
      ]),
    );
    expect(result.run.artifacts).toEqual(expect.arrayContaining(result.artifacts.map((a) => a.id)));

    const approvals = await new ApprovalRegistry(dir).listPending();
    expect(approvals.map((approval) => approval.action)).toEqual(
      expect.arrayContaining(["send_final_proposals", "accept_projects", "publish_public_content"]),
    );

    const artifacts = await new ArtifactStore(dir).list({ run_id: result.run.id });
    expect(artifacts.length).toBeGreaterThanOrEqual(10);

    const paths = workspacePaths(dir);
    const communication = await readFile(
      join(paths.clientsDir, result.client.slug, "COMMUNICATION.md"),
      "utf8",
    );
    expect(communication).toContain("Oggi ho parlato con una pizzeria");

    const backlog = await readFile(
      join(paths.projectsDir, result.project.slug, "BACKLOG.md"),
      "utf8",
    );
    expect(backlog).toContain("Prepare proposal and pricing for owner approval");

    const audit = await readFile(paths.auditLog, "utf8");
    expect(audit).toContain("coordinator.intake.completed");
  });

  it("reuses a named existing client from lowercase owner intake", async () => {
    const clients = new ClientRegistry(dir);
    const existing = await clients.create({
      name: "Pizzeria Amodeo",
      industry: "food_and_beverage",
      status: "lead",
    });
    const service = new CoordinatorIntakeService(dir, { config: defaultConfig("agency") });

    const result = await service.process({
      message:
        "pizzeria amodeo vorrebbe un sito basico di html e css per una pizza specifica la margherita",
      source: "owner_chat",
    });

    expect(result.client.id).toBe(existing.id);
    expect(result.client.name).toBe("Pizzeria Amodeo");
    expect(result.project.name).toBe("Pizzeria Amodeo Website");
    expect(result.opportunity.title).toBe("Website for Pizzeria Amodeo");
    expect(result.summary).toContain("Prepared intake for existing client Pizzeria Amodeo");

    const listed = await clients.list();
    expect(listed.map((client) => client.name)).toEqual(["Pizzeria Amodeo"]);
  });
});
