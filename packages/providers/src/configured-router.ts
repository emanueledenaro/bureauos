import { AnthropicAdapter } from "./adapters/anthropic.js";
import { GoogleAdapter } from "./adapters/google.js";
import { LocalAdapter } from "./adapters/local.js";
import { OpenAICodexOAuthAdapter } from "./adapters/openai-codex.js";
import { OpenAIAdapter } from "./adapters/openai.js";
import { OpenRouterAdapter } from "./adapters/openrouter.js";
import {
  ProviderAuthStore,
  maskSecret,
  type ProviderAuthMode,
  type ProviderCredentialRecord,
} from "./auth-store.js";
import {
  defaultProviderCredentialId,
  getProviderConnector,
  listProviderConnectors,
} from "./catalog.js";
import { ProviderRouter } from "./router.js";
import type { ProviderType } from "./types.js";

export type ProviderConnectionSource = "auth" | "env";

export interface ProviderConnection {
  provider: ProviderType;
  provider_name: string;
  id: string;
  source: ProviderConnectionSource;
  auth_mode: ProviderAuthMode;
  has_api_key: boolean;
  api_key_masked: string;
  oauth_token_masked: string;
  base_url: string;
  default_model: string;
  no_api_fallback: boolean;
}

export interface ConfiguredProviderRouter {
  router: ProviderRouter;
  connections: ProviderConnection[];
  credentials: ProviderCredentialRecord[];
}

export type ProviderEnv = Record<string, string | undefined>;

function registerCredential(
  router: ProviderRouter,
  credential: ProviderCredentialRecord,
  authStore?: ProviderAuthStore,
): void {
  const apiKey = credential.apiKey || undefined;
  const baseUrl = credential.baseUrl || undefined;
  const defaultModel = credential.defaultModel || undefined;
  switch (credential.provider) {
    case "openai-codex":
      router.register(
        new OpenAICodexOAuthAdapter(credential.id, {
          accessToken: credential.accessToken || undefined,
          refreshToken: credential.refreshToken || undefined,
          expiresAt: credential.expiresAt || undefined,
          defaultModel,
          ...(authStore
            ? {
                onTokenRefresh: async (token) => {
                  await authStore.upsert({
                    provider: credential.provider,
                    id: credential.id,
                    mode: "oauth",
                    accessToken: token.accessToken,
                    refreshToken: token.refreshToken,
                    expiresAt: token.expiresAt,
                    defaultModel: credential.defaultModel,
                  });
                },
              }
            : {}),
        }),
      );
      return;
    case "openai":
      router.register(new OpenAIAdapter(credential.id, { apiKey, baseUrl, defaultModel }));
      return;
    case "anthropic":
      router.register(new AnthropicAdapter(credential.id, { apiKey, defaultModel }));
      return;
    case "google":
      router.register(new GoogleAdapter(credential.id, { apiKey, defaultModel }));
      return;
    case "openrouter":
      router.register(new OpenRouterAdapter(credential.id, { apiKey, defaultModel }));
      return;
    case "local":
      router.register(new LocalAdapter(credential.id, { baseUrl, defaultModel }));
      return;
    case "custom":
      router.register(new OpenAIAdapter(credential.id, { apiKey, baseUrl, defaultModel }));
      return;
  }
}

function connectionFromCredential(credential: ProviderCredentialRecord): ProviderConnection {
  const connector = getProviderConnector(credential.provider);
  return {
    provider: credential.provider,
    provider_name: connector.name,
    id: credential.id,
    source: "auth",
    auth_mode: credential.mode,
    has_api_key: Boolean(credential.apiKey),
    api_key_masked: credential.apiKey ? maskSecret(credential.apiKey) : "",
    oauth_token_masked: credential.accessToken
      ? maskSecret(credential.accessToken)
      : credential.refreshToken
        ? maskSecret(credential.refreshToken)
        : "",
    base_url: credential.baseUrl,
    default_model: credential.defaultModel,
    no_api_fallback: connector.noApiFallback,
  };
}

function firstEnv(env: ProviderEnv, names?: readonly string[]): string {
  return (
    names?.map((name) => env[name]?.trim()).find((value): value is string => Boolean(value)) ?? ""
  );
}

function envCredential(
  provider: ProviderType,
  env: ProviderEnv,
): ProviderCredentialRecord | undefined {
  const connector = getProviderConnector(provider);
  const now = new Date().toISOString();
  const apiKey = firstEnv(env, connector.env.apiKey);
  const accessToken = firstEnv(env, connector.env.accessToken);
  const refreshToken = firstEnv(env, connector.env.refreshToken);
  const expiresAt = firstEnv(env, connector.env.expiresAt);
  const baseUrl = firstEnv(env, connector.env.baseUrl);

  if (connector.defaultAuthMode === "oauth" && !accessToken && !refreshToken) return undefined;
  if (connector.defaultAuthMode === "local" && !baseUrl) return undefined;
  if (connector.defaultAuthMode === "api-key" && !apiKey && !baseUrl) return undefined;

  return {
    provider,
    id: defaultProviderCredentialId(provider),
    mode: connector.defaultAuthMode,
    apiKey,
    accessToken,
    refreshToken,
    expiresAt,
    baseUrl,
    defaultModel: "",
    created: now,
    updated: now,
  };
}

export async function buildConfiguredProviderRouter(
  workspaceRoot: string,
  env: ProviderEnv,
): Promise<ConfiguredProviderRouter> {
  const authStore = ProviderAuthStore.forWorkspace(workspaceRoot);
  const credentials = await authStore.list();
  const router = new ProviderRouter();
  const connections = credentials.map(connectionFromCredential);

  for (const credential of credentials) registerCredential(router, credential, authStore);

  const hasStored = (provider: ProviderType) =>
    credentials.some((credential) => credential.provider === provider);
  const envProviders = listProviderConnectors()
    .filter((connector) => connector.id !== "custom")
    .map((connector) => connector.id);

  for (const provider of envProviders) {
    if (hasStored(provider)) continue;
    const credential = envCredential(provider, env);
    if (!credential) continue;
    registerCredential(router, credential);
    connections.push({
      ...connectionFromCredential(credential),
      source: "env",
    });
  }

  return { router, connections, credentials };
}
