import type {
  ProviderAdapter,
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
  "openai-codex": "gpt-5",
  openai: "gpt-5",
  anthropic: "claude-opus-4-7",
  google: "gemini-2.5-pro",
  openrouter: "openai/gpt-5",
  local: "llama3.1",
  custom: "gpt-5",
};

function toProviderType(provider: ProviderName): ProviderType {
  if (provider === "codex") return "openai-codex";
  return provider;
}

function providerId(provider: ProviderType): string {
  return `${provider}-default`;
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
      model: config.supreme_coordinator.model,
    };
  }
  const roleConfig = config.agents[roleId];
  return {
    provider: roleConfig?.provider ?? config.supreme_coordinator.provider,
    model: roleConfig?.model ?? config.supreme_coordinator.model,
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
  provider: ProviderAdapter,
): string {
  if (provider.defaultModel) return provider.defaultModel;
  const preference = roleModelPreference(config, roleId);
  if (toProviderType(preference.provider) === provider.type) return preference.model;
  return PROVIDER_DEFAULT_MODELS[provider.type];
}

export async function selectAgentModel(
  router: ProviderRouter,
  config: BureauConfig,
  roleId: string,
): Promise<AgentModelSelection | undefined> {
  const selected = await router.selectForAgent(roleId);
  if (!selected) return undefined;
  return {
    provider: selected.adapter,
    model: modelForSelection(config, roleId, selected.adapter),
    validation: selected.validation,
  };
}
