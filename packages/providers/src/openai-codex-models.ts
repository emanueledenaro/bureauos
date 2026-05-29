import type { ProviderBudgetTier } from "./types.js";

export interface OpenAICodexOAuthModel {
  id: string;
  name: string;
  capabilities: string[];
  budgetTier: ProviderBudgetTier;
}

export const OPENAI_CODEX_OAUTH_DEFAULT_MODEL = "gpt-5.5";

// Keep this list aligned with the OpenAI Codex rate card for ChatGPT sign-in usage.
export const OPENAI_CODEX_OAUTH_MODELS: OpenAICodexOAuthModel[] = [
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    capabilities: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use", "oauth"],
    budgetTier: "premium",
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    capabilities: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use", "oauth"],
    budgetTier: "high",
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    capabilities: [
      "chat",
      "reasoning",
      "coding",
      "vision",
      "streaming",
      "tool-use",
      "oauth",
      "low-latency",
    ],
    budgetTier: "standard",
  },
  {
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    capabilities: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use", "oauth"],
    budgetTier: "high",
  },
  {
    id: "gpt-5.2",
    name: "GPT-5.2",
    capabilities: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use", "oauth"],
    budgetTier: "high",
  },
  {
    id: "gpt-5.3-codex-spark",
    name: "GPT-5.3 Codex Spark",
    capabilities: [
      "chat",
      "reasoning",
      "coding",
      "vision",
      "streaming",
      "tool-use",
      "oauth",
      "preview",
      "low-latency",
    ],
    budgetTier: "premium",
  },
];

const DEPRECATED_CODEX_MODEL_ALIASES = new Set([
  "codex-mini-latest",
  "gpt-5",
  "gpt-5-codex",
  "gpt-5-codex-mini",
  "gpt-5.1-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.2-codex",
]);

export function normalizeOpenAICodexOAuthModel(model?: string): string {
  if (!model) return OPENAI_CODEX_OAUTH_DEFAULT_MODEL;
  const id = model.includes("/") ? model.split("/").pop() || model : model;
  if (DEPRECATED_CODEX_MODEL_ALIASES.has(id)) return OPENAI_CODEX_OAUTH_DEFAULT_MODEL;
  return id;
}

export function listOpenAICodexOAuthModelIDs(defaultModel?: string): string[] {
  const normalizedDefault = normalizeOpenAICodexOAuthModel(defaultModel);
  const knownIDs = OPENAI_CODEX_OAUTH_MODELS.map((model) => model.id);
  return [normalizedDefault, ...knownIDs.filter((model) => model !== normalizedDefault)];
}
