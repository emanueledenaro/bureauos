import { autonomyLevelName, type BureauConfig } from "../config/schema.js";
import { ApprovalRegistry } from "../registries/approval.js";

export type PolicyOutcome =
  | "allow"
  | "deny"
  | "require_approval"
  | "require_more_context"
  | "escalate";

export type RiskClass = "low" | "medium" | "high" | "critical";

export interface PolicyInput {
  action: string;
  actor: string;
  target?: string;
  capability?: string;
  riskClass?: RiskClass;
}

export interface PolicyDecision {
  action: string;
  actor: string;
  target?: string;
  capability?: string;
  allowed: boolean;
  outcome: PolicyOutcome;
  reason: string;
  required_gates: string[];
  approval_id?: string;
}

/**
 * The set of actions controlled by `autonomy` in bureauos.yaml.
 * Keep this list in sync with `BureauConfigSchema` and `docs/autonomy-policy.md`.
 */
const AUTONOMY_ACTIONS = new Set([
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
]);

/**
 * The set of actions controlled by `growth_autonomy` in bureauos.yaml.
 */
const GROWTH_ACTIONS = new Set([
  "draft_content",
  "draft_campaigns",
  "draft_replies",
  "draft_proposals",
  "update_internal_pipeline",
  "publish_public_content",
  "send_client_messages",
  "run_paid_ads",
  "change_pricing",
  "send_final_proposals",
  "accept_projects",
  "publish_social_posts",
  "generate_public_creatives",
  "launch_ad_campaigns",
  "change_ad_budget",
]);

/**
 * Actions that always require human review unless an explicit approval exists.
 * Per `docs/autonomy-policy.md` mandatory human escalation.
 */
const ALWAYS_HUMAN = new Set([
  "touch_secrets",
  "change_billing",
  "delete_data",
  "destructive_db_change",
  "auth_policy_change",
  "make_legal_commitment",
]);

export class PolicyEngine {
  constructor(
    private readonly config: BureauConfig,
    private readonly approvals: ApprovalRegistry,
  ) {}

  async evaluate(input: PolicyInput): Promise<PolicyDecision> {
    const base: Omit<PolicyDecision, "outcome" | "allowed" | "reason" | "required_gates"> = {
      action: input.action,
      actor: input.actor,
      ...(input.target !== undefined ? { target: input.target } : {}),
      ...(input.capability !== undefined ? { capability: input.capability } : {}),
    };

    if (ALWAYS_HUMAN.has(input.action)) {
      const approval = await this.approvals.match(input.action, input.target ?? "*");
      if (approval) {
        return {
          ...base,
          outcome: "allow",
          allowed: true,
          reason: `approved by ${approval.resolved_by} (${approval.id})`,
          required_gates: [],
          approval_id: approval.id,
        };
      }
      return {
        ...base,
        outcome: "escalate",
        allowed: false,
        reason: "action requires explicit human approval",
        required_gates: ["human_approval"],
      };
    }

    if (AUTONOMY_ACTIONS.has(input.action)) {
      const allowed =
        (this.config.autonomy as Record<string, boolean | number>)[input.action] === true;
      if (allowed) {
        return {
          ...base,
          outcome: "allow",
          allowed: true,
          reason: `enabled by autonomy.${input.action} at level ${this.config.autonomy.level} (${autonomyLevelName(this.config.autonomy.level)})`,
          required_gates: this.gatesFor(input),
        };
      }
      return this.requireOrEscalate(base, input);
    }

    if (GROWTH_ACTIONS.has(input.action)) {
      const allowed =
        (this.config.growth_autonomy as Record<string, boolean>)[input.action] === true;
      if (allowed) {
        return {
          ...base,
          outcome: "allow",
          allowed: true,
          reason: `enabled by growth_autonomy.${input.action}`,
          required_gates: this.gatesFor(input),
        };
      }
      return this.requireOrEscalate(base, input);
    }

    // Unknown action: deny by default, escalate so a human can decide policy.
    return {
      ...base,
      outcome: "escalate",
      allowed: false,
      reason: `unknown action "${input.action}" requires policy definition`,
      required_gates: ["policy_definition"],
    };
  }

  private async requireOrEscalate(
    base: Omit<PolicyDecision, "outcome" | "allowed" | "reason" | "required_gates">,
    input: PolicyInput,
  ): Promise<PolicyDecision> {
    const approval = await this.approvals.match(input.action, input.target ?? "*");
    if (approval) {
      return {
        ...base,
        outcome: "allow",
        allowed: true,
        reason: `policy disabled but approved by ${approval.resolved_by} (${approval.id})`,
        required_gates: [],
        approval_id: approval.id,
      };
    }
    return {
      ...base,
      outcome: "require_approval",
      allowed: false,
      reason: `policy disabled for action "${input.action}"; requires owner approval`,
      required_gates: ["owner_approval"],
    };
  }

  private gatesFor(input: PolicyInput): string[] {
    const gates: string[] = [];
    if (input.action === "open_pull_requests" || input.action === "push_commits") {
      if (this.config.limits.require_tests_for_code_changes) gates.push("tests_required");
      gates.push("linked_issue");
    }
    if (input.action === "merge_pull_requests") {
      gates.push("passing_checks");
      gates.push("required_reviews");
    }
    if (input.action === "deploy_production") {
      gates.push("release_readiness_review");
    }
    return gates;
  }
}
