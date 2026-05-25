import { routeProfileForProviderModel } from "@bureauos/providers";
import type {
  ProviderAdapter,
  ProviderSelection,
  ProviderSelectionCriteria,
  ProviderRouter,
  ProviderType,
  ValidationResult,
} from "@bureauos/providers";
import type { BureauConfig, ProviderName } from "../config/schema.js";
import { AGENT_INDEX, AGENT_ROLES, type AgentDefinition } from "./roles.js";

export const MODEL_PROVIDER_CAPABILITY = "bureauos.capabilities.model_provider";

export interface AgentModelSelection {
  provider: ProviderAdapter;
  model: string;
  validation: ValidationResult;
}

const PROVIDER_DEFAULT_MODELS: Record<ProviderType, string> = {
  "openai-codex": "gpt-5.5",
  openai: "gpt-5.5",
  anthropic: "claude-opus-4-7",
  google: "gemini-3.5-flash",
  openrouter: "openai/gpt-5.5",
  local: "llama3.1",
  custom: "gpt-5.5",
};
const CODEX_OAUTH_DEFAULT_MODEL = PROVIDER_DEFAULT_MODELS["openai-codex"];

function toProviderType(provider: ProviderName): ProviderType {
  if (provider === "codex") return "openai-codex";
  return provider;
}

function providerId(provider: ProviderType): string {
  return `${provider}-default`;
}

function normalizedModelForProvider(provider: ProviderName, model: string): string {
  const providerType = toProviderType(provider);
  if (providerType !== "openai-codex" && model === CODEX_OAUTH_DEFAULT_MODEL) {
    return PROVIDER_DEFAULT_MODELS[providerType];
  }
  return model;
}

function defaultRequiredModelCapabilities(role: AgentDefinition): string[] {
  const capabilities = new Set<string>(["chat"]);
  if (
    ["supreme_coordinator", "qa", "security", "reviewer", "compliance", "pricing"].includes(role.id)
  ) {
    capabilities.add("reasoning");
  }
  if (role.id === "development") capabilities.add("coding");
  if (role.id === "creative") capabilities.add("vision");
  return [...capabilities];
}

function roleModelPreference(
  config: BureauConfig,
  roleId: string,
): {
  provider: ProviderName;
  model: string;
} {
  if (roleId === "supreme_coordinator") {
    return {
      provider: config.supreme_coordinator.provider,
      model: normalizedModelForProvider(
        config.supreme_coordinator.provider,
        config.supreme_coordinator.model,
      ),
    };
  }
  const roleConfig = config.agents[roleId];
  const provider = roleConfig?.provider ?? config.supreme_coordinator.provider;
  const model = roleConfig?.model ?? config.supreme_coordinator.model;
  return {
    provider,
    model: normalizedModelForProvider(provider, model),
  };
}

function roleSelectionCriteria(
  config: BureauConfig,
  role: AgentDefinition,
): ProviderSelectionCriteria {
  const roleConfig =
    role.id === "supreme_coordinator" ? config.supreme_coordinator : config.agents[role.id];
  const preference = roleModelPreference(config, role.id);
  const preferredProviderType = toProviderType(preference.provider);
  const preferredProviderId = providerId(preferredProviderType);
  const requiredCapabilities = new Set(defaultRequiredModelCapabilities(role));
  for (const capability of roleConfig?.required_model_capabilities ?? [])
    requiredCapabilities.add(capability);
  return {
    requiredCapabilities: [...requiredCapabilities],
    ...(roleConfig?.max_budget_tier ? { maxBudgetTier: roleConfig.max_budget_tier } : {}),
    ...(roleConfig?.prefer_low_cost ? { preferLowCost: true } : {}),
    routeProfiles: {
      [preferredProviderId]: routeProfileForProviderModel(
        preferredProviderType,
        preference.model,
        config,
      ),
    },
  };
}

export function providerChainForRole(
  config: BureauConfig,
  role: AgentDefinition,
): readonly string[] {
  const preference = roleModelPreference(config, role.id);
  return [providerId(toProviderType(preference.provider))];
}

export function configureAgentProviderRouting(
  router: ProviderRouter,
  config: BureauConfig,
  roleIds: readonly string[] = AGENT_ROLES.map((role) => role.id),
): void {
  for (const roleId of roleIds) {
    const role = AGENT_INDEX.get(roleId);
    if (!role) continue;
    router.assign(roleId, providerChainForRole(config, role));
  }
}

function modelForSelection(
  config: BureauConfig,
  roleId: string,
  selection: ProviderSelection,
): string {
  const provider = selection.adapter;
  const preference = roleModelPreference(config, roleId);
  if (toProviderType(preference.provider) === provider.type) return preference.model;
  if (selection.profile.model) return selection.profile.model;
  if (provider.defaultModel) return provider.defaultModel;
  return PROVIDER_DEFAULT_MODELS[provider.type];
}

export async function selectAgentModel(
  router: ProviderRouter,
  config: BureauConfig,
  roleId: string,
): Promise<AgentModelSelection | undefined> {
  const role = AGENT_INDEX.get(roleId);
  const selected = await router.selectForAgent(
    roleId,
    role ? roleSelectionCriteria(config, role) : {},
  );
  if (!selected) return undefined;
  return {
    provider: selected.adapter,
    model: modelForSelection(config, roleId, selected),
    validation: selected.validation,
  };
}
