import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { defaultConfig } from "../config/loader.js";
import { CoordinatorIntakeService } from "../coordinator/intake.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { GitHubIssueDraftService } from "./issue-drafts.js";

describe("GitHubIssueDraftService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-github-drafts-"));
    await initWorkspace({ root: dir, organizationName: "GitHub Draft Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("turns coordinator intake artifacts into GitHub-ready issue drafts", async () => {
    const intake = await new CoordinatorIntakeService(dir, {
      config: defaultConfig("agency"),
    }).process({
      clientName: "Pizzeria Aurora",
      expectedValue: 4_500,
      message:
        "Oggi ho parlato con una pizzeria: vuole un sito con prenotazioni, identita, logo, posizione e contenuti.",
      source: "owner_chat",
    });

    const result = await new GitHubIssueDraftService(dir).draftForProject(intake.project.slug);

    expect(result.project.slug).toBe("pizzeria-aurora-booking-website");
    expect(result.client?.name).toBe("Pizzeria Aurora");
    expect(result.drafts).toHaveLength(5);
    expect(result.artifacts).toHaveLength(5);
    expect(result.drafts.map((draft) => draft.title)).toEqual(
      expect.arrayContaining([
        "Product: finalize scope for Pizzeria Aurora Booking Website",
        "Delivery: provision repository for Pizzeria Aurora Booking Website",
        "Sales: prepare proposal for Pizzeria Aurora",
        "Compliance: review external commitments for Pizzeria Aurora Booking Website",
        "Growth: draft proof-safe content for Pizzeria Aurora Booking Website",
      ]),
    );

    const productDraft = result.drafts.find((draft) => draft.title.startsWith("Product:"));
    expect(productDraft?.labels).toEqual(
      expect.arrayContaining([
        "type:feature",
        "stage:product-ready",
        "agent:product",
        "needs:decision",
      ]),
    );
    expect(productDraft?.source_artifacts.length).toBeGreaterThanOrEqual(1);

    const artifactStore = new ArtifactStore(dir);
    const persistedDrafts = await artifactStore.list({ type: "github-issue-draft" });
    expect(persistedDrafts).toHaveLength(5);
    expect(persistedDrafts.map((artifact) => artifact.project_id)).toEqual(
      result.artifacts.map(() => intake.project.id),
    );

    const firstPersisted = await artifactStore.read(result.artifacts[0]!.id);
    expect(firstPersisted?.body).toContain("## Policy Notes");
    expect(firstPersisted?.body).toContain("External commitments");
    expect(firstPersisted?.body).toContain("- type:");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.issue_drafts.generated");
  });

  it("fails clearly when the project is unknown", async () => {
    await expect(new GitHubIssueDraftService(dir).draftForProject("missing")).rejects.toThrow(
      "project not found: missing",
    );
  });
});
