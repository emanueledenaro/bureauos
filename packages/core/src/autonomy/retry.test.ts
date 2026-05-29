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
import { AutonomousRetryService } from "./retry.js";

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
      coordinator: { audit, artifacts, policy },
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
});
