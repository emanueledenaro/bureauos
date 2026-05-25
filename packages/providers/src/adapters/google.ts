import type {
  GenerateTextOptions,
  GenerateTextResult,
  ProviderAdapter,
  ValidationResult,
} from "../types.js";
import { NotConfiguredError } from "./openai.js";
import type { ProviderFetch } from "./openai-compatible.js";

const GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

interface GoogleGenerateResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: unknown }>;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

function endpoint(
  baseUrl: string,
  model: string,
  method: "generateContent" | "streamGenerateContent",
  apiKey: string,
): string {
  const root = baseUrl.replace(/\/+$/, "");
  return `${root}/models/${encodeURIComponent(model)}:${method}?key=${encodeURIComponent(apiKey)}${
    method === "streamGenerateContent" ? "&alt=sse" : ""
  }`;
}

function requestBody(options: GenerateTextOptions): Record<string, unknown> {
  return {
    contents: [
      {
        role: "user",
        parts: [{ text: options.prompt }],
      },
    ],
    ...(options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
    generationConfig: {
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { maxOutputTokens: options.maxTokens } : {}),
    },
  };
}

function readText(response: GoogleGenerateResponse): string {
  return (
    response.candidates?.[0]?.content?.parts
      ?.map((part) => (typeof part.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("") ?? ""
  );
}

function parseResponse(response: GoogleGenerateResponse, model: string): GenerateTextResult {
  const text = readText(response);
  if (!text) throw new Error("Google Gemini returned no content");
  return {
    text,
    model,
    usage: {
      ...(response.usageMetadata?.promptTokenCount !== undefined
        ? { inputTokens: response.usageMetadata.promptTokenCount }
        : {}),
      ...(response.usageMetadata?.candidatesTokenCount !== undefined
        ? { outputTokens: response.usageMetadata.candidatesTokenCount }
        : {}),
    },
  };
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  throw new Error(`Google Gemini failed with HTTP ${response.status}${body ? `: ${body}` : ""}`);
}

function parseSseText(value: string): string[] {
  const chunks: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      const delta = readText(JSON.parse(raw) as GoogleGenerateResponse);
      if (delta) chunks.push(delta);
    } catch {
      // Ignore malformed SSE frames; empty streams are handled by callers.
    }
  }
  return chunks;
}

export class GoogleAdapter implements ProviderAdapter {
  public readonly id: string;
  public readonly type = "google" as const;
  public readonly name = "Google Gemini";
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
    return [
      "gemini-3.5-flash",
      "gemini-3.1-pro-preview",
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ];
  }

  async validateCredentials(): Promise<ValidationResult> {
    if (!this.options.apiKey) {
      return { ok: false, reason: "GOOGLE_API_KEY is not set" };
    }
    return { ok: true };
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    if (!this.options.apiKey) throw new NotConfiguredError("GOOGLE_API_KEY is not set");
    const fetchImpl = this.options.fetch ?? fetch;
    const response = await fetchImpl(
      endpoint(
        this.options.baseUrl ?? GOOGLE_BASE_URL,
        options.model,
        "generateContent",
        this.options.apiKey,
      ),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody(options)),
      },
    );
    await assertOk(response);
    return parseResponse((await response.json()) as GoogleGenerateResponse, options.model);
  }

  async *stream(options: GenerateTextOptions): AsyncIterable<string> {
    if (!this.options.apiKey) throw new NotConfiguredError("GOOGLE_API_KEY is not set");
    const fetchImpl = this.options.fetch ?? fetch;
    const response = await fetchImpl(
      endpoint(
        this.options.baseUrl ?? GOOGLE_BASE_URL,
        options.model,
        "streamGenerateContent",
        this.options.apiKey,
      ),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody(options)),
      },
    );
    await assertOk(response);
    for (const chunk of parseSseText(await response.text())) yield chunk;
  }
}
