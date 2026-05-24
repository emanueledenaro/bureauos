import type { ProviderAdapter, ValidationResult } from "./types.js";

export interface ProviderSelection {
  adapter: ProviderAdapter;
  validation: ValidationResult;
}

/**
 * Provider router.
 *
 * Selects providers per agent role with fallback chains. Right now this is a
 * simple registry; budget-aware routing and capability-aware routing land
 * later in Phase 2.
 */
export class ProviderRouter {
  private readonly providers = new Map<string, ProviderAdapter>();
  private readonly assignments = new Map<string, string[]>();

  register(provider: ProviderAdapter): void {
    this.providers.set(provider.id, provider);
  }

  /**
   * Assign a chain of providers to an agent role.
   * The first one is the default; subsequent entries are fallbacks.
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
    for (const adapter of this.chainForAgent(agentRole)) {
      const validation = await adapter.validateCredentials();
      if (validation.ok) return { adapter, validation };
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
