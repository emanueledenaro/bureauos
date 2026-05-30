import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  LocalLexicalSemanticMemoryIndex,
  NoopSemanticMemoryIndex,
  tokenizeForSemanticIndex,
} from "./semantic.js";

describe("tokenizeForSemanticIndex", () => {
  it("lowercases, splits, and drops stop words and single chars", () => {
    expect(tokenizeForSemanticIndex("The Quick brown-fox a I")).toEqual(["quick", "brown", "fox"]);
  });
});

describe("NoopSemanticMemoryIndex", () => {
  it("is disabled and returns nothing by default", async () => {
    const index = new NoopSemanticMemoryIndex();
    expect(index.enabled).toBe(false);
    await expect(index.search("anything")).resolves.toEqual([]);
  });
});

describe("LocalLexicalSemanticMemoryIndex", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-semantic-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("ranks documents by TF-IDF cosine similarity over markdown memory", async () => {
    await writeFile(
      join(dir, "ROOT.md"),
      "# Root\nMargherita pizza landing page redesign for the restaurant.\n",
      "utf8",
    );
    await mkdir(join(dir, "clients", "acme"), { recursive: true });
    await writeFile(
      join(dir, "clients", "acme", "CLIENT.md"),
      "# Acme\nEnterprise invoicing and billing platform migration.\n",
      "utf8",
    );

    const index = new LocalLexicalSemanticMemoryIndex(dir);
    const hits = await index.search("pizza restaurant redesign");

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.path).toBe("ROOT.md");
    expect(hits[0]?.score).toBeGreaterThan(0);
    expect(hits[0]?.score).toBeLessThanOrEqual(1);
    // The unrelated billing document should not outrank the topical match.
    expect(hits[0]?.path).not.toBe("clients/acme/CLIENT.md");
  });

  it("returns a snippet anchored on a matching query term", async () => {
    await writeFile(
      join(dir, "NOTES.md"),
      "# Notes\nUnrelated preamble before the retention signal for Amodeo near the end here.\n",
      "utf8",
    );
    const index = new LocalLexicalSemanticMemoryIndex(dir);
    const hits = await index.search("retention");
    expect(hits[0]?.snippet).toContain("retention");
  });

  it("honors the minScore threshold", async () => {
    await writeFile(join(dir, "ROOT.md"), "# Root\nApple banana cherry.\n", "utf8");
    const index = new LocalLexicalSemanticMemoryIndex(dir);
    const high = await index.search("apple", { minScore: 0.99 });
    expect(high).toEqual([]);
    const low = await index.search("apple", { minScore: 0 });
    expect(low.length).toBeGreaterThan(0);
  });

  it("returns nothing for empty or stop-word-only queries", async () => {
    await writeFile(join(dir, "ROOT.md"), "# Root\nContent here.\n", "utf8");
    const index = new LocalLexicalSemanticMemoryIndex(dir);
    await expect(index.search("")).resolves.toEqual([]);
    await expect(index.search("the a is")).resolves.toEqual([]);
  });

  it("is disabled when constructed with enabled=false", async () => {
    await writeFile(join(dir, "ROOT.md"), "# Root\nContent here.\n", "utf8");
    const index = new LocalLexicalSemanticMemoryIndex(dir, { enabled: false });
    expect(index.enabled).toBe(false);
    await expect(index.search("content")).resolves.toEqual([]);
  });

  it("applies upsert overrides and remove deletions", async () => {
    await writeFile(join(dir, "ROOT.md"), "# Root\nOriginal disk content about pricing.\n", "utf8");
    const index = new LocalLexicalSemanticMemoryIndex(dir, { cacheTtlMs: 0 });

    await index.upsert([
      { path: "VIRTUAL.md", body: "Ephemeral note about quantum chromodynamics research." },
    ]);
    const upserted = await index.search("quantum chromodynamics");
    expect(upserted.some((hit) => hit.path === "VIRTUAL.md")).toBe(true);

    await index.remove(["VIRTUAL.md"]);
    const removed = await index.search("quantum chromodynamics");
    expect(removed.some((hit) => hit.path === "VIRTUAL.md")).toBe(false);
  });

  it("filters to the requested paths", async () => {
    await writeFile(join(dir, "ONE.md"), "# One\nShared keyword alpha here.\n", "utf8");
    await writeFile(join(dir, "TWO.md"), "# Two\nShared keyword alpha there.\n", "utf8");
    const index = new LocalLexicalSemanticMemoryIndex(dir);
    const hits = await index.search("alpha", { paths: ["TWO.md"] });
    expect(hits.map((hit) => hit.path)).toEqual(["TWO.md"]);
  });
});
