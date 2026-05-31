import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
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
import { SqliteFtsMemoryIndex } from "./sqlite-index.js";

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

  it("rebuilds and searches the SQLite FTS5 index when available", async () => {
    await writeFile(join(dir, "ROOT.md"), "# Root\nPizzeria Amodeo is active.\n", "utf8");
    await mkdir(join(dir, "clients", "pizzeria-amodeo"), { recursive: true });
    await writeFile(
      join(dir, "clients", "pizzeria-amodeo", "CLIENT.md"),
      "# Pizzeria Amodeo\nWebsite request for a pizza margherita landing page.\n",
      "utf8",
    );

    const index = new SqliteFtsMemoryIndex(dir);
    const status = await index.rebuild();
    if (!status.available) return;

    expect(status).toMatchObject({ document_count: 2, stale: false });

    const hits = await new LocalMemoryStore(dir).search("margherita", {
      backend: "sqlite_fts5",
      limit: 5,
    });

    expect(hits[0]).toMatchObject({
      relativePath: "clients/pizzeria-amodeo/CLIENT.md",
      source: "sqlite_fts5",
    });
    expect(hits[0]?.snippet).toContain("margherita");
    expect(hits[0]?.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("refreshes a stale SQLite FTS5 index from Markdown source of truth", async () => {
    await writeFile(join(dir, "ROOT.md"), "# Root\nOld account wording.\n", "utf8");
    const index = new SqliteFtsMemoryIndex(dir);
    const status = await index.rebuild();
    if (!status.available) return;

    await writeFile(join(dir, "ROOT.md"), "# Root\nNew retention signal for Amodeo.\n", "utf8");

    const hits = await new LocalMemoryStore(dir).search("retention", {
      backend: "sqlite_fts5",
    });

    expect(hits[0]).toMatchObject({ relativePath: "ROOT.md", source: "sqlite_fts5" });
    expect(hits[0]?.snippet).toContain("retention");
  });

  it("honors a configured FTS5 index path instead of the default location", async () => {
    await writeFile(join(dir, "ROOT.md"), "# Root\nConfigured index location test.\n", "utf8");
    const customIndexPath = join(dir, "custom", "search.sqlite");

    const store = new LocalMemoryStore(dir, { indexPath: customIndexPath });
    const hits = await store.search("configured", { backend: "sqlite_fts5", limit: 5 });
    if (hits.length === 0) return; // node:sqlite unavailable in this runtime.

    expect(hits[0]).toMatchObject({ relativePath: "ROOT.md", source: "sqlite_fts5" });
    // The configured index file must exist and the legacy default must not.
    await expect(stat(customIndexPath)).resolves.toBeTruthy();
    await expect(stat(join(dir, ".index", "memory-fts5.sqlite"))).rejects.toBeTruthy();
  });

  it("falls back safely when the SQLite index is corrupt", async () => {
    await mkdir(join(dir, ".index"), { recursive: true });
    await writeFile(join(dir, ".index", "memory-fts5.sqlite"), "not a sqlite database", "utf8");
    await writeFile(join(dir, "ROOT.md"), "# Root\nAcme fallback context.\n", "utf8");

    const hits = await new LocalMemoryStore(dir).search("fallback", { limit: 5 });

    expect(hits[0]?.snippet).toContain("fallback");
  });

  it("ignores local index folders during Markdown scans and indexing", async () => {
    await mkdir(join(dir, ".index"), { recursive: true });
    await writeFile(join(dir, ".index", "STALE.md"), "Ghost stale memory.\n", "utf8");
    await writeFile(join(dir, "ROOT.md"), "# Root\nVisible memory only.\n", "utf8");

    await expect(new LocalMemoryStore(dir).search("ghost", { backend: "scan" })).resolves.toEqual(
      [],
    );

    const status = await new SqliteFtsMemoryIndex(dir).rebuild();
    if (!status.available) return;
    expect(status.document_count).toBe(1);
  });

  it("returns workspace-relative paths on the Markdown scan fallback (SER-209)", async () => {
    await mkdir(join(dir, "clients", "acme"), { recursive: true });
    await writeFile(
      join(dir, "clients", "acme", "CLIENT.md"),
      "# Acme\nAcme retainer renewal signal.\n",
      "utf8",
    );

    const hits = await new LocalMemoryStore(dir).search("retainer", { backend: "scan" });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      relativePath: "clients/acme/CLIENT.md",
      source: "scan",
    });
    // The scan fallback must not leak the absolute workspace prefix.
    expect(hits[0]?.relativePath).not.toContain(dir);
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

  it("recalls the same in-scope docs for a multi-word query as the global store (SER-197)", async () => {
    await mkdir(join(dir, "projects", "alpha"), { recursive: true });
    await mkdir(join(dir, "projects", "beta"), { recursive: true });
    // Query tokens are present but NOT as a contiguous phrase — the old
    // whole-query substring scoped scan missed this.
    await writeFile(
      join(dir, "projects", "alpha", "PROJECT.md"),
      "# Alpha\nThe margherita pizza landing page is in design.\n",
      "utf8",
    );
    // An out-of-scope doc that also matches the tokens.
    await writeFile(
      join(dir, "projects", "beta", "PROJECT.md"),
      "# Beta\nA different margherita pizza landing concept.\n",
      "utf8",
    );

    const scoped = new ScopedMemoryStore(dir, [{ path: "projects/alpha", kind: "directory" }]);
    const global = new LocalMemoryStore(dir);
    const query = "pizza margherita landing";

    const scopedPaths = (await scoped.search(query)).map((h) => h.relativePath).sort();
    // Finds the in-scope multi-word match, never the out-of-scope sibling.
    expect(scopedPaths).toEqual(["projects/alpha/PROJECT.md"]);

    // The global store returns the same document among its in-scope results
    // (whichever backend it uses).
    const globalInScope = (await global.search(query))
      .map((h) => h.relativePath)
      .filter((p) => p === "projects/alpha/PROJECT.md");
    expect(globalInScope).toEqual(["projects/alpha/PROJECT.md"]);

    // Trailing whitespace must behave identically.
    const trimmed = (await scoped.search(`${query}   `)).map((h) => h.relativePath).sort();
    expect(trimmed).toEqual(scopedPaths);
  });

  it("denies cross-scope access via .. path traversal", async () => {
    await mkdir(join(dir, "clients", "acme"), { recursive: true });
    await mkdir(join(dir, "clients", "bravo"), { recursive: true });
    await writeFile(join(dir, "clients", "acme", "CLIENT.md"), "Acme scoped notes.\n", "utf8");
    await writeFile(
      join(dir, "clients", "bravo", "secret.md"),
      "Bravo confidential secret.\n",
      "utf8",
    );

    const s = new ScopedMemoryStore(dir, [{ path: "clients/acme", kind: "directory" }]);

    // Sanity: the in-scope client file is reachable.
    await expect(s.read("clients/acme/CLIENT.md")).resolves.toContain("Acme");

    // Traversal that textually starts with the allowed prefix but resolves into
    // a sibling scope must be denied for canAccess, read, and list.
    const traversal = "clients/acme/../bravo/secret.md";
    expect(s.canAccess(traversal)).toBe(false);
    await expect(s.read(traversal)).rejects.toBeInstanceOf(MemoryAccessDeniedError);
    await expect(s.list("clients/acme/../bravo")).rejects.toBeInstanceOf(MemoryAccessDeniedError);

    // The escaped file must never appear in a scoped listing of the allowed dir.
    const listed = await s.list("clients/acme");
    expect(listed.some((file) => file.endsWith("clients/bravo/secret.md"))).toBe(false);

    // A traversal that climbs above the memory root is rejected outright.
    expect(s.canAccess("../outside.md")).toBe(false);
    await expect(s.read("../outside.md")).rejects.toBeInstanceOf(MemoryAccessDeniedError);
  });

  it("does not walk the indexes/ storage directory as memory (SER-198)", async () => {
    await writeFile(join(dir, "ROOT.md"), "# Root\nPizzeria booking project.\n", "utf8");
    // A sidecar a custom semantic provider might drop under index storage.
    await mkdir(join(dir, "indexes", "semantic"), { recursive: true });
    await writeFile(
      join(dir, "indexes", "semantic", "shard.md"),
      "# Shard\nPizzeria booking index sidecar.\n",
      "utf8",
    );

    const s = new LocalMemoryStore(dir);
    const listed = await s.list();
    expect(listed.some((file) => file.includes("indexes/"))).toBe(false);

    const hits = await s.search("pizzeria");
    expect(hits.some((hit) => hit.path.includes("indexes/"))).toBe(false);
    // The real memory file is still found.
    expect(hits.some((hit) => hit.path.endsWith("ROOT.md"))).toBe(true);
  });
});
