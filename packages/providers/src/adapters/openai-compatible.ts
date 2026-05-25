import type { GenerateTextOptions, GenerateTextResult } from "../types.js";
import { NotConfiguredError } from "./openai.js";

export type ProviderFetch = typeof fetch;

export interface OpenAICompatibleOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  fetch?: ProviderFetch;
  headers?: Record<string, string>;
}

interface ChatCompletionChoice {
  message?: { content?: unknown };
  delta?: { content?: unknown };
}

interface ChatCompletionResponse {
  model?: string;
  choices?: ChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface ModelsResponse {
  data?: Array<{ id?: unknown }>;
  models?: Array<{ name?: unknown; id?: unknown }>;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function endpoint(baseUrl: string, path: string): string {
  const root = normalizeBaseUrl(baseUrl);
  if (root.endsWith("/v1") && path.startsWith("/v1/")) return `${root}${path.slice(3)}`;
  return `${root}${path}`;
}

function messages(
  options: GenerateTextOptions,
): Array<{ role: "system" | "user"; content: string }> {
  return [
    ...(options.system ? [{ role: "system" as const, content: options.system }] : []),
    { role: "user", content: options.prompt },
  ];
}

function requestBody(options: GenerateTextOptions, stream = false): Record<string, unknown> {
  return {
    model: options.model,
    messages: messages(options),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
    ...(stream ? { stream: true } : {}),
  };
}

function headers(options: OpenAICompatibleOptions): Headers {
  const out = new Headers(options.headers ?? {});
  out.set("content-type", "application/json");
  if (options.apiKey) out.set("authorization", `Bearer ${options.apiKey}`);
  return out;
}

async function assertOk(response: Response, label: string): Promise<void> {
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  throw new Error(`${label} failed with HTTP ${response.status}${body ? `: ${body}` : ""}`);
}

function readText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(readText).filter(Boolean).join("");
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  if (typeof item["text"] === "string") return item["text"];
  if (typeof item["content"] === "string") return item["content"];
  if (item["content"]) return readText(item["content"]);
  return "";
}

function parseCompletion(
  payload: ChatCompletionResponse,
  fallbackModel: string,
): GenerateTextResult {
  const text = readText(payload.choices?.[0]?.message?.content);
  if (!text) throw new Error("OpenAI-compatible provider returned no content");
  return {
    text,
    model: payload.model ?? fallbackModel,
    usage: {
      ...(payload.usage?.prompt_tokens !== undefined
        ? { inputTokens: payload.usage.prompt_tokens }
        : {}),
      ...(payload.usage?.completion_tokens !== undefined
        ? { outputTokens: payload.usage.completion_tokens }
        : {}),
    },
  };
}

function parseSseDelta(raw: string): string {
  if (!raw || raw === "[DONE]") return "";
  try {
    const payload = JSON.parse(raw) as ChatCompletionResponse;
    return readText(payload.choices?.[0]?.delta?.content);
  } catch {
    return "";
  }
}

async function* readSseDeltas(response: Response): AsyncIterable<string> {
  const text = await response.text();
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    const delta = parseSseDelta(line.slice(6).trim());
    if (delta) yield delta;
  }
}

export class OpenAICompatibleChatAdapter {
  constructor(
    private readonly label: string,
    private readonly options: OpenAICompatibleOptions,
  ) {}

  async listModels(fallbackModels: readonly string[]): Promise<readonly string[]> {
    if (!this.options.baseUrl) return fallbackModels;
    const fetchImpl = this.options.fetch ?? fetch;
    try {
      const response = await fetchImpl(endpoint(this.options.baseUrl, "/v1/models"), {
        headers: headers(this.options),
      });
      if (!response.ok) return fallbackModels;
      const payload = (await response.json()) as ModelsResponse;
      const models =
        payload.data
          ?.map((model) => model.id)
          .filter((id): id is string => typeof id === "string" && Boolean(id)) ??
        payload.models
          ?.map((model) => model.id ?? model.name)
          .filter((id): id is string => typeof id === "string" && Boolean(id)) ??
        [];
      return models.length > 0 ? models : fallbackModels;
    } catch {
      return fallbackModels;
    }
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    if (!this.options.baseUrl) throw new NotConfiguredError(`${this.label} base URL is not set`);
    const fetchImpl = this.options.fetch ?? fetch;
    const response = await fetchImpl(endpoint(this.options.baseUrl, "/v1/chat/completions"), {
      method: "POST",
      headers: headers(this.options),
      body: JSON.stringify(requestBody(options)),
    });
    await assertOk(response, this.label);
    return parseCompletion((await response.json()) as ChatCompletionResponse, options.model);
  }

  async *stream(options: GenerateTextOptions): AsyncIterable<string> {
    if (!this.options.baseUrl) throw new NotConfiguredError(`${this.label} base URL is not set`);
    const fetchImpl = this.options.fetch ?? fetch;
    const response = await fetchImpl(endpoint(this.options.baseUrl, "/v1/chat/completions"), {
      method: "POST",
      headers: headers(this.options),
      body: JSON.stringify(requestBody(options, true)),
    });
    await assertOk(response, this.label);
    yield* readSseDeltas(response);
  }
}
