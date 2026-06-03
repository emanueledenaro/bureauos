import type { ProviderConnection } from "./api";

export interface ModelOption {
  provider: string;
  providerName: string;
  model: string;
}

export function buildModelOptions(providers: ProviderConnection[]): ModelOption[] {
  return providers
    .filter((p) => p.status === "ok")
    .map((p) => ({ provider: p.provider, providerName: p.provider_name, model: p.default_model }));
}

export function activeModelLabel(providers: ProviderConnection[]): string {
  const ok = providers.find((p) => p.status === "ok");
  return ok ? `${ok.provider_name} · ${ok.default_model}` : "No model connected";
}
