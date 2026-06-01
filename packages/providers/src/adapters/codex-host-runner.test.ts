import { describe, expect, it } from "vitest";
import {
  GitStatusDiffInspector,
  HostCodexRuntimeRunner,
  parseGitPorcelain,
  type HostCommandExecution,
  type HostCommandExecutor,
  type HostCommandResult,
} from "./codex-host-runner.js";
import { CodexRuntimeAdapter } from "./codex.js";
import type { CodexRuntimeRunnerInput } from "./codex.js";

class FakeExecutor implements HostCommandExecutor {
  public readonly calls: HostCommandExecution[] = [];

  constructor(
    private readonly results: Record<string, HostCommandResult>,
    private readonly fallback?: HostCommandResult,
  ) {}

  async run(execution: HostCommandExecution): Promise<HostCommandResult> {
    this.calls.push(execution);
    const key = [execution.command, ...execution.args].join(" ");
    const result = this.results[key] ?? this.results[execution.command] ?? this.fallback;
    if (!result) throw new Error(`unexpected command: ${key}`);
    return { ...result, command: execution.command };
  }
}

function ok(stdout = ""): HostCommandResult {
  return { command: "", exitCode: 0, stdout, stderr: "", timedOut: false };
}

function fail(exitCode = 1, stderr = "boom"): HostCommandResult {
  return { command: "", exitCode, stdout: "", stderr, timedOut: false };
}

function input(overrides: Partial<CodexRuntimeRunnerInput["task"]> = {}): CodexRuntimeRunnerInput {
  return {
    context: { workspaceRoot: "/work", runId: "run_1" },
    task: { intent: "development_agent_execution", scope: "Add a small change", ...overrides },
  };
}

describe("HostCodexRuntimeRunner", () => {
  it("refuses to execute when no commands are configured or supplied", async () => {
    const executor = new FakeExecutor({});
    const runner = new HostCodexRuntimeRunner({ executor });

    const result = await runner.execute(input());

    expect(result.ok).toBe(false);
    expect(result.commands).toEqual([]);
    expect(result.error).toContain("no configured commands");
    expect(executor.calls).toHaveLength(0);
  });

  it("codegen mode: turns the task into a coding-tool invocation when no commands are configured", async () => {
    const executor = new FakeExecutor({}, ok("")); // codegen call + git diff both succeed
    const runner = new HostCodexRuntimeRunner({
      executor,
      codegenCommand: ["codex", "exec", "--full-auto"],
      allowedCommands: ["codex"],
    });

    const result = await runner.execute(
      input({
        scope: "Build a pizzeria table-booking screen",
        inputs: { briefing: "Flutter app named giovanniprova" },
      }),
    );

    expect(result.ok).toBe(true);
    const codegenCall = executor.calls.find((call) => call.command === "codex");
    expect(codegenCall).toBeDefined();
    // Base args preserved; the task prompt is one final argument (never a shell string).
    expect(codegenCall?.args.slice(0, 2)).toEqual(["exec", "--full-auto"]);
    const prompt = codegenCall?.args[2] ?? "";
    expect(prompt).toContain("Task: Build a pizzeria table-booking screen");
    expect(prompt).toContain("giovanniprova");
    expect(result.commands.some((line) => line.startsWith("codex exec --full-auto"))).toBe(true);
  });

  it("codegen mode stays off when explicit commands are configured (verify-only wins)", async () => {
    const executor = new FakeExecutor({}, ok(""));
    const runner = new HostCodexRuntimeRunner({
      executor,
      codegenCommand: ["codex", "exec"],
      allowedCommands: ["codex", "pnpm"],
      commands: [{ command: "pnpm", args: ["test"] }],
    });

    await runner.execute(input());

    expect(executor.calls.some((call) => call.command === "pnpm")).toBe(true);
    expect(executor.calls.some((call) => call.command === "codex")).toBe(false);
  });

  it("codegen mode: shell metacharacters in the task stay inside one literal argument", async () => {
    const executor = new FakeExecutor({}, ok(""));
    const runner = new HostCodexRuntimeRunner({
      executor,
      codegenCommand: ["codex", "exec"],
      allowedCommands: ["codex"],
    });

    const malicious = '"; rm -rf / # `whoami` $(id) && echo pwned';
    await runner.execute(input({ scope: malicious }));

    const call = executor.calls.find((entry) => entry.command === "codex");
    expect(call).toBeDefined();
    // Exactly base args + ONE prompt arg — the malicious text is never split
    // into separate argv entries (spawn runs shell:false, so it stays inert).
    expect(call?.args).toHaveLength(2);
    expect(call?.args[1]).toContain(malicious);
  });

  it("codegen mode is refused when its binary is not on the allow-list", async () => {
    const executor = new FakeExecutor({}, ok(""));
    const runner = new HostCodexRuntimeRunner({
      executor,
      codegenCommand: ["codex", "exec"],
      allowedCommands: ["pnpm"], // codex deliberately not allowed
    });

    const result = await runner.execute(input());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("allow-list");
    expect(executor.calls.some((call) => call.command === "codex")).toBe(false);
  });

  it("runs configured commands with shell:false-safe args and reports diff evidence", async () => {
    const executor = new FakeExecutor({
      "pnpm test": ok("all good"),
      "git status --porcelain": ok(" M packages/core/src/foo.ts\n?? packages/core/src/bar.ts\n"),
    });
    const runner = new HostCodexRuntimeRunner({
      executor,
      commands: [{ command: "pnpm", args: ["test"], label: "unit tests" }],
    });

    const result = await runner.execute(input());

    expect(result.ok).toBe(true);
    expect(result.commands).toEqual(["pnpm test"]);
    expect(result.evidence).toContain("unit tests: passed");
    expect(result.changedFiles).toEqual(["packages/core/src/foo.ts", "packages/core/src/bar.ts"]);
    // pnpm test was spawned, and the diff inspector ran git status; nothing else.
    expect(executor.calls.map((call) => [call.command, ...call.args].join(" "))).toEqual([
      "pnpm test",
      "git status --porcelain",
    ]);
  });

  it("refuses commands that are not on the allow-list before spawning", async () => {
    const executor = new FakeExecutor({}, ok());
    const runner = new HostCodexRuntimeRunner({
      executor,
      commands: [{ command: "curl", args: ["https://evil.test"] }],
    });

    const result = await runner.execute(input());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("not on the allow-list: curl");
    expect(executor.calls).toHaveLength(0);
  });

  it("refuses destructive git subcommands even when git is allow-listed", async () => {
    const executor = new FakeExecutor({}, ok());
    const runner = new HostCodexRuntimeRunner({
      executor,
      commands: [{ command: "git", args: ["push", "--force"] }],
    });

    const result = await runner.execute(input());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("git subcommand is not allowed: push");
    expect(executor.calls).toHaveLength(0);
  });

  // SER-183: git global options (`-c`/`-C`/`--git-dir`/`--exec-path`/...) must
  // not be usable to smuggle a blocked subcommand past the allow-list, escape
  // the workspace, or run arbitrary commands. Each must be refused with no spawn.
  it.each([
    {
      name: "git -c core.pager=x push (pager exec + hidden subcommand)",
      args: ["-c", "core.pager=x", "push"],
      expected: "git global flag is not allowed: -c",
    },
    {
      name: "git -C /tmp push (workspace escape + hidden subcommand)",
      args: ["-C", "/tmp", "push"],
      expected: "git global flag is not allowed: -C",
    },
    {
      name: "git --git-dir=/x reset --hard (workspace escape + destructive)",
      args: ["--git-dir=/x", "reset", "--hard"],
      expected: "git global flag is not allowed: --git-dir",
    },
    {
      name: "git -c alias.x='!cmd' status (alias exec vector)",
      args: ["-c", "alias.x=!cmd", "status"],
      expected: "git global flag is not allowed: -c",
    },
    {
      name: "git --exec-path=/tmp push (helper-binary hijack + hidden subcommand)",
      args: ["--exec-path=/tmp", "push"],
      expected: "git global flag is not allowed: --exec-path",
    },
  ])("refuses git global flag bypass: $name", async ({ args, expected }) => {
    const executor = new FakeExecutor({}, ok());
    const runner = new HostCodexRuntimeRunner({
      executor,
      commands: [{ command: "git", args }],
    });

    const result = await runner.execute(input());

    expect(result.ok).toBe(false);
    expect(result.error).toContain(expected);
    // No process must ever be spawned for a refused command.
    expect(executor.calls).toHaveLength(0);
  });

  it.each([
    { name: "git status --porcelain", args: ["status", "--porcelain"] },
    { name: "git diff", args: ["diff"] },
  ])("still allows the read-only git flow: $name", async ({ name, args }) => {
    const key = `git ${args.join(" ")}`;
    const executor = new FakeExecutor({
      [key]: ok(""),
      "git status --porcelain": ok(""),
    });
    const runner = new HostCodexRuntimeRunner({
      executor,
      commands: [{ command: "git", args, label: name }],
    });

    const result = await runner.execute(input());

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    // The allow-listed git command was actually spawned.
    expect(executor.calls.map((call) => [call.command, ...call.args].join(" "))).toContain(key);
  });

  it("stops at the first failing command and surfaces the failure", async () => {
    const executor = new FakeExecutor({
      "pnpm build": ok(),
      "pnpm test": fail(2, "1 failing"),
      "git status --porcelain": ok(""),
    });
    const runner = new HostCodexRuntimeRunner({
      executor,
      commands: [
        { command: "pnpm", args: ["build"] },
        { command: "pnpm", args: ["test"] },
        { command: "pnpm", args: ["lint"] },
      ],
    });

    const result = await runner.execute(input());

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.error).toContain("command failed (exit 2): pnpm test");
    // lint must not run after test failed.
    expect(executor.calls.map((call) => [call.command, ...call.args].join(" "))).toEqual([
      "pnpm build",
      "pnpm test",
      "git status --porcelain",
    ]);
  });

  it("treats a timed-out command as a failure", async () => {
    const executor = new FakeExecutor({
      "pnpm test": { command: "pnpm", exitCode: 1, stdout: "", stderr: "", timedOut: true },
      "git status --porcelain": ok(""),
    });
    const runner = new HostCodexRuntimeRunner({
      executor,
      commands: [{ command: "pnpm", args: ["test"] }],
    });

    const result = await runner.execute(input());

    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("prefers task-supplied commands over configured commands", async () => {
    const executor = new FakeExecutor({
      "node verify.js": ok(),
      "git status --porcelain": ok(""),
    });
    const runner = new HostCodexRuntimeRunner({
      executor,
      commands: [{ command: "pnpm", args: ["test"] }],
    });

    const result = await runner.execute(
      input({ inputs: { commands: [{ command: "node", args: ["verify.js"] }] } }),
    );

    expect(result.ok).toBe(true);
    expect(result.commands).toEqual(["node verify.js"]);
  });

  // Finding #38: a command whose cwd resolves outside the workspace root must be
  // refused and must never spawn. `safeWorkspaceCwd` enforces this.
  it("refuses a command whose cwd escapes the workspace root", async () => {
    const executor = new FakeExecutor({}, ok());
    const runner = new HostCodexRuntimeRunner({
      executor,
      commands: [{ command: "pnpm", args: ["test"], cwd: "../../escape" }],
    });

    await expect(runner.execute(input())).rejects.toThrow(/command cwd escapes workspace/);
    // The escaping command was never spawned.
    expect(executor.calls.map((call) => [call.command, ...call.args].join(" "))).not.toContain(
      "pnpm test",
    );
  });

  it("returns empty changed files when git inspection fails", async () => {
    const executor = new FakeExecutor({
      "pnpm test": ok(),
      "git status --porcelain": fail(128, "not a git repo"),
    });
    const runner = new HostCodexRuntimeRunner({
      executor,
      commands: [{ command: "pnpm", args: ["test"] }],
    });

    const result = await runner.execute(input());

    expect(result.ok).toBe(true);
    expect(result.changedFiles).toEqual([]);
  });
});

describe("HostCodexRuntimeRunner under the CodexRuntimeAdapter boundary", () => {
  it("normalizes evidence and passes a clean run through the adapter", async () => {
    const executor = new FakeExecutor({
      "pnpm test": ok("passed"),
      "git status --porcelain": ok(" M src/foo.ts\n"),
    });
    const runner = new HostCodexRuntimeRunner({
      executor,
      commands: [{ command: "pnpm", args: ["test"] }],
    });
    const adapter = new CodexRuntimeAdapter("codex-host", { runner });
    await adapter.prepare({ workspaceRoot: process.cwd(), runId: "run_1" });

    const result = await adapter.execute({
      capability: "edit_code",
      intent: "implement scoped change",
      scope: "Add a small change",
    });

    expect(result.ok).toBe(true);
    expect(result.changedFiles).toEqual(["src/foo.ts"]);
    expect(result.commands).toEqual(["pnpm test"]);
  });

  it("lets the adapter block a runner diff that touches a secret-looking file", async () => {
    const executor = new FakeExecutor({
      "pnpm test": ok(),
      "git status --porcelain": ok(" M .env\n"),
    });
    const runner = new HostCodexRuntimeRunner({
      executor,
      commands: [{ command: "pnpm", args: ["test"] }],
    });
    const adapter = new CodexRuntimeAdapter("codex-host", { runner });
    await adapter.prepare({ workspaceRoot: process.cwd(), runId: "run_1" });

    const result = await adapter.execute({
      capability: "edit_code",
      intent: "implement change",
      scope: "Add code",
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.blockers?.join(" ")).toContain("secret-looking file");
  });

  it("lets the adapter enforce the changed-file limit on runner diffs", async () => {
    const many = Array.from({ length: 6 }, (_, i) => ` M src/file-${i}.ts`).join("\n");
    const executor = new FakeExecutor({
      "pnpm test": ok(),
      "git status --porcelain": ok(`${many}\n`),
    });
    const runner = new HostCodexRuntimeRunner({
      executor,
      commands: [{ command: "pnpm", args: ["test"] }],
    });
    const adapter = new CodexRuntimeAdapter("codex-host", { runner, maxChangedFiles: 3 });
    await adapter.prepare({ workspaceRoot: process.cwd(), runId: "run_1" });

    const result = await adapter.execute({
      capability: "edit_code",
      intent: "implement change",
      scope: "Add code",
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.blockers?.join(" ")).toContain("changed file count exceeds runtime limit");
  });
});

describe("parseGitPorcelain", () => {
  it("parses modified, added, and renamed entries", () => {
    const stdout = [
      " M packages/core/src/a.ts",
      "?? packages/core/src/b.ts",
      'R  "old name.ts" -> "new name.ts"',
      "",
    ].join("\n");

    expect(parseGitPorcelain(stdout)).toEqual([
      "packages/core/src/a.ts",
      "packages/core/src/b.ts",
      "new name.ts",
    ]);
  });
});

describe("GitStatusDiffInspector", () => {
  it("runs git status --porcelain through the executor and parses output", async () => {
    const executor = new FakeExecutor({
      "git status --porcelain": ok(" M src/x.ts\n"),
    });
    const inspector = new GitStatusDiffInspector(executor);

    const files = await inspector.changedFiles("/work");

    expect(files).toEqual(["src/x.ts"]);
    expect(executor.calls[0]?.args).toEqual(["status", "--porcelain"]);
  });
});
