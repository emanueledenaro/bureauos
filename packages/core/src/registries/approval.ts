import { rename } from "node:fs/promises";
import { join } from "node:path";
import { newId } from "../ids.js";
import { workspacePaths } from "../paths.js";
import { ensureDir, fileExists, listDocs, readDoc, writeDoc, type FrontMatter } from "./base.js";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalRecord extends FrontMatter {
  id: string;
  action: string;
  actor: string;
  target: string;
  scope: string;
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
  expiresAt?: string;
  oneOff?: boolean;
  recurring?: boolean;
  body?: string;
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
