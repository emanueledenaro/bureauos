import type {
  GenerateTextOptions,
  GenerateTextResult,
  ProviderAdapter,
  ValidationResult,
} from "../types.js";
import {
  refreshOpenAICodexToken,
  type OpenAICodexOAuthFetch,
  type OpenAICodexToken,
} from "../openai-codex-oauth.js";
import {
  listOpenAICodexOAuthModelIDs,
  normalizeOpenAICodexOAuthModel,
  OPENAI_CODEX_OAUTH_DEFAULT_MODEL,
} from "../openai-codex-models.js";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const CHATGPT_ACCOUNT_CLAIM = "https://api.openai.com/auth";

export class OpenAICodexOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAICodexOAuthError";
  }
}

export interface OpenAICodexOAuthOptions {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  defaultModel?: string;
  fetch?: OpenAICodexOAuthFetch;
  onTokenRefresh?: (token: OpenAICodexToken) => Promise<void>;
}

interface ResponsesApiRequest {
  model: string;
  input: Array<{
    type: "message";
    role: "user";
    content: Array<{ type: "input_text"; text: string }>;
  }>;
  stream: true;
  store: false;
  instructions: string;
  include: string[];
  reasoning: { effort: "medium"; summary: "auto" };
  text: { verbosity: "medium" };
}

interface SseParseResult {
  text: string;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const [, payload] = token.split(".");
  if (!payload) return undefined;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

export function extractChatGPTAccountId(accessToken: string): string | undefined {
  const payload = decodeJwtPayload(accessToken);
  const rootAccountId = payload?.["chatgpt_account_id"];
  if (typeof rootAccountId === "string" && rootAccountId) return rootAccountId;
  const authClaim = payload?.[CHATGPT_ACCOUNT_CLAIM];
  if (!authClaim || typeof authClaim !== "object") return undefined;
  const accountId = (authClaim as Record<string, unknown>)["chatgpt_account_id"];
  return typeof accountId === "string" && accountId ? accountId : undefined;
}

function isExpired(expiresAt?: string): boolean {
  if (!expiresAt) return false;
  const timestamp = Date.parse(expiresAt);
  if (!Number.isFinite(timestamp)) return false;
  return timestamp <= Date.now() + 60_000;
}

const DEFAULT_CODEX_INSTRUCTIONS =
  "You are BureauOS Supreme Coordinator. Answer clearly, use the supplied context, and never claim actions were completed unless they were actually completed.";

function buildRequestBody(options: GenerateTextOptions): ResponsesApiRequest {
  const instructions = options.system?.trim() || DEFAULT_CODEX_INSTRUCTIONS;
  return {
    model: normalizeOpenAICodexOAuthModel(options.model),
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: options.prompt }],
      },
    ],
    stream: true,
    store: false,
    instructions,
    include: ["reasoning.encrypted_content"],
    reasoning: { effort: "medium", summary: "auto" },
    text: { verbosity: "medium" },
  };
}

function headers(accessToken: string, accountId: string): Headers {
  const out = new Headers();
  out.set("Authorization", `Bearer ${accessToken}`);
  out.set("ChatGPT-Account-Id", accountId);
  out.set("OpenAI-Beta", "responses=experimental");
  out.set("originator", "codex_cli_rs");
  out.set("accept", "text/event-stream");
  out.set("content-type", "application/json");
  return out;
}

function readTextContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map(readTextContent).filter(Boolean).join("");

  const item = value as Record<string, unknown>;
  if (typeof item["output_text"] === "string") return item["output_text"];
  if (typeof item["text"] === "string") return item["text"];
  if (typeof item["content"] === "string") return item["content"];
  if (item["text"] && typeof item["text"] === "object") {
    const nested = item["text"] as Record<string, unknown>;
    if (typeof nested["value"] === "string") return nested["value"];
  }
  if (Array.isArray(item["output"])) return readTextContent(item["output"]);
  if (Array.isArray(item["content"])) return readTextContent(item["content"]);
  if (item["response"]) return readTextContent(item["response"]);
  return "";
}

function readUsage(value: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const response =
    source["response"] && typeof source["response"] === "object" ? source["response"] : source;
  const usage =
    response && typeof response === "object"
      ? (response as Record<string, unknown>)["usage"]
      : undefined;
  if (!usage || typeof usage !== "object") return undefined;
  const usageRecord = usage as Record<string, unknown>;
  const inputTokens = usageRecord["input_tokens"];
  const outputTokens = usageRecord["output_tokens"];
  return {
    ...(typeof inputTokens === "number" ? { inputTokens } : {}),
    ...(typeof outputTokens === "number" ? { outputTokens } : {}),
  };
}

function readModel(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  if (typeof source["model"] === "string") return source["model"];
  const response = source["response"];
  if (response && typeof response === "object") {
    const model = (response as Record<string, unknown>)["model"];
    if (typeof model === "string") return model;
  }
  return undefined;
}

function sseErrorMessage(item: Record<string, unknown>, type: string): string | undefined {
  const status = typeof item["status"] === "string" ? item["status"] : "";
  const isErrorFrame =
    type === "error" ||
    type === "response.failed" ||
    type === "response.error" ||
    status === "failed";
  const error = item["error"];
  const errorMessage =
    error &&
    typeof error === "object" &&
    typeof (error as Record<string, unknown>)["message"] === "string"
      ? ((error as Record<string, unknown>)["message"] as string)
      : typeof item["message"] === "string"
        ? (item["message"] as string)
        : "";
  if (isErrorFrame) {
    return errorMessage || "OpenAI Codex backend reported a stream error";
  }
  // A bare error object even without an error-typed frame.
  if (error && typeof error === "object" && errorMessage) return errorMessage;
  return undefined;
}

function parseSsePayload(payload: unknown): { delta?: string; done?: unknown; error?: string } {
  if (!payload || typeof payload !== "object") return {};
  const item = payload as Record<string, unknown>;
  const type = typeof item["type"] === "string" ? item["type"] : "";
  if (typeof item["delta"] === "string") return { delta: item["delta"] };
  if (type === "response.output_text.delta" && typeof item["text"] === "string") {
    return { delta: item["text"] };
  }
  if (type === "response.done" || type === "response.completed") {
    const response = item["response"];
    // A terminal frame can still carry a failed status / error object (SER-201).
    if (response && typeof response === "object") {
      const responseError = sseErrorMessage(response as Record<string, unknown>, "");
      if (responseError) return { error: responseError };
    }
    return { done: response ?? item };
  }
  // The Codex Responses backend can return HTTP 200 then stream an error frame;
  // surface it so callers fail with the reason instead of an empty "success"
  // (SER-201).
  const error = sseErrorMessage(item, type);
  if (error) return { error };
  if (item["response"] && typeof item["response"] === "object") {
    const responseError = sseErrorMessage(item["response"] as Record<string, unknown>, "");
    if (responseError) return { error: responseError };
    return { done: item["response"] };
  }
  return {};
}

function parseSseText(value: string): SseParseResult {
  const deltas: string[] = [];
  let done: unknown;
  for (const line of value.split(/\r?\n/)) {
    if (!line.startsWith("data: ")) continue;
    const raw = line.slice(6).trim();
    if (!raw || raw === "[DONE]") continue;
    let parsed: { delta?: string; done?: unknown; error?: string };
    try {
      parsed = parseSsePayload(JSON.parse(raw) as unknown);
    } catch {
      // Ignore malformed SSE frames; the final response check will catch empty output.
      continue;
    }
    // Surface backend error frames consistently with stream() (SER-201).
    if (parsed.error) throw new OpenAICodexOAuthError(parsed.error);
    if (parsed.delta) deltas.push(parsed.delta);
    if (parsed.done) done = parsed.done;
  }

  const finalText = deltas.join("") || readTextContent(done);
  const model = readModel(done);
  const usage = readUsage(done);
  return {
    text: finalText,
    ...(model ? { model } : {}),
    ...(usage ? { usage } : {}),
  };
}

async function readResponseText(response: Response): Promise<SseParseResult> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await response.json()) as unknown;
    if (json && typeof json === "object") {
      const error = sseErrorMessage(json as Record<string, unknown>, "");
      if (error) throw new OpenAICodexOAuthError(error);
    }
    const model = readModel(json);
    const usage = readUsage(json);
    return {
      text: readTextContent(json),
      ...(model ? { model } : {}),
      ...(usage ? { usage } : {}),
    };
  }
  return parseSseText(await response.text());
}

/**
 * OpenAI Codex OAuth provider.
 *
 * This is intentionally separate from the OpenAI API-key adapter. It never
 * falls back to `OPENAI_API_KEY`; if the OAuth route cannot run, callers must
 * either stop or produce an explicitly marked deterministic local draft.
 */
export class OpenAICodexOAuthAdapter implements ProviderAdapter {
  public readonly id: string;
  public readonly type = "openai-codex" as const;
  public readonly name = "OpenAI Codex OAuth";
  public readonly defaultModel?: string;

  /**
   * In-flight token refresh shared across concurrent callers.
   *
   * OpenAI rotates the refresh token on every exchange, so a second concurrent
   * refresh would replay an already-consumed refresh token and brick the saved
   * credential. Single-flight ensures one refresh runs at a time; concurrent
   * callers reuse its result. Cleared on success and failure so a failed
   * refresh never wedges later calls.
   */
  private refreshInFlight?: Promise<string>;

  constructor(
    id: string,
    private readonly options: OpenAICodexOAuthOptions = {},
  ) {
    this.id = id;
    this.defaultModel = options.defaultModel;
  }

  async listModels(): Promise<readonly string[]> {
    return listOpenAICodexOAuthModelIDs(this.defaultModel);
  }

  async validateCredentials(): Promise<ValidationResult> {
    if (!this.options.accessToken && !this.options.refreshToken) {
      return { ok: false, reason: "OpenAI Codex OAuth token is not connected" };
    }
    // An expired access token with no refresh token deterministically fails at
    // generation time (`accessToken()` throws "refresh token is not connected").
    // Report it as not-ok here so the router won't select a route it would call
    // healthy, and the owner sees "reconnect" instead of "provider failed"
    // (SER-200). A usable (non-expired) access token or any refresh token is ok.
    const hasUsableAccessToken =
      Boolean(this.options.accessToken) && !isExpired(this.options.expiresAt);
    if (!hasUsableAccessToken && !this.options.refreshToken) {
      return {
        ok: false,
        reason: "OpenAI Codex OAuth token expired and no refresh token is connected",
      };
    }
    return { ok: true };
  }

  private async accessToken(): Promise<string> {
    if (this.options.accessToken && !isExpired(this.options.expiresAt)) {
      return this.options.accessToken;
    }
    if (!this.options.refreshToken) {
      throw new OpenAICodexOAuthError("OpenAI Codex OAuth refresh token is not connected");
    }
    // Single-flight: if a refresh is already running, reuse it instead of
    // starting a second one with a rotating refresh token that the provider
    // will reject.
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refreshAccessToken(this.options.refreshToken).finally(() => {
        this.refreshInFlight = undefined;
      });
    }
    return this.refreshInFlight;
  }

  private async refreshAccessToken(refreshToken: string): Promise<string> {
    const token = await refreshOpenAICodexToken({
      refreshToken,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
    this.options.accessToken = token.accessToken;
    this.options.refreshToken = token.refreshToken;
    this.options.expiresAt = token.expiresAt;
    await this.options.onTokenRefresh?.(token);
    return token.accessToken;
  }

  private async request(options: GenerateTextOptions): Promise<Response> {
    const accessToken = await this.accessToken();
    const accountId = extractChatGPTAccountId(accessToken);
    if (!accountId) {
      throw new OpenAICodexOAuthError("OpenAI Codex OAuth token is missing ChatGPT account id");
    }
    const fetchImpl = this.options.fetch ?? fetch;
    const send = (model: string): Promise<Response> =>
      fetchImpl(CODEX_RESPONSES_URL, {
        method: "POST",
        headers: headers(accessToken, accountId),
        body: JSON.stringify(buildRequestBody({ ...options, model })),
      });

    const requested = normalizeOpenAICodexOAuthModel(options.model);
    let response = await send(requested);
    // The ChatGPT-account Codex backend rejects some models (notably the
    // "-codex" variants) with HTTP 400 "... model is not supported when using
    // Codex with a ChatGPT account". The default model is always a ChatGPT-
    // account-supported chat model, so retry once with it rather than failing
    // the whole turn over a model the router happened to pick (SER-203).
    if (response.status === 400 && requested !== OPENAI_CODEX_OAUTH_DEFAULT_MODEL) {
      const text = await response.text().catch(() => "");
      if (/not supported/i.test(text)) {
        response = await send(OPENAI_CODEX_OAUTH_DEFAULT_MODEL);
      } else {
        throw new OpenAICodexOAuthError(`OpenAI Codex backend request failed: 400 ${text}`.trim());
      }
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new OpenAICodexOAuthError(
        `OpenAI Codex backend request failed: ${response.status} ${text}`.trim(),
      );
    }
    return response;
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    const parsed = await readResponseText(await this.request(options));
    if (!parsed.text) {
      throw new OpenAICodexOAuthError("OpenAI Codex backend returned no text");
    }
    return {
      text: parsed.text,
      model: parsed.model ?? options.model,
      ...(parsed.usage ? { usage: parsed.usage } : {}),
    };
  }

  async *stream(options: GenerateTextOptions): AsyncIterable<string> {
    const response = await this.request(options);
    if (!response.body) {
      const parsed = await readResponseText(response);
      if (parsed.text) yield parsed.text;
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalText = "";
    let emittedDelta = false;
    // Returns the delta to yield (if any) for a single `data: ` line, updating
    // finalText as a side effect. Throws OpenAICodexOAuthError on backend error
    // frames (SER-201); swallows malformed JSON so valid frames still flow.
    const consumeLine = (line: string): string | undefined => {
      if (!line.startsWith("data: ")) return undefined;
      const raw = line.slice(6).trim();
      if (!raw || raw === "[DONE]") return undefined;
      let parsed: { delta?: string; done?: unknown; error?: string };
      try {
        parsed = parseSsePayload(JSON.parse(raw) as unknown);
      } catch {
        return undefined;
      }
      if (parsed.error) throw new OpenAICodexOAuthError(parsed.error);
      if (parsed.delta) return parsed.delta;
      if (parsed.done) finalText = readTextContent(parsed.done);
      return undefined;
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trimEnd();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        const delta = consumeLine(line);
        if (delta !== undefined) {
          emittedDelta = true;
          yield delta;
        }
      }
    }
    // Flush a final frame that arrived without a trailing newline (SER-202).
    buffer += decoder.decode();
    const tail = buffer.trim();
    if (tail) {
      const delta = consumeLine(tail);
      if (delta !== undefined) {
        emittedDelta = true;
        yield delta;
      }
    }
    if (!emittedDelta && finalText) yield finalText;
  }
}
