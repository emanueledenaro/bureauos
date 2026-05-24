import { join } from "node:path";
import { newId } from "../ids.js";
import { workspacePaths } from "../paths.js";
import { AuditLog } from "../audit/log.js";
import { ArtifactStore } from "../artifacts/store.js";
import { PolicyEngine, type PolicyDecision } from "../policy/engine.js";
import {
  ensureDir,
  fileExists,
  listDocs,
  readDoc,
  writeDoc,
  type FrontMatter,
} from "../registries/base.js";

export type RunStatus =
  | "created"
  | "context_loading"
  | "planning"
  | "dispatching"
  | "in_progress"
  | "blocked"
  | "needs_human"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export type RunType =
  | "feature"
  | "bug"
  | "review"
  | "release"
  | "planning"
  | "retrospective"
  | "visibility"
  | "content"
  | "campaign"
  | "conversion"
  | "sales"
  | "social"
  | "creative"
  | "ads"
  | "compliance"
  | "client_success"
  | "intake"
  | "health_check";

export type RunTriggerType =
  | "owner_request"
  | "event"
  | "schedule"
  | "threshold"
  | "memory_due"
  | "health_check"
  | "external_signal";

export interface RunRecord extends FrontMatter {
  id: string;
  type: RunType;
  status: RunStatus;
  trigger_type: RunTriggerType;
  trigger_source: string;
  project_id: string;
  client_id: string;
  scope: string;
  created_by: string;
  artifacts: string[];
  decisions: string[];
  created: string;
  updated: string;
  completed: string;
}

export interface StartRunInput {
  type: RunType;
  triggerType: RunTriggerType;
  triggerSource: string;
  scope: string;
  createdBy?: string;
  projectId?: string;
  clientId?: string;
}

export interface RunEngineDeps {
  audit: AuditLog;
  artifacts: ArtifactStore;
  policy: PolicyEngine;
}

export class RunEngine {
  constructor(
    public readonly workspaceRoot: string,
    private readonly deps: RunEngineDeps,
  ) {}

  private paths() {
    return workspacePaths(this.workspaceRoot);
  }

  private file(id: string): string {
    return join(this.paths().runsDir, `${id}.md`);
  }

  /**
   * Start and execute a run with the stub dispatch.
   *
   * The stub dispatch writes a `run-report` artifact for the run, transitions
   * the run through the lifecycle states, and records every transition in the
   * audit log. No model calls are made.
   */
  async start(input: StartRunInput): Promise<RunRecord> {
    const id = newId("run");
    await ensureDir(this.paths().runsDir);

    const policyDecision: PolicyDecision = await this.deps.policy.evaluate({
      action: this.actionForRunType(input.type),
      actor: input.createdBy ?? "supreme_coordinator",
      ...(input.projectId !== undefined ? { target: input.projectId } : {}),
    });

    const now = new Date().toISOString();
    let record: RunRecord = {
      id,
      type: input.type,
      status: "created",
      trigger_type: input.triggerType,
      trigger_source: input.triggerSource,
      project_id: input.projectId ?? "",
      client_id: input.clientId ?? "",
      scope: input.scope,
      created_by: input.createdBy ?? "supreme_coordinator",
      artifacts: [],
      decisions: [],
      created: now,
      updated: now,
      completed: "",
    };

    await this.persist(record, `# Run ${id}\n\nScope: ${input.scope}\n`);
    await this.deps.audit.append({
      actor: record.created_by,
      action: "run.created",
      target: id,
      result: "ok",
    });

    if (!policyDecision.allowed) {
      record = await this.transition(record, "needs_human");
      await this.deps.audit.append({
        actor: record.created_by,
        action: "run.policy_blocked",
        target: id,
        policy_result: policyDecision.outcome === "allow" ? "allow" : policyDecision.outcome === "deny" ? "deny" : policyDecision.outcome === "escalate" ? "escalate" : "require_approval",
        result: "ok",
      });
      return record;
    }

    for (const next of ["context_loading", "planning", "dispatching", "in_progress"] as const) {
      record = await this.transition(record, next);
    }

    // Stub dispatch: write a run-report artifact summarizing the intent.
    const artifact = await this.deps.artifacts.write({
      type: "run-report",
      createdBy: record.created_by,
      runId: id,
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
      body: `# Run Report\n\n- Run: ${id}\n- Type: ${input.type}\n- Trigger: ${input.triggerType} (${input.triggerSource})\n- Scope: ${input.scope}\n\n## Status\n\nStub dispatch completed. No model calls were made. Phase 8 will wire the real development runtime.\n`,
    });
    record.artifacts = [...record.artifacts, artifact.id];
    await this.persist(record, `# Run ${id}\n\nScope: ${input.scope}\n\nArtifacts: ${record.artifacts.join(", ")}\n`);
    await this.deps.audit.append({
      actor: record.created_by,
      action: "run.artifact_written",
      target: id,
      artifact_id: artifact.id,
      result: "ok",
    });

    record = await this.transition(record, "verifying");
    record = await this.transition(record, "completed");
    record.completed = new Date().toISOString();
    await this.persist(record, `# Run ${id}\n\nScope: ${input.scope}\n\nArtifacts: ${record.artifacts.join(", ")}\nCompleted: ${record.completed}\n`);
    await this.deps.audit.append({
      actor: record.created_by,
      action: "run.completed",
      target: id,
      result: "ok",
    });

    return record;
  }

  async get(id: string): Promise<RunRecord | undefined> {
    const path = this.file(id);
    if (!(await fileExists(path))) return undefined;
    const doc = await readDoc<RunRecord>(path);
    return doc.front;
  }

  async list(filter: { status?: RunStatus } = {}): Promise<RunRecord[]> {
    const files = await listDocs(this.paths().runsDir);
    const out: RunRecord[] = [];
    for (const f of files) {
      const doc = await readDoc<RunRecord>(f);
      if (filter.status && doc.front.status !== filter.status) continue;
      out.push(doc.front);
    }
    return out;
  }

  private async transition(record: RunRecord, status: RunStatus): Promise<RunRecord> {
    const updated: RunRecord = { ...record, status, updated: new Date().toISOString() };
    await this.persist(updated, `# Run ${record.id}\n\nScope: ${record.scope}\nStatus: ${status}\n`);
    await this.deps.audit.append({
      actor: record.created_by,
      action: `run.${status}`,
      target: record.id,
      result: "ok",
    });
    return updated;
  }

  private async persist(record: RunRecord, body: string): Promise<void> {
    await writeDoc(this.file(record.id), record, body);
  }

  private actionForRunType(type: RunType): string {
    switch (type) {
      case "feature":
      case "bug":
      case "review":
      case "release":
        return "open_pull_requests";
      case "content":
      case "social":
      case "creative":
      case "campaign":
      case "ads":
        return "draft_content";
      case "compliance":
      case "client_success":
      case "intake":
      case "health_check":
      case "planning":
      case "retrospective":
      case "visibility":
      case "conversion":
      case "sales":
      default:
        return "create_internal_reports";
    }
  }
}
