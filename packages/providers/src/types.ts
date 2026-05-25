/**
 * Provider and runtime adapter contracts.
 *
 * BureauOS is model-agnostic: every model provider plugs in through the same
 * `ProviderAdapter` contract; every execution runtime (Codex, Claude Code,
 * Gemini CLI, etc.) plugs in through `RuntimeAdapter`. The provider router
 * (in `./router.ts`) selects the owner-approved provider route per agent role.
 */

export type ProviderType =
  | "openai-codex"
  | "openai"
  | "anthropic"
  | "google"
  | "local"
  | "openrouter"
  | "custom";
export type RuntimeType = "codex" | "claude-code" | "gemini-cli" | "custom";

export type ProviderBudgetTier = "free" | "low" | "standard" | "high" | "premium";

export interface ProviderRouteProfile {
  model?: string;
  capabilities: readonly string[];
  budgetTier: ProviderBudgetTier;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export interface GenerateTextOptions {
  model: string;
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GenerateTextResult {
  text: string;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ProviderAdapter {
  readonly id: string;
  readonly type: ProviderType;
  readonly name: string;
  readonly defaultModel?: string;
  listModels(): Promise<readonly string[]>;
  validateCredentials(): Promise<ValidationResult>;
  generateText(options: GenerateTextOptions): Promise<GenerateTextResult>;
  stream(options: GenerateTextOptions): AsyncIterable<string>;
}

export interface RuntimeContext {
  workspaceRoot: string;
  runId: string;
  projectId?: string;
  clientId?: string;
}

export interface RuntimeTask {
  intent: string;
  scope: string;
  inputs?: Record<string, unknown>;
}

export interface RuntimeResult {
  ok: boolean;
  artifacts: readonly string[];
  evidence?: string;
  error?: string;
}

export interface RuntimeAdapter {
  readonly id: string;
  readonly type: RuntimeType;
  canExecute(capability: string): boolean;
  prepare(context: RuntimeContext): Promise<void>;
  execute(task: RuntimeTask): Promise<RuntimeResult>;
}
