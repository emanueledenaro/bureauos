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
  public readonly defaultModel?: string;

  constructor(
    id: string,
    private readonly options: { apiKey?: string; defaultModel?: string } = {},
  ) {
    this.id = id;
    this.defaultModel = options.defaultModel;
  }

  async listModels(): Promise<readonly string[]> {
    return ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"];
  }

  async validateCredentials(): Promise<ValidationResult> {
    if (!this.options.apiKey) {
      return { ok: false, reason: "ANTHROPIC_API_KEY is not set" };
    }
    return { ok: true };
  }

  private async client() {
    if (!this.options.apiKey) {
      throw new NotConfiguredError("ANTHROPIC_API_KEY is not set");
    }
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    return new Anthropic({ apiKey: this.options.apiKey });
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    const client = await this.client();
    const response = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      ...(options.system ? { system: options.system } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      messages: [{ role: "user", content: options.prompt }],
    });
    const first = response.content.find((c) => c.type === "text");
    const text = first && "text" in first ? first.text : "";
    return {
      text,
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  async *stream(options: GenerateTextOptions): AsyncIterable<string> {
    const client = await this.client();
    const stream = client.messages.stream({
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      ...(options.system ? { system: options.system } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      messages: [{ role: "user", content: options.prompt }],
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  }
}
