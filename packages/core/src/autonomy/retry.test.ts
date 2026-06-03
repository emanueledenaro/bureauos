import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { defaultConfig } from "../config/loader.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { readDoc, writeDoc } from "../registries/base.js";
import { RunEngine, type RunRecord } from "../runs/engine.js";
import { AutonomousRetryService, type RetryProjectDispatcher } from "./retry.js";
import { AgentRegistry, type AgentRunInput, type AgentRunOutput } from "../agents/runtime.js";
import { AGENT_INDEX } from "../agents/roles.js";
import { ProjectRegistry } from "../registries/project.js";
import { ownerBuildSourceWorkItem } from "../work-items/source.js";
import type { DispatchOutput } from "../runs/coordinator.js";

/** Registry whose every role resolves to an ok stub (clean recovery path). */
function okRegistry(deps: {
  artifacts: ArtifactStore;
  audit: AuditLog;
  policy: PolicyEngine;
}): AgentRegistry {
  return new AgentRegistry(deps);
}

/** Registry where one role blocks, so a coordinator retry truthfully fails. */
function blockingRegistry(
  deps: { artifacts: ArtifactStore; audit: AuditLog; policy: PolicyEngine },
  roleId: string,
  blocker: string,
): AgentRegistry {
  const registry = new AgentRegistry(deps);
  const definition = AGENT_INDEX.get(roleId)!;
  registry.register({
    definition,
    async execute(input: AgentRunInput): Promise<AgentRunOutput> {
      const record = await deps.artifacts.write({
        type: "run-report",
        createdBy: definition.id,
        runId: input.context.runId,
        body: `# ${definition.role} blocked\n\n${blocker}`,
      });
      return {
        ok: false,
        artifactIds: [record.id],
        decisions: ["blocked"],
        blockers: [blocker],
        notes: `${definition.role} blocked`,
      };
    },
  });
  return registry;
}

/**
 * Spy {@link RetryProjectDispatcher}: records every dispatch call and creates a
 * REAL run (so the retry's parent-linkage/recovery bookkeeping behaves), with a
 * configurable all-ok or blocked step set. Stands in for the heavy
 * ProjectDispatchService so the test asserts the ROUTING without running the
 * provider-codegen pipeline.
 */
class SpyProjectDispatcher implements RetryProjectDispatcher {
  readonly calls: Array<{
    projectSlug: string;
    runType: RunRecord["type"];
    scope: string;
    source?: string;
    ownerBuild?: boolean;
  }> = [];

  constructor(
    private readonly runs: RunEngine,
    private readonly outcome: "ok" | "blocked" = "ok",
  ) {}

  async dispatch(input: {
    projectSlug: string;
    runType: RunRecord["type"];
    scope: string;
    briefing?: string;
    source?: string;
    ownerBuild?: boolean;
  }): Promise<{ run: RunRecord; dispatch: DispatchOutput; artifacts: never[] }> {
    this.calls.push({
      projectSlug: input.projectSlug,
      runType: input.runType,
      scope: input.scope,
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.ownerBuild !== undefined ? { ownerBuild: input.ownerBuild } : {}),
    });
    // Mirror ProjectDispatchService: start a run carrying the passed trigger
    // source and final status, so it becomes the retry child the service tracks.
    const run = await this.runs.start({
      type: input.runType,
      triggerType: "owner_request",
      triggerSource: input.source ?? "project_dispatch",
      scope: input.scope,
    });
    const blocked = this.outcome === "blocked";
    if (blocked) await this.runs.patch(run.id, { status: "blocked" });
    const finalRun = (await this.runs.get(run.id)) ?? run;
    const steps = blocked
      ? [{ role: "qa", ok: false, artifactIds: [], blockers: ["qa: still not ready"], notes: "" }]
      : [{ role: "development", ok: true, artifactIds: [], blockers: [], notes: "built" }];
    return {
      run: finalRun,
      dispatch: { runId: finalRun.id, steps, briefingArtifactId: "brief_spy" },
      artifacts: [],
    };
  }
}

const NOW = new Date("2026-05-25T12:00:00.000Z");

describe("AutonomousRetryService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-autonomy-retry-"));
    await initWorkspace({ root: dir, organizationName: "Autonomy Retry", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function patchRun(run: RunRecord, patch: Partial<RunRecord>): Promise<void> {
    const path = join(workspacePaths(dir).runsDir, `${run.id}.md`);
    const doc = await readDoc<RunRecord>(path);
    await writeDoc(path, { ...doc.front, ...patch }, doc.body);
  }

  function runtime() {
    const config = defaultConfig("agency");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    return { config, artifacts, audit, policy, runs };
  }

  it("starts a bounded retry run and records recovery metadata", async () => {
    const { artifacts, audit, policy, runs } = runtime();
    const original = await runs.start({
      type: "bug",
      triggerType: "owner_request",
      triggerSource: "owner:bug",
      scope: "Fix booking regression",
    });
    await patchRun(original, { status: "failed", completed: "" });

    const service = new AutonomousRetryService(dir, {
      runs,
      audit,
      artifacts,
      policy,
      coordinator: { audit, artifacts, policy, registry: okRegistry({ artifacts, audit, policy }) },
    });
    const result = await service.scan({ now: NOW, maxAttempts: 2 });
    const duplicate = await service.scan({ now: NOW, maxAttempts: 2 });

    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0]?.attempt).toBe(1);
    expect(result.triggered[0]?.triggerSource).toBe(`bureauos.retry:${original.id}:1`);
    expect(result.report).toMatchObject({
      type: "autonomy-retry-report",
      status: "submitted",
      retry_count: 1,
      escalation_count: 0,
    });
    expect(duplicate.triggered).toHaveLength(0);
    expect(duplicate.skipped[0]?.reason).toBe("already_recovered");

    const patchedOriginal = await runs.get(original.id);
    expect(patchedOriginal?.["retry_attempts"]).toBe(1);
    expect(patchedOriginal?.["next_retry_at"]).toBe("2026-05-25T12:30:00.000Z");
    expect(patchedOriginal?.["retry_recovered_at"]).toBe(NOW.toISOString());
    expect(patchedOriginal?.["retry_child_runs"]).toEqual([result.triggered[0]!.retryRun.id]);

    const retryArtifacts = await artifacts.list({ run_id: result.triggered[0]!.retryRun.id });
    expect(retryArtifacts.length).toBeGreaterThan(1);
    const retryRun = await runs.get(result.triggered[0]!.retryRun.id);
    expect(retryRun).toMatchObject({
      retry_parent_run_id: original.id,
      retry_attempt: 1,
      retry_max_attempts: 2,
      retry_classification: "retryable_failure",
      retry_report_id: result.report!.id,
    });
    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("autonomy.retry.started");
    expect(log).toContain("coordinator.step_completed");
  });

  it("escalates with an owner-visible blocker instead of looping after the retry limit", async () => {
    const { artifacts, audit, policy, runs } = runtime();
    const original = await runs.start({
      type: "bug",
      triggerType: "owner_request",
      triggerSource: "owner:bug",
      scope: "Fix booking regression",
    });
    await runs.patch(original.id, {
      status: "failed",
      completed: "",
      retry_attempts: 2,
    });

    const result = await new AutonomousRetryService(dir, {
      runs,
      audit,
      artifacts,
      policy,
    }).scan({ now: NOW, maxAttempts: 2 });

    expect(result.triggered).toHaveLength(0);
    expect(result.escalated).toHaveLength(1);
    expect(result.escalated[0]?.attempts).toBe(2);
    expect(result.escalated[0]?.reason).toBe("max_attempts_reached");
    expect(result.escalated[0]?.blocker).toContain("Retry limit reached");
    expect(result.escalated[0]?.approval?.action).toBe("resolve_retry_blocker");
    const patchedOriginal = await runs.get(original.id);
    expect(patchedOriginal?.["next_retry_at"]).toBe("");
    expect(patchedOriginal?.["retry_escalated_at"]).toBe(NOW.toISOString());
    expect(patchedOriginal?.["retry_escalation_reason"]).toBe("max_attempts_reached");
    expect(patchedOriginal?.["retry_blocker_approval_id"]).toBe(result.escalated[0]?.approval?.id);
    expect(patchedOriginal?.["retry_report_id"]).toBe(result.report?.id);

    const approvals = await new ApprovalRegistry(dir).listPending();
    expect(approvals).toEqual([
      expect.objectContaining({
        id: result.escalated[0]?.approval?.id,
        action: "resolve_retry_blocker",
        run_id: original.id,
        status: "pending",
      }),
    ]);

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("autonomy.retry.escalated");
    expect(log).toContain(result.escalated[0]!.approval!.id);
  });

  it("escalates non-retryable failures without spending an attempt", async () => {
    const { artifacts, audit, policy, runs } = runtime();
    const original = await runs.start({
      type: "bug",
      triggerType: "owner_request",
      triggerSource: "owner:bug",
      scope: "Fix booking regression",
    });
    await runs.patch(original.id, {
      status: "blocked",
      completed: "",
      dispatch_blockers: ["Missing production credential approval"],
    });

    const result = await new AutonomousRetryService(dir, {
      runs,
      audit,
      artifacts,
      policy,
    }).scan({ now: NOW, maxAttempts: 2 });

    expect(result.triggered).toHaveLength(0);
    expect(result.escalated).toHaveLength(1);
    expect(result.escalated[0]).toMatchObject({
      attempts: 0,
      reason: "non_retryable_failure",
      blocker: "Failure needs credential or access intervention before retry.",
    });
    const patchedOriginal = await runs.get(original.id);
    expect(patchedOriginal).toMatchObject({
      retry_attempts: 0,
      retry_escalation_reason: "non_retryable_failure",
      retry_classification: "non_retryable_credentials",
    });
    expect(patchedOriginal?.["retry_child_runs"]).toBeUndefined();
  });

  it("does not mark recovery when the retry truthfully blocks, then escalates over the limit", async () => {
    const { artifacts, audit, policy, runs } = runtime();
    const original = await runs.start({
      type: "bug",
      triggerType: "owner_request",
      triggerSource: "owner:bug",
      scope: "Fix booking regression",
    });
    await patchRun(original, { status: "failed", completed: "" });

    const service = new AutonomousRetryService(dir, {
      runs,
      audit,
      artifacts,
      policy,
      coordinator: {
        audit,
        artifacts,
        policy,
        registry: blockingRegistry({ artifacts, audit, policy }, "qa", "qa: still not ready"),
      },
    });

    // First attempt: the coordinator retry blocks, so recovery must NOT be set
    // and the original stays eligible for the next bounded attempt.
    const first = await service.scan({ now: NOW, maxAttempts: 1 });
    expect(first.triggered).toHaveLength(1);
    const retryRunId = first.triggered[0]!.retryRun.id;

    const afterFirst = await runs.get(original.id);
    expect(afterFirst?.["retry_recovered_at"]).toBeUndefined();
    expect(afterFirst?.["retry_attempts"]).toBe(1);

    // The retry child itself is now truthfully blocked with blockers persisted.
    const retryRun = await runs.get(retryRunId);
    expect(retryRun?.status).toBe("blocked");
    expect(retryRun?.["dispatch_blockers"]).toEqual(["qa: qa: still not ready"]);

    // Second scan over maxAttempts escalates the original instead of looping.
    const second = await service.scan({ now: NOW, maxAttempts: 1 });
    expect(second.triggered).toHaveLength(0);
    expect(second.escalated).toHaveLength(1);
    expect(second.escalated[0]?.run.id).toBe(original.id);
    expect(second.escalated[0]?.reason).toBe("max_attempts_reached");

    const escalatedOriginal = await runs.get(original.id);
    expect(escalatedOriginal?.["retry_escalated_at"]).toBe(NOW.toISOString());
    expect(escalatedOriginal?.["retry_recovered_at"]).toBeUndefined();
  });

  it("honors policy when retry triage is disabled", async () => {
    const config = defaultConfig("agency");
    config.autonomy.start_triage_runs = false;
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const original = await runs.start({
      type: "bug",
      triggerType: "owner_request",
      triggerSource: "owner:bug",
      scope: "Fix booking regression",
    });
    await patchRun(original, { status: "failed", completed: "" });

    const result = await new AutonomousRetryService(dir, {
      runs,
      audit,
      artifacts,
      policy,
    }).scan({ now: NOW, maxAttempts: 2 });

    expect(result.triggered).toHaveLength(0);
    expect(result.skipped).toEqual([
      {
        run: expect.objectContaining({ id: original.id }),
        reason: "policy_blocked",
        triggerSource: `bureauos.retry:${original.id}:1`,
      },
    ]);

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("autonomy.retry.blocked");
  });

  it("routes an owner-build feature run retry through ProjectDispatchService with ownerBuild (not template-only)", async () => {
    const { artifacts, audit, policy, runs } = runtime();
    const projects = new ProjectRegistry(dir);
    const project = await projects.create({ name: "Acme App", clientId: "client_acme" });

    // An owner-build code (feature) run that blocked, e.g. QA hard-block.
    const original = await runs.start({
      type: "feature",
      triggerType: "owner_request",
      triggerSource: "owner:build",
      scope: "Build the landing page",
      projectId: project.id,
      sourceWorkItem: ownerBuildSourceWorkItem({ projectId: project.id }),
    });
    await runs.patch(original.id, {
      status: "blocked",
      completed: "",
      dispatch_blockers: ["qa: missing evidence for acceptance criterion"],
    });

    const spy = new SpyProjectDispatcher(runs, "ok");
    const result = await new AutonomousRetryService(dir, {
      runs,
      audit,
      artifacts,
      policy,
      // The fallback coordinator path is still wired; the assertion is that the
      // CODE run takes the project-dispatch path instead.
      coordinator: { audit, artifacts, policy },
      projects,
      projectDispatch: spy,
    }).scan({ now: NOW, maxAttempts: 2 });

    // Routed through ProjectDispatchService, preserving ownerBuild + slug + the
    // retry trigger source (so the dispatched run is the retry child).
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]).toMatchObject({
      projectSlug: project.slug,
      runType: "feature",
      ownerBuild: true,
      source: `bureauos.retry:${original.id}:1`,
    });

    // The retry recovered (the dispatch returned all-ok steps) — i.e. it did NOT
    // degrade to a template-only re-block.
    expect(result.triggered).toHaveLength(1);
    const patchedOriginal = await runs.get(original.id);
    expect(patchedOriginal?.["retry_recovered_at"]).toBe(NOW.toISOString());
    expect(patchedOriginal?.["retry_child_runs"]).toEqual([result.triggered[0]!.retryRun.id]);

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("autonomy.retry.code_dispatch");
  });

  it("does NOT preserve ownerBuild when the code run was not an owner build", async () => {
    const { artifacts, audit, policy, runs } = runtime();
    const projects = new ProjectRegistry(dir);
    const project = await projects.create({ name: "Beta App", clientId: "client_beta" });

    // A non-owner-build feature run (no owner_build work item) that blocked.
    const original = await runs.start({
      type: "feature",
      triggerType: "event",
      triggerSource: "signal:regression",
      scope: "Fix a regression",
      projectId: project.id,
    });
    await runs.patch(original.id, { status: "blocked", completed: "" });

    const spy = new SpyProjectDispatcher(runs, "ok");
    await new AutonomousRetryService(dir, {
      runs,
      audit,
      artifacts,
      policy,
      coordinator: { audit, artifacts, policy },
      projects,
      projectDispatch: spy,
    }).scan({ now: NOW, maxAttempts: 2 });

    // Still routed via project dispatch (it is a code run), but ownerBuild is NOT
    // set — so the relaxed linked_issue gate never leaks to non-owner code runs.
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]?.ownerBuild).toBeUndefined();
  });

  it("uses the unchanged dispatchRun path for a NON-code run retry", async () => {
    const { artifacts, audit, policy, runs } = runtime();
    const projects = new ProjectRegistry(dir);
    const project = await projects.create({ name: "Gamma Co", clientId: "client_gamma" });

    // A planning run is NOT a code run (its pipeline has no development role), so
    // it must use the coordinator/dispatchRun path — the spy must never be called.
    const original = await runs.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "owner:plan",
      scope: "Plan the next milestone",
      projectId: project.id,
    });
    await runs.patch(original.id, { status: "failed", completed: "" });

    const spy = new SpyProjectDispatcher(runs, "ok");
    const result = await new AutonomousRetryService(dir, {
      runs,
      audit,
      artifacts,
      policy,
      coordinator: { audit, artifacts, policy, registry: okRegistry({ artifacts, audit, policy }) },
      projects,
      projectDispatch: spy,
    }).scan({ now: NOW, maxAttempts: 2 });

    expect(spy.calls).toHaveLength(0);
    expect(result.triggered).toHaveLength(1);
    // Recovered through the coordinator stub/dispatchRun path, as before.
    const patchedOriginal = await runs.get(original.id);
    expect(patchedOriginal?.["retry_recovered_at"]).toBe(NOW.toISOString());
    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).not.toContain("autonomy.retry.code_dispatch");
    expect(log).toContain("coordinator.step_completed");
  });
});
