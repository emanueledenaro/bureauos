import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexRuntimeAdapter, CodexRuntimeError, type CodexRuntimeRunner } from "./codex.js";

describe("CodexRuntimeAdapter", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-codex-runtime-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("validates workspace and run context during prepare", async () => {
    const adapter = new CodexRuntimeAdapter("codex-test");

    await expect(adapter.prepare({ workspaceRoot: "", runId: "run_1" })).rejects.toBeInstanceOf(
      CodexRuntimeError,
    );
    await expect(adapter.prepare({ workspaceRoot: dir, runId: "" })).rejects.toBeInstanceOf(
      CodexRuntimeError,
    );
    await expect(
      adapter.prepare({ workspaceRoot: join(dir, "missing"), runId: "run_1" }),
    ).rejects.toBeInstanceOf(CodexRuntimeError);

    await expect(adapter.prepare({ workspaceRoot: dir, runId: "run_1" })).resolves.toBeUndefined();
  });

  it("returns structured execution artifacts, evidence, files, and commands", async () => {
    const calls: unknown[] = [];
    const runner: CodexRuntimeRunner = {
      async execute(input) {
        calls.push(input);
        return {
          ok: true,
          artifacts: ["art_execution"],
          evidence: "pnpm test passed",
          changedFiles: ["packages/core/src/foo.ts"],
          commands: ["pnpm test"],
        };
      },
    };
    const adapter = new CodexRuntimeAdapter("codex-test", { runner });
    await adapter.prepare({ workspaceRoot: dir, runId: "run_1", projectId: "project_1" });

    const result = await adapter.execute({
      capability: "edit_code",
      intent: "implement scoped code change",
      scope: "Add a small runtime boundary",
      inputs: { commands: ["pnpm test"] },
    });

    expect(result).toMatchObject({
      ok: true,
      artifacts: ["art_execution"],
      evidence: "pnpm test passed",
      changedFiles: ["packages/core/src/foo.ts"],
      commands: ["pnpm test"],
    });
    expect(calls).toHaveLength(1);
  });

  it("blocks unsafe tasks before calling the runner", async () => {
    const runner: CodexRuntimeRunner = {
      async execute() {
        throw new Error("runner should not be called");
      },
    };
    const adapter = new CodexRuntimeAdapter("codex-test", { runner });
    await adapter.prepare({ workspaceRoot: dir, runId: "run_1" });

    const result = await adapter.execute({
      capability: "edit_code",
      intent: "reset repository",
      scope: "Run a destructive reset",
      inputs: { commands: ["git reset --hard HEAD"] },
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.blockers?.join(" ")).toContain("destructive git reset");
    expect(result.commands).toEqual(["git reset --hard HEAD"]);
  });

  it("blocks runner results that touch secret-looking files", async () => {
    const adapter = new CodexRuntimeAdapter("codex-test", {
      runner: {
        async execute() {
          return {
            ok: true,
            artifacts: ["art_attempt"],
            changedFiles: [".env"],
            commands: ["pnpm test"],
          };
        },
      },
    });
    await adapter.prepare({ workspaceRoot: dir, runId: "run_1" });

    const result = await adapter.execute({
      capability: "edit_code",
      intent: "implement change",
      scope: "Add code",
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.artifacts).toEqual(["art_attempt"]);
    expect(result.blockers?.join(" ")).toContain("secret-looking file");
  });

  it("returns failure details when the runner fails", async () => {
    const adapter = new CodexRuntimeAdapter("codex-test", {
      runner: {
        async execute() {
          throw new Error("codex cli failed");
        },
      },
    });
    await adapter.prepare({ workspaceRoot: dir, runId: "run_1" });

    const result = await adapter.execute({
      capability: "run_tests",
      intent: "run tests",
      scope: "Run project tests",
    });

    expect(result).toMatchObject({
      ok: false,
      artifacts: [],
      error: "codex cli failed",
    });
    expect(result.evidence).toContain("Codex runtime failed");
  });
});
