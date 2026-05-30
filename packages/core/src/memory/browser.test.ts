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
      expect(result.entries).toEqual([
        expect.objectContaining({
          path: "clients/acme-labs/CLIENT.md",
          score: 0.91,
        }),
      ]);
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
