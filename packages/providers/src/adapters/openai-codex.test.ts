import { describe, expect, it } from "vitest";
import { OPENAI_CODEX_TOKEN_URL } from "../openai-codex-oauth.js";
import {
  OpenAICodexOAuthAdapter,
  OpenAICodexOAuthError,
  extractChatGPTAccountId,
} from "./openai-codex.js";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";

function accessToken(accountId = "acct_test"): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": {
        chatgpt_account_id: accountId,
      },
    }),
  ).toString("base64url");
  return `${header}.${payload}.signature`;
}

function accessTokenWithTopLevelAccountId(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ chatgpt_account_id: accountId })).toString(
    "base64url",
  );
  return `${header}.${payload}.signature`;
}

function sseResponse(text: string): Response {
  return new Response(
    [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}`,
      `data: ${JSON.stringify({
        type: "response.done",
        response: {
          model: "gpt-5.3-codex",
          usage: { input_tokens: 10, output_tokens: 3 },
        },
      })}`,
      "",
    ].join("\n\n"),
    {
      headers: {
        "content-type": "text/event-stream",
      },
    },
  );
}

describe("OpenAICodexOAuthAdapter", () => {
  it("extracts the ChatGPT account id from the Codex OAuth JWT claim", () => {
    expect(extractChatGPTAccountId(accessToken("acct_123"))).toBe("acct_123");
    expect(extractChatGPTAccountId(accessTokenWithTopLevelAccountId("acct_root"))).toBe(
      "acct_root",
    );
    expect(extractChatGPTAccountId("not-a-jwt")).toBeUndefined();
  });

  it("reports missing OAuth credentials gracefully", async () => {
    const adapter = new OpenAICodexOAuthAdapter("openai-codex-test", {});
    const validation = await adapter.validateCredentials();
    expect(validation.ok).toBe(false);
    expect(validation.reason).toContain("OAuth token");
  });

  it("reports OK when an OAuth token is configured", async () => {
    const adapter = new OpenAICodexOAuthAdapter("openai-codex-test", {
      accessToken: accessToken(),
    });
    const validation = await adapter.validateCredentials();
    expect(validation.ok).toBe(true);
  });

  it("calls the ChatGPT Codex backend with OAuth headers and no OpenAI API-key fallback", async () => {
    const previousApiKey = process.env["OPENAI_API_KEY"];
    process.env["OPENAI_API_KEY"] = "sk-should-not-be-used";
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ input, init });
      return sseResponse("hello from codex");
    };
    const adapter = new OpenAICodexOAuthAdapter("openai-codex-test", {
      accessToken: accessToken("acct_header"),
      fetch: fetchImpl,
    });

    try {
      const result = await adapter.generateText({
        model: "gpt-5.3-codex",
        system: "You are BureauOS.",
        prompt: "Write the next action.",
        temperature: 0.2,
        maxTokens: 120,
      });

      expect(result).toEqual({
        text: "hello from codex",
        model: "gpt-5.3-codex",
        usage: { inputTokens: 10, outputTokens: 3 },
      });
      expect(calls).toHaveLength(1);
      expect(String(calls[0]?.input)).toBe(CODEX_RESPONSES_URL);
      expect(String(calls[0]?.input)).not.toContain("api.openai.com");

      const headers = new Headers(calls[0]?.init?.headers);
      expect(headers.get("Authorization")).toBe(`Bearer ${accessToken("acct_header")}`);
      expect(headers.get("ChatGPT-Account-Id")).toBe("acct_header");
      expect(headers.get("OpenAI-Beta")).toBe("responses=experimental");
      expect(headers.get("originator")).toBe("codex_cli_rs");
      expect(headers.get("x-api-key")).toBeNull();

      const body = JSON.parse(String(calls[0]?.init?.body)) as {
        model: string;
        input: Array<{
          role: string;
          content: Array<{ type: string; text: string }>;
        }>;
        stream: boolean;
        store: boolean;
        instructions: string;
        temperature?: number;
        max_output_tokens?: number;
      };
      expect(body).toMatchObject({
        model: "gpt-5.3-codex",
        stream: true,
        store: false,
        instructions: "You are BureauOS.",
      });
      expect(body.input).toEqual([
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Write the next action." }],
        },
      ]);
      expect(body.temperature).toBeUndefined();
      expect(body.max_output_tokens).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("sk-should-not-be-used");
    } finally {
      if (previousApiKey === undefined) delete process.env["OPENAI_API_KEY"];
      else process.env["OPENAI_API_KEY"] = previousApiKey;
    }
  });

  it("lists the current Codex OAuth model first even when old defaults are present", async () => {
    const adapter = new OpenAICodexOAuthAdapter("openai-codex-test", {
      defaultModel: "gpt-5",
    });

    await expect(adapter.listModels()).resolves.toEqual([
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.2",
      "gpt-5.3-codex-spark",
    ]);
  });

  it("keeps a saved supported Codex OAuth default first", async () => {
    const adapter = new OpenAICodexOAuthAdapter("openai-codex-test", {
      defaultModel: "gpt-5.4-mini",
    });

    await expect(adapter.listModels()).resolves.toEqual([
      "gpt-5.4-mini",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.3-codex",
      "gpt-5.2",
      "gpt-5.3-codex-spark",
    ]);
  });

  it("streams Codex SSE deltas without duplicating the final response text", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        [
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Hel" })}`,
          `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "lo" })}`,
          `data: ${JSON.stringify({
            type: "response.done",
            response: { output: [{ content: [{ text: "Hello" }] }] },
          })}`,
          "",
        ].join("\n\n"),
        { headers: { "content-type": "text/event-stream" } },
      );
    const adapter = new OpenAICodexOAuthAdapter("openai-codex-test", {
      accessToken: accessToken(),
      fetch: fetchImpl,
    });

    const chunks: string[] = [];
    for await (const chunk of adapter.stream({ model: "gpt-5.3-codex", prompt: "hello" })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Hel", "lo"]);
  });

  it("refreshes expired OAuth tokens and persists the refreshed token through the callback", async () => {
    const refreshedToken = accessToken("acct_refreshed");
    const refreshed: unknown[] = [];
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === OPENAI_CODEX_TOKEN_URL) {
        return new Response(
          JSON.stringify({
            access_token: refreshedToken,
            refresh_token: "refresh-new",
            expires_in: 3600,
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return sseResponse("fresh run");
    };
    const adapter = new OpenAICodexOAuthAdapter("openai-codex-test", {
      accessToken: accessToken("acct_old"),
      refreshToken: "refresh-old",
      expiresAt: new Date(0).toISOString(),
      fetch: fetchImpl,
      onTokenRefresh: async (token) => {
        refreshed.push(token);
      },
    });

    const result = await adapter.generateText({ model: "gpt-5.3-codex", prompt: "continue" });

    expect(result.text).toBe("fresh run");
    expect(calls.map((call) => call.url)).toEqual([OPENAI_CODEX_TOKEN_URL, CODEX_RESPONSES_URL]);
    expect(new Headers(calls[1]?.init?.headers).get("Authorization")).toBe(
      `Bearer ${refreshedToken}`,
    );
    expect(new Headers(calls[1]?.init?.headers).get("ChatGPT-Account-Id")).toBe("acct_refreshed");
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toMatchObject({
      accessToken: refreshedToken,
      refreshToken: "refresh-new",
      expiresIn: 3600,
    });
  });

  it("fails explicitly when the OAuth token has no ChatGPT account id", async () => {
    const adapter = new OpenAICodexOAuthAdapter("openai-codex-test", {
      accessToken: "header.payload.signature",
      fetch: async () => sseResponse("never called"),
    });

    await expect(adapter.generateText({ model: "gpt-5.3-codex", prompt: "hello" })).rejects.toThrow(
      OpenAICodexOAuthError,
    );
  });
});
