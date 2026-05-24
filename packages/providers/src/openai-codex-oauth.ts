import { createHash, randomBytes } from "node:crypto";

export const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const OPENAI_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const OPENAI_CODEX_SCOPE = "openid profile email offline_access";
export const OPENAI_CODEX_DEFAULT_REDIRECT_URI = "http://localhost:1455/auth/callback";

export interface OpenAICodexAuthorization {
  state: string;
  codeVerifier: string;
  authorizationUrl: string;
  redirectUri: string;
  expiresAt: string;
}

export interface OpenAICodexToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  expiresIn: number;
}

export interface ParsedOpenAICodexAuthorizationInput {
  code?: string;
  state?: string;
}

export type OpenAICodexOAuthFetch = typeof fetch;

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function createOpenAICodexState(): string {
  return randomBytes(16).toString("hex");
}

export function createOpenAICodexCodeVerifier(): string {
  return base64Url(randomBytes(32));
}

export function createOpenAICodexCodeChallenge(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

export function createOpenAICodexAuthorization(input?: {
  redirectUri?: string;
  now?: Date;
}): OpenAICodexAuthorization {
  const redirectUri = input?.redirectUri ?? OPENAI_CODEX_DEFAULT_REDIRECT_URI;
  const codeVerifier = createOpenAICodexCodeVerifier();
  const state = createOpenAICodexState();
  const url = new URL(OPENAI_CODEX_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", OPENAI_CODEX_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", OPENAI_CODEX_SCOPE);
  url.searchParams.set("code_challenge", createOpenAICodexCodeChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", "codex_cli_rs");

  const now = input?.now ?? new Date();
  return {
    state,
    codeVerifier,
    authorizationUrl: url.toString(),
    redirectUri,
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
  };
}

export function parseOpenAICodexAuthorizationInput(
  input: string,
): ParsedOpenAICodexAuthorizationInput {
  const value = input.trim();
  if (!value) return {};

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {
    // Continue with compact CLI-friendly formats.
  }

  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return {
      ...(code ? { code } : {}),
      ...(state ? { state } : {}),
    };
  }

  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
    };
  }

  return { code: value };
}

async function requestToken(
  body: URLSearchParams,
  fetchImpl: OpenAICodexOAuthFetch = fetch,
): Promise<OpenAICodexToken> {
  const response = await fetchImpl(OPENAI_CODEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenAI Codex OAuth token request failed: ${response.status} ${text}`.trim());
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
    throw new Error("OpenAI Codex OAuth token response is missing required fields");
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
}

export function exchangeOpenAICodexCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri?: string;
  fetch?: OpenAICodexOAuthFetch;
}): Promise<OpenAICodexToken> {
  return requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: OPENAI_CODEX_CLIENT_ID,
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri ?? OPENAI_CODEX_DEFAULT_REDIRECT_URI,
    }),
    input.fetch,
  );
}

export function refreshOpenAICodexToken(input: {
  refreshToken: string;
  fetch?: OpenAICodexOAuthFetch;
}): Promise<OpenAICodexToken> {
  return requestToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: OPENAI_CODEX_CLIENT_ID,
    }),
    input.fetch,
  );
}
