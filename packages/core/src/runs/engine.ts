import { join } from "node:path";
import { newId } from "../ids.js";
import { workspacePaths } from "../paths.js";
import { AuditLog } from "../audit/log.js";
import { ArtifactStore } from "../artifacts/store.js";
import { writeRunOutcomeMemory } from "../memory/run-outcomes.js";
import { PolicyEngine, type PolicyDecision } from "../policy/engine.js";
import {
  sourceWorkItemFromFrontMatter,
  sourceWorkItemFromTriggerSource,
  sourceWorkItemFrontMatter,
  sourceWorkItemLabel,
  type SourceWorkItemInput,
} from "../work-items/source.js";
import {
  ensureDir,
  fileExists,
  listDocs,
  readDoc,
  withFileLock,
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
  source_work_item_type: string;
  source_work_item_id: string;
  source_work_item_url: string;
  linear_identifier: string;
  linear_url: string;
}

export interface StartRunInput {
  type: RunType;
  triggerType: RunTriggerType;
  triggerSource: string;
  scope: string;
  createdBy?: string;
  projectId?: string;
  clientId?: string;
  sourceWorkItem?: SourceWorkItemInput;
}

export type RunDispatchTerminalStatus = "completed" | "blocked" | "needs_human" | "failed";

export interface RunDispatchInput {
  workspaceRoot: string;
  run: RunRecord;
  startInput: StartRunInput;
}

export interface RunDispatchResult {
  status: RunDispatchTerminalStatus;
  artifactIds?: readonly string[];
  decisions?: readonly string[];
  metadata?: FrontMatter;
  blockers?: readonly string[];
  error?: string;
}

export type RunDispatcher = (input: RunDispatchInput) => Promise<RunDispatchResult>;

export interface RunEngineDeps {
  audit: AuditLog;
  artifacts: ArtifactStore;
  policy: PolicyEngine;
  dispatcher?: RunDispatcher;
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
   * Start and execute a run.
   *
   * When a dispatcher dependency is supplied, it owns the real execution path.
   * Without a dispatcher, the engine keeps the safe stub path for local dev and
   * tests.
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
    const sourceWorkItem =
      input.sourceWorkItem ?? sourceWorkItemFromTriggerSource(input.triggerSource);
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
      source_work_item_type: "",
      source_work_item_id: "",
      source_work_item_url: "",
      linear_identifier: "",
      linear_url: "",
      ...sourceWorkItemFrontMatter(sourceWorkItem),
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
        policy_result:
          policyDecision.outcome === "allow"
            ? "allow"
            : policyDecision.outcome === "deny"
              ? "deny"
              : policyDecision.outcome === "escalate"
                ? "escalate"
                : "require_approval",
        result: "ok",
      });
      return record;
    }

    for (const next of ["context_loading", "planning", "dispatching", "in_progress"] as const) {
      record = await this.transition(record, next);
    }

    if (this.deps.dispatcher) return this.executeDispatch(record, input);
    return this.executeStubDispatch(record, input);
  }

  private async executeStubDispatch(record: RunRecord, input: StartRunInput): Promise<RunRecord> {
    const artifact = await this.deps.artifacts.write({
      type: "run-report",
      createdBy: record.created_by,
      runId: record.id,
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
      sourceWorkItem: sourceWorkItemFromFrontMatter(record),
      body: `# Run Report\n\n- Run: ${record.id}\n- Type: ${input.type}\n- Trigger: ${input.triggerType} (${input.triggerSource})\n- Scope: ${input.scope}\n\n## Status\n\nStub dispatch completed. No model calls were made. Phase 8 wires the real development runtime through an injected dispatcher.\n`,
    });
    record.artifacts = [...record.artifacts, artifact.id];
    record.decisions = [...record.decisions, "stub_dispatch"];
    await this.persist(
      record,
      this.runBody(record, {
        dispatchStatus: "completed",
        summary: "Stub dispatch completed. No external model or runtime calls were made.",
      }),
    );
    await this.deps.audit.append({
      actor: record.created_by,
      action: "run.artifact_written",
      target: record.id,
      artifact_id: artifact.id,
      result: "ok",
    });

    await this.deps.audit.append({
      actor: record.created_by,
      action: "run.dispatch_stub_completed",
      target: record.id,
      result: "ok",
    });

    return this.completeRun(record);
  }

  private async executeDispatch(record: RunRecord, input: StartRunInput): Promise<RunRecord> {
    try {
      const result = await this.deps.dispatcher!({
        workspaceRoot: this.workspaceRoot,
        run: record,
        startInput: input,
      });
      return this.applyDispatchResult(record, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.applyDispatchResult(record, {
        status: "failed",
        error: message,
        metadata: { dispatch_error: message },
      });
    }
  }

  private async applyDispatchResult(
    record: RunRecord,
    result: RunDispatchResult,
  ): Promise<RunRecord> {
    const artifactIds = Array.from(new Set([...record.artifacts, ...(result.artifactIds ?? [])]));
    const decisions = Array.from(new Set([...record.decisions, ...(result.decisions ?? [])]));
    record = {
      ...record,
      ...(result.metadata ?? {}),
      artifacts: artifactIds,
      decisions,
      dispatch_status: result.status,
      ...(result.blockers?.length ? { dispatch_blockers: [...result.blockers] } : {}),
      ...(result.error ? { dispatch_error: result.error } : {}),
      updated: new Date().toISOString(),
    };

    await this.persist(
      record,
      this.runBody(record, {
        dispatchStatus: result.status,
        blockers: result.blockers ?? [],
        error: result.error,
      }),
    );

    await this.deps.audit.append({
      actor: record.created_by,
      action: `run.dispatch_${result.status}`,
      target: record.id,
      result: result.status === "failed" ? "error" : "ok",
      ...(result.error ? { error: result.error } : {}),
    });

    if (result.status !== "completed") {
      record = { ...record, status: result.status, updated: new Date().toISOString() };
      await this.persist(
        record,
        this.runBody(record, {
          dispatchStatus: result.status,
          blockers: result.blockers ?? [],
          error: result.error,
        }),
      );
      await this.deps.audit.append({
        actor: record.created_by,
        action: `run.${result.status}`,
        target: record.id,
        result: result.status === "failed" ? "error" : "ok",
        ...(result.error ? { error: result.error } : {}),
      });
      await writeRunOutcomeMemory(this.workspaceRoot, record, { audit: this.deps.audit });
      return record;
    }

    return this.completeRun(record);
  }

  private async completeRun(record: RunRecord): Promise<RunRecord> {
    record = await this.transition(record, "verifying");
    record = await this.transition(record, "completed");
    record.completed = new Date().toISOString();
    await this.persist(record, this.runBody(record));
    await this.deps.audit.append({
      actor: record.created_by,
      action: "run.completed",
      target: record.id,
      result: "ok",
    });
    await writeRunOutcomeMemory(this.workspaceRoot, record, { audit: this.deps.audit });

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

  async attachArtifacts(id: string, artifactIds: readonly string[]): Promise<RunRecord> {
    // Serialize the read-modify-write so concurrent callers (e.g. several
    // scheduler jobs attaching artifacts to the same run) don't clobber each
    // other's updates.
    const updated = await withFileLock(this.file(id), async () => {
      const current = await this.get(id);
      if (!current) throw new Error(`run not found: ${id}`);
      const artifacts = Array.from(new Set([...current.artifacts, ...artifactIds]));
      const next: RunRecord = {
        ...current,
        artifacts,
        updated: new Date().toISOString(),
      };
      await this.persist(
        next,
        `# Run ${id}\n\nScope: ${next.scope}\nStatus: ${next.status}\n\nArtifacts: ${artifacts.join(", ")}\nCompleted: ${next.completed}\n`,
      );
      return next;
    });
    await this.deps.audit.append({
      actor: updated.created_by,
      action: "run.artifacts_attached",
      target: id,
      result: "ok",
    });
    return updated;
  }

  async patch(id: string, patch: FrontMatter): Promise<RunRecord> {
    // Serialize the read-modify-write so overlapping patches don't lose fields.
    const updated = await withFileLock(this.file(id), async () => {
      const path = this.file(id);
      if (!(await fileExists(path))) throw new Error(`run not found: ${id}`);
      const doc = await readDoc<RunRecord>(path);
      const next = {
        ...doc.front,
        ...patch,
        updated: new Date().toISOString(),
      } as RunRecord;
      await writeDoc(path, next, doc.body);
      return next;
    });
    await this.deps.audit.append({
      actor: updated.created_by,
      action: "run.metadata_updated",
      target: id,
      result: "ok",
    });
    return updated;
  }

  private async transition(record: RunRecord, status: RunStatus): Promise<RunRecord> {
    const updated: RunRecord = { ...record, status, updated: new Date().toISOString() };
    await this.persist(
      updated,
      `# Run ${record.id}\n\nScope: ${record.scope}\nStatus: ${status}\n`,
    );
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

  private runBody(
    record: RunRecord,
    details: {
      dispatchStatus?: string;
      summary?: string;
      blockers?: readonly string[];
      error?: string;
    } = {},
  ): string {
    return `# Run ${record.id}

Scope: ${record.scope}
Status: ${record.status}
Dispatch: ${details.dispatchStatus ?? String(record["dispatch_status"] ?? "(none)")}
Source work item: ${sourceWorkItemLabel(record)}
${details.summary ? `\n${details.summary}\n` : ""}
Artifacts: ${record.artifacts.join(", ") || "(none)"}
Decisions: ${record.decisions.join(", ") || "(none)"}
${details.blockers?.length ? `Blockers: ${details.blockers.join(", ")}\n` : ""}${details.error ? `Error: ${details.error}\n` : ""}Completed: ${record.completed || "(not completed)"}
`;
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
