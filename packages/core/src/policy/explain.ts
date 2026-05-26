import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import type { PolicyOutcome, RiskClass } from "./engine.js";

export type PolicyExplainOutcome = "allow" | "deny" | "require_approval" | "escalate";

export interface PolicyExplainDecision {
  id: string;
  artifact_id: string;
  created: string;
  agent: string;
  capability: string;
  action: string;
  policy_action: string;
  target: string;
  source_status: "allowed" | "blocked";
  outcome: PolicyExplainOutcome;
  allowed: boolean;
  matched_rule: string;
  risk_class: RiskClass;
  approval_required: boolean;
  approval_id?: string;
  reason: string;
  required_gates: string[];
  missing_gates: string[];
}

export interface PolicyExplainResult {
  generated_at: string;
  counts: Record<PolicyExplainOutcome, number>;
  decisions: PolicyExplainDecision[];
}

export interface PolicyExplainOptions {
  limit?: number;
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[redacted]"],
  [/\b(xox[baprs]-[A-Za-z0-9-]{8,})\b/g, "[redacted]"],
  [
    /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|authorization)\s*[:=]\s*)([^\s"'`]+)/gi,
    "$1[redacted]",
  ],
  [/\b(Bearer\s+)([A-Za-z0-9._-]{12,})\b/gi, "$1[redacted]"],
];

function redactSecretLookingText(input: string): string {
  return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => {
    return text.replace(pattern, replacement);
  }, input);
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean);
  const single = stringValue(value);
  return single ? [single] : [];
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true";
}

function riskValue(value: unknown): RiskClass {
  const risk = stringValue(value);
  if (risk === "low" || risk === "medium" || risk === "high" || risk === "critical") return risk;
  return "medium";
}

function policyOutcomeValue(value: unknown): PolicyOutcome {
  const outcome = stringValue(value);
  if (
    outcome === "allow" ||
    outcome === "deny" ||
    outcome === "require_approval" ||
    outcome === "require_more_context" ||
    outcome === "escalate"
  ) {
    return outcome;
  }
  return "escalate";
}

function sourceStatusValue(value: unknown): "allowed" | "blocked" {
  return stringValue(value) === "allowed" ? "allowed" : "blocked";
}

function explainOutcome(record: ArtifactRecord): PolicyExplainOutcome {
  const sourceStatus = sourceStatusValue(record.decision_status);
  const policyOutcome = policyOutcomeValue(record.policy_outcome);
  const missingGates = stringArray(record.missing_gates);
  if (sourceStatus === "allowed") return "allow";
  if (missingGates.length > 0 || policyOutcome === "require_approval") return "require_approval";
  if (policyOutcome === "escalate" || policyOutcome === "require_more_context") return "escalate";
  return "deny";
}

function explainReason(record: ArtifactRecord, outcome: PolicyExplainOutcome): string {
  const policyReason = stringValue(record.policy_reason);
  const capabilityReason = stringValue(record.capability_reason);
  const reason = outcome === "deny" && capabilityReason ? capabilityReason : policyReason;
  return redactSecretLookingText(reason || "No policy reason recorded.");
}

function toDecision(record: ArtifactRecord): PolicyExplainDecision {
  const outcome = explainOutcome(record);
  const capabilityId = stringValue(record.capability_id);
  const action = stringValue(record.action);
  const approvalId = stringValue(record.approval_id);
  const decision: PolicyExplainDecision = {
    id: `policy:${record.id}`,
    artifact_id: record.id,
    created: record.created,
    agent: stringValue(record.agent || record.created_by),
    capability: capabilityId,
    action,
    policy_action: stringValue(record.policy_action || `${capabilityId}.${action}`),
    target: redactSecretLookingText(stringValue(record.target)),
    source_status: sourceStatusValue(record.decision_status),
    outcome,
    allowed: outcome === "allow",
    matched_rule:
      stringValue(record.policy_matched_rule) || `capability.${capabilityId || "unknown"}`,
    risk_class: riskValue(record.capability_risk_class),
    approval_required:
      outcome === "require_approval" ||
      booleanValue(record.policy_approval_required) ||
      Boolean(approvalId),
    reason: explainReason(record, outcome),
    required_gates: stringArray(record.policy_required_gates),
    missing_gates: stringArray(record.missing_gates),
  };
  return approvalId ? { ...decision, approval_id: approvalId } : decision;
}

export class PolicyExplainService {
  constructor(private readonly workspaceRoot: string) {}

  async list(options: PolicyExplainOptions = {}): Promise<PolicyExplainResult> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 100);
    const artifacts = await new ArtifactStore(this.workspaceRoot).list({
      type: "capability-audit",
    });
    const decisions = artifacts
      .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""))
      .slice(0, limit)
      .map(toDecision);
    const counts: Record<PolicyExplainOutcome, number> = {
      allow: 0,
      deny: 0,
      require_approval: 0,
      escalate: 0,
    };
    for (const decision of decisions) counts[decision.outcome]++;

    return {
      generated_at: new Date().toISOString(),
      counts,
      decisions,
    };
  }
}
