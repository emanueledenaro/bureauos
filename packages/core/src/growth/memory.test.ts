import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { GrowthMemoryService } from "./memory.js";

describe("GrowthMemoryService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-growth-memory-"));
    await initWorkspace({ root: dir, organizationName: "Growth Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads brand, offer, and channel memory from the workspace", async () => {
    const memory = await new GrowthMemoryService(dir).get();

    expect(memory.ready).toBe(false);
    expect(memory.missing_sections.sort()).toEqual(["brand", "channels", "offers"]);
    expect(memory.sections.map((section) => section.path)).toEqual([
      "BRAND.md",
      "OFFERS.md",
      "CHANNELS.md",
    ]);
    expect(JSON.stringify(memory)).not.toContain(dir);
  });

  it("updates structured growth memory and audits the write", async () => {
    const memory = await new GrowthMemoryService(dir).update({
      brand: "BureauOS is an AI operating system for owner-led software companies.",
      offers: "AAAS setup, delivery automation, and growth operations.",
      channels: "GitHub, X, LinkedIn, founder-led case studies.",
      actor: "owner",
    });

    expect(memory.ready).toBe(true);
    expect(memory.missing_sections).toEqual([]);
    expect(memory.sections.find((section) => section.id === "brand")?.preview).toContain(
      "AI operating system",
    );

    const paths = workspacePaths(dir);
    const brand = await readFile(paths.brandMemory, "utf8");
    expect(brand).toContain("status: configured");
    expect(brand).toContain("owner-led software companies");

    const audit = await readFile(paths.auditLog, "utf8");
    expect(audit).toContain("growth.memory.updated");
    expect(audit).toContain("growth_memory");
  });
});
