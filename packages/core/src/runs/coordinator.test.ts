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
import { RunEngine } from "./engine.js";
import { dispatchRun } from "./coordinator.js";

describe("Supreme Coordinator dispatch", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-coord-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runs the planning pipeline through PM + Product and writes their artifacts", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const runs = new RunEngine(dir, { audit, artifacts, policy });

    const run = await runs.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "test",
      scope: "Q3 plan",
    });

    const result = await dispatchRun(
      { audit, artifacts, policy },
      {
        workspaceRoot: dir,
        run,
        scope: "Q3 plan",
        briefing: "Aim for 4 active clients by end of quarter.",
      },
    );

    expect(result.steps.map((s) => s.role)).toEqual(["project_manager", "product"]);

    const allArtifacts = await artifacts.list({ run_id: run.id });
    // 1 from run engine stub + 2 from the pipeline (PM + Product)
    expect(allArtifacts.length).toBeGreaterThanOrEqual(3);
    const types = new Set(allArtifacts.map((a) => a.type));
    expect(types.has("run-report")).toBe(true);
    expect(types.has("feature-spec")).toBe(true);

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("coordinator.briefing_written");
    expect(log).toContain("coordinator.step_completed");
  });

  it("runs the feature pipeline through Product, UX, Dev, QA, Security, Reviewer", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const runs = new RunEngine(dir, { audit, artifacts, policy });

    const run = await runs.start({
      type: "feature",
      triggerType: "owner_request",
      triggerSource: "test",
      scope: "Add Google login",
    });

    const result = await dispatchRun(
      { audit, artifacts, policy },
      { workspaceRoot: dir, run, scope: "Add Google login" },
    );
    expect(result.steps.map((s) => s.role)).toEqual([
      "product",
      "ux",
      "development",
      "qa",
      "security",
      "reviewer",
    ]);
  });
});
