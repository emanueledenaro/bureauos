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
  type ProviderCatalogConfig,
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
  config: ProviderCatalogConfig = {},
  authStore?: ProviderAuthStore,
): void {
  const apiKey = credential.apiKey || undefined;
  const baseUrl = credential.baseUrl || undefined;
  const defaultModel =
    credential.defaultModel || getProviderConnector(credential.provider, config).defaultModel;
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
      router.register(new GoogleAdapter(credential.id, { apiKey, baseUrl, defaultModel }));
      return;
    case "openrouter":
      router.register(new OpenRouterAdapter(credential.id, { apiKey, baseUrl, defaultModel }));
      return;
    case "local":
      router.register(new LocalAdapter(credential.id, { apiKey, baseUrl, defaultModel }));
      return;
    case "custom":
      router.register(new OpenAIAdapter(credential.id, { apiKey, baseUrl, defaultModel }));
      return;
  }
}

function connectionFromCredential(
  credential: ProviderCredentialRecord,
  config: ProviderCatalogConfig = {},
): ProviderConnection {
  const connector = getProviderConnector(credential.provider, config);
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
    default_model: credential.defaultModel || connector.defaultModel,
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
  config: ProviderCatalogConfig = {},
): ProviderCredentialRecord | undefined {
  const connector = getProviderConnector(provider, config);
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
    defaultModel: connector.defaultModel,
    created: now,
    updated: now,
  };
}

export async function buildConfiguredProviderRouter(
  workspaceRoot: string,
  env: ProviderEnv,
  config: ProviderCatalogConfig = {},
): Promise<ConfiguredProviderRouter> {
  const authStore = ProviderAuthStore.forWorkspace(workspaceRoot);
  const credentials = await authStore.list();
  const router = new ProviderRouter();
  const enabledProviders = new Set(listProviderConnectors(config).map((connector) => connector.id));
  const activeCredentials = credentials.filter((credential) =>
    enabledProviders.has(credential.provider),
  );
  const connections = activeCredentials.map((credential) =>
    connectionFromCredential(credential, config),
  );

  for (const credential of activeCredentials)
    registerCredential(router, credential, config, authStore);

  const hasStored = (provider: ProviderType) =>
    activeCredentials.some((credential) => credential.provider === provider);
  const envProviders = listProviderConnectors(config)
    .filter((connector) => connector.id !== "custom")
    .map((connector) => connector.id);

  for (const provider of envProviders) {
    if (hasStored(provider)) continue;
    const credential = envCredential(provider, env, config);
    if (!credential) continue;
    registerCredential(router, credential, config);
    connections.push({
      ...connectionFromCredential(credential, config),
      source: "env",
    });
  }

  return { router, connections, credentials: activeCredentials };
}
