import { describe, expect, it, vi } from "vitest";
import {
  OPENAI_CODEX_AUTHORIZE_URL,
  OPENAI_CODEX_CLIENT_ID,
  OPENAI_CODEX_SCOPE,
  createOpenAICodexAuthorization,
  createOpenAICodexCodeChallenge,
  exchangeOpenAICodexCode,
  parseOpenAICodexAuthorizationInput,
  refreshOpenAICodexToken,
  type OpenAICodexOAuthFetch,
} from "./openai-codex-oauth.js";

function response(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("OpenAI Codex OAuth helpers", () => {
  it("builds the Codex PKCE authorization URL without tokens", () => {
    const authorization = createOpenAICodexAuthorization({
      redirectUri: "http://localhost:1455/auth/callback",
      now: new Date("2026-05-24T10:00:00.000Z"),
    });
    const url = new URL(authorization.authorizationUrl);

    expect(url.origin + url.pathname).toBe(OPENAI_CODEX_AUTHORIZE_URL);
    expect(url.searchParams.get("client_id")).toBe(OPENAI_CODEX_CLIENT_ID);
    expect(url.searchParams.get("scope")).toBe(OPENAI_CODEX_SCOPE);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("id_token_add_organizations")).toBe("true");
    expect(url.searchParams.get("codex_cli_simplified_flow")).toBe("true");
    expect(url.searchParams.get("originator")).toBe("codex_cli_rs");
    expect(url.search).not.toContain("access_token");
    expect(authorization.expiresAt).toBe("2026-05-24T10:05:00.000Z");
  });

  it("creates a deterministic SHA256 PKCE challenge for a verifier", () => {
    expect(createOpenAICodexCodeChallenge("verifier")).toBe(
      "iMnq5o6zALKXGivsnlom_0F5_WYda32GHkxlV7mq7hQ",
    );
  });

  it("parses redirect URLs, compact code/state pairs, and raw codes", () => {
    expect(
      parseOpenAICodexAuthorizationInput("http://localhost:1455/auth/callback?code=abc&state=xyz"),
    ).toEqual({ code: "abc", state: "xyz" });
    expect(parseOpenAICodexAuthorizationInput("abc#xyz")).toEqual({
      code: "abc",
      state: "xyz",
    });
    expect(parseOpenAICodexAuthorizationInput("abc")).toEqual({ code: "abc" });
  });

  it("exchanges authorization codes with the Codex OAuth token endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      response({
        access_token: "oauth-access-token",
        refresh_token: "oauth-refresh-token",
        expires_in: 3600,
      }),
    ) as OpenAICodexOAuthFetch;

    const token = await exchangeOpenAICodexCode({
      code: "code-123",
      codeVerifier: "verifier-123",
      redirectUri: "http://localhost:1455/auth/callback",
      fetch: fetchMock,
    });

    expect(token.accessToken).toBe("oauth-access-token");
    expect(token.refreshToken).toBe("oauth-refresh-token");
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toContain("grant_type=authorization_code");
    expect(String(init?.body)).toContain("code=code-123");
    expect(String(init?.body)).toContain("code_verifier=verifier-123");
  });

  it("refreshes Codex OAuth tokens without using an OpenAI API key", async () => {
    const fetchMock = vi.fn(async () =>
      response({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 1800,
      }),
    ) as OpenAICodexOAuthFetch;

    await refreshOpenAICodexToken({ refreshToken: "old-refresh", fetch: fetchMock });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(String(init?.body)).toContain("grant_type=refresh_token");
    expect(String(init?.body)).toContain("refresh_token=old-refresh");
    expect(String(init?.body)).not.toContain("api_key");
  });
});
