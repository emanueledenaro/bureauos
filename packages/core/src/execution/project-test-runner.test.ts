import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import {
  ProjectTestRunnerService,
  resolveProjectTestCommand,
  type ProjectCommandRunner,
  type ProjectCommandRunnerOptions,
  type ProjectTestExecution,
  type ResolvedProjectTestCommand,
} from "./project-test-runner.js";

class FakeCommandRunner implements ProjectCommandRunner {
  readonly commands: ResolvedProjectTestCommand[] = [];

  constructor(private readonly execution: ProjectTestExecution) {}

  async run(
    command: ResolvedProjectTestCommand,
    _options: ProjectCommandRunnerOptions,
  ): Promise<ProjectTestExecution> {
    this.commands.push(command);
    return this.execution;
  }
}

describe("ProjectTestRunnerService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-project-tests-"));
    await initWorkspace({ root: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("discovers a package test command and writes passing PR gate evidence", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@9.12.0",
        scripts: { test: "pnpm -r run test" },
      }),
      "utf8",
    );
    const runner = new FakeCommandRunner({
      exitCode: 0,
      stdout: "all tests passed",
      stderr: "",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const result = await new ProjectTestRunnerService(dir, { commandRunner: runner }).run({
      runId: "run_12345678",
      projectId: "proj_12345678",
    });

    expect(result.status).toBe("passed");
    expect(result.prGateSatisfied).toBe(true);
    expect(result.testEvidence).toEqual([`pnpm test passed (${result.artifact.id})`]);
    expect(runner.commands[0]).toMatchObject({
      command: "pnpm",
      args: ["test"],
      source: "discovered",
      commandLine: "pnpm test",
    });

    const written = await new ArtifactStore(dir).read(result.artifact.id);
    expect(written?.record.type).toBe("test-evidence-report");
    expect(written?.record.test_status).toBe("passed");
    expect(written?.record.pr_gate_satisfied).toBe(true);
    expect(written?.body).toContain("all tests passed");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("execution.tests.passed");
  });

  it("uses a configured structured command before discovery", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ packageManager: "pnpm@9.12.0", scripts: { test: "pnpm -r run test" } }),
      "utf8",
    );
    const runner = new FakeCommandRunner({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const result = await new ProjectTestRunnerService(dir, { commandRunner: runner }).run({
      command: {
        command: "pnpm",
        args: ["--filter", "@bureauos/core", "test"],
        label: "core tests",
      },
    });

    expect(result.status).toBe("passed");
    expect(result.command).toMatchObject({
      source: "configured",
      label: "core tests",
      commandLine: "pnpm --filter @bureauos/core test",
    });
  });

  it("keeps failing test output as artifact evidence without satisfying the PR gate", async () => {
    const runner = new FakeCommandRunner({
      exitCode: 1,
      stdout: "one suite failed",
      stderr: "AssertionError",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    });

    const result = await new ProjectTestRunnerService(dir, { commandRunner: runner }).run({
      command: { command: "pnpm", args: ["test"] },
      runId: "run_12345678",
    });

    expect(result.status).toBe("failed");
    expect(result.prGateSatisfied).toBe(false);
    expect(result.testEvidence).toEqual([]);

    const written = await new ArtifactStore(dir).read(result.artifact.id);
    expect(written?.record.test_status).toBe("failed");
    expect(written?.record.pr_gate_satisfied).toBe(false);
    expect(written?.body).toContain("AssertionError");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("execution.tests.failed");
  });

  it("blocks clearly when no test command is configured or discovered", async () => {
    const result = await new ProjectTestRunnerService(dir, {
      commandRunner: new FakeCommandRunner({
        exitCode: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      }),
    }).run({ runId: "run_12345678" });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("no project test command configured or discovered");
    expect(result.prGateSatisfied).toBe(false);
    expect(result.testEvidence).toEqual([]);

    const written = await new ArtifactStore(dir).read(result.artifact.id);
    expect(written?.record.test_status).toBe("blocked");
    expect(written?.body).toContain("no project test command configured or discovered");
  });
});

describe("resolveProjectTestCommand", () => {
  it("returns undefined when no package test script exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bureauos-project-tests-"));
    try {
      await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: {} }), "utf8");
      await expect(resolveProjectTestCommand({ workspaceRoot: dir })).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
