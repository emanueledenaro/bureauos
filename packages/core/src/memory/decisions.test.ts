import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { recordDecision } from "./decisions.js";

describe("recordDecision concurrency", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-decisions-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("records a single heading and every block under concurrent writes (SER-189)", async () => {
    // Several runs completing in one scheduler tick append decisions to the same
    // global DECISIONS.md. Without serialization two writers could both emit the
    // heading or interleave a block between another's heading and block.
    const whats = Array.from({ length: 20 }, (_, i) => `decision number ${i}`);
    await Promise.all(
      whats.map((what) => recordDecision(dir, { what, why: `because ${what}`, actor: "owner" })),
    );

    const content = await readFile(workspacePaths(dir).decisionsLog, "utf8");
    // Exactly one heading, no duplicates from a check-then-write race.
    expect(content.match(/^# Decisions$/gm)?.length ?? 0).toBe(1);
    // Every decision block survived (no lost or interleaved-then-corrupted blocks).
    for (const what of whats) {
      expect(content, `missing block: ${what}`).toContain(`- ${what}`);
    }
    expect(content.match(/^## .+ - decision number \d+$/gm)?.length ?? 0).toBe(20);
  });
});
