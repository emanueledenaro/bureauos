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

export { OpenAIAdapter, NotConfiguredError } from "./adapters/openai.js";
export { AnthropicAdapter } from "./adapters/anthropic.js";
export { GoogleAdapter } from "./adapters/google.js";
export { LocalAdapter } from "./adapters/local.js";
export { OpenRouterAdapter } from "./adapters/openrouter.js";
export { CodexRuntimeAdapter } from "./adapters/codex.js";
