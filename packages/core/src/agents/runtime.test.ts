import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { defaultConfig } from "../config/loader.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { AgentRegistry } from "./runtime.js";

describe("AgentRegistry", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-agents-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns a stub agent for a known role and executes it", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const registry = new AgentRegistry({ artifacts, audit, policy });
    const agent = registry.get("supreme_coordinator");
    const out = await agent.execute({
      context: { runId: "run_xyz", scope: "test" },
      capabilities: new Map(),
    });
    expect(out.ok).toBe(true);
    expect(out.artifactIds.length).toBe(1);
  });

  it("throws on unknown roles", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const registry = new AgentRegistry({ artifacts, audit, policy });
    expect(() => registry.get("nonsense")).toThrow(/unknown agent role/);
  });
});
