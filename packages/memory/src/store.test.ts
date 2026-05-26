import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LocalMemoryStore,
  MemoryAccessDeniedError,
  ScopedMemoryStore,
  assembleContextPacket,
} from "./store.js";
import { NoopSemanticMemoryIndex, type SemanticMemoryIndex } from "./semantic.js";

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
    expect(packet.semanticHits).toEqual([]);
  });

  it("uses a safe no-op semantic index by default", async () => {
    await writeFile(join(dir, "ROOT.md"), "# Root\nMap of memory.\n", "utf8");
    const s = new LocalMemoryStore(dir);
    const packet = await assembleContextPacket(s, "anything", {
      semanticIndex: new NoopSemanticMemoryIndex(),
    });

    expect(packet.semanticHits).toEqual([]);
  });

  it("can include semantic hits from a configured index contract", async () => {
    await writeFile(join(dir, "ROOT.md"), "# Root\nMap of memory.\n", "utf8");
    const semanticIndex: SemanticMemoryIndex = {
      kind: "test",
      enabled: true,
      async search(query, options) {
        return [
          {
            path: "semantic://client-context",
            snippet: `${query}:${options?.limit}`,
            score: 0.92,
          },
        ];
      },
    };
    const s = new LocalMemoryStore(dir);
    const packet = await assembleContextPacket(s, "amodeo project status", {
      semanticIndex,
      semanticLimit: 3,
    });

    expect(packet.semanticHits).toEqual([
      {
        path: "semantic://client-context",
        snippet: "amodeo project status:3",
        score: 0.92,
      },
    ]);
  });

  it("refuses path traversal outside the memory root", async () => {
    const s = new LocalMemoryStore(dir);
    await expect(s.read("../outside.md")).rejects.toBeInstanceOf(MemoryAccessDeniedError);
  });

  it("scopes reads, lists, and searches to allowed memory paths", async () => {
    await mkdir(join(dir, "projects", "alpha"), { recursive: true });
    await mkdir(join(dir, "projects", "beta"), { recursive: true });
    await writeFile(join(dir, "POLICIES.md"), "Policy: drafts first.\n", "utf8");
    await writeFile(
      join(dir, "projects", "alpha", "PROJECT.md"),
      "Alpha booking project.\n",
      "utf8",
    );
    await writeFile(join(dir, "projects", "beta", "PROJECT.md"), "Beta secret project.\n", "utf8");

    const s = new ScopedMemoryStore(dir, [
      { path: "POLICIES.md", kind: "file" },
      { path: "projects/alpha", kind: "directory" },
    ]);

    await expect(s.read("POLICIES.md")).resolves.toContain("drafts");
    await expect(s.read("projects/alpha/PROJECT.md")).resolves.toContain("Alpha");
    await expect(s.read("projects/beta/PROJECT.md")).rejects.toBeInstanceOf(
      MemoryAccessDeniedError,
    );

    const files = await s.list();
    expect(files.some((file) => file.endsWith("projects/alpha/PROJECT.md"))).toBe(true);
    expect(files.some((file) => file.endsWith("projects/beta/PROJECT.md"))).toBe(false);

    const hits = await s.search("secret");
    expect(hits).toEqual([]);
  });
});
