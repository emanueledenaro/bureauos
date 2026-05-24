import type {
  GenerateTextOptions,
  GenerateTextResult,
  ProviderAdapter,
  ValidationResult,
} from "../types.js";

export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotConfiguredError";
  }
}

/**
 * OpenAI provider adapter.
 *
 * Uses the official `openai` SDK when credentials are present. The kernel
 * never embeds the key; it is read from `options.apiKey` (typically
 * sourced from the env var by the caller) at construction time.
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

  private async client() {
    if (!this.options.apiKey) {
      throw new NotConfiguredError("OPENAI_API_KEY is not set");
    }
    const { default: OpenAI } = await import("openai");
    return new OpenAI({
      apiKey: this.options.apiKey,
      ...(this.options.baseUrl ? { baseURL: this.options.baseUrl } : {}),
    });
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    const client = await this.client();
    const response = await client.chat.completions.create({
      model: options.model,
      messages: [
        ...(options.system ? [{ role: "system" as const, content: options.system }] : []),
        { role: "user" as const, content: options.prompt },
      ],
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
    });
    const choice = response.choices[0];
    if (!choice?.message?.content) {
      throw new Error("OpenAI returned no content");
    }
    return {
      text: choice.message.content,
      model: response.model,
      usage: {
        ...(response.usage?.prompt_tokens !== undefined
          ? { inputTokens: response.usage.prompt_tokens }
          : {}),
        ...(response.usage?.completion_tokens !== undefined
          ? { outputTokens: response.usage.completion_tokens }
          : {}),
      },
    };
  }

  async *stream(options: GenerateTextOptions): AsyncIterable<string> {
    const client = await this.client();
    const stream = await client.chat.completions.create({
      model: options.model,
      messages: [
        ...(options.system ? [{ role: "system" as const, content: options.system }] : []),
        { role: "user" as const, content: options.prompt },
      ],
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      stream: true,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
