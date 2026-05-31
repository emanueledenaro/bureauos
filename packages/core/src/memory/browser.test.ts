import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SemanticMemoryIndex } from "@bureauos/memory";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { workspacePaths } from "../paths.js";
import { MemoryBrowserService } from "./browser.js";

describe("MemoryBrowserService", () => {
  it("uses semantic index hits when configured and available", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-memory-browser-"));
    try {
      const paths = workspacePaths(dir);
      await mkdir(join(paths.clientsDir, "acme-labs"), { recursive: true });
      await writeFile(
        join(paths.clientsDir, "acme-labs", "CLIENT.md"),
        "# Acme Labs\n\nRetained client for frontend support.\n",
        "utf8",
      );
      const config = defaultConfig("agency");
      config.memory.semantic_index.enabled = true;
      config.memory.semantic_index.provider = "custom";
      const semanticIndex: SemanticMemoryIndex = {
        kind: "fake",
        enabled: true,
        async search(query) {
          expect(query).toBe("pizza redesign");
          return [
            {
              path: "clients/acme-labs/CLIENT.md",
              snippet: "Semantic match for Acme Labs",
              score: 0.91,
            },
          ];
        },
      };

      const result = await new MemoryBrowserService(dir, config, { semanticIndex }).browse({
        query: "pizza redesign",
      });

      expect(result.semantic_hits).toEqual([
        {
          path: "clients/acme-labs/CLIENT.md",
          snippet: "Semantic match for Acme Labs",
          score: 0.91,
        },
      ]);
      // The fused entry score is reciprocal-rank fusion (SER-196), not the raw
      // cosine; the cosine itself is asserted on `semantic_hits` above.
      expect(result.entries).toEqual([
        expect.objectContaining({ path: "clients/acme-labs/CLIENT.md" }),
      ]);
      expect(result.entries[0]?.score).toBeCloseTo(1 / 61, 5);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("routes keyword retrieval through the FTS5-backed store search", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-memory-browser-"));
    try {
      const paths = workspacePaths(dir);
      await mkdir(join(paths.clientsDir, "amodeo"), { recursive: true });
      await writeFile(
        join(paths.clientsDir, "amodeo", "CLIENT.md"),
        "# Amodeo\n\nPizza margherita landing page request.\n",
        "utf8",
      );
      await mkdir(join(paths.clientsDir, "bravo"), { recursive: true });
      await writeFile(
        join(paths.clientsDir, "bravo", "CLIENT.md"),
        "# Bravo\n\nUnrelated billing migration work.\n",
        "utf8",
      );

      const result = await new MemoryBrowserService(dir, defaultConfig("agency")).browse({
        query: "margherita",
      });

      expect(result.entries.map((entry) => entry.path)).toEqual(["clients/amodeo/CLIENT.md"]);
      expect(result.entries[0]?.score).toBeGreaterThan(0);
      expect(result.selected?.body).toContain("margherita");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lets a strong semantic-only hit outrank a marginal keyword hit (SER-196)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-memory-browser-"));
    try {
      const paths = workspacePaths(dir);
      // Dominant keyword doc: the query term many times → top of the keyword
      // ranking (rank 1), pushing the marginal doc to a lower keyword rank.
      await mkdir(join(paths.clientsDir, "dominant"), { recursive: true });
      await writeFile(
        join(paths.clientsDir, "dominant", "CLIENT.md"),
        `# Dominant\n\n${"margherita ".repeat(80)}\n`,
        "utf8",
      );
      // Marginal keyword doc: a single occurrence of the query term.
      await mkdir(join(paths.clientsDir, "marginal"), { recursive: true });
      await writeFile(
        join(paths.clientsDir, "marginal", "CLIENT.md"),
        "# Marginal\n\nOne passing margherita mention and nothing else relevant.\n",
        "utf8",
      );
      // Semantic-only doc: no keyword match, strong cosine similarity.
      await mkdir(join(paths.clientsDir, "semantic"), { recursive: true });
      await writeFile(
        join(paths.clientsDir, "semantic", "CLIENT.md"),
        "# Semantic\n\nConceptually related pizza redesign and rebrand work.\n",
        "utf8",
      );

      const config = defaultConfig("agency");
      config.memory.semantic_index.enabled = true;
      config.memory.semantic_index.provider = "custom";
      const semanticIndex: SemanticMemoryIndex = {
        kind: "fake",
        enabled: true,
        async search() {
          return [{ path: "clients/semantic/CLIENT.md", snippet: "conceptual match", score: 0.95 }];
        },
      };

      const result = await new MemoryBrowserService(dir, config, { semanticIndex }).browse({
        query: "margherita",
      });

      const order = result.entries.map((entry) => entry.path);
      const semanticRank = order.indexOf("clients/semantic/CLIENT.md");
      const marginalRank = order.indexOf("clients/marginal/CLIENT.md");
      expect(semanticRank).toBeGreaterThanOrEqual(0);
      expect(marginalRank).toBeGreaterThanOrEqual(0);
      // Under reciprocal-rank fusion the strong semantic-only hit (semantic
      // rank 1) outranks the lower-ranked marginal keyword hit — impossible
      // under the old additive blend where any keyword hit dominated (SER-196).
      expect(semanticRank).toBeLessThan(marginalRank);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses the local semantic provider from config without an injected index", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-memory-browser-"));
    try {
      const paths = workspacePaths(dir);
      await mkdir(join(paths.clientsDir, "acme-labs"), { recursive: true });
      await writeFile(
        join(paths.clientsDir, "acme-labs", "CLIENT.md"),
        "# Acme Labs\n\nRetained client for frontend support and retention.\n",
        "utf8",
      );
      const config = defaultConfig("agency");
      config.memory.semantic_index.enabled = true;
      config.memory.semantic_index.provider = "local";
      config.memory.semantic_index.min_score = 0;

      const result = await new MemoryBrowserService(dir, config).browse({
        query: "retention frontend",
      });

      expect(result.semantic_hits.length).toBeGreaterThan(0);
      expect(result.semantic_hits[0]?.path).toBe("clients/acme-labs/CLIENT.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns topical semantic hits at the default config min_score (SER-195)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-memory-browser-"));
    try {
      const paths = workspacePaths(dir);
      await mkdir(join(paths.clientsDir, "acme-labs"), { recursive: true });
      await writeFile(
        join(paths.clientsDir, "acme-labs", "CLIENT.md"),
        "# Acme Labs\n\nFrontend retention support. Frontend retention engagement and frontend support retention roadmap.\n",
        "utf8",
      );
      await mkdir(join(paths.clientsDir, "other-co"), { recursive: true });
      await writeFile(
        join(paths.clientsDir, "other-co", "CLIENT.md"),
        "# Other Co\n\nKitchen plumbing invoice schedule and warehouse logistics.\n",
        "utf8",
      );
      const config = defaultConfig("agency");
      config.memory.semantic_index.enabled = true;
      config.memory.semantic_index.provider = "local";
      // Exercise the shipped default threshold, not the min_score = 0 workaround:
      // a topical query must still surface the on-topic document (SER-195).
      expect(config.memory.semantic_index.min_score).toBeGreaterThan(0);

      const result = await new MemoryBrowserService(dir, config).browse({
        query: "frontend retention support",
      });

      expect(result.semantic_hits.length).toBeGreaterThan(0);
      expect(result.semantic_hits[0]?.path).toBe("clients/acme-labs/CLIENT.md");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
