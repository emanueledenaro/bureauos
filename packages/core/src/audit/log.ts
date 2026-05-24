import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface AuditEvent {
  timestamp: string;
  actor: string;
  action: string;
  target?: string;
  capability?: string;
  policy_result?: "allow" | "deny" | "require_approval" | "escalate";
  approval_id?: string;
  artifact_id?: string;
  result: "ok" | "error";
  error?: string;
}

export type AuditEventInput = Omit<AuditEvent, "timestamp">;

/**
 * Append-only JSONL audit log.
 *
 * One event per side effect. Events are never edited or deleted.
 * Daily rotation and segment hashing land in a later phase
 * (see BACKLOG.md Phase 1.7).
 */
export class AuditLog {
  constructor(public readonly path: string) {}

  async append(event: AuditEventInput): Promise<AuditEvent> {
    const full: AuditEvent = {
      timestamp: new Date().toISOString(),
      ...event,
    };
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(full)}\n`, "utf8");
    return full;
  }
}
