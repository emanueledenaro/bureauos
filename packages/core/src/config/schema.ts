import { z } from "zod";

/**
 * Schema for the BureauOS workspace configuration file (`bureauos.yaml`).
 *
 * Mirrors the example at `examples/bureauos.example.yaml`. Most fields are
 * optional with safe defaults so a minimal config still loads.
 */

const Preset = z.enum(["freelancer", "agency", "startup", "operator"]);
export type Preset = z.infer<typeof Preset>;

const AutonomyMode = z.enum([
  "safe_draft",
  "issue_only",
  "branch_and_pr",
  "business_operations",
  "custom",
]);
export type AutonomyMode = z.infer<typeof AutonomyMode>;

const AutonomyLevel = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

const AUTONOMY_LEVEL_NAMES: Record<AutonomyLevel, string> = {
  0: "Read Only",
  1: "Issue and Comment",
  2: "Branch and PR",
  3: "PR Maintenance",
  4: "Merge",
  5: "Release and Deploy",
};

export function autonomyLevelName(level: AutonomyLevel): string {
  return AUTONOMY_LEVEL_NAMES[level];
}

const ProviderName = z.enum([
  "openai-codex",
  "openai",
  "anthropic",
  "google",
  "local",
  "openrouter",
  "codex",
  "custom",
]);
export type ProviderName = z.infer<typeof ProviderName>;

const ProviderBudgetTier = z.enum(["free", "low", "standard", "high", "premium"]);

const ProviderConfig = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    env: z.array(z.string()).optional(),
    options: z.record(z.string(), z.unknown()).default({}),
    models: z
      .record(
        z.string(),
        z
          .object({
            id: z.string().optional(),
            name: z.string().optional(),
            capabilities: z.array(z.string()).optional(),
            budgetTier: ProviderBudgetTier.optional(),
            budget_tier: ProviderBudgetTier.optional(),
            disabled: z.boolean().optional(),
          })
          .passthrough(),
      )
      .default({}),
  })
  .passthrough();

const RiskClass = z.enum(["low", "medium", "high", "critical"]);
const CapabilityType = z.enum([
  "mcp",
  "runtime",
  "skill",
  "registry",
  "tool_bus",
  "shell",
  "browser",
  "custom",
]);
const CapabilityStatus = z.enum(["available", "configured", "designed", "blocked"]);

const OrganizationConfig = z.object({
  name: z.string().min(1).default("Untitled BureauOS Workspace"),
});

const AutoDetectConfig = z
  .object({
    git: z.boolean().default(true),
    github_remote: z.boolean().default(true),
    package_manager: z.boolean().default(true),
    test_commands: z.boolean().default(true),
    codex_capabilities: z.boolean().default(true),
    mcp_connectors: z.boolean().default(true),
  })
  .default({});

const SetupConfig = z
  .object({
    preset: Preset.default("freelancer"),
    mode: AutonomyMode.default("safe_draft"),
    generated_by: z.string().default("bureau init"),
    advanced_config_required: z.boolean().default(false),
    auto_detect: AutoDetectConfig,
  })
  .default({});

const InterfaceNotificationsConfig = z
  .object({
    approval_needed: z.boolean().default(true),
    high_risk_blocker: z.boolean().default(true),
    client_issue: z.boolean().default(true),
    revenue_opportunity: z.boolean().default(true),
    daily_report: z.boolean().default(true),
    low_value_activity: z.boolean().default(false),
  })
  .default({});

const InterfaceConfig = z
  .object({
    enabled: z.boolean().default(true),
    mode: z.enum(["local_dashboard", "headless"]).default("local_dashboard"),
    // Owner-facing UI language. "en" is the base; "it" is the second supported
    // locale (SER-236). The selection is persisted here and editable from the
    // Settings view.
    language: z.enum(["en", "it"]).default("en"),
    mobile_first: z.boolean().default(true),
    default_views: z.array(z.string()).default([]),
    notifications: InterfaceNotificationsConfig,
  })
  .default({});

const AgentConfig = z.object({
  provider: ProviderName.default("openai-codex"),
  model: z.string().default("gpt-5.5"),
  runtime: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
  required_model_capabilities: z.array(z.string()).default([]),
  max_budget_tier: ProviderBudgetTier.optional(),
  prefer_low_cost: z.boolean().default(false),
});

const SupremeCoordinatorConfig = z
  .object({
    provider: ProviderName.default("openai-codex"),
    model: z.string().default("gpt-5.5"),
    user_facing: z.boolean().default(true),
    always_on: z.boolean().default(true),
    memory: z
      .object({
        scope: z.enum(["global", "workspace"]).default("global"),
        root: z.string().default(".bureauos/memory/ROOT.md"),
        company: z.string().default(".bureauos/memory/COMPANY.md"),
        daily_notes: z.string().default(".bureauos/memory/memory"),
        decisions: z.string().default(".bureauos/memory/DECISIONS.md"),
        archive: z.string().default(".bureauos/memory/archive"),
        search_index: z.string().default(".bureauos/memory/indexes/memory.sqlite"),
      })
      .default({}),
    required_model_capabilities: z.array(z.string()).default([]),
    max_budget_tier: ProviderBudgetTier.optional(),
    prefer_low_cost: z.boolean().default(false),
  })
  .default({});

const AUTONOMY_ACTION_KEYS = [
  "observe_signals",
  "start_triage_runs",
  "create_internal_reports",
  "create_repositories",
  "create_issues",
  "comment_on_issues",
  "create_branches",
  "push_commits",
  "open_pull_requests",
  "merge_pull_requests",
  "deploy_production",
  "contact_clients_directly",
] as const;

type AutonomyActionKey = (typeof AUTONOMY_ACTION_KEYS)[number];

function autonomyPreset(level: AutonomyLevel): Record<AutonomyActionKey, boolean> {
  const readOnly: Record<AutonomyActionKey, boolean> = {
    observe_signals: true,
    start_triage_runs: false,
    create_internal_reports: false,
    create_repositories: false,
    create_issues: false,
    comment_on_issues: false,
    create_branches: false,
    push_commits: false,
    open_pull_requests: false,
    merge_pull_requests: false,
    deploy_production: false,
    contact_clients_directly: false,
  };

  if (level === 0) return readOnly;

  const issueOnly = {
    ...readOnly,
    start_triage_runs: true,
    create_internal_reports: true,
    create_issues: true,
    comment_on_issues: true,
  };
  if (level === 1) return issueOnly;

  const branchAndPr = {
    ...issueOnly,
    create_repositories: true,
    create_branches: true,
    push_commits: true,
    open_pull_requests: true,
  };
  if (level === 2 || level === 3) return branchAndPr;

  const merge = {
    ...branchAndPr,
    merge_pull_requests: true,
  };
  if (level === 4) return merge;

  return {
    ...merge,
    deploy_production: true,
  };
}

const AutonomyConfigInput = z
  .object({
    level: AutonomyLevel.default(2),
    observe_signals: z.boolean().optional(),
    start_triage_runs: z.boolean().optional(),
    create_internal_reports: z.boolean().optional(),
    create_repositories: z.boolean().optional(),
    create_issues: z.boolean().optional(),
    comment_on_issues: z.boolean().optional(),
    create_branches: z.boolean().optional(),
    push_commits: z.boolean().optional(),
    open_pull_requests: z.boolean().optional(),
    merge_pull_requests: z.boolean().optional(),
    deploy_production: z.boolean().optional(),
    contact_clients_directly: z.boolean().optional(),
  })
  .default({});

const AutonomyConfig = AutonomyConfigInput.transform((input) => {
  const overrides = Object.fromEntries(
    AUTONOMY_ACTION_KEYS.map((key) => [key, input[key]] as const).filter(
      (([, value]) => value !== undefined) as (
        entry: readonly [AutonomyActionKey, boolean | undefined],
      ) => entry is readonly [AutonomyActionKey, boolean],
    ),
  ) as Partial<Record<AutonomyActionKey, boolean>>;

  return {
    ...autonomyPreset(input.level),
    ...overrides,
    level: input.level,
  };
});

const GrowthAutonomyConfig = z
  .object({
    draft_content: z.boolean().default(true),
    draft_campaigns: z.boolean().default(true),
    draft_replies: z.boolean().default(true),
    draft_proposals: z.boolean().default(true),
    update_internal_pipeline: z.boolean().default(true),
    publish_public_content: z.boolean().default(false),
    send_client_messages: z.boolean().default(false),
    run_paid_ads: z.boolean().default(false),
    change_pricing: z.boolean().default(false),
    send_final_proposals: z.boolean().default(false),
    accept_projects: z.boolean().default(false),
    publish_social_posts: z.boolean().default(false),
    generate_public_creatives: z.boolean().default(true),
    launch_ad_campaigns: z.boolean().default(false),
    change_ad_budget: z.boolean().default(false),
    allow_one_off_owner_approval: z.boolean().default(true),
    require_action_sensitive_memory_for_approval: z.boolean().default(true),
  })
  .default({});

const LimitsConfig = z
  .object({
    max_retries_per_task: z.number().int().positive().default(2),
    max_files_changed_without_human_review: z.number().int().positive().default(8),
    require_tests_for_code_changes: z.boolean().default(true),
    require_security_review_for_auth_changes: z.boolean().default(true),
    require_security_review_for_payment_changes: z.boolean().default(true),
    require_human_for_destructive_actions: z.boolean().default(true),
  })
  .default({});

const RuntimeCommandConfig = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  label: z.string().optional(),
});
export type RuntimeCommandConfig = z.infer<typeof RuntimeCommandConfig>;

/**
 * Development-execution runtime settings.
 *
 * The host-backed Codex runner is disabled by default. When `codex.enabled` is
 * true, the kernel constructs a real subprocess-backed runner behind the
 * existing `CodexRuntimeAdapter` safety boundary. `allowed_commands` is the
 * binary allow-list the runner enforces before spawning, and `commands` is the
 * conservative verification/edit sequence it runs.
 */
const RuntimeConfig = z
  .object({
    codex: z
      .object({
        enabled: z.boolean().default(false),
        allowed_commands: z.array(z.string()).default(["pnpm", "npm", "yarn", "node", "git"]),
        commands: z.array(RuntimeCommandConfig).default([]),
        max_changed_files: z.number().int().positive().default(25),
        timeout_ms: z.number().int().positive().default(120_000),
        max_output_chars: z.number().int().positive().default(12_000),
      })
      .default({}),
  })
  .default({});

const MemoryConfig = z
  .object({
    coordinator_has_global_access: z.boolean().default(true),
    isolate_projects: z.boolean().default(true),
    write_decision_records: z.boolean().default(true),
    verify_live_state_when_cheap: z.boolean().default(true),
    retain_raw_history: z.boolean().default(true),
    promote_daily_notes_to_durable_memory: z.boolean().default(true),
    root_memory_always_loaded: z.boolean().default(true),
    semantic_index: z
      .object({
        enabled: z.boolean().default(false),
        // `none` keeps the safe no-op index. `local` enables the offline,
        // deterministic TF-IDF index over the markdown memory. `custom` defers
        // to a host-injected provider-backed index (no-op fallback otherwise).
        provider: z.enum(["none", "local", "custom"]).default("none"),
        index_path: z.string().default(".bureauos/memory/indexes/semantic"),
        // TF-IDF cosine similarities for real queries against markdown memory
        // sit well below the old 0.72 default, which suppressed essentially every
        // hit (SER-195). 0.1 keeps near-zero noise out while letting genuine
        // topical matches through; raise per-workspace for stricter recall.
        min_score: z.number().min(0).max(1).default(0.1),
      })
      .default({}),
    growth_memory: z
      .object({
        brand: z.string().default(".bureauos/memory/BRAND.md"),
        offers: z.string().default(".bureauos/memory/OFFERS.md"),
        channels: z.string().default(".bureauos/memory/CHANNELS.md"),
        leads: z.string().default(".bureauos/memory/LEADS.md"),
        campaigns: z.string().default(".bureauos/memory/CAMPAIGNS.md"),
        conversion_notes: z.string().default(".bureauos/memory/CONVERSION_NOTES.md"),
        pricing: z.string().default(".bureauos/memory/PRICING.md"),
        proposals: z.string().default(".bureauos/memory/PROPOSALS.md"),
      })
      .default({}),
    client_intelligence: z
      .object({
        clients_root: z.string().default(".bureauos/memory/clients"),
        profile: z.string().default("CLIENT.md"),
        revenue: z.string().default("REVENUE.md"),
        relationship: z.string().default("RELATIONSHIP.md"),
        permissions: z.string().default("PERMISSIONS.md"),
        communication: z.string().default("COMMUNICATION.md"),
        opportunities: z.string().default("OPPORTUNITIES.md"),
        projects: z.string().default("PROJECTS.md"),
      })
      .default({}),
  })
  .default({});

const GitHubConfig = z
  .object({
    source_of_truth: z.boolean().default(true),
    use_issues: z.boolean().default(true),
    use_labels: z.boolean().default(true),
    use_comments: z.boolean().default(true),
    use_pull_requests: z.boolean().default(true),
    use_checks: z.boolean().default(true),
  })
  .default({});

const CapabilityConfig = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    type: CapabilityType.default("custom"),
    allowed_agents: z.array(z.string()).default([]),
    actions: z.record(z.string(), z.boolean()).default({}),
    required_approvals: z.array(z.string()).default([]),
    risk_class: RiskClass.default("medium"),
    audit_required: z.boolean().default(true),
    status: CapabilityStatus.default("configured"),
    connector: z.string().optional(),
    high_risk_actions_require_policy: z.boolean().default(false),
  })
  .passthrough();

const BusinessConfig = z
  .object({
    primary_objective: z.string().default("sustainable_owner_profit"),
    optimize_for: z.array(z.string()).default([]),
    metrics: z
      .object({
        track_pipeline_value: z.boolean().default(true),
        track_expected_margin: z.boolean().default(true),
        track_delivery_capacity: z.boolean().default(true),
        track_payment_status: z.boolean().default(false),
        track_client_retention_risk: z.boolean().default(true),
        track_marketing_performance: z.boolean().default(true),
        track_client_lifetime_value: z.boolean().default(true),
        track_client_profitability: z.boolean().default(true),
        track_client_value_score: z.boolean().default(true),
      })
      .default({}),
    policies: z
      .object({
        minimum_margin_required: z.boolean().default(true),
        require_delivery_review_before_proposal: z.boolean().default(true),
        require_compliance_review_before_external_commitment: z.boolean().default(true),
        require_owner_approval_for_price_commitment: z.boolean().default(true),
      })
      .default({}),
    require_owner_approval_for: z.array(z.string()).default([]),
  })
  .default({});

const OpenSourceConfig = z
  .object({
    goal: z.string().default("widely_adopted_owner_operator_agency_os"),
    optimize_for: z.array(z.string()).default([]),
  })
  .default({});

const TriggerConfig = z
  .object({
    github: z
      .object({
        enabled: z.boolean().default(true),
        watch_issues: z.boolean().default(true),
        watch_pull_requests: z.boolean().default(true),
        watch_checks: z.boolean().default(true),
        watch_security_alerts: z.boolean().default(true),
      })
      .default({}),
    schedules: z
      .object({
        project_health_check: z.string().default("hourly"),
        daily_executive_report: z.string().default("daily"),
        growth_review: z.string().default("weekly"),
        client_account_review: z.string().default("weekly"),
      })
      .default({}),
    thresholds: z
      .object({
        stale_pr_hours: z.number().positive().default(48),
        blocked_issue_hours: z.number().positive().default(48),
        unanswered_client_message_hours: z.number().positive().default(48),
        empty_content_pipeline_days: z.number().positive().default(7),
      })
      .default({}),
  })
  .default({});

export const BureauConfigSchema = z
  .object({
    organization: OrganizationConfig.default({ name: "Untitled BureauOS Workspace" }),
    setup: SetupConfig,
    interface: InterfaceConfig,
    supreme_coordinator: SupremeCoordinatorConfig,
    agents: z.record(z.string(), AgentConfig).default({}),
    autonomy: AutonomyConfig,
    growth_autonomy: GrowthAutonomyConfig,
    business: BusinessConfig,
    open_source: OpenSourceConfig,
    limits: LimitsConfig,
    runtime: RuntimeConfig,
    memory: MemoryConfig,
    github: GitHubConfig,
    provider: z.record(z.string(), ProviderConfig).default({}),
    enabled_providers: z.array(z.string()).optional(),
    disabled_providers: z.array(z.string()).default([]),
    capabilities: z.record(z.string(), CapabilityConfig).default({}),
    triggers: TriggerConfig,
  })
  .strict();

export type BureauConfig = z.infer<typeof BureauConfigSchema>;
