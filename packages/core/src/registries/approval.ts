import { rename } from "node:fs/promises";
import { join } from "node:path";
import { newId } from "../ids.js";
import { workspacePaths } from "../paths.js";
import { ensureDir, fileExists, listDocs, readDoc, writeDoc, type FrontMatter } from "./base.js";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type ApprovalRiskLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalRecord extends FrontMatter {
  id: string;
  action: string;
  actor: string;
  target: string;
  scope: string;
  run_id: string;
  risk_level: ApprovalRiskLevel;
  status: ApprovalStatus;
  expires_at: string;
  one_off: boolean;
  recurring: boolean;
  created: string;
  updated: string;
  resolved_at: string;
  resolved_by: string;
  reason: string;
}

export interface CreateApprovalInput {
  action: string;
  actor: string;
  target: string;
  scope: string;
  runId?: string;
  riskLevel?: ApprovalRiskLevel;
  expiresAt?: string;
  oneOff?: boolean;
  recurring?: boolean;
  body?: string;
}

const APPROVAL_ACTION_RISK: Readonly<Record<string, ApprovalRiskLevel>> = {
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

export function normalizeApprovalRiskLevel(value: unknown): ApprovalRiskLevel | undefined {
  return value === "low" || value === "medium" || value === "high" || value === "critical"
    ? value
    : undefined;
}

export function inferApprovalRiskLevel(action: string, target = "", scope = ""): ApprovalRiskLevel {
  const explicit = APPROVAL_ACTION_RISK[action];
  if (explicit) return explicit;
  const descriptor = `${action} ${target} ${scope}`.toLowerCase();
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

export function approvalRiskLevel(
  approval: Pick<ApprovalRecord, "action" | "target" | "scope" | "risk_level">,
): ApprovalRiskLevel {
  return (
    normalizeApprovalRiskLevel(approval.risk_level) ??
    inferApprovalRiskLevel(approval.action, approval.target, approval.scope)
  );
}

export function approvalRequiresDecisionNote(
  approval: Pick<ApprovalRecord, "action" | "target" | "scope" | "risk_level">,
): boolean {
  const risk = approvalRiskLevel(approval);
  return risk === "high" || risk === "critical";
}

export class ApprovalRegistry {
  constructor(public readonly workspaceRoot: string) {}

  private paths() {
    return workspacePaths(this.workspaceRoot);
  }

  private pendingFile(id: string): string {
    return join(this.paths().approvalsPendingDir, `${id}.md`);
  }

  private resolvedFile(id: string): string {
    return join(this.paths().approvalsResolvedDir, `${id}.md`);
  }

  async request(input: CreateApprovalInput): Promise<ApprovalRecord> {
    const id = newId("appr");
    await ensureDir(this.paths().approvalsPendingDir);
    const now = new Date().toISOString();
    const record: ApprovalRecord = {
      id,
      action: input.action,
      actor: input.actor,
      target: input.target,
      scope: input.scope,
      run_id: input.runId ?? "",
      risk_level:
        input.riskLevel ?? inferApprovalRiskLevel(input.action, input.target, input.scope),
      status: "pending",
      expires_at: input.expiresAt ?? "",
      one_off: input.oneOff ?? true,
      recurring: input.recurring ?? false,
      created: now,
      updated: now,
      resolved_at: "",
      resolved_by: "",
      reason: "",
    };
    await writeDoc(this.pendingFile(id), record, input.body ?? "");
    return record;
  }

  async getPending(id: string): Promise<ApprovalRecord | undefined> {
    const path = this.pendingFile(id);
    if (!(await fileExists(path))) return undefined;
    const doc = await readDoc<ApprovalRecord>(path);
    return doc.front;
  }

  async resolve(
    id: string,
    status: "approved" | "rejected",
    resolvedBy: string,
    reason = "",
  ): Promise<ApprovalRecord> {
    const path = this.pendingFile(id);
    if (!(await fileExists(path))) throw new Error(`approval not found: ${id}`);
    const doc = await readDoc<ApprovalRecord>(path);
    const now = new Date().toISOString();
    const updated: ApprovalRecord = {
      ...doc.front,
      status,
      updated: now,
      resolved_at: now,
      resolved_by: resolvedBy,
      reason,
    };
    await ensureDir(this.paths().approvalsResolvedDir);
    await writeDoc(this.resolvedFile(id), updated, doc.body);
    await rename(path, this.pendingFile(`${id}.archived`)).catch(() => {});
    // Try a hard removal by writing then deleting via fs.unlink-style helper.
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(this.pendingFile(`${id}.archived`));
    } catch {
      // Best-effort cleanup; the resolved record is the source of truth.
    }
    return updated;
  }

  async listPending(): Promise<ApprovalRecord[]> {
    const files = await listDocs(this.paths().approvalsPendingDir);
    const out: ApprovalRecord[] = [];
    for (const f of files) {
      const doc = await readDoc<ApprovalRecord>(f);
      out.push(doc.front);
    }
    return out;
  }

  async listResolved(): Promise<ApprovalRecord[]> {
    const files = await listDocs(this.paths().approvalsResolvedDir);
    const out: ApprovalRecord[] = [];
    for (const f of files) {
      const doc = await readDoc<ApprovalRecord>(f);
      out.push(doc.front);
    }
    return out;
  }

  /**
   * Look up a standing or one-off approval matching the requested action and target.
   * Returns the most recent matching approval that is still valid (not expired).
   */
  async match(
    action: string,
    target: string,
    now = new Date(),
  ): Promise<ApprovalRecord | undefined> {
    const resolved = await this.listResolved();
    const candidates = resolved
      .filter(
        (r) =>
          r.status === "approved" &&
          r.action === action &&
          (r.target === target || r.target === "*"),
      )
      .filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > now.getTime())
      .sort((a, b) => (a.resolved_at > b.resolved_at ? -1 : 1));
    return candidates[0];
  }
}
