export const VERSION = "0.0.0";

export type {
  ProviderAdapter,
  ProviderType,
  RuntimeAdapter,
  RuntimeType,
  RuntimeContext,
  RuntimeTask,
  RuntimeResult,
  GenerateTextOptions,
  GenerateTextResult,
  ValidationResult,
} from "./types.js";

export { ProviderRouter } from "./router.js";
export type { ProviderSelection } from "./router.js";
export { buildConfiguredProviderRouter } from "./configured-router.js";
export type {
  ConfiguredProviderRouter,
  ProviderConnection,
  ProviderConnectionSource,
  ProviderEnv,
} from "./configured-router.js";
export { ProviderAuthStore, maskSecret, providerAuthPath } from "./auth-store.js";
export type {
  ProviderAuthMode,
  ProviderCredentialInput,
  ProviderCredentialRecord,
} from "./auth-store.js";

export { OpenAIAdapter, NotConfiguredError } from "./adapters/openai.js";
export { OAuthBridgeNotConfiguredError, OpenAICodexOAuthAdapter } from "./adapters/openai-codex.js";
export { AnthropicAdapter } from "./adapters/anthropic.js";
export { GoogleAdapter } from "./adapters/google.js";
export { LocalAdapter } from "./adapters/local.js";
export { OpenRouterAdapter } from "./adapters/openrouter.js";
export { CodexRuntimeAdapter } from "./adapters/codex.js";
