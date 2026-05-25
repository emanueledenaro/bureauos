import type { ProviderBudgetTier, ProviderRouteProfile, ProviderType } from "./types.js";

export type ProviderConnectorAuthMode = "oauth" | "api-key" | "local";

export type ProviderAuthMethodType = "oauth" | "api" | "local";

export interface ProviderAuthPromptCondition {
  key: string;
  op: "eq" | "neq";
  value: string;
}

export interface ProviderAuthTextPrompt {
  type: "text";
  key: string;
  message: string;
  placeholder?: string;
  when?: ProviderAuthPromptCondition;
}

export interface ProviderAuthSelectPromptOption {
  label: string;
  value: string;
  hint?: string;
}

export interface ProviderAuthSelectPrompt {
  type: "select";
  key: string;
  message: string;
  options: ProviderAuthSelectPromptOption[];
  when?: ProviderAuthPromptCondition;
}

export type ProviderAuthPrompt = ProviderAuthTextPrompt | ProviderAuthSelectPrompt;

export interface ProviderAuthMethod {
  type: ProviderAuthMethodType;
  label: string;
  prompts?: ProviderAuthPrompt[];
}

export interface ProviderEnvironmentMapping {
  apiKey?: string[];
  accessToken?: string[];
  refreshToken?: string[];
  expiresAt?: string[];
  baseUrl?: string[];
}

export interface ProviderModelInfo {
  id: string;
  name: string;
  capabilities: string[];
  budgetTier: ProviderBudgetTier;
}

export interface ProviderConnector {
  id: ProviderType;
  name: string;
  description: string;
  source: "builtin" | "config";
  defaultAuthMode: ProviderConnectorAuthMode;
  defaultModel: string;
  models: ProviderModelInfo[];
  authMethods: ProviderAuthMethod[];
  env: ProviderEnvironmentMapping;
  popular: boolean;
  requiresBaseUrl: boolean;
  noApiFallback: boolean;
}

export interface ProviderConfigInput {
  name?: string;
  description?: string;
  env?: string[];
  options?: Record<string, unknown>;
  models?: Record<
    string,
    {
      id?: string;
      name?: string;
      capabilities?: string[];
      budgetTier?: ProviderBudgetTier;
      budget_tier?: ProviderBudgetTier;
      disabled?: boolean;
      [key: string]: unknown;
    }
  >;
}

export interface ProviderCatalogConfig {
  provider?: Record<string, ProviderConfigInput>;
  enabled_providers?: string[];
  disabled_providers?: string[];
}

export interface ProviderCatalogResult {
  all: ProviderConnector[];
  default: Record<string, string>;
  configured: string[];
  auth: Record<string, ProviderAuthMethod[]>;
}

const CONNECTORS: readonly ProviderConnector[] = [
  {
    id: "openai-codex",
    name: "OpenAI Codex",
    description: "Browser OAuth route for ChatGPT Plus/Pro Codex access.",
    source: "builtin",
    defaultAuthMode: "oauth",
    defaultModel: "gpt-5.3-codex",
    models: [
      {
        id: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        capabilities: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use", "oauth"],
        budgetTier: "high",
      },
    ],
    authMethods: [{ type: "oauth", label: "ChatGPT Plus/Pro (browser)" }],
    env: {
      accessToken: ["OPENAI_CODEX_ACCESS_TOKEN"],
      refreshToken: ["OPENAI_CODEX_REFRESH_TOKEN"],
      expiresAt: ["OPENAI_CODEX_EXPIRES_AT"],
    },
    popular: true,
    requiresBaseUrl: false,
    noApiFallback: true,
  },
  {
    id: "openai",
    name: "OpenAI API",
    description: "OpenAI API key route. Kept separate from OpenAI Codex OAuth.",
    source: "builtin",
    defaultAuthMode: "api-key",
    defaultModel: "gpt-5.5",
    models: [
      {
        id: "gpt-5.5",
        name: "GPT-5.5",
        capabilities: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use"],
        budgetTier: "premium",
      },
      {
        id: "gpt-5.5-pro",
        name: "GPT-5.5 Pro",
        capabilities: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use"],
        budgetTier: "premium",
      },
      {
        id: "gpt-5.4",
        name: "GPT-5.4",
        capabilities: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use"],
        budgetTier: "high",
      },
      {
        id: "gpt-5.4-pro",
        name: "GPT-5.4 Pro",
        capabilities: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use"],
        budgetTier: "premium",
      },
      {
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        capabilities: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use", "low-latency"],
        budgetTier: "standard",
      },
      {
        id: "gpt-5.4-nano",
        name: "GPT-5.4 Nano",
        capabilities: ["chat", "reasoning", "vision", "streaming", "tool-use", "low-latency", "low-cost"],
        budgetTier: "low",
      },
      {
        id: "chat-latest",
        name: "Chat Latest",
        capabilities: ["chat", "vision", "streaming", "tool-use"],
        budgetTier: "high",
      },
      {
        id: "gpt-4o",
        name: "GPT-4o",
        capabilities: ["chat", "vision", "streaming", "tool-use"],
        budgetTier: "standard",
      },
    ],
    authMethods: [{ type: "api", label: "API key" }],
    env: { apiKey: ["OPENAI_API_KEY"] },
    popular: true,
    requiresBaseUrl: false,
    noApiFallback: false,
  },
  {
    id: "anthropic",
    name: "Anthropic API",
    description: "Anthropic API key route for Claude models.",
    source: "builtin",
    defaultAuthMode: "api-key",
    defaultModel: "claude-sonnet-4-6",
    models: [
      {
        id: "claude-opus-4-7",
        name: "Claude Opus 4.7",
        capabilities: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use"],
        budgetTier: "premium",
      },
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        capabilities: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use"],
        budgetTier: "high",
      },
      {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        capabilities: ["chat", "streaming", "low-latency", "low-cost"],
        budgetTier: "low",
      },
    ],
    authMethods: [{ type: "api", label: "API key" }],
    env: { apiKey: ["ANTHROPIC_API_KEY"] },
    popular: true,
    requiresBaseUrl: false,
    noApiFallback: false,
  },
  {
    id: "google",
    name: "Google AI",
    description: "Google API key route for Gemini models.",
    source: "builtin",
    defaultAuthMode: "api-key",
    defaultModel: "gemini-3.5-flash",
    models: [
      {
        id: "gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        capabilities: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use", "low-latency"],
        budgetTier: "standard",
      },
      {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro Preview",
        capabilities: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use"],
        budgetTier: "high",
      },
      {
        id: "gemini-3-flash-preview",
        name: "Gemini 3 Flash Preview",
        capabilities: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use"],
        budgetTier: "standard",
      },
      {
        id: "gemini-3.1-flash-lite",
        name: "Gemini 3.1 Flash-Lite",
        capabilities: ["chat", "reasoning", "vision", "streaming", "low-latency", "low-cost"],
        budgetTier: "low",
      },
      {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        capabilities: ["chat", "reasoning", "coding", "vision", "streaming"],
        budgetTier: "high",
      },
      {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        capabilities: ["chat", "vision", "streaming", "low-latency", "low-cost"],
        budgetTier: "low",
      },
    ],
    authMethods: [{ type: "api", label: "API key" }],
    env: { apiKey: ["GOOGLE_API_KEY"] },
    popular: true,
    requiresBaseUrl: false,
    noApiFallback: false,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "OpenRouter API key route for routed model access.",
    source: "builtin",
    defaultAuthMode: "api-key",
    defaultModel: "openai/gpt-5.5",
    models: [
      {
        id: "openai/gpt-5.5",
        name: "OpenAI GPT-5.5",
        capabilities: ["chat", "reasoning", "coding", "vision", "streaming"],
        budgetTier: "premium",
      },
      {
        id: "openai/gpt-5.5-pro",
        name: "OpenAI GPT-5.5 Pro",
        capabilities: ["chat", "reasoning", "coding", "vision", "streaming"],
        budgetTier: "premium",
      },
      {
        id: "openai/gpt-5.4",
        name: "OpenAI GPT-5.4",
        capabilities: ["chat", "reasoning", "coding", "vision", "streaming"],
        budgetTier: "high",
      },
      {
        id: "openai/gpt-5.4-pro",
        name: "OpenAI GPT-5.4 Pro",
        capabilities: ["chat", "reasoning", "coding", "vision", "streaming"],
        budgetTier: "premium",
      },
      {
        id: "openai/gpt-5.4-mini",
        name: "OpenAI GPT-5.4 Mini",
        capabilities: ["chat", "reasoning", "coding", "streaming"],
        budgetTier: "standard",
      },
      {
        id: "openai/gpt-5.4-nano",
        name: "OpenAI GPT-5.4 Nano",
        capabilities: ["chat", "reasoning", "coding", "streaming", "low-cost"],
        budgetTier: "low",
      },
      {
        id: "anthropic/claude-opus-4.7",
        name: "Claude Opus 4.7",
        capabilities: ["chat", "reasoning", "coding", "streaming"],
        budgetTier: "high",
      },
      {
        id: "anthropic/claude-sonnet-4.6",
        name: "Claude Sonnet 4.6",
        capabilities: ["chat", "reasoning", "coding", "streaming"],
        budgetTier: "high",
      },
      {
        id: "google/gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        capabilities: ["chat", "reasoning", "coding", "streaming", "low-latency"],
        budgetTier: "standard",
      },
      {
        id: "google/gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro Preview",
        capabilities: ["chat", "reasoning", "coding", "streaming"],
        budgetTier: "high",
      },
    ],
    authMethods: [{ type: "api", label: "API key" }],
    env: { apiKey: ["OPENROUTER_API_KEY"] },
    popular: true,
    requiresBaseUrl: false,
    noApiFallback: false,
  },
  {
    id: "local",
    name: "Local Model",
    description: "Local OpenAI-compatible model endpoint.",
    source: "builtin",
    defaultAuthMode: "local",
    defaultModel: "local-model",
    models: [
      {
        id: "local-model",
        name: "Local Model",
        capabilities: ["chat", "coding", "streaming", "local", "low-cost"],
        budgetTier: "free",
      },
    ],
    authMethods: [{ type: "local", label: "Local endpoint" }],
    env: { baseUrl: ["LOCAL_MODEL_URL"] },
    popular: false,
    requiresBaseUrl: true,
    noApiFallback: false,
  },
  {
    id: "custom",
    name: "Custom API",
    description: "Custom OpenAI-compatible API endpoint.",
    source: "builtin",
    defaultAuthMode: "api-key",
    defaultModel: "custom-model",
    models: [
      {
        id: "custom-model",
        name: "Custom Model",
        capabilities: ["chat", "streaming"],
        budgetTier: "standard",
      },
    ],
    authMethods: [
      {
        type: "api",
        label: "API key",
        prompts: [
          {
            type: "text",
            key: "baseUrl",
            message: "Base URL",
            placeholder: "https://api.example.com/v1",
          },
        ],
      },
    ],
    env: {},
    popular: false,
    requiresBaseUrl: false,
    noApiFallback: false,
  },
] as const;

function cloneMethod(method: ProviderAuthMethod): ProviderAuthMethod {
  return {
    ...method,
    ...(method.prompts
      ? {
          prompts: method.prompts.map((prompt) => ({
            ...prompt,
            ...(prompt.type === "select" ? { options: [...prompt.options] } : {}),
          })),
        }
      : {}),
  };
}

function cloneConnector(connector: ProviderConnector): ProviderConnector {
  return {
    ...connector,
    models: connector.models.map((model) => ({
      ...model,
      capabilities: [...model.capabilities],
    })),
    authMethods: connector.authMethods.map(cloneMethod),
    env: {
      ...(connector.env.apiKey ? { apiKey: [...connector.env.apiKey] } : {}),
      ...(connector.env.accessToken ? { accessToken: [...connector.env.accessToken] } : {}),
      ...(connector.env.refreshToken ? { refreshToken: [...connector.env.refreshToken] } : {}),
      ...(connector.env.expiresAt ? { expiresAt: [...connector.env.expiresAt] } : {}),
      ...(connector.env.baseUrl ? { baseUrl: [...connector.env.baseUrl] } : {}),
    },
  };
}

function configuredModels(
  existing: ProviderModelInfo[],
  config?: ProviderConfigInput,
): ProviderModelInfo[] {
  const models = new Map(
    existing.map((model) => [model.id, { ...model, capabilities: [...model.capabilities] }]),
  );
  for (const [key, model] of Object.entries(config?.models ?? {})) {
    if (model.disabled) {
      models.delete(key);
      if (model.id) models.delete(model.id);
      continue;
    }
    const id = model.id ?? key;
    const existingModel = existing.find((item) => item.id === id);
    const configuredBudgetTier = model.budgetTier ?? model.budget_tier;
    models.set(id, {
      id,
      name: model.name ?? existingModel?.name ?? key,
      capabilities: model.capabilities ?? existingModel?.capabilities ?? ["chat"],
      budgetTier: configuredBudgetTier ?? existingModel?.budgetTier ?? "standard",
    });
  }
  return [...models.values()];
}

function applyProviderConfig(
  connector: ProviderConnector,
  config?: ProviderConfigInput,
): ProviderConnector {
  if (!config) return connector;
  const models = configuredModels(connector.models, config);
  const configuredDefaultModel =
    typeof config.options?.["defaultModel"] === "string" ? config.options["defaultModel"] : "";
  const defaultModel =
    configuredDefaultModel && models.some((model) => model.id === configuredDefaultModel)
      ? configuredDefaultModel
      : connector.defaultModel;
  const hasConfiguredBaseUrl =
    typeof config.options?.["baseURL"] === "string" ||
    typeof config.options?.["baseUrl"] === "string";
  return {
    ...connector,
    source: "config",
    ...(config.name ? { name: config.name } : {}),
    ...(config.description ? { description: config.description } : {}),
    defaultModel,
    models,
    env: {
      ...connector.env,
      ...(config.env ? { apiKey: [...config.env] } : {}),
    },
    ...(hasConfiguredBaseUrl ? { requiresBaseUrl: false } : {}),
  };
}

export function listProviderConnectors(config: ProviderCatalogConfig = {}): ProviderConnector[] {
  const disabled = new Set(config.disabled_providers ?? []);
  const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined;
  return CONNECTORS.flatMap((connector) => {
    if (enabled && !enabled.has(connector.id)) return [];
    if (disabled.has(connector.id)) return [];
    return [applyProviderConfig(cloneConnector(connector), config.provider?.[connector.id])];
  });
}

export function getProviderConnector(
  provider: ProviderType,
  config: ProviderCatalogConfig = {},
): ProviderConnector {
  const connector = listProviderConnectors(config).find((item) => item.id === provider);
  if (!connector) throw new Error(`unknown provider connector: ${provider}`);
  return connector;
}

export function providerAuthMethods(
  config: ProviderCatalogConfig = {},
): Record<string, ProviderAuthMethod[]> {
  return Object.fromEntries(
    listProviderConnectors(config).map((connector) => [
      connector.id,
      connector.authMethods.map(cloneMethod),
    ]),
  );
}

export function defaultProviderCredentialId(provider: ProviderType): string {
  return `${provider}-default`;
}

export function defaultProviderAuthMode(provider: ProviderType): ProviderConnectorAuthMode {
  return getProviderConnector(provider).defaultAuthMode;
}

export function resolveProviderCatalog(config: ProviderCatalogConfig = {}): ProviderCatalogResult {
  const all = listProviderConnectors(config);
  return {
    all,
    default: Object.fromEntries(all.map((connector) => [connector.id, connector.defaultModel])),
    configured: Object.keys(config.provider ?? {}).filter((id) =>
      all.some((connector) => connector.id === id),
    ),
    auth: providerAuthMethods(config),
  };
}

export function routeProfileForProviderModel(
  provider: ProviderType,
  modelId: string,
  config: ProviderCatalogConfig = {},
): ProviderRouteProfile {
  const connector = getProviderConnector(provider, config);
  const model =
    connector.models.find((item) => item.id === modelId) ??
    connector.models.find((item) => item.id === connector.defaultModel);
  return {
    model: modelId,
    capabilities: model ? [...model.capabilities] : ["chat"],
    budgetTier: model?.budgetTier ?? "standard",
  };
}
