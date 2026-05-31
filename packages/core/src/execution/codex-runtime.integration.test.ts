import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { buildCodexRuntimeFromConfig } from "./codex-runtime.js";

const run = promisify(execFile);

/**
 * SER-238 — proves the development-execution engine works end-to-end against a
 * REAL workspace: no injected fakes, so this exercises the real
 * `SubprocessHostCommandExecutor` (`spawn(..., { shell: false })`) and the real
 * `GitStatusDiffInspector` (`git status --porcelain`) behind the
 * `CodexRuntimeAdapter` safety boundary. A benign allow-listed `node` command
 * stands in for a Codex edit so no external CLI is required.
 */
describe("codex runtime — real subprocess execution (SER-238)", () => {
  let dir: string;

  // Generous timeouts: this hook + test spawn real `git`/`node` subprocesses, so
  // they must not rely on vitest's 5s default on a loaded CI runner.
  const TIMEOUT_MS = 30_000;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-codex-exec-"));
    // The diff inspector reads `git status`, so the workspace must be a git repo
    // with a clean baseline.
    await run("git", ["init", "-q"], { cwd: dir });
    await run("git", ["config", "user.email", "ci@bureauos.test"], { cwd: dir });
    await run("git", ["config", "user.name", "BureauOS CI"], { cwd: dir });
    await writeFile(join(dir, "README.md"), "baseline\n", "utf8");
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-q", "-m", "baseline"], { cwd: dir });
  }, TIMEOUT_MS);

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it(
    "runs a real allow-listed command that writes a file and reports the real diff",
    async () => {
      const config = defaultConfig("freelancer");
      config.runtime.codex.enabled = true;
      // `node` is in the default allow-list; this makes a real file change in the
      // workspace, standing in for a Codex edit without needing the Codex CLI.
      config.runtime.codex.commands = [
        {
          command: "node",
          args: ["-e", "require('fs').writeFileSync('generated.txt','built by the agent\\n')"],
          label: "edit",
        },
      ];

      // No injected executor/diff -> the real subprocess executor + git diff run.
      const runtime = buildCodexRuntimeFromConfig(config);
      expect(runtime).toBeDefined();

      await runtime!.prepare({ workspaceRoot: dir, runId: "run_exec_test" });
      const result = await runtime!.execute({
        capability: "edit_code",
        intent: "development_agent_execution",
        scope: "write a generated file",
        inputs: {},
      });

      // The engine actually executed (not blocked, not a fake).
      expect(result.ok).toBe(true);
      expect(result.blocked ?? false).toBe(false);
      expect(result.commands && result.commands.length).toBeGreaterThan(0);

      // The real git-diff inspector detected the new file...
      expect(result.changedFiles).toContain("generated.txt");
      // ...and the subprocess really wrote it to disk.
      const written = await readFile(join(dir, "generated.txt"), "utf8");
      expect(written).toContain("built by the agent");
    },
    TIMEOUT_MS,
  );
});
