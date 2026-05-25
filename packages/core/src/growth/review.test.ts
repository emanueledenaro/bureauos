import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ClientRegistry } from "../registries/client.js";
import { OpportunityRegistry } from "../registries/opportunity.js";
import { GrowthMemoryService } from "./memory.js";
import { GrowthReviewService } from "./review.js";

describe("GrowthReviewService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-growth-review-"));
    await initWorkspace({ root: dir, organizationName: "Growth Review", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("generates a growth review from memory, client, opportunity, and artifact signals", async () => {
    await new GrowthMemoryService(dir).update({
      brand: "BureauOS helps owner-led companies operate delivery and growth.",
      offers: "AAAS setup and autonomous delivery operations.",
      channels: "GitHub, X, LinkedIn.",
      actor: "owner",
    });
    const client = await new ClientRegistry(dir).create({
      name: "Miraglia Pizza",
      status: "active",
      industry: "food_and_beverage",
    });
    await new ClientRegistry(dir).update(client.slug, {
      next_follow_up_at: "2026-05-20T10:00:00.000Z",
    });
    await new OpportunityRegistry(dir).create({
      title: "Booking website",
      source: "owner_intake",
      clientId: client.id,
      expectedValue: 5000,
      expectedMargin: 45,
    });
    await new ArtifactStore(dir).write({
      type: "social-post-brief",
      createdBy: "content",
      body: "# Social Post Brief\n\nDraft only.",
    });

    const result = await new GrowthReviewService(dir).generate({
      runId: "run_growth_review",
      now: new Date("2026-05-25T10:00:00.000Z"),
    });

    expect(result.report).toMatchObject({
      type: "growth-review",
      run_id: "run_growth_review",
      status: "submitted",
      memory_ready: true,
      pipeline_value: 5000,
      recent_content_count: 1,
      follow_ups_due: 1,
    });
    expect(result.recommendations.join("\n")).toContain("highest-value open opportunity");
    const written = await new ArtifactStore(dir).read(result.report.id);
    expect(written?.body).toContain("# Growth Review");
    expect(written?.body).toContain("Open pipeline: $5,000");
    expect(written?.body).toContain("Do not publish public content");

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("growth.review.generated");
  });

  it("reports missing growth memory without inventing content", async () => {
    const result = await new GrowthReviewService(dir).generate({
      now: new Date("2026-05-25T10:00:00.000Z"),
    });

    expect(result.memory_ready).toBe(false);
    expect(result.missing_sections).toEqual(expect.arrayContaining(["brand", "offers"]));
    expect(result.recent_content_count).toBe(0);
    expect(result.recommendations.join("\n")).toContain("Complete growth memory");
  });
});
