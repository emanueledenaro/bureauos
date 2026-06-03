import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  HostCommandExecution,
  HostCommandExecutor,
  HostCommandResult,
} from "@bureauos/providers";
import { defaultConfig } from "../config/loader.js";
import { buildCodexRuntimeFromConfig } from "./codex-runtime.js";

class FakeExecutor implements HostCommandExecutor {
  public readonly calls: HostCommandExecution[] = [];

  constructor(private readonly result: HostCommandResult) {}

  async run(execution: HostCommandExecution): Promise<HostCommandResult> {
    this.calls.push(execution);
    return { ...this.result, command: execution.command };
  }
}

describe("buildCodexRuntimeFromConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-codex-runtime-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns undefined when runtime.codex is disabled (default)", () => {
    const config = defaultConfig("freelancer");
    expect(config.runtime.codex.enabled).toBe(false);
    expect(buildCodexRuntimeFromConfig(config)).toBeUndefined();
  });

  it("returns undefined when config is missing", () => {
    expect(buildCodexRuntimeFromConfig(undefined)).toBeUndefined();
  });

  it("builds a host-backed adapter when enabled and honors config limits", async () => {
    const config = defaultConfig("freelancer");
    config.runtime.codex.enabled = true;
    config.runtime.codex.commands = [{ command: "pnpm", args: ["test"] }];
    config.runtime.codex.max_changed_files = 2;

    const executor = new FakeExecutor({
      command: "",
      exitCode: 0,
      stdout: " M src/a.ts\n M src/b.ts\n M src/c.ts\n",
      stderr: "",
      timedOut: false,
    });
    const diff = {
      async changedFiles(): Promise<readonly string[]> {
        return ["src/a.ts", "src/b.ts", "src/c.ts"];
      },
    };
    const runtime = buildCodexRuntimeFromConfig(config, { executor, diff });
    expect(runtime).toBeDefined();

    await runtime?.prepare({ workspaceRoot: process.cwd(), runId: "run_1" });
    const result = await runtime?.execute({
      capability: "edit_code",
      intent: "implement scoped change",
      scope: "Add a small change",
    });

    // 3 changed files > max_changed_files (2) -> adapter blocks.
    expect(result?.ok).toBe(false);
    expect(result?.blocked).toBe(true);
    expect(result?.blockers?.join(" ")).toContain("changed file count exceeds runtime limit");
  });

  it("builds a provider-codegen runtime when codegen_mode='provider' and a closure is supplied", async () => {
    const config = defaultConfig("freelancer");
    config.runtime.codex.enabled = true;
    config.runtime.codex.codegen_mode = "provider";

    let seenSystem = "";
    const providerGenerate = async (req: { system: string; prompt: string }): Promise<string> => {
      seenSystem = req.system;
      return '<<<FILE path="index.html">>>\n<title>ok</title>\n<<<END FILE>>>';
    };
    const diff = {
      async changedFiles(): Promise<readonly string[]> {
        return [];
      },
    };

    const runtime = buildCodexRuntimeFromConfig(config, { providerGenerate, diff });
    expect(runtime).toBeDefined();

    // A real temp workspace: the provider runner writes files to disk.
    await runtime?.prepare({ workspaceRoot: dir, runId: "run_1" });
    // Use a scope-only task; the provider runner writes files and runs no commands.
    const result = await runtime?.execute({
      capability: "edit_code",
      intent: "implement scoped change",
      scope: "Build a tiny page",
    });

    // The runner asked the closure with the file-envelope system prompt.
    expect(seenSystem).toContain("<<<END FILE>>>");
    expect(result?.ok).toBe(true);
    expect(result?.changedFiles).toEqual(["index.html"]);
    expect(result?.commands).toEqual([]);
    expect(await readFile(join(dir, "index.html"), "utf8")).toContain("<title>ok</title>");
  });

  it("falls back to the host (command) path when codegen_mode='provider' but no closure is supplied", async () => {
    const config = defaultConfig("freelancer");
    config.runtime.codex.enabled = true;
    config.runtime.codex.codegen_mode = "provider";
    config.runtime.codex.commands = [{ command: "pnpm", args: ["test"] }];

    const executor = new FakeExecutor({
      command: "",
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
    });
    const diff = {
      async changedFiles(): Promise<readonly string[]> {
        return ["src/a.ts"];
      },
    };
    // No providerGenerate => safe fallback to the host runner (never throws).
    const runtime = buildCodexRuntimeFromConfig(config, { executor, diff });
    await runtime?.prepare({ workspaceRoot: process.cwd(), runId: "run_1" });
    const result = await runtime?.execute({
      capability: "edit_code",
      intent: "implement scoped change",
      scope: "Add a small change",
    });

    expect(result?.ok).toBe(true);
    expect(result?.commands).toEqual(["pnpm test"]);
  });

  it("runs a clean cycle when enabled and within limits", async () => {
    const config = defaultConfig("freelancer");
    config.runtime.codex.enabled = true;
    config.runtime.codex.commands = [{ command: "pnpm", args: ["test"] }];

    const executor = new FakeExecutor({
      command: "",
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
    });
    const diff = {
      async changedFiles(): Promise<readonly string[]> {
        return ["src/a.ts"];
      },
    };
    const runtime = buildCodexRuntimeFromConfig(config, { executor, diff });
    await runtime?.prepare({ workspaceRoot: process.cwd(), runId: "run_1" });
    const result = await runtime?.execute({
      capability: "edit_code",
      intent: "implement scoped change",
      scope: "Add a small change",
    });

    expect(result?.ok).toBe(true);
    expect(result?.changedFiles).toEqual(["src/a.ts"]);
    expect(result?.commands).toEqual(["pnpm test"]);
  });
});
