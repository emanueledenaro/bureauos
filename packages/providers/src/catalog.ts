import type { ProviderType } from "./types.js";

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

export interface ProviderConnector {
  id: ProviderType;
  name: string;
  description: string;
  defaultAuthMode: ProviderConnectorAuthMode;
  authMethods: ProviderAuthMethod[];
  env: ProviderEnvironmentMapping;
  popular: boolean;
  requiresBaseUrl: boolean;
  noApiFallback: boolean;
}

const CONNECTORS: readonly ProviderConnector[] = [
  {
    id: "openai-codex",
    name: "OpenAI Codex",
    description: "Browser OAuth route for ChatGPT Plus/Pro Codex access.",
    defaultAuthMode: "oauth",
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
    defaultAuthMode: "api-key",
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
    defaultAuthMode: "api-key",
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
    defaultAuthMode: "api-key",
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
    defaultAuthMode: "api-key",
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
    defaultAuthMode: "local",
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
    defaultAuthMode: "api-key",
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

export function listProviderConnectors(): ProviderConnector[] {
  return CONNECTORS.map((connector) => ({ ...connector, authMethods: [...connector.authMethods] }));
}

export function getProviderConnector(provider: ProviderType): ProviderConnector {
  const connector = CONNECTORS.find((item) => item.id === provider);
  if (!connector) throw new Error(`unknown provider connector: ${provider}`);
  return { ...connector, authMethods: [...connector.authMethods] };
}

export function providerAuthMethods(): Record<string, ProviderAuthMethod[]> {
  return Object.fromEntries(
    CONNECTORS.map((connector) => [
      connector.id,
      connector.authMethods.map((method) => ({
        ...method,
        ...(method.prompts ? { prompts: [...method.prompts] } : {}),
      })),
    ]),
  );
}

export function defaultProviderCredentialId(provider: ProviderType): string {
  return `${provider}-default`;
}

export function defaultProviderAuthMode(provider: ProviderType): ProviderConnectorAuthMode {
  return getProviderConnector(provider).defaultAuthMode;
}
