import type { ApprovalRecord, RunRecord } from "./api";
import type { Tone } from "./tone";

export type ApprovalRiskLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalRiskGroup {
  risk: ApprovalRiskLevel;
  approvals: ApprovalRecord[];
}

export interface ApprovalRunGroup {
  runKey: string;
  runId?: string;
  label: string;
  riskGroups: ApprovalRiskGroup[];
  approvals: ApprovalRecord[];
}

const RISK_RANK: Record<ApprovalRiskLevel, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const RISK_TONE: Record<ApprovalRiskLevel, Tone> = {
  low: "success",
  medium: "info",
  high: "warning",
  critical: "danger",
};

const ACTION_RISK: Readonly<Record<string, ApprovalRiskLevel>> = {
  accept_projects: "high",
  auth_policy_change: "critical",
  change_ad_budget: "high",
  change_billing: "critical",
  change_pricing: "high",
  contact_clients_directly: "high",
  create_repositories: "high",
  delete_data: "critical",
  deploy_production: "critical",
  destructive_db_change: "critical",
  launch_ad_campaigns: "high",
  make_legal_commitment: "critical",
  merge_pull_requests: "high",
  publish_public_content: "high",
  publish_social_posts: "high",
  run_paid_ads: "high",
  send_client_messages: "high",
  send_final_proposals: "high",
  touch_secrets: "critical",
};

export function normalizeApprovalRisk(value: unknown): ApprovalRiskLevel | undefined {
  return value === "low" || value === "medium" || value === "high" || value === "critical"
    ? value
    : undefined;
}

export function approvalRiskLevel(approval: ApprovalRecord): ApprovalRiskLevel {
  const explicit = normalizeApprovalRisk(approval.risk_level);
  if (explicit) return explicit;
  const mapped = ACTION_RISK[approval.action];
  if (mapped) return mapped;
  const descriptor = `${approval.action} ${approval.target} ${approval.scope}`.toLowerCase();
  if (
    /\b(secret|billing|payment|stripe|legal|delete|destructive|production|deploy|domain)\b/.test(
      descriptor,
    )
  ) {
    return "critical";
  }
  if (
    /\b(client|public|publish|paid|ads?|budget|merge|proposal|pricing|price|contract)\b/.test(
      descriptor,
    )
  ) {
    return "high";
  }
  if (/\b(github|pull|repository|issue|comment|provider|oauth)\b/.test(descriptor)) {
    return "medium";
  }
  return "low";
}

export function approvalRiskTone(risk: ApprovalRiskLevel): Tone {
  return RISK_TONE[risk];
}

export function approvalRequiresDecisionNote(approval: ApprovalRecord): boolean {
  const risk = approvalRiskLevel(approval);
  return risk === "high" || risk === "critical";
}

export function isStaleApprovalError(error: unknown): boolean {
  return error instanceof Error && /approval is no longer pending|409/i.test(error.message);
}

export function approvalMatchesRun(approval: ApprovalRecord, run: RunRecord): boolean {
  if (approval.run_id && approval.run_id === run.id) return true;
  if (Array.isArray(run.decisions) && run.decisions.includes(approval.id)) return true;
  return false;
}

export function groupApprovalsByRunAndRisk(
  approvals: ApprovalRecord[],
  runs: RunRecord[] = [],
): ApprovalRunGroup[] {
  const runsById = new Map(runs.map((run) => [run.id, run]));
  const groups = new Map<string, ApprovalRecord[]>();

  for (const approval of approvals) {
    const runKey = approval.run_id || `scope:${approval.scope || approval.target || "unscoped"}`;
    groups.set(runKey, [...(groups.get(runKey) ?? []), approval]);
  }

  return [...groups.entries()]
    .map(([runKey, items]) => {
      const run = runsById.get(runKey);
      const byRisk = new Map<ApprovalRiskLevel, ApprovalRecord[]>();
      for (const item of items) {
        const risk = approvalRiskLevel(item);
        byRisk.set(risk, [...(byRisk.get(risk) ?? []), item]);
      }
      const riskGroups = [...byRisk.entries()]
        .map(([risk, riskItems]) => ({
          risk,
          approvals: riskItems.sort(sortApprovalNewestFirst),
        }))
        .sort((a, b) => RISK_RANK[b.risk] - RISK_RANK[a.risk]);

      return {
        runKey,
        ...(run?.id ? { runId: run.id } : {}),
        label: run?.scope || items[0]?.scope || items[0]?.target || "Unscoped approval",
        riskGroups,
        approvals: items.sort(sortApprovalNewestFirst),
      };
    })
    .sort((a, b) => {
      const aRisk = Math.max(...a.riskGroups.map((group) => RISK_RANK[group.risk]));
      const bRisk = Math.max(...b.riskGroups.map((group) => RISK_RANK[group.risk]));
      if (aRisk !== bRisk) return bRisk - aRisk;
      return newestTimestamp(b.approvals).localeCompare(newestTimestamp(a.approvals));
    });
}

function newestTimestamp(approvals: ApprovalRecord[]): string {
  return (
    approvals
      .map((approval) => approval.updated ?? approval.created ?? "")
      .sort((a, b) => b.localeCompare(a))[0] ?? ""
  );
}

function sortApprovalNewestFirst(a: ApprovalRecord, b: ApprovalRecord): number {
  return (b.updated ?? b.created ?? "").localeCompare(a.updated ?? a.created ?? "");
}
