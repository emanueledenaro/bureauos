import {
  CodexRuntimeAdapter,
  HostCodexRuntimeRunner,
  type HostCodexCommand,
  type HostCommandExecutor,
  type RuntimeAdapter,
  type WorkspaceDiffInspector,
} from "@bureauos/providers";
import type { BureauConfig } from "../config/schema.js";

/**
 * Build a development-execution runtime adapter from workspace config.
 *
 * Returns `undefined` unless `runtime.codex.enabled` is true, so the Development
 * Agent stays template-only by default. When enabled, this wires the real
 * host-backed {@link HostCodexRuntimeRunner} behind the existing
 * {@link CodexRuntimeAdapter} safety boundary. The adapter remains the outer
 * policy gate (merge/deploy/destructive-git/secret-path/changed-file-limit
 * blockers), and the runner enforces its own command allow-list and confined,
 * shell-less subprocess execution.
 *
 * Tests and host backends can inject `executor`/`diff` to drive a fake or a
 * real Codex CLI/API integration without changing the safety boundary.
 */
export interface BuildCodexRuntimeOptions {
  executor?: HostCommandExecutor;
  diff?: WorkspaceDiffInspector;
  /** Adapter id; defaults to `codex-host`. */
  id?: string;
}

export function buildCodexRuntimeFromConfig(
  config: BureauConfig | undefined,
  options: BuildCodexRuntimeOptions = {},
): RuntimeAdapter | undefined {
  const codex = config?.runtime?.codex;
  if (!codex || !codex.enabled) return undefined;

  // The codegen tool's own binary must be on the allow-list, so add it
  // automatically when codegen is configured (the owner shouldn't have to
  // remember to list it twice).
  const codegenBinary = codex.codegen_command[0];
  const allowedCommands =
    codegenBinary && !codex.allowed_commands.includes(codegenBinary)
      ? [...codex.allowed_commands, codegenBinary]
      : codex.allowed_commands;

  const runner = new HostCodexRuntimeRunner({
    commands: codex.commands.map(toHostCommand),
    codegenCommand: codex.codegen_command,
    allowedCommands,
    timeoutMs: codex.timeout_ms,
    maxOutputChars: codex.max_output_chars,
    ...(options.executor ? { executor: options.executor } : {}),
    ...(options.diff ? { diff: options.diff } : {}),
  });

  return new CodexRuntimeAdapter(options.id ?? "codex-host", {
    runner,
    maxChangedFiles: codex.max_changed_files,
  });
}

function toHostCommand(command: {
  command: string;
  args: readonly string[];
  cwd?: string;
  label?: string;
}): HostCodexCommand {
  return {
    command: command.command,
    args: command.args,
    ...(command.cwd !== undefined ? { cwd: command.cwd } : {}),
    ...(command.label !== undefined ? { label: command.label } : {}),
  };
}
