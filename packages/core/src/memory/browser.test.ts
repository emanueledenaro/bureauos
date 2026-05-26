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
});
