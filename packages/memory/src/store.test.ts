import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalMemoryStore, assembleContextPacket } from "./store.js";

describe("LocalMemoryStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-mem-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns no hits for an empty store", async () => {
    const s = new LocalMemoryStore(dir);
    const hits = await s.search("anything");
    expect(hits).toEqual([]);
  });

  it("returns hits with a score for matching content", async () => {
    await writeFile(join(dir, "ROOT.md"), "# Root\nAcme is an active client.\n", "utf8");
    await mkdir(join(dir, "clients"), { recursive: true });
    await writeFile(
      join(dir, "clients", "CLIENT.md"),
      "# Acme\nAcme paid the invoice on time.\nAcme owes a follow-up.\n",
      "utf8",
    );
    const s = new LocalMemoryStore(dir);
    const hits = await s.search("acme");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it("assembles a context packet from ROOT and search hits", async () => {
    await writeFile(join(dir, "ROOT.md"), "# Root\nMap of memory.\n", "utf8");
    await writeFile(join(dir, "COMPANY.md"), "We sell software services.\n", "utf8");
    const s = new LocalMemoryStore(dir);
    const packet = await assembleContextPacket(s, "software");
    expect(packet.rootMemory).toContain("Map of memory");
    expect(packet.topHits.length).toBeGreaterThan(0);
  });
});
