import type {
  GenerateTextOptions,
  GenerateTextResult,
  ProviderAdapter,
  ValidationResult,
} from "../types.js";
import { NotConfiguredError } from "./openai.js";

/**
 * Local model adapter. Targets Ollama or any OpenAI-compatible local endpoint.
 */
export class LocalAdapter implements ProviderAdapter {
  public readonly id: string;
  public readonly type = "local" as const;
  public readonly name = "Local Model";

  constructor(
    id: string,
    private readonly options: { baseUrl?: string; defaultModel?: string } = {},
  ) {
    this.id = id;
  }

  async listModels(): Promise<readonly string[]> {
    return [];
  }

  async validateCredentials(): Promise<ValidationResult> {
    if (!this.options.baseUrl) {
      return {
        ok: false,
        reason: "local adapter requires a baseUrl (e.g. http://localhost:11434)",
      };
    }
    return { ok: true };
  }

  async generateText(_options: GenerateTextOptions): Promise<GenerateTextResult> {
    throw new NotConfiguredError("Local adapter is a stub. BACKLOG Phase 2.");
  }

  async *stream(_options: GenerateTextOptions): AsyncIterable<string> {
    throw new NotConfiguredError("Local adapter is a stub. BACKLOG Phase 2.");
  }
}
