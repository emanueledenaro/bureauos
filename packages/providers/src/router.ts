import type { ProviderAdapter, ValidationResult } from "./types.js";

export interface ProviderSelection {
  adapter: ProviderAdapter;
  validation: ValidationResult;
}

/**
 * Provider router.
 *
 * Selects providers per agent role. Default BureauOS agent routing assigns one
 * owner-chosen provider; any longer chain must be built explicitly by policy.
 * Budget-aware routing and capability-aware routing land later in Phase 2.
 */
export class ProviderRouter {
  private readonly providers = new Map<string, ProviderAdapter>();
  private readonly assignments = new Map<string, string[]>();

  register(provider: ProviderAdapter): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Assign a provider chain to an agent role.
   * The first one is the route to try first; subsequent entries are only for
   * explicitly approved chains, never implicit API billing fallback.
   */
  assign(agentRole: string, providerIds: readonly string[]): void {
    this.assignments.set(agentRole, [...providerIds]);
  }

  get(providerId: string): ProviderAdapter | undefined {
    return this.providers.get(providerId);
  }

  chainForAgent(agentRole: string): readonly ProviderAdapter[] {
    const ids = this.assignments.get(agentRole) ?? [];
    return ids
      .map((id) => this.providers.get(id))
      .filter((adapter): adapter is ProviderAdapter => adapter !== undefined);
  }

  forAgent(agentRole: string): ProviderAdapter | undefined {
    return this.chainForAgent(agentRole)[0];
  }

  async selectForAgent(agentRole: string): Promise<ProviderSelection | undefined> {
    let openAICodexRouteFailed = false;
    for (const adapter of this.chainForAgent(agentRole)) {
      if (openAICodexRouteFailed && adapter.type === "openai") continue;
      const validation = await adapter.validateCredentials();
      if (validation.ok) return { adapter, validation };
      if (adapter.type === "openai-codex") openAICodexRouteFailed = true;
    }
    return undefined;
  }

  async validate(): Promise<ReadonlyMap<string, ValidationResult>> {
    const out = new Map<string, ValidationResult>();
    for (const [id, adapter] of this.providers) {
      out.set(id, await adapter.validateCredentials());
    }
    return out;
  }

  list(): readonly ProviderAdapter[] {
    return [...this.providers.values()];
  }
}
