import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderAuthStore } from "./auth-store.js";
import { buildConfiguredProviderRouter } from "./configured-router.js";
import { OPENAI_CODEX_TOKEN_URL } from "./openai-codex-oauth.js";

const CODEX_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const originalFetch = globalThis.fetch;

function accessToken(accountId: string): string {
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

function sseResponse(text: string): Response {
  return new Response(
    [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}`,
      `data: ${JSON.stringify({ type: "response.done", response: { model: "gpt-5" } })}`,
      "",
    ].join("\n\n"),
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("buildConfiguredProviderRouter", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("persists refreshed OpenAI Codex OAuth tokens for stored credentials", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "bureauos-provider-router-"));
    const store = ProviderAuthStore.forWorkspace(workspaceRoot);
    await store.upsert({
      provider: "openai-codex",
      accessToken: accessToken("acct_old"),
      refreshToken: "refresh-old",
      expiresAt: new Date(0).toISOString(),
      defaultModel: "gpt-5",
    });

    const refreshedToken = accessToken("acct_new");
    const calls: string[] = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url === OPENAI_CODEX_TOKEN_URL) {
        expect(String(init?.body)).toContain("grant_type=refresh_token");
        return new Response(
          JSON.stringify({
            access_token: refreshedToken,
            refresh_token: "refresh-new",
            expires_in: 3600,
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      return sseResponse("persisted refresh");
    }) as typeof fetch;

    const { router } = await buildConfiguredProviderRouter(workspaceRoot, {});
    const adapter = router.get("openai-codex-default");
    expect(adapter).toBeDefined();

    const result = await adapter?.generateText({ model: "gpt-5", prompt: "run" });
    const stored = await store.get("openai-codex");

    expect(result?.text).toBe("persisted refresh");
    expect(calls).toEqual([OPENAI_CODEX_TOKEN_URL, CODEX_RESPONSES_URL]);
    expect(stored).toMatchObject({
      provider: "openai-codex",
      id: "openai-codex-default",
      mode: "oauth",
      accessToken: refreshedToken,
      refreshToken: "refresh-new",
      defaultModel: "gpt-5",
    });
    expect(Date.parse(stored?.expiresAt ?? "")).toBeGreaterThan(Date.now());
  });
});
