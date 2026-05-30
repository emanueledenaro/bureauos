import { spawn } from "node:child_process";
import { relative, resolve } from "node:path";
import type {
  CodexRuntimeRunner,
  CodexRuntimeRunnerInput,
  CodexRuntimeRunnerResult,
} from "./codex.js";

/**
 * Host-backed Codex runtime runner.
 *
 * This is the first real, host-side execution path for the Development Agent.
 * It runs a conservative, owner-configured list of verification/edit commands
 * through a safe `spawn(..., { shell: false })` boundary (no shell string
 * interpolation, no command chaining) and reports changed files plus command
 * evidence back to {@link CodexRuntimeAdapter}, whose safety policy remains the
 * outer boundary (merge/deploy/destructive-git/secret-path/changed-file-limit
 * blockers still apply on top of whatever this runner returns).
 *
 * The runner is intentionally conservative:
 *
 * - It refuses to run unless at least one command is configured/supplied.
 * - Every command's binary must be on the allow-list; anything else is
 *   refused before any process is spawned.
 * - Commands are never passed through a shell, so `&&`, `;`, `|`, backticks,
 *   and redirection are inert.
 * - Working directories are confined to the workspace root.
 * - It does not commit, push, merge, deploy, or mutate git history itself; it
 *   only runs the allow-listed commands and inspects the resulting diff.
 *
 * The actual model-driven code generation (the "Codex" step) is supplied by
 * the host: a real integration injects an {@link HostCommandExecutor} (and a
 * command list) that drives the chosen Codex CLI/API. The default executor is
 * a plain subprocess runner reused from the proven project-test-runner
 * pattern, which keeps this safe to ship while host wiring matures.
 */

export interface HostCodexCommand {
  /** Executable name (e.g. `pnpm`, `git`, `node`). Must be on the allow-list. */
  command: string;
  /** Arguments passed verbatim; never interpreted by a shell. */
  args?: readonly string[];
  /** Optional cwd, relative to the workspace root. Confined to the workspace. */
  cwd?: string;
  /** Human-readable label used in evidence. */
  label?: string;
}

export interface HostCommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface HostCommandExecution {
  command: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  maxOutputChars: number;
}

export interface HostCommandExecutor {
  run(execution: HostCommandExecution): Promise<HostCommandResult>;
}

/** Lists changed files in the workspace; defaults to `git status --porcelain`. */
export interface WorkspaceDiffInspector {
  changedFiles(workspaceRoot: string): Promise<readonly string[]>;
}

export interface HostCodexRuntimeRunnerOptions {
  /**
   * Commands to run for an edit/test cycle. When empty, the runner refuses to
   * execute and returns a blocked result (conservative by default).
   */
  commands?: readonly HostCodexCommand[];
  /**
   * Allow-list of executable binary names. A command whose `command` is not in
   * this set is refused before spawning. Defaults to a conservative set of
   * read/verify tools.
   */
  allowedCommands?: readonly string[];
  /** Per-command wall-clock timeout. */
  timeoutMs?: number;
  /** Maximum captured stdout/stderr characters per command. */
  maxOutputChars?: number;
  /** Injection seam for tests / host backends. */
  executor?: HostCommandExecutor;
  /** Injection seam for diff inspection. */
  diff?: WorkspaceDiffInspector;
}

const DEFAULT_ALLOWED_COMMANDS = ["pnpm", "npm", "yarn", "node", "git"] as const;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 12_000;

/**
 * Git subcommands this runner will never run, even when `git` is allow-listed.
 * These mirror the adapter's destructive-command boundary so a host cannot use
 * the runner to bypass it via a configured command list.
 */
const BLOCKED_GIT_SUBCOMMANDS = new Set([
  "merge",
  "push",
  "reset",
  "clean",
  "rebase",
  "commit",
  "cherry-pick",
  "revert",
  "checkout",
  "switch",
]);

export class HostCodexRuntimeRunner implements CodexRuntimeRunner {
  private readonly commands: readonly HostCodexCommand[];
  private readonly allowedCommands: ReadonlySet<string>;
  private readonly timeoutMs: number;
  private readonly maxOutputChars: number;
  private readonly executor: HostCommandExecutor;
  private readonly diff: WorkspaceDiffInspector;

  constructor(options: HostCodexRuntimeRunnerOptions = {}) {
    this.commands = options.commands ?? [];
    this.allowedCommands = new Set(options.allowedCommands ?? DEFAULT_ALLOWED_COMMANDS);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    this.executor = options.executor ?? new SubprocessHostCommandExecutor();
    this.diff = options.diff ?? new GitStatusDiffInspector(this.executor);
  }

  async execute(input: CodexRuntimeRunnerInput): Promise<CodexRuntimeRunnerResult> {
    const workspaceRoot = input.context.workspaceRoot;
    const commands = this.resolveCommands(input);

    if (commands.length === 0) {
      return {
        ok: false,
        error: "host Codex runner has no configured commands to execute",
        evidence: "Host Codex runner refused to execute: no commands configured.",
        changedFiles: [],
        commands: [],
      };
    }

    const preflight = this.validateCommands(commands);
    if (preflight) {
      return {
        ok: false,
        error: preflight,
        evidence: `Host Codex runner refused to execute: ${preflight}`,
        changedFiles: [],
        commands: commands.map(commandLine),
      };
    }

    const evidenceLines: string[] = [];
    const ranCommands: string[] = [];
    let ok = true;
    let exitCode = 0;
    let failure: string | undefined;

    for (const command of commands) {
      const cwd = safeWorkspaceCwd(workspaceRoot, command.cwd);
      const line = commandLine(command);
      ranCommands.push(line);
      const result = await this.executor.run({
        command: command.command,
        args: command.args ?? [],
        cwd,
        timeoutMs: this.timeoutMs,
        maxOutputChars: this.maxOutputChars,
      });
      const label = command.label ?? line;
      if (result.timedOut) {
        ok = false;
        exitCode = result.exitCode || 1;
        failure = `command timed out: ${line}`;
        evidenceLines.push(`${label}: timed out`);
        break;
      }
      if (result.exitCode !== 0) {
        ok = false;
        exitCode = result.exitCode;
        failure = `command failed (exit ${result.exitCode}): ${line}`;
        evidenceLines.push(`${label}: failed (exit ${result.exitCode})`);
        break;
      }
      evidenceLines.push(`${label}: passed`);
    }

    const changedFiles = await this.safeChangedFiles(workspaceRoot);

    return {
      ok,
      artifacts: [],
      evidence: evidenceLines.join("\n") || "Host Codex runner produced no command evidence.",
      changedFiles,
      commands: ranCommands,
      exitCode,
      ...(failure ? { error: failure } : {}),
    };
  }

  private resolveCommands(input: CodexRuntimeRunnerInput): readonly HostCodexCommand[] {
    const fromTask = commandsFromInputs(input.task.inputs);
    if (fromTask.length > 0) return fromTask;
    return this.commands;
  }

  private validateCommands(commands: readonly HostCodexCommand[]): string | undefined {
    for (const command of commands) {
      const binary = command.command.trim();
      if (!binary) return "empty command is not allowed";
      if (!this.allowedCommands.has(binary)) {
        return `command is not on the allow-list: ${binary}`;
      }
      if (binary === "git") {
        const subcommand = firstGitSubcommand(command.args ?? []);
        if (subcommand && BLOCKED_GIT_SUBCOMMANDS.has(subcommand)) {
          return `git subcommand is not allowed: ${subcommand}`;
        }
      }
    }
    return undefined;
  }

  private async safeChangedFiles(workspaceRoot: string): Promise<readonly string[]> {
    try {
      return await this.diff.changedFiles(workspaceRoot);
    } catch {
      return [];
    }
  }
}

/**
 * Default subprocess executor. Mirrors the safe `spawn(..., { shell: false })`
 * pattern used by the project test runner: no shell, confined cwd, bounded
 * output, and a hard timeout.
 */
export class SubprocessHostCommandExecutor implements HostCommandExecutor {
  async run(execution: HostCommandExecution): Promise<HostCommandResult> {
    return new Promise((resolveExecution) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const child = spawn(execution.command, [...execution.args], {
        cwd: execution.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, execution.timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout = appendLimited(stdout, chunk, execution.maxOutputChars);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = appendLimited(stderr, chunk, execution.maxOutputChars);
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        resolveExecution({
          command: execution.command,
          exitCode: 1,
          stdout,
          stderr: `${stderr}${stderr ? "\n" : ""}${error.message}`,
          timedOut,
        });
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        resolveExecution({
          command: execution.command,
          exitCode: code ?? 1,
          stdout,
          stderr,
          timedOut,
        });
      });
    });
  }
}

/** Lists changed files via `git status --porcelain` using the shared executor. */
export class GitStatusDiffInspector implements WorkspaceDiffInspector {
  constructor(private readonly executor: HostCommandExecutor) {}

  async changedFiles(workspaceRoot: string): Promise<readonly string[]> {
    const result = await this.executor.run({
      command: "git",
      args: ["status", "--porcelain"],
      cwd: resolve(workspaceRoot),
      timeoutMs: 30_000,
      maxOutputChars: DEFAULT_MAX_OUTPUT_CHARS,
    });
    if (result.exitCode !== 0) return [];
    return parseGitPorcelain(result.stdout);
  }
}

export function parseGitPorcelain(stdout: string): string[] {
  const files: string[] = [];
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) continue;
    // Porcelain v1 format: XY<space>path  (rename uses "orig -> new").
    const pathPart = line.slice(3).trim();
    if (!pathPart) continue;
    const renameIndex = pathPart.indexOf(" -> ");
    const file = renameIndex >= 0 ? pathPart.slice(renameIndex + 4) : pathPart;
    const normalized = file.replace(/^"|"$/g, "").trim();
    if (normalized) files.push(normalized);
  }
  return files;
}

function commandsFromInputs(inputs: Record<string, unknown> | undefined): HostCodexCommand[] {
  const raw = inputs?.["commands"];
  if (!Array.isArray(raw)) return [];
  const commands: HostCodexCommand[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Partial<HostCodexCommand>;
    if (typeof candidate.command !== "string" || !candidate.command.trim()) continue;
    commands.push({
      command: candidate.command.trim(),
      ...(Array.isArray(candidate.args)
        ? { args: candidate.args.filter((arg): arg is string => typeof arg === "string") }
        : {}),
      ...(typeof candidate.cwd === "string" ? { cwd: candidate.cwd } : {}),
      ...(typeof candidate.label === "string" ? { label: candidate.label } : {}),
    });
  }
  return commands;
}

function firstGitSubcommand(args: readonly string[]): string | undefined {
  for (const arg of args) {
    if (arg.startsWith("-")) continue;
    return arg.toLowerCase();
  }
  return undefined;
}

function commandLine(command: HostCodexCommand): string {
  return [command.command, ...(command.args ?? [])].join(" ");
}

function safeWorkspaceCwd(workspaceRoot: string, cwd?: string): string {
  const root = resolve(workspaceRoot);
  const resolved = resolve(root, cwd ?? ".");
  const rel = relative(root, resolved);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error(`command cwd escapes workspace: ${cwd}`);
  }
  return resolved;
}

function appendLimited(current: string, chunk: Buffer | string, maxOutputChars: number): string {
  const next = current + chunk.toString();
  return next.length <= maxOutputChars ? next : next.slice(0, maxOutputChars);
}
