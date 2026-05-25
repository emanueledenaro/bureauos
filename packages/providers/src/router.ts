import type {
  ProviderAdapter,
  ProviderBudgetTier,
  ProviderRouteProfile,
  ValidationResult,
} from "./types.js";

export interface ProviderSelection {
  adapter: ProviderAdapter;
  validation: ValidationResult;
  profile: ProviderRouteProfile;
}

export interface ProviderSelectionCriteria {
  requiredCapabilities?: readonly string[];
  maxBudgetTier?: ProviderBudgetTier;
  preferLowCost?: boolean;
  routeProfiles?: Readonly<Record<string, Partial<ProviderRouteProfile>>>;
}

/**
 * Provider router.
 *
 * Selects providers per agent role. Default BureauOS agent routing assigns one
 * owner-chosen provider; any longer chain must be built explicitly by policy.
 */
export class ProviderRouter {
  private readonly providers = new Map<string, ProviderAdapter>();
  private readonly profiles = new Map<string, ProviderRouteProfile>();
  private readonly assignments = new Map<string, string[]>();

  register(provider: ProviderAdapter, profile: Partial<ProviderRouteProfile> = {}): void {
    this.providers.set(provider.id, provider);
    this.profiles.set(provider.id, normalizeProfile(provider, profile));
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

  profileFor(providerId: string): ProviderRouteProfile | undefined {
    const profile = this.profiles.get(providerId);
    if (!profile) return undefined;
    return {
      ...profile,
      capabilities: [...profile.capabilities],
    };
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

  async selectForAgent(
    agentRole: string,
    criteria: ProviderSelectionCriteria = {},
  ): Promise<ProviderSelection | undefined> {
    const candidates: Array<ProviderSelection & { index: number }> = [];
    let openAICodexRouteFailed = false;

    for (const [index, adapter] of this.chainForAgent(agentRole).entries()) {
      if (openAICodexRouteFailed && adapter.type === "openai") continue;
      const profile = normalizeProfile(adapter, {
        ...(this.profiles.get(adapter.id) ?? {}),
        ...(criteria.routeProfiles?.[adapter.id] ?? {}),
      });
      if (!matchesCriteria(profile, criteria)) {
        if (adapter.type === "openai-codex") openAICodexRouteFailed = true;
        continue;
      }
      const validation = await adapter.validateCredentials();
      if (validation.ok) candidates.push({ adapter, validation, profile, index });
      if (adapter.type === "openai-codex") openAICodexRouteFailed = true;
    }

    if (!criteria.preferLowCost) return candidates[0];
    return candidates.sort(
      (left, right) =>
        budgetRank(left.profile.budgetTier) - budgetRank(right.profile.budgetTier) ||
        left.index - right.index,
    )[0];
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

const DEFAULT_CAPABILITIES_BY_TYPE: Record<ProviderAdapter["type"], readonly string[]> = {
  "openai-codex": ["chat", "reasoning", "coding", "vision", "streaming", "oauth"],
  openai: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use"],
  anthropic: ["chat", "reasoning", "coding", "vision", "streaming", "tool-use"],
  google: ["chat", "reasoning", "coding", "streaming", "vision"],
  openrouter: ["chat", "reasoning", "coding", "streaming"],
  local: ["chat", "coding", "streaming", "local", "low-cost"],
  custom: ["chat", "streaming"],
};

const DEFAULT_BUDGET_BY_TYPE: Record<ProviderAdapter["type"], ProviderBudgetTier> = {
  "openai-codex": "standard",
  openai: "high",
  anthropic: "high",
  google: "standard",
  openrouter: "standard",
  local: "free",
  custom: "standard",
};

const BUDGET_RANK: Record<ProviderBudgetTier, number> = {
  free: 0,
  low: 1,
  standard: 2,
  high: 3,
  premium: 4,
};

function normalizeProfile(
  provider: ProviderAdapter,
  profile: Partial<ProviderRouteProfile> = {},
): ProviderRouteProfile {
  return {
    model: profile.model ?? provider.defaultModel,
    capabilities: profile.capabilities ?? DEFAULT_CAPABILITIES_BY_TYPE[provider.type],
    budgetTier: profile.budgetTier ?? DEFAULT_BUDGET_BY_TYPE[provider.type],
  };
}

function budgetRank(tier: ProviderBudgetTier): number {
  return BUDGET_RANK[tier];
}

function matchesCriteria(
  profile: ProviderRouteProfile,
  criteria: ProviderSelectionCriteria,
): boolean {
  const capabilities = new Set(profile.capabilities);
  for (const capability of criteria.requiredCapabilities ?? []) {
    if (!capabilities.has(capability)) return false;
  }
  if (criteria.maxBudgetTier && budgetRank(profile.budgetTier) > budgetRank(criteria.maxBudgetTier))
    return false;
  return true;
}
