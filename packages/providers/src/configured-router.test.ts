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

  it("only exposes real stored or environment-backed provider connections", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "bureauos-provider-router-"));

    const empty = await buildConfiguredProviderRouter(workspaceRoot, {});
    expect(empty.connections).toEqual([]);
    expect(empty.router.list()).toEqual([]);

    const configured = await buildConfiguredProviderRouter(workspaceRoot, {
      ANTHROPIC_API_KEY: "sk-ant-env",
    });

    expect(configured.connections).toMatchObject([
      {
        provider: "anthropic",
        provider_name: "Anthropic API",
        source: "env",
        auth_mode: "api-key",
      },
    ]);
    expect(configured.router.get("anthropic-default")).toBeDefined();
  });

  it("honors provider connector config when building runtime routes", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "bureauos-provider-router-"));
    const store = ProviderAuthStore.forWorkspace(workspaceRoot);
    await store.upsert({
      provider: "openrouter",
      apiKey: "sk-disabled",
    });

    const configured = await buildConfiguredProviderRouter(
      workspaceRoot,
      { OPENAI_ENTERPRISE_KEY: "sk-openai-enterprise" },
      {
        disabled_providers: ["openrouter"],
        provider: {
          openai: {
            name: "OpenAI Enterprise",
            env: ["OPENAI_ENTERPRISE_KEY"],
            options: { defaultModel: "gpt-5-enterprise" },
            models: {
              "gpt-5-enterprise": { name: "GPT-5 Enterprise" },
            },
          },
        },
      },
    );

    expect(configured.connections.map((connection) => connection.provider)).toEqual(["openai"]);
    expect(configured.connections[0]).toMatchObject({
      provider_name: "OpenAI Enterprise",
      source: "env",
      default_model: "gpt-5-enterprise",
    });
    expect(configured.router.get("openrouter-default")).toBeUndefined();
    expect(configured.router.get("openai-default")?.defaultModel).toBe("gpt-5-enterprise");
    expect(configured.router.profileFor("openai-default")).toMatchObject({
      model: "gpt-5-enterprise",
      capabilities: ["chat"],
      budgetTier: "standard",
    });
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
