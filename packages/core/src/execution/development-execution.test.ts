import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { defaultConfig } from "../config/loader.js";
import { workspacePaths } from "../paths.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { buildDevelopmentExecution } from "./development-execution.js";

describe("buildDevelopmentExecution (SER-239)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-dev-exec-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function deps(config = defaultConfig("agency")) {
    const approvals = new ApprovalRegistry(dir);
    return {
      config,
      approvals,
      artifacts: new ArtifactStore(dir),
      audit: new AuditLog(workspacePaths(dir).auditLog),
      policy: new PolicyEngine(config, approvals),
    };
  }

  it("returns nothing when the codex runtime is disabled (default)", () => {
    const { config, ...rest } = deps();
    const result = buildDevelopmentExecution(dir, config, rest);
    expect(result.developmentRuntime).toBeUndefined();
    expect(result.capabilityUse).toBeUndefined();
  });

  it("builds the runtime and its capability checker as a strict pair when enabled", () => {
    const config = defaultConfig("agency");
    config.runtime.codex.enabled = true;
    const { config: cfg, ...rest } = deps(config);
    const result = buildDevelopmentExecution(dir, cfg, rest);
    // The two must come together: a real runtime without a gate would let the
    // development agent skip its fail-closed edit_code/run_tests checks.
    expect(result.developmentRuntime).toBeDefined();
    expect(result.capabilityUse).toBeDefined();
  });
});
