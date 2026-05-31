import {
  CapabilityRegistry,
  type CapabilityUseDecision,
  type CapabilityConfigInput,
} from "@bureauos/capabilities";
import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import type { BureauConfig } from "../config/schema.js";
import { workspacePaths } from "../paths.js";
import { PolicyEngine, type PolicyDecision } from "../policy/engine.js";
import {
  ApprovalRegistry,
  type ApprovalRecord,
  type ApprovalRiskLevel,
} from "../registries/approval.js";

export interface CapabilityUseInput {
  agent: string;
  capabilityId: string;
  action: string;
  target?: string;
  policyAction?: string;
  linkedIssueNumbers?: readonly number[];
  testEvidence?: readonly string[];
  approvalIds?: readonly string[];
  changedFiles?: readonly string[];
  /**
   * When true this is a read-only preview (e.g. the `capabilities check`
   * CLI/API), so a matching one-off approval is NOT consumed. Real agent
   * capability use leaves this unset so the approval is burned exactly once.
   */
  preview?: boolean;
}

export interface CapabilityUseResult {
  status: "allowed" | "blocked";
  capability: CapabilityUseDecision;
  policy: PolicyDecision;
  target: string;
  missing_gates: string[];
  approval?: ApprovalRecord;
  artifact: ArtifactRecord;
}

export interface CapabilityUseDeps {
  config: BureauConfig;
  registry?: CapabilityRegistry;
  artifacts?: ArtifactStore;
  approvals?: ApprovalRegistry;
  policy?: PolicyEngine;
  audit?: AuditLog;
}

const POLICY_ACTIONS: Readonly<Record<string, string>> = {
  "ads_platform.change_budget": "change_ad_budget",
  "ads_platform.draft_campaigns": "draft_campaigns",
  "ads_platform.generate_creatives": "generate_public_creatives",
  "ads_platform.launch_campaigns": "launch_ad_campaigns",
  "ads_platform.read_campaigns": "observe_signals",
  "client_communications.draft_proposal_message": "draft_proposals",
  "client_communications.draft_reply": "draft_replies",
  "client_communications.schedule_follow_up": "update_internal_pipeline",
  "client_communications.send_message": "send_client_messages",
  "codex.deploy": "deploy_production",
  "codex.edit_code": "push_commits",
  "codex.merge_pr": "merge_pull_requests",
  "codex.open_pr": "open_pull_requests",
  "codex.read_repo": "observe_signals",
  "codex.run_tests": "observe_signals",
  "deployment.create_preview": "observe_signals",
  "deployment.deploy_production": "deploy_production",
  "deployment.read_deployments": "observe_signals",
  "github.comment": "comment_on_issues",
  "github.create_issues": "create_issues",
  "github.create_repositories": "create_repositories",
  "github.merge_pr": "merge_pull_requests",
  "github.open_pr": "open_pull_requests",
  "github.read_checks": "observe_signals",
  "github.read_issues": "observe_signals",
  "github.read_prs": "observe_signals",
  "linear.comment": "comment_on_issues",
  "linear.create_issues": "create_issues",
  "linear.read_issues": "observe_signals",
  "linear.read_projects": "observe_signals",
  "linear.set_issue_state": "comment_on_issues",
  "linear.update_issues": "comment_on_issues",
  "mcp.inspect": "observe_signals",
  "skills.inspect": "observe_signals",
  "skills.use_skill": "observe_signals",
  "stripe.change_price": "change_billing",
  "stripe.draft_price_change": "change_pricing",
  "stripe.read_billing": "observe_signals",
  "stripe.refund_payment": "change_billing",
};

function capabilityConfig(config: BureauConfig): Record<string, CapabilityConfigInput> {
  return config.capabilities as Record<string, CapabilityConfigInput>;
}

function policyActionFor(input: CapabilityUseInput): string {
  if (input.policyAction) return input.policyAction;
  return (
    POLICY_ACTIONS[`${input.capabilityId}.${input.action}`] ??
    `${input.capabilityId}.${input.action}`
  );
}

function auditPolicyResult(
  outcome: PolicyDecision["outcome"],
): "allow" | "deny" | "require_approval" | "escalate" {
  return outcome === "require_more_context" ? "escalate" : outcome;
}

function missingEvidenceGates(args: {
  policy: PolicyDecision;
  linkedIssues: readonly number[];
  tests: readonly string[];
  changedFiles?: readonly string[];
  changedFileLimit: number;
  hasApproval: boolean;
}): string[] {
  const gates = new Set<string>(args.policy.required_gates);
  const missing: string[] = [];
  if (gates.has("tests_required") && args.tests.length === 0) missing.push("tests_required");
  if (gates.has("linked_issue") && args.linkedIssues.length === 0) missing.push("linked_issue");
  // Owner-configured security/human gates (SER-181) are satisfied by a granted
  // approval for the action; until one exists they block capability use.
  if (gates.has("security_review") && !args.hasApproval) missing.push("security_review");
  if (gates.has("human_review") && !args.hasApproval) missing.push("human_review");
  if (args.changedFiles !== undefined && args.changedFiles.length > args.changedFileLimit) {
    missing.push("changed_file_limit");
  }
  return missing;
}

function blockedReasonFor(args: {
  capability: CapabilityUseDecision;
  policy: PolicyDecision;
  missingGates: readonly string[];
  changedFileCount: number;
  changedFileLimit: number;
}): string {
  if (!args.capability.allowed) return args.capability.reason;
  if (!args.policy.allowed) return args.policy.reason;
  if (args.missingGates.includes("changed_file_limit")) {
    return `changed file count ${args.changedFileCount} exceeds limit ${args.changedFileLimit}`;
  }
  if (args.missingGates.length) {
    return `missing required capability gate(s): ${args.missingGates.join(", ")}`;
  }
  return "";
}

function auditBody(args: {
  input: CapabilityUseInput;
  target: string;
  capability: CapabilityUseDecision;
  policy: PolicyDecision;
  status: "allowed" | "blocked";
  missingGates: readonly string[];
  changedFileCount: number;
  changedFileLimit: number;
  approval?: ApprovalRecord;
}): string {
  const linkedIssues = args.input.linkedIssueNumbers ?? [];
  const testEvidence = args.input.testEvidence ?? [];
  const approvalIds = args.input.approvalIds ?? [];
  const changedFiles = args.input.changedFiles;
  return `# Capability Use Audit

## Request

- Agent: ${args.input.agent}
- Capability: ${args.input.capabilityId}
- Action: ${args.input.action}
- Target: ${args.target}
- Status: ${args.status}

## Capability Boundary

- Allowed by registry: ${args.capability.allowed}
- Status: ${args.capability.status}
- Risk: ${args.capability.risk_class}
- Reason: ${args.capability.reason}
- Registered approvals: ${args.capability.required_approvals.join(", ") || "(none)"}

## Policy Boundary

- Policy action: ${args.policy.action}
- Outcome: ${args.policy.outcome}
- Allowed by policy: ${args.policy.allowed}
- Matched rule: ${args.policy.matched_rule}
- Approval required: ${args.policy.approval_required}
- Reason: ${args.policy.reason}
- Required gates: ${args.policy.required_gates.join(", ") || "(none)"}
- Approval: ${args.approval?.id ?? args.policy.approval_id ?? "(none)"}

## Evidence

- Linked issues: ${linkedIssues.length ? linkedIssues.map((issue) => `#${issue}`).join(", ") : "(none)"}
- Test evidence: ${testEvidence.length ? testEvidence.join("; ") : "(none)"}
- Approval evidence: ${approvalIds.length ? approvalIds.join(", ") : "(none)"}
- Changed files: ${changedFiles ? `${args.changedFileCount} / ${args.changedFileLimit}` : "(not reported)"}
- Changed file list: ${changedFiles?.length ? changedFiles.join(", ") : "(none)"}
- Missing gates: ${args.missingGates.length ? args.missingGates.join(", ") : "(none)"}

## Execution Boundary

This audit authorizes or blocks capability use. External execution must still produce its own run report, artifacts, and verification evidence.
`;
}

export class CapabilityUseService {
  private readonly registry: CapabilityRegistry;
  private readonly artifacts: ArtifactStore;
  private readonly approvals: ApprovalRegistry;
  private readonly policy: PolicyEngine;
  private readonly audit: AuditLog;
  private readonly config: BureauConfig;

  constructor(
    private readonly workspaceRoot: string,
    deps: CapabilityUseDeps,
  ) {
    this.config = deps.config;
    this.registry = deps.registry ?? CapabilityRegistry.fromConfig(capabilityConfig(deps.config));
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.approvals = deps.approvals ?? new ApprovalRegistry(workspaceRoot);
    this.policy = deps.policy ?? new PolicyEngine(deps.config, this.approvals);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
  }

  async check(input: CapabilityUseInput): Promise<CapabilityUseResult> {
    const target = input.target?.trim() || `${input.capabilityId}.${input.action}`;
    const linkedIssues = input.linkedIssueNumbers ?? [];
    const tests = input.testEvidence ?? [];
    const changedFiles = input.changedFiles;
    const changedFileLimit = this.config.limits.max_files_changed_without_human_review;
    const changedFileCount = changedFiles?.length ?? 0;
    const capability = this.registry.check({
      capability_id: input.capabilityId,
      agent: input.agent,
      action: input.action,
      target,
    });
    const policy = await this.policy.evaluate({
      action: policyActionFor(input),
      actor: input.agent,
      target,
      capability: `${input.capabilityId}.${input.action}`,
      riskClass: capability.risk_class,
      ...(input.preview ? { preview: true } : {}),
    });
    const grantedApproval = await this.approvals.match(
      policy.action,
      target,
      undefined,
      `${input.capabilityId}.${input.action}`,
    );
    const missingGates = capability.allowed
      ? missingEvidenceGates({
          policy,
          linkedIssues,
          tests,
          changedFiles,
          changedFileLimit,
          hasApproval: !!grantedApproval,
        })
      : [];
    const blockedReason = blockedReasonFor({
      capability,
      policy,
      missingGates,
      changedFileCount,
      changedFileLimit,
    });
    const approval =
      blockedReason && (policy.outcome === "require_approval" || missingGates.length > 0)
        ? await this.findOrRequestApproval({
            action: policy.action,
            actor: input.agent,
            target,
            scope: `${input.capabilityId}.${input.action}`,
            riskLevel: capability.risk_class,
            reason: blockedReason,
          })
        : undefined;
    const status =
      capability.allowed && policy.allowed && missingGates.length === 0 ? "allowed" : "blocked";
    const effectivePolicy: PolicyDecision = missingGates.length
      ? {
          ...policy,
          allowed: false,
          outcome: "require_approval",
          reason: blockedReason,
          approval_required: true,
          required_gates: missingGates,
          ...(approval ? { approval_id: approval.id } : {}),
        }
      : policy;

    const artifact = await this.artifacts.write({
      type: "capability-audit",
      createdBy: input.agent,
      metadata: {
        agent: input.agent,
        capability_id: input.capabilityId,
        action: input.action,
        target,
        decision_status: status,
        policy_action: effectivePolicy.action,
        policy_outcome: effectivePolicy.outcome,
        policy_reason: effectivePolicy.reason,
        policy_matched_rule: effectivePolicy.matched_rule,
        policy_required_gates: effectivePolicy.required_gates,
        policy_approval_required: effectivePolicy.approval_required,
        capability_status: capability.status,
        capability_reason: capability.reason,
        capability_risk_class: capability.risk_class,
        missing_gates: missingGates,
        linked_issues: linkedIssues.map(String),
        test_evidence: [...tests],
        changed_file_count: changedFileCount,
        changed_file_limit: changedFileLimit,
        changed_file_limit_exceeded:
          changedFiles !== undefined && changedFileCount > changedFileLimit,
        changed_files: changedFiles ? [...changedFiles] : [],
        approval_id: approval?.id ?? policy.approval_id ?? "",
      },
      body: auditBody({
        input,
        target,
        capability,
        policy: effectivePolicy,
        status,
        missingGates,
        changedFileCount,
        changedFileLimit,
        approval,
      }),
    });

    await this.audit.append({
      actor: input.agent,
      action: status === "allowed" ? "capability.use.allowed" : "capability.use.blocked",
      target,
      capability: `${input.capabilityId}.${input.action}`,
      artifact_id: artifact.id,
      ...(approval ? { approval_id: approval.id } : {}),
      policy_result:
        status === "allowed"
          ? "allow"
          : capability.allowed
            ? auditPolicyResult(effectivePolicy.outcome)
            : "deny",
      result: "ok",
    });

    return {
      status,
      capability,
      policy: effectivePolicy,
      target,
      missing_gates: missingGates,
      ...(approval ? { approval } : {}),
      artifact,
    };
  }

  private async findOrRequestApproval(input: {
    action: string;
    actor: string;
    target: string;
    scope: string;
    riskLevel: ApprovalRiskLevel;
    reason: string;
  }): Promise<ApprovalRecord> {
    const pending = await this.approvals.listPending();
    const existing = pending.find(
      (approval) =>
        approval.action === input.action &&
        approval.target === input.target &&
        // Reuse a pending request only when it is for the same precise scope, so
        // a pending approval for one operation does not absorb a request for a
        // different operation that collapses to the same action (SER-180).
        approval.scope === input.scope,
    );
    if (existing) return existing;
    return this.approvals.request({
      action: input.action,
      actor: input.actor,
      target: input.target,
      scope: input.scope,
      riskLevel: input.riskLevel,
      body: `# Approval: capability use

Capability scope: ${input.scope}
Target: ${input.target}
Reason: ${input.reason}
`,
    });
  }
}
