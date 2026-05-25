import type {
  GenerateTextOptions,
  GenerateTextResult,
  ProviderAdapter,
  ValidationResult,
} from "../types.js";
import { NotConfiguredError } from "./openai.js";
import { OpenAICompatibleChatAdapter, type ProviderFetch } from "./openai-compatible.js";

const LOCAL_MODELS = ["local-model"] as const;

/**
 * Local model adapter. Targets Ollama or any OpenAI-compatible local endpoint.
 */
export class LocalAdapter implements ProviderAdapter {
  public readonly id: string;
  public readonly type = "local" as const;
  public readonly name = "Local Model";
  public readonly defaultModel?: string;

  constructor(
    id: string,
    private readonly options: {
      baseUrl?: string;
      apiKey?: string;
      defaultModel?: string;
      fetch?: ProviderFetch;
    } = {},
  ) {
    this.id = id;
    this.defaultModel = options.defaultModel;
  }

  async listModels(): Promise<readonly string[]> {
    return this.client().listModels(this.defaultModel ? [this.defaultModel] : LOCAL_MODELS);
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

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    if (!this.options.baseUrl) throw new NotConfiguredError("local adapter requires a baseUrl");
    return this.client().generateText(options);
  }

  async *stream(options: GenerateTextOptions): AsyncIterable<string> {
    if (!this.options.baseUrl) throw new NotConfiguredError("local adapter requires a baseUrl");
    yield* this.client().stream(options);
  }

  private client(): OpenAICompatibleChatAdapter {
    return new OpenAICompatibleChatAdapter("Local model", {
      apiKey: this.options.apiKey,
      baseUrl: this.options.baseUrl,
      fetch: this.options.fetch,
    });
  }
}
