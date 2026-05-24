import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { ArtifactStore } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { PolicyEngine } from "../policy/engine.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { RunEngine } from "../runs/engine.js";
import { Scheduler } from "./scheduler.js";

describe("Scheduler", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-sched-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runs the scheduled jobs on the first tick", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const lines: string[] = [];
    const scheduler = new Scheduler({ config, runs, logger: (m) => lines.push(m) });
    await scheduler.tick(Date.now());
    const all = await runs.list();
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(lines.some((l) => l.includes("daily_executive_report"))).toBe(true);
  });

  it("does not double-run jobs within their interval", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const scheduler = new Scheduler({ config, runs, logger: () => {} });
    const t0 = 1_700_000_000_000;
    await scheduler.tick(t0);
    const after1 = (await runs.list()).length;
    await scheduler.tick(t0 + 60_000);
    const after2 = (await runs.list()).length;
    expect(after2).toBe(after1);
  });
});
