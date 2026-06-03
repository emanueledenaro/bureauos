export interface ModelOverride {
  /**
   * A provider id matching a `ProviderType` (e.g. "anthropic", "openai", "google").
   * The override resolver looks up the adapter by `${provider}-default`, so any value
   * that is not a registered ProviderType degrades silently to the default selection.
   */
  provider: string;
  model: string;
}

/** Validate an untrusted `modelOverride` from a request body. Returns undefined for anything malformed. */
export function parseModelOverride(value: unknown): ModelOverride | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as { provider?: unknown; model?: unknown };
  const provider = typeof candidate.provider === "string" ? candidate.provider.trim() : "";
  const model = typeof candidate.model === "string" ? candidate.model.trim() : "";
  if (!provider || !model) return undefined;
  return { provider, model };
}
