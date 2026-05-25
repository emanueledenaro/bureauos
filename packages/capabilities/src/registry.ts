import type {
  CapabilityDefinition,
  CapabilityStatus,
  CapabilityType,
  CapabilityUseDecision,
  CapabilityUseRequest,
  RiskClass,
} from "./types.js";

export interface CapabilityConfigInput {
  name?: string;
  description?: string;
  type?: CapabilityType;
  allowed_agents?: readonly string[];
  actions?: Readonly<Record<string, boolean>>;
  required_approvals?: readonly string[];
  risk_class?: RiskClass;
  audit_required?: boolean;
  status?: CapabilityStatus;
  connector?: string;
}

export const DEFAULT_CAPABILITIES: readonly CapabilityDefinition[] = [
  {
    id: "codex",
    name: "Codex Runtime",
    description: "Repository execution runtime for development, review, QA, tests, and PR work.",
    type: "runtime",
    allowed_agents: ["development", "reviewer", "qa", "security"],
    actions: {
      read_repo: true,
      edit_code: true,
      run_tests: true,
      open_pr: true,
      merge_pr: false,
      deploy: false,
    },
    required_approvals: ["linked_issue", "tests_required"],
    risk_class: "high",
    audit_required: true,
    status: "designed",
    connector: "codex",
  },
  {
    id: "github",
    name: "GitHub",
    description: "GitHub issues, labels, pull requests, comments, checks, and repository signals.",
    type: "mcp",
    allowed_agents: ["supreme_coordinator", "project_manager", "development", "reviewer", "qa"],
    actions: {
      read_issues: true,
      create_issues: true,
      comment: true,
      read_prs: true,
      open_pr: true,
      merge_pr: false,
      read_checks: true,
    },
    required_approvals: [],
    risk_class: "medium",
    audit_required: true,
    status: "configured",
    connector: "github",
  },
  {
    id: "skills",
    name: "Skill Registry",
    description: "Approved reusable operating procedures, templates, scripts, and workflows.",
    type: "registry",
    allowed_agents: [
      "supreme_coordinator",
      "project_manager",
      "development",
      "qa",
      "security",
      "marketing",
      "compliance",
    ],
    actions: {
      inspect: true,
      use_skill: true,
      install_skill: false,
      modify_skill: false,
    },
    required_approvals: [],
    risk_class: "low",
    audit_required: true,
    status: "designed",
    connector: "skills",
  },
  {
    id: "mcp",
    name: "MCP Tool Bus",
    description: "Controlled tool bus for external services and local tool resources.",
    type: "tool_bus",
    allowed_agents: [
      "supreme_coordinator",
      "project_manager",
      "development",
      "reviewer",
      "qa",
      "security",
      "marketing",
      "sales",
      "compliance",
    ],
    actions: {
      inspect: true,
      call_tool: true,
      add_server: false,
      remove_server: false,
      authorize_server: false,
    },
    required_approvals: [],
    risk_class: "medium",
    audit_required: true,
    status: "designed",
    connector: "mcp",
  },
  {
    id: "browser",
    name: "Browser Automation",
    description: "Local browser checks, screenshots, and UI verification.",
    type: "browser",
    allowed_agents: ["qa", "reviewer", "development", "supreme_coordinator"],
    actions: {
      inspect_page: true,
      screenshot: true,
      click_test: true,
      submit_forms: false,
    },
    required_approvals: [],
    risk_class: "medium",
    audit_required: true,
    status: "designed",
    connector: "browser",
  },
  {
    id: "ads_platform",
    name: "Ads Platform",
    description: "Draft-first advertising campaign, creative, targeting, and budget operations.",
    type: "mcp",
    allowed_agents: ["ads", "marketing", "compliance", "supreme_coordinator"],
    actions: {
      read_campaigns: true,
      draft_campaigns: true,
      generate_creatives: true,
      launch_campaigns: false,
      change_budget: false,
    },
    required_approvals: ["paid_ad_spend", "ad_campaign_launch"],
    risk_class: "high",
    audit_required: true,
    status: "designed",
    connector: "ads",
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Billing, subscriptions, invoices, and payments operations.",
    type: "mcp",
    allowed_agents: ["pricing", "sales", "compliance", "supreme_coordinator"],
    actions: {
      read_billing: true,
      draft_price_change: true,
      change_price: false,
      refund_payment: false,
    },
    required_approvals: ["billing_change"],
    risk_class: "critical",
    audit_required: true,
    status: "designed",
    connector: "stripe",
  },
  {
    id: "client_communications",
    name: "Client Communications",
    description: "Email, Slack, calendar, CRM, and client-message drafting/sending.",
    type: "mcp",
    allowed_agents: ["client_success", "sales", "proposal", "supreme_coordinator"],
    actions: {
      draft_reply: true,
      draft_proposal_message: true,
      schedule_follow_up: true,
      send_message: false,
    },
    required_approvals: ["client_send"],
    risk_class: "high",
    audit_required: true,
    status: "designed",
    connector: "communications",
  },
  {
    id: "deployment",
    name: "Deployment",
    description: "Vercel, hosting, environments, release checks, and production deployment.",
    type: "mcp",
    allowed_agents: ["release", "development", "reviewer", "supreme_coordinator"],
    actions: {
      read_deployments: true,
      create_preview: true,
      deploy_production: false,
      change_domains: false,
    },
    required_approvals: ["production_deploy"],
    risk_class: "critical",
    audit_required: true,
    status: "designed",
    connector: "vercel",
  },
];

function mergeCapability(
  base: CapabilityDefinition,
  override?: CapabilityConfigInput,
): CapabilityDefinition {
  if (!override) return { ...base, actions: { ...base.actions } };
  return {
    ...base,
    ...override,
    id: base.id,
    name: override.name ?? base.name,
    description: override.description ?? base.description,
    type: override.type ?? base.type,
    allowed_agents: override.allowed_agents
      ? [...override.allowed_agents]
      : [...base.allowed_agents],
    actions: { ...base.actions, ...(override.actions ?? {}) },
    required_approvals: override.required_approvals
      ? [...override.required_approvals]
      : [...base.required_approvals],
    risk_class: override.risk_class ?? base.risk_class,
    audit_required: override.audit_required ?? base.audit_required,
    status: override.status ?? (override ? "configured" : base.status),
    connector: override.connector ?? base.connector,
  };
}

function definitionFromConfig(id: string, input: CapabilityConfigInput): CapabilityDefinition {
  return {
    id,
    name: input.name ?? id,
    description: input.description ?? "",
    type: input.type ?? "custom",
    allowed_agents: input.allowed_agents ? [...input.allowed_agents] : [],
    actions: { ...(input.actions ?? {}) },
    required_approvals: input.required_approvals ? [...input.required_approvals] : [],
    risk_class: input.risk_class ?? "medium",
    audit_required: input.audit_required ?? true,
    status: input.status ?? "configured",
    ...(input.connector ? { connector: input.connector } : {}),
  };
}

export function defaultCapabilityConfig(): Record<string, CapabilityConfigInput> {
  return Object.fromEntries(
    DEFAULT_CAPABILITIES.map((capability) => [
      capability.id,
      {
        type: capability.type,
        allowed_agents: capability.allowed_agents,
        actions: capability.actions,
        required_approvals: capability.required_approvals,
        risk_class: capability.risk_class,
        audit_required: capability.audit_required,
        status: capability.status,
        ...(capability.connector ? { connector: capability.connector } : {}),
      },
    ]),
  );
}

export class CapabilityRegistry {
  private readonly capabilities: Map<string, CapabilityDefinition>;

  constructor(definitions: readonly CapabilityDefinition[] = DEFAULT_CAPABILITIES) {
    this.capabilities = new Map(
      definitions.map((definition) => [
        definition.id,
        { ...definition, actions: { ...definition.actions } },
      ]),
    );
  }

  static fromConfig(config: Record<string, CapabilityConfigInput> = {}): CapabilityRegistry {
    const merged: CapabilityDefinition[] = [];
    const seen = new Set<string>();

    for (const base of DEFAULT_CAPABILITIES) {
      merged.push(mergeCapability(base, config[base.id]));
      seen.add(base.id);
    }

    for (const [id, input] of Object.entries(config)) {
      if (seen.has(id)) continue;
      merged.push(definitionFromConfig(id, input));
    }

    return new CapabilityRegistry(merged);
  }

  list(): CapabilityDefinition[] {
    return [...this.capabilities.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  get(id: string): CapabilityDefinition | undefined {
    const capability = this.capabilities.get(id);
    return capability ? { ...capability, actions: { ...capability.actions } } : undefined;
  }

  forAgent(agent: string): CapabilityDefinition[] {
    return this.list().filter((capability) => this.agentAllowed(capability, agent));
  }

  check(request: CapabilityUseRequest): CapabilityUseDecision {
    const capability = this.capabilities.get(request.capability_id);
    if (!capability) {
      return {
        capability_id: request.capability_id,
        agent: request.agent,
        action: request.action,
        allowed: false,
        reason: "capability is not registered",
        required_approvals: [],
        risk_class: "medium",
        audit_required: true,
        status: "blocked",
      };
    }

    const base = {
      capability_id: capability.id,
      agent: request.agent,
      action: request.action,
      required_approvals: capability.required_approvals,
      risk_class: capability.risk_class,
      audit_required: capability.audit_required,
      status: capability.status,
    };

    if (!this.agentAllowed(capability, request.agent)) {
      return {
        ...base,
        allowed: false,
        reason: `agent "${request.agent}" is not assigned to capability "${capability.id}"`,
      };
    }

    if (capability.actions[request.action] !== true) {
      return {
        ...base,
        allowed: false,
        reason: `action "${request.action}" is disabled for capability "${capability.id}"`,
      };
    }

    if (capability.status === "blocked") {
      return {
        ...base,
        allowed: false,
        reason: `capability "${capability.id}" is blocked`,
      };
    }

    return {
      ...base,
      allowed: true,
      reason: `agent "${request.agent}" may use ${capability.id}.${request.action}`,
    };
  }

  private agentAllowed(capability: CapabilityDefinition, agent: string): boolean {
    return capability.allowed_agents.includes("*") || capability.allowed_agents.includes(agent);
  }
}
