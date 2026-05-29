import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { workspacePaths } from "../paths.js";

export interface ProjectTestCommand {
  command: string;
  args?: readonly string[];
  cwd?: string;
  label?: string;
}

export interface ResolvedProjectTestCommand {
  command: string;
  args: readonly string[];
  cwd: string;
  label: string;
  source: "configured" | "discovered";
  commandLine: string;
}

export interface ProjectTestExecution {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface ProjectCommandRunner {
  run(
    command: ResolvedProjectTestCommand,
    options: ProjectCommandRunnerOptions,
  ): Promise<ProjectTestExecution>;
}

export interface ProjectCommandRunnerOptions {
  timeoutMs: number;
  maxOutputChars: number;
}

export interface ProjectTestRunnerInput {
  command?: ProjectTestCommand;
  cwd?: string;
  runId?: string;
  projectId?: string;
  clientId?: string;
  createdBy?: string;
  timeoutMs?: number;
  maxOutputChars?: number;
}

export interface ProjectTestRunnerResult {
  status: "passed" | "failed" | "blocked";
  command?: ResolvedProjectTestCommand;
  exitCode?: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  artifact: ArtifactRecord;
  testEvidence: string[];
  prGateSatisfied: boolean;
  reason?: string;
}

export interface ProjectTestRunnerDeps {
  artifacts?: ArtifactStore;
  audit?: AuditLog;
  commandRunner?: ProjectCommandRunner;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 12_000;

interface PackageJsonForDiscovery {
  packageManager?: unknown;
  scripts?: Record<string, unknown>;
}

function commandLine(command: Pick<ProjectTestCommand, "command" | "args">): string {
  return [command.command, ...(command.args ?? [])].join(" ");
}

function packageManagerBinary(packageManager: unknown): string {
  if (typeof packageManager !== "string") return "npm";
  if (packageManager.startsWith("pnpm@")) return "pnpm";
  if (packageManager.startsWith("yarn@")) return "yarn";
  if (packageManager.startsWith("npm@")) return "npm";
  return packageManager.split("@")[0] || "npm";
}

function safeCwd(workspaceRoot: string, cwd?: string): string {
  const resolved = resolve(workspaceRoot, cwd ?? ".");
  const rel = relative(workspaceRoot, resolved);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error(`test command cwd escapes workspace: ${cwd}`);
  }
  return resolved;
}

function appendLimited(
  current: string,
  chunk: Buffer | string,
  maxOutputChars: number,
): { value: string; truncated: boolean } {
  const next = current + chunk.toString();
  if (next.length <= maxOutputChars) return { value: next, truncated: false };
  return { value: next.slice(0, maxOutputChars), truncated: true };
}

function outputBlock(label: string, value: string, truncated: boolean): string {
  const body = value.trim() || "(empty)";
  return `## ${label}${truncated ? " (truncated)" : ""}\n\n\`\`\`text\n${body}\n\`\`\``;
}

async function discoverCommand(
  workspaceRoot: string,
  cwd: string,
): Promise<ProjectTestCommand | undefined> {
  try {
    const raw = await readFile(resolve(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as PackageJsonForDiscovery;
    if (typeof pkg.scripts?.["test"] !== "string") return undefined;
    const manager = packageManagerBinary(pkg.packageManager);
    return {
      command: manager,
      args: ["test"],
      cwd: relative(workspaceRoot, cwd) || ".",
      label: `${manager} test`,
    };
  } catch {
    return undefined;
  }
}

export async function resolveProjectTestCommand(args: {
  workspaceRoot: string;
  configured?: ProjectTestCommand;
  cwd?: string;
}): Promise<ResolvedProjectTestCommand | undefined> {
  const cwd = safeCwd(args.workspaceRoot, args.configured?.cwd ?? args.cwd);
  const source = args.configured ? "configured" : "discovered";
  const command = args.configured ?? (await discoverCommand(args.workspaceRoot, cwd));
  if (!command) return undefined;
  const resolvedCwd = safeCwd(args.workspaceRoot, command.cwd ?? args.cwd);
  const line = commandLine(command);
  return {
    command: command.command,
    args: command.args ?? [],
    cwd: resolvedCwd,
    label: command.label ?? line,
    source,
    commandLine: line,
  };
}

export class SubprocessProjectCommandRunner implements ProjectCommandRunner {
  async run(
    command: ResolvedProjectTestCommand,
    options: ProjectCommandRunnerOptions,
  ): Promise<ProjectTestExecution> {
    return new Promise((resolveExecution) => {
      let stdout = "";
      let stderr = "";
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let timedOut = false;

      const child = spawn(command.command, [...command.args], {
        cwd: command.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, options.timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        const next = appendLimited(stdout, chunk, options.maxOutputChars);
        stdout = next.value;
        stdoutTruncated = stdoutTruncated || next.truncated;
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        const next = appendLimited(stderr, chunk, options.maxOutputChars);
        stderr = next.value;
        stderrTruncated = stderrTruncated || next.truncated;
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        resolveExecution({
          exitCode: 1,
          stdout,
          stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`,
          timedOut,
          stdoutTruncated,
          stderrTruncated,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        resolveExecution({
          exitCode: code ?? 1,
          stdout,
          stderr,
          timedOut,
          stdoutTruncated,
          stderrTruncated,
        });
      });
    });
  }
}

export class ProjectTestRunnerService {
  private readonly artifacts: ArtifactStore;
  private readonly audit: AuditLog;
  private readonly commandRunner: ProjectCommandRunner;

  constructor(
    private readonly workspaceRoot: string,
    deps: ProjectTestRunnerDeps = {},
  ) {
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.commandRunner = deps.commandRunner ?? new SubprocessProjectCommandRunner();
  }

  async run(input: ProjectTestRunnerInput = {}): Promise<ProjectTestRunnerResult> {
    const createdBy = input.createdBy ?? "development";
    const maxOutputChars = input.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const command = await resolveProjectTestCommand({
      workspaceRoot: this.workspaceRoot,
      configured: input.command,
      cwd: input.cwd,
    });

    if (!command) {
      const reason = "no project test command configured or discovered";
      const artifact = await this.writeArtifact({
        input,
        createdBy,
        status: "blocked",
        reason,
        stdout: "",
        stderr: "",
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      });
      await this.audit.append({
        actor: createdBy,
        action: "execution.tests.blocked",
        target: input.projectId ?? input.runId ?? "project-tests",
        artifact_id: artifact.id,
        result: "ok",
      });
      return {
        status: "blocked",
        stdout: "",
        stderr: "",
        timedOut: false,
        artifact,
        testEvidence: [],
        prGateSatisfied: false,
        reason,
      };
    }

    const execution = await this.commandRunner.run(command, { timeoutMs, maxOutputChars });
    const status = execution.exitCode === 0 && !execution.timedOut ? "passed" : "failed";
    const artifact = await this.writeArtifact({
      input,
      createdBy,
      command,
      status,
      exitCode: execution.exitCode,
      stdout: execution.stdout,
      stderr: execution.stderr,
      timedOut: execution.timedOut,
      stdoutTruncated: execution.stdoutTruncated,
      stderrTruncated: execution.stderrTruncated,
    });

    await this.audit.append({
      actor: createdBy,
      action: status === "passed" ? "execution.tests.passed" : "execution.tests.failed",
      target: command.commandLine,
      artifact_id: artifact.id,
      result: "ok",
    });

    const evidence = `${command.commandLine} passed (${artifact.id})`;
    return {
      status,
      command,
      exitCode: execution.exitCode,
      stdout: execution.stdout,
      stderr: execution.stderr,
      timedOut: execution.timedOut,
      artifact,
      testEvidence: status === "passed" ? [evidence] : [],
      prGateSatisfied: status === "passed",
    };
  }

  private async writeArtifact(args: {
    input: ProjectTestRunnerInput;
    createdBy: string;
    status: ProjectTestRunnerResult["status"];
    command?: ResolvedProjectTestCommand;
    exitCode?: number;
    reason?: string;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  }): Promise<ArtifactRecord> {
    const commandLineText = args.command?.commandLine ?? "(none)";
    return this.artifacts.write({
      type: "test-evidence-report",
      createdBy: args.createdBy,
      ...(args.input.runId ? { runId: args.input.runId } : {}),
      ...(args.input.projectId ? { projectId: args.input.projectId } : {}),
      ...(args.input.clientId ? { clientId: args.input.clientId } : {}),
      metadata: {
        test_status: args.status,
        command: commandLineText,
        command_source: args.command?.source ?? "none",
        exit_code: args.exitCode ?? -1,
        timed_out: args.timedOut,
        pr_gate_satisfied: args.status === "passed",
      },
      body: `# Test Evidence Report

- Status: ${args.status}
- Command: ${commandLineText}
- Command source: ${args.command?.source ?? "none"}
- Working directory: ${args.command?.cwd ?? "(none)"}
- Exit code: ${args.exitCode ?? "(none)"}
- Timed out: ${args.timedOut}
- PR gate satisfied: ${args.status === "passed"}
${args.reason ? `- Reason: ${args.reason}\n` : ""}
${outputBlock("stdout", args.stdout, args.stdoutTruncated)}

${outputBlock("stderr", args.stderr, args.stderrTruncated)}
`,
    });
  }
}
