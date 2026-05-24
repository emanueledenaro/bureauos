import type {
  GenerateTextOptions,
  GenerateTextResult,
  ProviderAdapter,
  ValidationResult,
} from "../types.js";
import { NotConfiguredError } from "./openai.js";

export class AnthropicAdapter implements ProviderAdapter {
  public readonly id: string;
  public readonly type = "anthropic" as const;
  public readonly name = "Anthropic";

  constructor(
    id: string,
    private readonly options: { apiKey?: string; defaultModel?: string } = {},
  ) {
    this.id = id;
  }

  async listModels(): Promise<readonly string[]> {
    return ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"];
  }

  async validateCredentials(): Promise<ValidationResult> {
    if (!this.options.apiKey) {
      return { ok: false, reason: "ANTHROPIC_API_KEY is not set" };
    }
    return { ok: true };
  }

  async generateText(_options: GenerateTextOptions): Promise<GenerateTextResult> {
    throw new NotConfiguredError("Anthropic adapter is a stub. BACKLOG Phase 2.");
  }

  async *stream(_options: GenerateTextOptions): AsyncIterable<string> {
    throw new NotConfiguredError("Anthropic adapter is a stub. BACKLOG Phase 2.");
  }
}
