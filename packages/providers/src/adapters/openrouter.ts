import type {
  GenerateTextOptions,
  GenerateTextResult,
  ProviderAdapter,
  ValidationResult,
} from "../types.js";
import { NotConfiguredError } from "./openai.js";
import { OpenAICompatibleChatAdapter, type ProviderFetch } from "./openai-compatible.js";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api";
const OPENROUTER_MODELS = ["openai/gpt-5", "anthropic/claude-sonnet-4.6"] as const;

export class OpenRouterAdapter implements ProviderAdapter {
  public readonly id: string;
  public readonly type = "openrouter" as const;
  public readonly name = "OpenRouter";
  public readonly defaultModel?: string;

  constructor(
    id: string,
    private readonly options: {
      apiKey?: string;
      baseUrl?: string;
      defaultModel?: string;
      fetch?: ProviderFetch;
    } = {},
  ) {
    this.id = id;
    this.defaultModel = options.defaultModel;
  }

  async listModels(): Promise<readonly string[]> {
    return this.client().listModels(OPENROUTER_MODELS);
  }

  async validateCredentials(): Promise<ValidationResult> {
    if (!this.options.apiKey) {
      return { ok: false, reason: "OPENROUTER_API_KEY is not set" };
    }
    return { ok: true };
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    if (!this.options.apiKey) throw new NotConfiguredError("OPENROUTER_API_KEY is not set");
    return this.client().generateText(options);
  }

  async *stream(options: GenerateTextOptions): AsyncIterable<string> {
    if (!this.options.apiKey) throw new NotConfiguredError("OPENROUTER_API_KEY is not set");
    yield* this.client().stream(options);
  }

  private client(): OpenAICompatibleChatAdapter {
    return new OpenAICompatibleChatAdapter("OpenRouter", {
      apiKey: this.options.apiKey,
      baseUrl: this.options.baseUrl ?? OPENROUTER_BASE_URL,
      fetch: this.options.fetch,
      headers: {
        "HTTP-Referer": "https://github.com/emanueledenaro/bureauos",
        "X-Title": "BureauOS",
      },
    });
  }
}
