import { join } from "node:path";
import { newId } from "../ids.js";
import { workspacePaths } from "../paths.js";
import { ensureDir, listDocs, readDoc, writeDoc, type FrontMatter } from "../registries/base.js";
import type { ApprovalRiskLevel } from "../registries/approval.js";

export type LocalNotificationType =
  | "approval_needed"
  | "high_risk_blocker"
  | "client_issue"
  | "revenue_opportunity"
  | "daily_report";

export type LocalNotificationSeverity = "info" | "warning" | "critical";
export type LocalNotificationStatus = "unread" | "read" | "dismissed";

export interface LocalNotificationRecord extends FrontMatter {
  id: string;
  type: LocalNotificationType;
  title: string;
  severity: LocalNotificationSeverity;
  status: LocalNotificationStatus;
  source_type: string;
  source_id: string;
  target: string;
  dedupe_key: string;
  created: string;
  updated: string;
}

export interface CreateLocalNotificationInput {
  type: LocalNotificationType;
  title: string;
  severity?: LocalNotificationSeverity;
  sourceType?: string;
  sourceId?: string;
  target?: string;
  dedupeKey?: string;
  body?: string;
}

export interface ApprovalNotificationInput {
  id: string;
  action: string;
  actor: string;
  target: string;
  scope: string;
  risk_level: ApprovalRiskLevel;
  run_id?: string;
}

export interface ApprovalNotificationSink {
  notifyApprovalNeeded(
    approval: ApprovalNotificationInput,
  ): Promise<LocalNotificationRecord | void>;
}

function severityForApproval(risk: ApprovalRiskLevel): LocalNotificationSeverity {
  if (risk === "critical") return "critical";
  if (risk === "high" || risk === "medium") return "warning";
  return "info";
}

function labelForAction(action: string): string {
  return action
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function approvalNotificationBody(approval: ApprovalNotificationInput): string {
  return `# Approval needed

- Approval: ${approval.id}
- Action: ${approval.action}
- Actor: ${approval.actor}
- Target: ${approval.target}
- Scope: ${approval.scope}
- Risk: ${approval.risk_level}
${approval.run_id ? `- Run: ${approval.run_id}\n` : ""}
BureauOS is waiting for an owner decision before continuing this approval-gated work.
`;
}

export class LocalNotificationCenter implements ApprovalNotificationSink {
  constructor(public readonly workspaceRoot: string) {}

  private paths() {
    return workspacePaths(this.workspaceRoot);
  }

  private file(id: string): string {
    return join(this.paths().notificationsInboxDir, `${id}.md`);
  }

  async notify(input: CreateLocalNotificationInput): Promise<LocalNotificationRecord> {
    await ensureDir(this.paths().notificationsInboxDir);
    if (input.dedupeKey) {
      const existing = await this.findByDedupeKey(input.dedupeKey);
      if (existing) return existing;
    }

    const now = new Date().toISOString();
    const id = newId("ntf");
    const record: LocalNotificationRecord = {
      id,
      type: input.type,
      title: input.title,
      severity: input.severity ?? "info",
      status: "unread",
      source_type: input.sourceType ?? "",
      source_id: input.sourceId ?? "",
      target: input.target ?? "",
      dedupe_key: input.dedupeKey ?? "",
      created: now,
      updated: now,
    };
    await writeDoc(this.file(id), record, input.body ?? "");
    return record;
  }

  async notifyApprovalNeeded(
    approval: ApprovalNotificationInput,
  ): Promise<LocalNotificationRecord> {
    return this.notify({
      type: "approval_needed",
      title: `Approval needed: ${labelForAction(approval.action)}`,
      severity: severityForApproval(approval.risk_level),
      sourceType: "approval",
      sourceId: approval.id,
      target: approval.target,
      dedupeKey: `approval:${approval.id}`,
      body: approvalNotificationBody(approval),
    });
  }

  async list(): Promise<LocalNotificationRecord[]> {
    const files = await listDocs(this.paths().notificationsInboxDir);
    const out: LocalNotificationRecord[] = [];
    for (const file of files) {
      const doc = await readDoc<LocalNotificationRecord>(file);
      out.push(doc.front);
    }
    return out.sort((a, b) => b.created.localeCompare(a.created));
  }

  private async findByDedupeKey(dedupeKey: string): Promise<LocalNotificationRecord | undefined> {
    const notifications = await this.list();
    return notifications.find((notification) => notification.dedupe_key === dedupeKey);
  }
}
