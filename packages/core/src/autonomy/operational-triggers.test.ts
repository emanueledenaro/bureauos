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
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";
import { RunEngine, type RunRecord } from "../runs/engine.js";
import { OperationalSignalTriggerService } from "./operational-triggers.js";

const NOW = new Date("2026-05-24T12:00:00.000Z");
const OLD = "2026-05-20T09:00:00.000Z";
const OLDER = "2026-05-19T09:00:00.000Z";

describe("OperationalSignalTriggerService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-operational-triggers-"));
    await initWorkspace({ root: dir, organizationName: "Operational Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function patchProject(
    project: ProjectRecord,
    patch: Partial<ProjectRecord>,
  ): Promise<void> {
    const path = join(workspacePaths(dir).projectsDir, project.slug, "PROJECT.md");
    const doc = await readDoc<ProjectRecord>(path);
    await writeDoc(path, { ...doc.front, ...patch }, doc.body);
  }

  async function patchClient(client: ClientRecord, patch: Partial<ClientRecord>): Promise<void> {
    const path = join(workspacePaths(dir).clientsDir, client.slug, "CLIENT.md");
    const doc = await readDoc<ClientRecord>(path);
    await writeDoc(path, { ...doc.front, ...patch }, doc.body);
  }

  async function patchRun(run: RunRecord, patch: Partial<RunRecord>): Promise<void> {
    const path = join(workspacePaths(dir).runsDir, `${run.id}.md`);
    const doc = await readDoc<RunRecord>(path);
    await writeDoc(path, { ...doc.front, ...patch }, doc.body);
  }

  it("starts idempotent threshold runs from internal operating signals", async () => {
    const config = defaultConfig("agency");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const clients = new ClientRegistry(dir);
    const projects = new ProjectRegistry(dir);
    const client = await clients.create({
      name: "Pizzeria Aurora",
      status: "active",
      industry: "food_and_beverage",
    });
    await patchClient(client, {
      last_client_message_at: OLD,
      last_owner_response_at: OLDER,
    });
    const project = await projects.create({
      name: "Pizzeria Aurora Booking Website",
      clientId: client.id,
      status: "blocked",
    });
    await patchProject(project, { updated: OLD });
    const blockedRun = await runs.start({
      type: "bug",
      triggerType: "owner_request",
      triggerSource: "owner:manual-bug",
      scope: "Original blocked implementation run",
      clientId: client.id,
      projectId: project.id,
    });
    await patchRun(blockedRun, { status: "blocked", updated: OLD, completed: "" });

    const service = new OperationalSignalTriggerService(dir, {
      runs,
      audit,
      artifacts,
      clients,
      projects,
      policy,
      coordinator: { audit, artifacts, policy },
    });

    const result = await service.scan({ now: NOW });
    const duplicate = await service.scan({ now: NOW });

    expect(result.triggered.map((item) => item.kind).sort()).toEqual([
      "blocked_project_age",
      "blocked_run_age",
      "empty_content_pipeline",
      "unanswered_client_message_age",
    ]);
    expect(result.report?.type).toBe("operational-signal-report");
    expect(duplicate.triggered).toHaveLength(0);
    expect(duplicate.skipped.map((item) => item.reason)).toEqual([
      "duplicate",
      "duplicate",
      "duplicate",
    ]);

    const thresholdRuns = (await runs.list()).filter((run) => run.trigger_type === "threshold");
    expect(thresholdRuns).toHaveLength(4);
    expect(thresholdRuns.map((run) => run.type).sort()).toEqual([
      "client_success",
      "content",
      "health_check",
      "health_check",
    ]);
    expect(thresholdRuns.every((run) => run.artifacts.includes(result.report!.id))).toBe(true);

    const reports = await artifacts.list({ type: "operational-signal-report" });
    expect(reports).toHaveLength(1);
    const report = await artifacts.read(reports[0]!.id);
    expect(report?.body).toContain("Pizzeria Aurora Booking Website");
    expect(report?.body).toContain("empty_content_pipeline");

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("operational.signal_trigger.run_started");
    expect(log).toContain("coordinator.step_completed");
  });

  it("blocks growth pipeline triggers when draft content autonomy is disabled", async () => {
    const config = defaultConfig("agency");
    config.growth_autonomy.draft_content = false;
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });

    const result = await new OperationalSignalTriggerService(dir, {
      runs,
      audit,
      artifacts,
      policy,
    }).scan({ now: NOW });

    expect(result.triggered).toHaveLength(0);
    expect(result.skipped).toEqual([
      {
        kind: "empty_content_pipeline",
        triggerSource: "bureauos.content_pipeline_empty:none:7d",
        reason: "policy_blocked",
      },
    ]);
    expect(await runs.list()).toHaveLength(0);

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("operational.signal_trigger.blocked");
  });
});
