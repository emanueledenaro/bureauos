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

const SetupConfig = z
  .object({
    preset: Preset.default("freelancer"),
    mode: AutonomyMode.default("safe_draft"),
    generated_by: z.string().default("bureau init"),
    advanced_config_required: z.boolean().default(false),
  })
  .default({});

const InterfaceConfig = z
  .object({
    enabled: z.boolean().default(true),
    mode: z.enum(["local_dashboard", "headless"]).default("local_dashboard"),
    mobile_first: z.boolean().default(true),
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
    required_model_capabilities: z.array(z.string()).default([]),
    max_budget_tier: ProviderBudgetTier.optional(),
    prefer_low_cost: z.boolean().default(false),
  })
  .default({});

const AutonomyConfig = z
  .object({
    observe_signals: z.boolean().default(true),
    start_triage_runs: z.boolean().default(true),
    create_internal_reports: z.boolean().default(true),
    create_repositories: z.boolean().default(true),
    create_issues: z.boolean().default(true),
    comment_on_issues: z.boolean().default(true),
    create_branches: z.boolean().default(true),
    push_commits: z.boolean().default(true),
    open_pull_requests: z.boolean().default(true),
    merge_pull_requests: z.boolean().default(false),
    deploy_production: z.boolean().default(false),
    contact_clients_directly: z.boolean().default(false),
  })
  .default({});

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

const MemoryConfig = z
  .object({
    coordinator_has_global_access: z.boolean().default(true),
    isolate_projects: z.boolean().default(true),
    write_decision_records: z.boolean().default(true),
    verify_live_state_when_cheap: z.boolean().default(true),
    retain_raw_history: z.boolean().default(true),
    promote_daily_notes_to_durable_memory: z.boolean().default(true),
    root_memory_always_loaded: z.boolean().default(true),
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
  })
  .passthrough();

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

export const BureauConfigSchema = z.object({
  organization: OrganizationConfig.default({ name: "Untitled BureauOS Workspace" }),
  setup: SetupConfig,
  interface: InterfaceConfig,
  supreme_coordinator: SupremeCoordinatorConfig,
  agents: z.record(z.string(), AgentConfig).default({}),
  autonomy: AutonomyConfig,
  growth_autonomy: GrowthAutonomyConfig,
  limits: LimitsConfig,
  memory: MemoryConfig,
  github: GitHubConfig,
  provider: z.record(z.string(), ProviderConfig).default({}),
  enabled_providers: z.array(z.string()).optional(),
  disabled_providers: z.array(z.string()).default([]),
  capabilities: z.record(z.string(), CapabilityConfig).default({}),
  triggers: TriggerConfig,
});

export type BureauConfig = z.infer<typeof BureauConfigSchema>;
