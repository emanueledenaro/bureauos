import type {
  GenerateTextOptions,
  GenerateTextResult,
  ProviderAdapter,
  ValidationResult,
} from "../types.js";
import { NotConfiguredError } from "./openai.js";

export class GoogleAdapter implements ProviderAdapter {
  public readonly id: string;
  public readonly type = "google" as const;
  public readonly name = "Google Gemini";
  public readonly defaultModel?: string;

  constructor(
    id: string,
    private readonly options: { apiKey?: string; defaultModel?: string } = {},
  ) {
    this.id = id;
    this.defaultModel = options.defaultModel;
  }

  async listModels(): Promise<readonly string[]> {
    return ["gemini-2.5-pro", "gemini-2.5-flash"];
  }

  async validateCredentials(): Promise<ValidationResult> {
    if (!this.options.apiKey) {
      return { ok: false, reason: "GOOGLE_API_KEY is not set" };
    }
    return { ok: true };
  }

  async generateText(_options: GenerateTextOptions): Promise<GenerateTextResult> {
    throw new NotConfiguredError("Google adapter is a stub. BACKLOG Phase 2.");
  }

  async *stream(_options: GenerateTextOptions): AsyncIterable<string> {
    throw new NotConfiguredError("Google adapter is a stub. BACKLOG Phase 2.");
  }
}
