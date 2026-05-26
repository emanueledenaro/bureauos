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
import { RunEngine } from "../runs/engine.js";
import { MemoryTriggerService } from "./memory-triggers.js";

const NOW = new Date("2026-05-25T12:00:00.000Z");
const DUE = "2026-05-24T09:00:00.000Z";

describe("MemoryTriggerService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-memory-triggers-"));
    await initWorkspace({ root: dir, organizationName: "Memory Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function patchClient(client: ClientRecord, patch: Partial<ClientRecord>): Promise<void> {
    const path = join(workspacePaths(dir).clientsDir, client.slug, "CLIENT.md");
    const doc = await readDoc<ClientRecord>(path);
    await writeDoc(path, { ...doc.front, ...patch }, doc.body);
  }

  it("starts idempotent memory-due runs for client follow-ups", async () => {
    const config = defaultConfig("agency");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const client = await new ClientRegistry(dir).create({
      name: "Pizzeria Aurora",
      status: "active",
      industry: "food_and_beverage",
    });
    await patchClient(client, { next_follow_up_at: DUE });

    const service = new MemoryTriggerService(dir, {
      runs,
      audit,
      artifacts,
      policy,
      coordinator: { audit, artifacts, policy },
    });

    const result = await service.scan({ now: NOW });
    const duplicate = await service.scan({ now: NOW });

    expect(result.triggered).toHaveLength(1);
    expect(result.triggered[0]).toMatchObject({
      kind: "client_follow_up_due",
      triggerSource: `bureauos.memory_due:client_follow_up:${client.id}:${DUE}`,
    });
    expect(result.triggered[0]!.artifactIds.length).toBeGreaterThan(0);
    expect(duplicate.triggered).toHaveLength(0);
    expect(duplicate.skipped).toEqual([
      {
        kind: "client_follow_up_due",
        triggerSource: `bureauos.memory_due:client_follow_up:${client.id}:${DUE}`,
        reason: "duplicate",
      },
    ]);

    const memoryRuns = (await runs.list()).filter((run) => run.trigger_type === "memory_due");
    expect(memoryRuns).toHaveLength(1);
    expect(memoryRuns[0]).toMatchObject({
      type: "client_success",
      client_id: client.id,
    });
    expect(
      result.triggered[0]!.artifactIds.every((artifactId) =>
        memoryRuns[0]!.artifacts.includes(artifactId),
      ),
    ).toBe(true);

    const statusReports = await artifacts.list({ type: "client-success-status-report" });
    expect(statusReports).toHaveLength(1);
    const report = await artifacts.read(statusReports[0]!.id);
    expect(report?.body).toContain("# Client Success Status Report");
    expect(report?.body).toContain("Draft Follow-Up");
    expect(report?.body).toContain("Do not send the message without owner approval");

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("memory.trigger.run_started");
    expect(log).toContain("memory.trigger.fulfilled");
    expect(log).toContain("client.success_status.generated");
    expect(log).toContain("coordinator.step_completed");
  });

  it("blocks follow-up memory triggers when reply drafting is disabled", async () => {
    const config = defaultConfig("agency");
    config.growth_autonomy.draft_replies = false;
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const client = await new ClientRegistry(dir).create({
      name: "Pizzeria Aurora",
      status: "active",
      industry: "food_and_beverage",
    });
    await patchClient(client, { next_follow_up_at: DUE });

    const result = await new MemoryTriggerService(dir, {
      runs,
      audit,
      artifacts,
      policy,
    }).scan({ now: NOW });

    expect(result.triggered).toHaveLength(0);
    expect(result.skipped).toEqual([
      {
        kind: "client_follow_up_due",
        triggerSource: `bureauos.memory_due:client_follow_up:${client.id}:${DUE}`,
        reason: "policy_blocked",
      },
    ]);
    expect(await runs.list()).toHaveLength(0);
    expect(await artifacts.list({ type: "client-success-status-report" })).toHaveLength(0);

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("memory.trigger.blocked");
  });
});
