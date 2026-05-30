import { createServer, type Server } from "node:http";
import {
  ProviderAuthStore,
  createOpenAICodexAuthorization,
  exchangeOpenAICodexCode,
  parseOpenAICodexAuthorizationInput,
  providerAuthMethods as listProviderAuthMethods,
  type ProviderCatalogConfig,
  type ProviderAuthMethod,
  type OpenAICodexOAuthFetch,
} from "@bureauos/providers";

/**
 * OAuth completion strategy shared by the authorize response and the callback
 * request. "auto" means BureauOS captured the redirect on a local callback
 * server and can finish without owner input; "code" means the owner must paste
 * the final redirect URL or authorization code.
 */
export type ProviderOAuthMethod = "auto" | "code";

export interface ProviderAuthAuthorization {
  url: string;
  method: ProviderOAuthMethod;
  instructions: string;
}

export interface ProviderOAuthCallbackInput {
  method?: ProviderOAuthMethod;
  code?: string;
  defaultModel?: string;
}

export interface ProviderOAuthCallbackResult {
  status: "connected" | "pending";
}

interface PendingCodexOAuth {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  code?: string;
  callbackReady: boolean;
  server?: Server;
}

const OPENAI_CODEX_PROVIDER_ID = "openai-codex";
const OAUTH_CALLBACK_PATH = "/auth/callback";
const DEFAULT_CALLBACK_PORT = 1455;

let pendingCodexOAuth: PendingCodexOAuth | undefined;

export function providerAuthMethods(
  config: ProviderCatalogConfig = {},
): Record<string, ProviderAuthMethod[]> {
  return listProviderAuthMethods(config);
}

function closePendingServer(): void {
  const server = pendingCodexOAuth?.server;
  pendingCodexOAuth = undefined;
  if (!server) return;
  try {
    server.close();
  } catch {
    // The server may already be closed by the runtime.
  }
}

function waitForServer(
  server: Server,
  port: number,
): Promise<{ ready: boolean; redirectUri: string }> {
  return new Promise((resolve) => {
    server.once("error", () => {
      resolve({
        ready: false,
        redirectUri: `http://localhost:${port || DEFAULT_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`,
      });
    });
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const resolvedPort =
        address && typeof address !== "string" ? address.port : port || DEFAULT_CALLBACK_PORT;
      resolve({
        ready: true,
        redirectUri: `http://localhost:${resolvedPort}${OAUTH_CALLBACK_PATH}`,
      });
    });
  });
}

async function startCallbackServer(port: number): Promise<{
  server?: Server;
  ready: boolean;
  redirectUri: string;
}> {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://localhost:${port || DEFAULT_CALLBACK_PORT}`);
      if (url.pathname !== OAUTH_CALLBACK_PATH) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const session = pendingCodexOAuth;
      if (!session || url.searchParams.get("state") !== session.state) {
        res.statusCode = 400;
        res.end("State mismatch");
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        res.statusCode = 400;
        res.end("Missing authorization code");
        return;
      }

      session.code = code;
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        "<!doctype html><title>BureauOS OAuth</title><body><h1>BureauOS connected.</h1><p>You can return to the app.</p></body>",
      );
    } catch {
      res.statusCode = 500;
      res.end("Internal error");
    }
  });

  const started = await waitForServer(server, port);
  if (!started.ready) {
    try {
      server.close();
    } catch {
      // Ignore close failures after bind errors.
    }
    return started;
  }
  return { ...started, server };
}

function waitForCode(session: PendingCodexOAuth, timeoutMs: number): Promise<string | undefined> {
  if (session.code) return Promise.resolve(session.code);
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (session.code) {
        clearInterval(timer);
        resolve(session.code);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve(undefined);
      }
    }, 100);
  });
}

export async function authorizeOpenAICodexOAuth(input?: {
  callbackPort?: number;
}): Promise<ProviderAuthAuthorization> {
  closePendingServer();

  const callback = await startCallbackServer(input?.callbackPort ?? DEFAULT_CALLBACK_PORT);
  const authorization = createOpenAICodexAuthorization({ redirectUri: callback.redirectUri });
  pendingCodexOAuth = {
    state: authorization.state,
    codeVerifier: authorization.codeVerifier,
    redirectUri: authorization.redirectUri,
    callbackReady: callback.ready,
    ...(callback.server ? { server: callback.server } : {}),
  };

  return {
    url: authorization.authorizationUrl,
    method: callback.ready ? "auto" : "code",
    instructions: callback.ready
      ? "Complete authorization in your browser. BureauOS will finish automatically."
      : "Open the URL manually, then paste the final redirect URL or authorization code.",
  };
}

export async function completeOpenAICodexOAuth(input: {
  workspaceRoot: string;
  payload?: ProviderOAuthCallbackInput;
  fetch?: OpenAICodexOAuthFetch;
}): Promise<ProviderOAuthCallbackResult> {
  const session = pendingCodexOAuth;
  if (!session) throw new Error("OpenAI Codex OAuth authorization was not started");

  if (input.payload?.code) {
    const parsed = parseOpenAICodexAuthorizationInput(input.payload.code);
    if (parsed.state && parsed.state !== session.state) {
      throw new Error("OpenAI Codex OAuth state mismatch");
    }
    if (!parsed.code) throw new Error("OpenAI Codex OAuth code is missing");
    session.code = parsed.code;
  }

  const code = session.callbackReady ? await waitForCode(session, 5 * 60 * 1000) : session.code;
  if (!code) return { status: "pending" };

  const token = await exchangeOpenAICodexCode({
    code,
    codeVerifier: session.codeVerifier,
    redirectUri: session.redirectUri,
    fetch: input.fetch,
  });

  await ProviderAuthStore.forWorkspace(input.workspaceRoot).upsert({
    provider: OPENAI_CODEX_PROVIDER_ID,
    mode: "oauth",
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
    ...(input.payload?.defaultModel ? { defaultModel: input.payload.defaultModel } : {}),
  });
  closePendingServer();
  return { status: "connected" };
}
