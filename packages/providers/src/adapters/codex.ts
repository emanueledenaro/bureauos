import type {
  RuntimeAdapter,
  RuntimeContext,
  RuntimeResult,
  RuntimeTask,
} from "../types.js";

/**
 * Codex runtime adapter.
 *
 * Treated as a development-execution capability rather than a generic model
 * provider. Phase 8 wires the development agent to this runtime.
 */
export class CodexRuntimeAdapter implements RuntimeAdapter {
  public readonly id: string;
  public readonly type = "codex" as const;

  constructor(id: string) {
    this.id = id;
  }

  canExecute(capability: string): boolean {
    return ["edit_code", "run_tests", "open_pr"].includes(capability);
  }

  async prepare(_context: RuntimeContext): Promise<void> {
    // No-op until the real Codex runtime is wired (BACKLOG Phase 8).
  }

  async execute(_task: RuntimeTask): Promise<RuntimeResult> {
    return {
      ok: false,
      artifacts: [],
      error: "Codex runtime adapter is a stub. BACKLOG Phase 8.",
    };
  }
}
