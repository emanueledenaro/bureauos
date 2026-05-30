import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initWorkspace } from "../init/initializer.js";
import { appendDailyNote } from "./daily.js";

describe("appendDailyNote", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-daily-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends a line to the requested section", async () => {
    const path = await appendDailyNote(dir, "Events", "first thing");
    const content = await readFile(path, "utf8");
    expect(content).toContain("## Events");
    expect(content).toContain("- first thing");
  });

  it("does not lose concurrent appends to the same daily note (SER-188)", async () => {
    // Many overlapping appends, mixing sections. Without serialization + atomic
    // write each caller reads the same base and the last writer wins, dropping
    // the others. With `withFileLock` + temp+rename every line must survive.
    const events = Array.from({ length: 25 }, (_, i) => `event ${i}`);
    const decisions = Array.from({ length: 10 }, (_, i) => `decision ${i}`);
    const path = (
      await Promise.all([
        ...events.map((line) => appendDailyNote(dir, "Events", line)),
        ...decisions.map((line) => appendDailyNote(dir, "Decisions", line)),
      ])
    )[0]!;

    const content = await readFile(path, "utf8");
    for (const line of [...events, ...decisions]) {
      expect(content, `missing line: ${line}`).toContain(`- ${line}`);
    }
    // The note still parses as a single, well-formed document (one title).
    expect(content.match(/^# \d{4}-\d{2}-\d{2}$/gm)?.length ?? 0).toBe(1);
  });
});
