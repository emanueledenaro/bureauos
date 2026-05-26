import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { RuntimeAdapter, RuntimeContext, RuntimeResult, RuntimeTask } from "../types.js";

/**
 * Codex runtime adapter.
 *
 * Treated as a development-execution capability rather than a generic model
 * provider. The adapter owns validation and safety policy; an injected runner
 * owns the host-specific Codex CLI/API execution.
 */
export interface CodexRuntimeRunnerInput {
  context: RuntimeContext;
  task: RuntimeTask;
}

export interface CodexRuntimeRunnerResult {
  ok: boolean;
  artifacts?: readonly string[];
  evidence?: string;
  changedFiles?: readonly string[];
  commands?: readonly string[];
  error?: string;
  exitCode?: number;
}

export interface CodexRuntimeRunner {
  execute(input: CodexRuntimeRunnerInput): Promise<CodexRuntimeRunnerResult>;
}

export interface CodexRuntimeAdapterOptions {
  runner?: CodexRuntimeRunner;
  allowedCapabilities?: readonly string[];
  maxChangedFiles?: number;
}

export class CodexRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexRuntimeError";
  }
}

const DEFAULT_CAPABILITIES = ["read_repo", "edit_code", "run_tests", "open_pr"] as const;
const DEFAULT_MAX_CHANGED_FILES = 25;

const DANGEROUS_COMMANDS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bgit\s+merge\b/i, reason: "merge operations are not allowed" },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: "destructive git reset is not allowed" },
  { pattern: /\bgit\s+clean\s+-[^\s]*f/i, reason: "destructive git clean is not allowed" },
  { pattern: /\bgit\s+push\b.*\s--force(?:\s|$)/i, reason: "force push is not allowed" },
  {
    pattern: /\brm\s+-rf\s+(?:\/|\.{1,2}(?:\s|$))/i,
    reason: "destructive file removal is not allowed",
  },
  { pattern: /\bvercel\b.*\s--prod(?:\s|$)/i, reason: "production deploy is not allowed" },
  {
    pattern: /\b(drop\s+database|truncate\s+table)\b/i,
    reason: "destructive data action is not allowed",
  },
];

const DANGEROUS_SCOPE: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bmerge\s+(?:the\s+)?(?:pull request|pr)\b/i,
    reason: "merge operations are not allowed",
  },
  { pattern: /\bdeploy\s+(?:to\s+)?production\b/i, reason: "production deploy is not allowed" },
  {
    pattern: /\b(?:edit|modify|write|touch|update)\b[^.\n]*\.env\b/i,
    reason: ".env changes are not allowed",
  },
];

const SECRET_FILE_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.pub)?$/i,
  /(^|\/).*?(?:secret|credential|private[-_]?key).*?/i,
];

export class CodexRuntimeAdapter implements RuntimeAdapter {
  public readonly id: string;
  public readonly type = "codex" as const;
  private readonly runner: CodexRuntimeRunner;
  private readonly allowedCapabilities: Set<string>;
  private readonly maxChangedFiles: number;
  private preparedContext?: RuntimeContext;

  constructor(id: string, options: CodexRuntimeAdapterOptions = {}) {
    this.id = id;
    this.runner = options.runner ?? new UnconfiguredCodexRuntimeRunner();
    this.allowedCapabilities = new Set(options.allowedCapabilities ?? DEFAULT_CAPABILITIES);
    this.maxChangedFiles = options.maxChangedFiles ?? DEFAULT_MAX_CHANGED_FILES;
  }

  canExecute(capability: string): boolean {
    return this.allowedCapabilities.has(capability);
  }

  async prepare(context: RuntimeContext): Promise<void> {
    const workspaceRoot = context.workspaceRoot.trim();
    if (!workspaceRoot) throw new CodexRuntimeError("workspaceRoot is required");
    if (!context.runId.trim()) throw new CodexRuntimeError("runId is required");

    const resolvedRoot = resolve(workspaceRoot);
    let workspaceStats;
    try {
      workspaceStats = await stat(resolvedRoot);
    } catch {
      throw new CodexRuntimeError(`workspaceRoot does not exist: ${resolvedRoot}`);
    }
    if (!workspaceStats.isDirectory()) {
      throw new CodexRuntimeError(`workspaceRoot is not a directory: ${resolvedRoot}`);
    }

    this.preparedContext = {
      ...context,
      workspaceRoot: resolvedRoot,
      runId: context.runId.trim(),
    };
  }

  async execute(task: RuntimeTask): Promise<RuntimeResult> {
    if (!this.preparedContext) {
      return this.failure("Codex runtime was not prepared before execute().");
    }

    const preflightBlockers = this.safetyBlockers(task);
    if (preflightBlockers.length > 0) {
      return this.blocked(preflightBlockers, {
        commands: commandsFrom(task.inputs),
        changedFiles: changedFilesFrom(task.inputs),
      });
    }

    try {
      const result = await this.runner.execute({ context: this.preparedContext, task });
      const runnerBlockers = this.safetyBlockers(task, result);
      if (runnerBlockers.length > 0) {
        return this.blocked(runnerBlockers, {
          artifacts: result.artifacts,
          commands: result.commands,
          changedFiles: result.changedFiles,
        });
      }

      const artifacts = result.artifacts ?? [];
      const changedFiles = result.changedFiles ?? [];
      const commands = result.commands ?? [];
      return {
        ok: result.ok,
        artifacts,
        evidence:
          result.evidence ??
          (result.ok
            ? `Codex runtime completed ${task.intent}.`
            : `Codex runtime failed ${task.intent}.`),
        changedFiles,
        commands,
        ...(result.error ? { error: result.error } : {}),
        ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failure(message);
    }
  }

  private safetyBlockers(
    task: RuntimeTask,
    result: Partial<CodexRuntimeRunnerResult> = {},
  ): string[] {
    const blockers = new Set<string>();
    if (task.capability && !this.canExecute(task.capability)) {
      blockers.add(`capability is not allowed: ${task.capability}`);
    }
    if (!task.intent.trim()) blockers.add("intent is required");
    if (!task.scope.trim()) blockers.add("scope is required");

    const scopeText = `${task.intent}\n${task.scope}`;
    for (const rule of DANGEROUS_SCOPE) {
      if (rule.pattern.test(scopeText)) blockers.add(rule.reason);
    }

    for (const command of [...commandsFrom(task.inputs), ...(result.commands ?? [])]) {
      for (const rule of DANGEROUS_COMMANDS) {
        if (rule.pattern.test(command)) blockers.add(rule.reason);
      }
      if (touchesSecretPath(command)) blockers.add("secret or credential paths are not allowed");
    }

    const changedFiles = [...changedFilesFrom(task.inputs), ...(result.changedFiles ?? [])];
    if (changedFiles.length > this.maxChangedFiles) {
      blockers.add(`changed file count exceeds runtime limit: ${changedFiles.length}`);
    }
    for (const file of changedFiles) {
      if (isSecretLikePath(file)) blockers.add(`secret-looking file is not allowed: ${file}`);
    }

    return [...blockers];
  }

  private blocked(
    blockers: readonly string[],
    details: {
      artifacts?: readonly string[];
      commands?: readonly string[];
      changedFiles?: readonly string[];
    } = {},
  ): RuntimeResult {
    const message = blockers.join("; ");
    return {
      ok: false,
      blocked: true,
      blockers,
      artifacts: details.artifacts ?? [],
      evidence: `Blocked by Codex runtime safety policy: ${message}`,
      error: message,
      changedFiles: details.changedFiles ?? [],
      commands: details.commands ?? [],
    };
  }

  private failure(message: string): RuntimeResult {
    return {
      ok: false,
      artifacts: [],
      evidence: `Codex runtime failed: ${message}`,
      error: message,
    };
  }
}

class UnconfiguredCodexRuntimeRunner implements CodexRuntimeRunner {
  async execute(): Promise<CodexRuntimeRunnerResult> {
    return {
      ok: false,
      error: "Codex runtime runner is not configured.",
      evidence: "Codex runtime runner is not configured.",
    };
  }
}

function commandsFrom(inputs: Record<string, unknown> | undefined): string[] {
  return stringArray(inputs?.["commands"]);
}

function changedFilesFrom(inputs: Record<string, unknown> | undefined): string[] {
  return stringArray(inputs?.["changedFiles"]);
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function touchesSecretPath(command: string): boolean {
  return command
    .split(/\s+/)
    .some((part) => (part.includes("/") || part.startsWith(".")) && isSecretLikePath(part));
}

function isSecretLikePath(path: string): boolean {
  const normalized = path.trim().replace(/^["']|["']$/g, "");
  if (!normalized) return false;
  if (/\.(?:example|sample|template)$/i.test(normalized)) return false;
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}
