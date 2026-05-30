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
});
