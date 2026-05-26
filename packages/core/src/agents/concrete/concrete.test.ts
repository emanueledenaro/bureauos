import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  RuntimeAdapter,
  RuntimeContext,
  RuntimeResult,
  RuntimeTask,
} from "@bureauos/providers";
import { ArtifactStore } from "../../artifacts/store.js";
import { AuditLog } from "../../audit/log.js";
import { defaultConfig } from "../../config/loader.js";
import { PolicyEngine } from "../../policy/engine.js";
import { ApprovalRegistry } from "../../registries/approval.js";
import { initWorkspace } from "../../init/initializer.js";
import { workspacePaths } from "../../paths.js";
import type { AgentCapabilityCheckInput } from "../runtime.js";
import { DevelopmentAgent } from "./development.js";
import { buildDefaultAgentRegistry } from "./index.js";

class FakeRuntime implements RuntimeAdapter {
  public readonly id = "codex-test";
  public readonly type = "codex" as const;
  public prepared?: RuntimeContext;
  public executed?: RuntimeTask;

  constructor(private readonly result: RuntimeResult) {}

  canExecute(capability: string): boolean {
    return ["edit_code", "run_tests"].includes(capability);
  }

  async prepare(context: RuntimeContext): Promise<void> {
    this.prepared = context;
  }

  async execute(task: RuntimeTask): Promise<RuntimeResult> {
    this.executed = task;
    return this.result;
  }
}

describe("concrete agents", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-concrete-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("each concrete agent writes the artifact type that matches its role", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const registry = buildDefaultAgentRegistry({ artifacts, audit, policy });

    const expectedArtifactTypes: Record<string, string> = {
      project_manager: "run-report",
      product: "feature-spec",
      development: "technical-plan",
      qa: "test-plan",
      security: "security-review",
      compliance: "compliance-review",
    };

    for (const [roleId, expectedType] of Object.entries(expectedArtifactTypes)) {
      const agent = registry.get(roleId);
      const out = await agent.execute({
        context: { runId: `run_test_${roleId}`, scope: "smoke test" },
        capabilities: new Map(),
      });
      expect(out.ok).toBe(true);
      expect(out.artifactIds.length).toBe(1);
      const written = await artifacts.read(out.artifactIds[0]!);
      expect(written?.record.type).toBe(expectedType);
      expect(written?.record.created_by).toBe(roleId);
    }
  });

  it("every templated agent role writes its signature artifact", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const registry = buildDefaultAgentRegistry({ artifacts, audit, policy });

    const templated: Record<string, string> = {
      supreme_coordinator: "executive-report",
      ux: "design-spec",
      reviewer: "pr-review",
      release: "run-report",
      visibility: "brand-brief",
      content: "social-post-brief",
      social: "social-post-brief",
      creative: "creative-brief",
      ads: "ad-campaign-brief",
      marketing: "campaign-brief",
      conversion: "conversion-audit",
      sales: "lead-qualification-report",
      pricing: "pricing-brief",
      proposal: "proposal-brief",
      client_success: "client-account-plan",
    };

    for (const [roleId, expectedType] of Object.entries(templated)) {
      const agent = registry.get(roleId);
      expect(agent.definition.id).toBe(roleId);
      const out = await agent.execute({
        context: { runId: `run_${roleId}`, scope: "stub run" },
        capabilities: new Map(),
      });
      expect(out.ok).toBe(true);
      expect(out.artifactIds.length).toBe(1);
      const written = await artifacts.read(out.artifactIds[0]!);
      expect(written?.record.type).toBe(expectedType);
      expect(written?.record.created_by).toBe(roleId);
    }
  });

  it("makes development template-only fallback explicit when no runtime is supplied", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const agent = new DevelopmentAgent({ artifacts, audit, policy });

    const out = await agent.execute({
      context: { runId: "run_dev", scope: "implement runtime work" },
      capabilities: new Map(),
    });

    expect(out.ok).toBe(true);
    expect(out.artifactIds.length).toBe(1);
    expect(out.decisions).toContain("template_only_fallback");
    expect(out.notes).toContain("template-only fallback");
    const written = await artifacts.read(out.artifactIds[0]!);
    expect(written?.body).toContain("Template-only fallback");
  });

  it("executes development runtime when codex gates allow", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const gateChecks: AgentCapabilityCheckInput[] = [];
    const runtime = new FakeRuntime({
      ok: true,
      artifacts: ["runtime_artifact"],
      evidence: "pnpm test passed",
      changedFiles: ["packages/core/src/example.ts"],
      commands: ["pnpm test"],
    });
    const agent = new DevelopmentAgent({
      artifacts,
      audit,
      policy,
      capabilityUse: {
        async check(input) {
          gateChecks.push(input);
          const artifact = await artifacts.write({
            type: "capability-audit",
            createdBy: input.agent,
            runId: "run_dev",
            body: `# Gate ${input.action}\n\nAllowed.`,
          });
          return { status: "allowed", artifact };
        },
      },
    });

    const out = await agent.execute({
      context: {
        workspaceRoot: dir,
        runId: "run_dev",
        scope: "implement runtime work",
        projectId: "project_1",
      },
      capabilities: new Map([["codex", runtime]]),
    });

    expect(out.ok).toBe(true);
    expect(gateChecks.map((check) => check.action)).toEqual(["edit_code", "run_tests"]);
    expect(runtime.prepared).toMatchObject({ workspaceRoot: dir, runId: "run_dev" });
    expect(runtime.executed).toMatchObject({
      capability: "edit_code",
      intent: "development_agent_execution",
      scope: "implement runtime work",
    });
    expect(out.artifactIds).toContain("runtime_artifact");
    expect(out.decisions).toContain("runtime_execution");

    const records = await Promise.all(
      out.artifactIds
        .filter((id) => id !== "runtime_artifact")
        .map((id) => artifacts.read(id).then((doc) => doc?.record.type)),
    );
    expect(records).toContain("technical-plan");
    expect(records).toContain("capability-audit");
    expect(records).toContain("run-report");
    expect(records).toContain("test-evidence-report");
    const log = await readAudit(dir);
    expect(log).toContain("agent.development.runtime_executed");
  });

  it("blocks development runtime before execution when capability gates fail", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const runtime = new FakeRuntime({ ok: true, artifacts: [] });
    const agent = new DevelopmentAgent({
      artifacts,
      audit,
      policy,
      capabilityUse: {
        async check(input) {
          const artifact = await artifacts.write({
            type: "capability-audit",
            createdBy: input.agent,
            runId: "run_dev",
            body: `# Gate ${input.action}\n\nBlocked.`,
          });
          return {
            status: "blocked",
            artifact,
            policy: { reason: "missing linked issue" },
          };
        },
      },
    });

    const out = await agent.execute({
      context: { workspaceRoot: dir, runId: "run_dev", scope: "implement runtime work" },
      capabilities: new Map([["codex", runtime]]),
    });

    expect(out.ok).toBe(false);
    expect(out.blockers).toEqual(["missing linked issue"]);
    expect(runtime.executed).toBeUndefined();
    expect(out.decisions).toContain("runtime_blocked");
    const log = await readAudit(dir);
    expect(log).toContain("agent.development.runtime_blocked");
  });
});

async function readAudit(dir: string): Promise<string> {
  return readFile(workspacePaths(dir).auditLog, "utf8");
}
