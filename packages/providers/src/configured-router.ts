import { AnthropicAdapter } from "./adapters/anthropic.js";
import { GoogleAdapter } from "./adapters/google.js";
import { LocalAdapter } from "./adapters/local.js";
import { OpenAIAdapter } from "./adapters/openai.js";
import { OpenRouterAdapter } from "./adapters/openrouter.js";
import { ProviderAuthStore, maskSecret, type ProviderCredentialRecord } from "./auth-store.js";
import { ProviderRouter } from "./router.js";
import type { ProviderType } from "./types.js";

export type ProviderConnectionSource = "auth" | "env";

export interface ProviderConnection {
  provider: ProviderType;
  id: string;
  source: ProviderConnectionSource;
  has_api_key: boolean;
  api_key_masked: string;
  base_url: string;
  default_model: string;
}

export interface ConfiguredProviderRouter {
  router: ProviderRouter;
  connections: ProviderConnection[];
  credentials: ProviderCredentialRecord[];
}

export type ProviderEnv = Record<string, string | undefined>;

function registerCredential(router: ProviderRouter, credential: ProviderCredentialRecord): void {
  const apiKey = credential.apiKey || undefined;
  const baseUrl = credential.baseUrl || undefined;
  const defaultModel = credential.defaultModel || undefined;
  switch (credential.provider) {
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
  return {
    provider: credential.provider,
    id: credential.id,
    source: "auth",
    has_api_key: Boolean(credential.apiKey),
    api_key_masked: credential.apiKey ? maskSecret(credential.apiKey) : "",
    base_url: credential.baseUrl,
    default_model: credential.defaultModel,
  };
}

function envCredential(
  provider: Exclude<ProviderType, "custom">,
  env: ProviderEnv,
): ProviderCredentialRecord {
  const now = new Date().toISOString();
  const id = `${provider}-default`;
  switch (provider) {
    case "openai":
      return {
        provider,
        id,
        apiKey: env["OPENAI_API_KEY"] ?? "",
        baseUrl: "",
        defaultModel: "",
        created: now,
        updated: now,
      };
    case "anthropic":
      return {
        provider,
        id,
        apiKey: env["ANTHROPIC_API_KEY"] ?? "",
        baseUrl: "",
        defaultModel: "",
        created: now,
        updated: now,
      };
    case "google":
      return {
        provider,
        id,
        apiKey: env["GOOGLE_API_KEY"] ?? "",
        baseUrl: "",
        defaultModel: "",
        created: now,
        updated: now,
      };
    case "openrouter":
      return {
        provider,
        id,
        apiKey: env["OPENROUTER_API_KEY"] ?? "",
        baseUrl: "",
        defaultModel: "",
        created: now,
        updated: now,
      };
    case "local":
      return {
        provider,
        id,
        apiKey: "",
        baseUrl: env["LOCAL_MODEL_URL"] ?? "",
        defaultModel: "",
        created: now,
        updated: now,
      };
  }
}

export async function buildConfiguredProviderRouter(
  workspaceRoot: string,
  env: ProviderEnv,
): Promise<ConfiguredProviderRouter> {
  const credentials = await ProviderAuthStore.forWorkspace(workspaceRoot).list();
  const router = new ProviderRouter();
  const connections = credentials.map(connectionFromCredential);

  for (const credential of credentials) registerCredential(router, credential);

  const hasStored = (provider: ProviderType) =>
    credentials.some((credential) => credential.provider === provider);
  const envProviders: Array<Exclude<ProviderType, "custom">> = [
    "openai",
    "anthropic",
    "google",
    "openrouter",
    "local",
  ];

  for (const provider of envProviders) {
    if (hasStored(provider)) continue;
    const credential = envCredential(provider, env);
    registerCredential(router, credential);
    connections.push({
      ...connectionFromCredential(credential),
      source: "env",
    });
  }

  return { router, connections, credentials };
}
