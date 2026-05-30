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
  ProviderBudgetTier,
  ProviderRouteProfile,
  ValidationResult,
} from "./types.js";

export { ProviderRouter } from "./router.js";
export type { ProviderSelection, ProviderSelectionCriteria } from "./router.js";
export {
  defaultProviderAuthMode,
  defaultProviderCredentialId,
  getProviderConnector,
  listProviderConnectors,
  providerAuthMethods,
  resolveProviderCatalog,
  routeProfileForProviderModel,
} from "./catalog.js";
export type {
  ProviderAuthMethod,
  ProviderAuthMethodType,
  ProviderAuthPrompt,
  ProviderCatalogConfig,
  ProviderCatalogResult,
  ProviderConfigInput,
  ProviderConnector,
  ProviderConnectorAuthMode,
  ProviderEnvironmentMapping,
  ProviderModelInfo,
} from "./catalog.js";
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
export {
  OPENAI_CODEX_OAUTH_DEFAULT_MODEL,
  OPENAI_CODEX_OAUTH_MODELS,
  listOpenAICodexOAuthModelIDs,
  normalizeOpenAICodexOAuthModel,
} from "./openai-codex-models.js";
export type { OpenAICodexOAuthModel } from "./openai-codex-models.js";
export {
  OPENAI_CODEX_AUTHORIZE_URL,
  OPENAI_CODEX_CLIENT_ID,
  OPENAI_CODEX_DEFAULT_REDIRECT_URI,
  OPENAI_CODEX_SCOPE,
  OPENAI_CODEX_TOKEN_URL,
  createOpenAICodexAuthorization,
  createOpenAICodexCodeChallenge,
  createOpenAICodexCodeVerifier,
  createOpenAICodexState,
  exchangeOpenAICodexCode,
  parseOpenAICodexAuthorizationInput,
  refreshOpenAICodexToken,
} from "./openai-codex-oauth.js";
export type {
  OpenAICodexAuthorization,
  OpenAICodexOAuthFetch,
  OpenAICodexToken,
  ParsedOpenAICodexAuthorizationInput,
} from "./openai-codex-oauth.js";

export { OpenAIAdapter, NotConfiguredError } from "./adapters/openai.js";
export { OpenAICodexOAuthAdapter, OpenAICodexOAuthError } from "./adapters/openai-codex.js";
export { AnthropicAdapter } from "./adapters/anthropic.js";
export { GoogleAdapter } from "./adapters/google.js";
export { LocalAdapter } from "./adapters/local.js";
export { OpenRouterAdapter } from "./adapters/openrouter.js";
export { CodexRuntimeAdapter, CodexRuntimeError } from "./adapters/codex.js";
export type {
  CodexRuntimeAdapterOptions,
  CodexRuntimeRunner,
  CodexRuntimeRunnerInput,
  CodexRuntimeRunnerResult,
} from "./adapters/codex.js";
export {
  HostCodexRuntimeRunner,
  SubprocessHostCommandExecutor,
  GitStatusDiffInspector,
  parseGitPorcelain,
} from "./adapters/codex-host-runner.js";
export type {
  HostCodexRuntimeRunnerOptions,
  HostCodexCommand,
  HostCommandExecutor,
  HostCommandExecution,
  HostCommandResult,
  WorkspaceDiffInspector,
} from "./adapters/codex-host-runner.js";
