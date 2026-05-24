import type {
  GenerateTextOptions,
  GenerateTextResult,
  ProviderAdapter,
  ValidationResult,
} from "../types.js";

/**
 * OpenAI provider adapter.
 *
 * Stub implementation. The real SDK wiring lands in Phase 2 of the backlog.
 * Until then, `generateText` and `stream` throw a `NotConfiguredError` that
 * the run engine treats as "agent has no provider — escalate".
 */
export class OpenAIAdapter implements ProviderAdapter {
  public readonly id: string;
  public readonly type = "openai" as const;
  public readonly name = "OpenAI";

  constructor(
    id: string,
    private readonly options: { apiKey?: string; baseUrl?: string; defaultModel?: string } = {},
  ) {
    this.id = id;
  }

  async listModels(): Promise<readonly string[]> {
    return ["gpt-5", "gpt-4o", "gpt-4o-mini", "o3-mini"];
  }

  async validateCredentials(): Promise<ValidationResult> {
    if (!this.options.apiKey) {
      return { ok: false, reason: "OPENAI_API_KEY is not set" };
    }
    return { ok: true };
  }

  async generateText(_options: GenerateTextOptions): Promise<GenerateTextResult> {
    throw new NotConfiguredError(
      "OpenAI adapter is a stub. Configure credentials and add SDK integration (BACKLOG Phase 2).",
    );
  }

  async *stream(_options: GenerateTextOptions): AsyncIterable<string> {
    throw new NotConfiguredError(
      "OpenAI adapter is a stub. Configure credentials and add SDK integration (BACKLOG Phase 2).",
    );
  }
}

export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotConfiguredError";
  }
}
