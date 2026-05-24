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
import { RunEngine } from "./engine.js";

describe("RunEngine", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-runs-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runs a planning run to completion and writes an artifact", async () => {
    const config = defaultConfig("freelancer");
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const engine = new RunEngine(dir, { audit, artifacts, policy });

    const run = await engine.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "test",
      scope: "test scope",
    });

    expect(run.status).toBe("completed");
    expect(run.artifacts.length).toBe(1);

    const arts = await artifacts.list({ run_id: run.id });
    expect(arts.length).toBe(1);
    expect(arts[0]?.type).toBe("run-report");
  });

  it("blocks a run when policy disallows the underlying action", async () => {
    const config = defaultConfig("freelancer");
    config.autonomy.open_pull_requests = false;
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const engine = new RunEngine(dir, { audit, artifacts, policy });

    const run = await engine.start({
      type: "feature",
      triggerType: "owner_request",
      triggerSource: "test",
      scope: "implement X",
    });
    expect(run.status).toBe("needs_human");
  });
});
