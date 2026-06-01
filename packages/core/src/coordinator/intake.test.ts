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

  it("turns a raw owner message into company memory, project work, and internal artifacts", async () => {
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
    expect(result.approvals).toEqual([]);
    expect(approvals).toEqual([]);
    expect(result.summary).not.toContain("approval");
    expect(result.summary).not.toContain("approvazione");

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
    expect(result.summary).toContain("Ho preso in carico Pizzeria Amodeo");

    const listed = await clients.list();
    expect(listed.map((client) => client.name)).toEqual(["Pizzeria Amodeo"]);
    await expect(new ApprovalRegistry(dir).listPending()).resolves.toEqual([]);
  });

  it("extracts inline client names from project-scope owner intake", async () => {
    const service = new CoordinatorIntakeService(dir, { config: defaultConfig("agency") });

    const result = await service.process({
      message: "Cliente Test SER126 vuole un sito interno HTML e CSS per una landing di prova.",
      source: "owner_chat",
    });

    expect(result.client.name).toBe("Test SER126");
    expect(result.project.name).toBe("Test SER126 Website");
    expect(result.opportunity.title).toBe("Website for Test SER126");
    expect(result.summary).toContain("Ho aperto il lavoro per Test SER126");
    expect(result.summary).not.toContain("New Client Lead");
    expect(result.approvals).toEqual([]);

    const listed = await new ClientRegistry(dir).list();
    expect(listed.map((client) => client.name)).toEqual(["Test SER126"]);
    await expect(new ApprovalRegistry(dir).listPending()).resolves.toEqual([]);
  });

  it("honors an explicit project name and a named tech stack (giovanniprova / Flutter)", async () => {
    const service = new CoordinatorIntakeService(dir, { config: defaultConfig("agency") });

    const result = await service.process({
      message:
        "Voglio un'app mobile in Flutter per prenotare un tavolo in una pizzeria. Nome del progetto: giovanniprova.",
      source: "owner_chat",
    });

    // The owner's explicit name is used verbatim — for the project and, since no
    // business name was given, the client — instead of a generic placeholder.
    expect(result.project.name).toBe("giovanniprova");
    expect(result.client.name).toBe("giovanniprova");
    expect(result.summary).not.toContain("Restaurant Lead");
    expect(result.summary).not.toContain("Mobile App Lead");
    // The named framework leads the technical stack.
    expect(result.classification.stack).toContain("Flutter");
  });

  it("persists a non-base64 data-URL attachment with a literal % without crashing (SER-232)", async () => {
    const service = new CoordinatorIntakeService(dir, { config: defaultConfig("agency") });

    // A literal "%" in a non-base64 data URL used to throw URIError in
    // decodeURIComponent and reject the whole intake.
    const result = await service.process({
      message: "Cliente nuovo, vedi allegato con i dettagli.",
      source: "owner_chat",
      clientName: "Percent Co",
      attachments: [{ name: "promo.txt", dataUrl: "data:text/plain,50% off launch" }],
    });

    const attachment = result.artifacts.find((artifact) => artifact.type === "owner-attachment");
    expect(attachment).toBeDefined();
    const stored = await new ArtifactStore(dir).read(attachment!.id);
    // Parsed as a data URL (not skipped to metadata_only), proving parseDataUrl
    // returned a buffer instead of throwing.
    expect(stored?.body).toContain("Source: data_url");
  });
});
