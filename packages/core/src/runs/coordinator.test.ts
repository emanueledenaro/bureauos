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
import { createCoordinatorRunDispatcher, dispatchRun } from "./coordinator.js";
import { AgentRegistry, type AgentRunInput, type AgentRunOutput } from "../agents/runtime.js";
import { AGENT_INDEX } from "../agents/roles.js";
import {
  ProviderRouter,
  type GenerateTextOptions,
  type ProviderAdapter,
  type RuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
  type RuntimeTask,
} from "@bureauos/providers";
import { configureAgentProviderRouting } from "../agents/provider-routing.js";

class FakeProvider implements ProviderAdapter {
  readonly id = "openai-default";
  readonly type = "openai" as const;
  readonly name = "Fake OpenAI";
  readonly defaultModel = "fake-model";

  async listModels(): Promise<readonly string[]> {
    return [this.defaultModel];
  }

  async validateCredentials() {
    return { ok: true };
  }

  async generateText(options: GenerateTextOptions) {
    return {
      text: `# Generated ${options.model}\n\n${options.prompt}`,
      model: options.model,
    };
  }

  async *stream(): AsyncIterable<string> {
    yield "unused";
  }
}

class FakeRuntime implements RuntimeAdapter {
  readonly id = "codex-test";
  readonly type = "codex" as const;
  prepared?: RuntimeContext;
  executed?: RuntimeTask;

  canExecute(capability: string): boolean {
    return ["edit_code", "run_tests"].includes(capability);
  }

  async prepare(context: RuntimeContext): Promise<void> {
    this.prepared = context;
  }

  async execute(task: RuntimeTask): Promise<RuntimeResult> {
    this.executed = task;
    return {
      ok: true,
      artifacts: ["runtime_artifact"],
      evidence: "runtime tests passed",
      changedFiles: ["packages/core/src/runtime-target.ts"],
      commands: ["pnpm test"],
    };
  }
}

/**
 * Test agent that always succeeds, recording a single artifact. Lets pipeline
 * tests assert the happy path without depending on concrete-agent evidence
 * gates.
 */
class OkTestAgent {
  constructor(
    public readonly definition: NonNullable<ReturnType<typeof AGENT_INDEX.get>>,
    private readonly artifacts: ArtifactStore,
  ) {}

  async execute(input: AgentRunInput): Promise<AgentRunOutput> {
    const record = await this.artifacts.write({
      type: "run-report",
      createdBy: this.definition.id,
      runId: input.context.runId,
      body: `# ${this.definition.role} ok\n\nScope: ${input.context.scope}`,
    });
    return {
      ok: true,
      artifactIds: [record.id],
      decisions: [],
      blockers: [],
      notes: `${this.definition.role} completed`,
    };
  }
}

/** Test agent that always blocks with explicit blockers. */
class BlockingTestAgent {
  constructor(
    public readonly definition: NonNullable<ReturnType<typeof AGENT_INDEX.get>>,
    private readonly artifacts: ArtifactStore,
    private readonly blocker: string,
  ) {}

  async execute(input: AgentRunInput): Promise<AgentRunOutput> {
    const record = await this.artifacts.write({
      type: "run-report",
      createdBy: this.definition.id,
      runId: input.context.runId,
      body: `# ${this.definition.role} blocked\n\n${this.blocker}`,
    });
    return {
      ok: false,
      artifactIds: [record.id],
      decisions: ["blocked"],
      blockers: [this.blocker],
      notes: `${this.definition.role} blocked`,
    };
  }
}

function registryWith(
  artifacts: ArtifactStore,
  audit: AuditLog,
  policy: PolicyEngine,
  overrides: Record<string, "ok" | { block: string }>,
): AgentRegistry {
  const registry = new AgentRegistry({ artifacts, audit, policy });
  for (const [roleId, behavior] of Object.entries(overrides)) {
    const definition = AGENT_INDEX.get(roleId)!;
    registry.register(
      behavior === "ok"
        ? new OkTestAgent(definition, artifacts)
        : new BlockingTestAgent(definition, artifacts, behavior.block),
    );
  }
  return registry;
}

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

  it("passes supplied runtime capability into the development step", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const developmentRuntime = new FakeRuntime();

    const run = await runs.start({
      type: "feature",
      triggerType: "owner_request",
      triggerSource: "test",
      scope: "Wire development runtime",
    });

    await dispatchRun(
      {
        audit,
        artifacts,
        policy,
        developmentRuntime,
        capabilityUse: {
          async check(input) {
            const artifact = await artifacts.write({
              type: "capability-audit",
              createdBy: input.agent,
              runId: run.id,
              body: `# Gate ${input.action}\n\nAllowed.`,
            });
            return { status: "allowed", artifact };
          },
        },
      },
      { workspaceRoot: dir, run, scope: "Wire development runtime" },
    );

    expect(developmentRuntime.prepared).toMatchObject({ workspaceRoot: dir, runId: run.id });
    expect(developmentRuntime.executed).toMatchObject({
      capability: "edit_code",
      intent: "development_agent_execution",
    });
    const allArtifacts = await artifacts.list({ run_id: run.id });
    expect(allArtifacts.some((artifact) => artifact.type === "test-evidence-report")).toBe(true);
    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("agent.development.runtime_executed");
  });

  it("passes a selected model provider to agents while preserving deterministic templates", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const config = defaultConfig("freelancer");
    config.supreme_coordinator.provider = "openai";
    const policy = new PolicyEngine(config, new ApprovalRegistry(dir));
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const providerRouter = new ProviderRouter();
    providerRouter.register(new FakeProvider());
    configureAgentProviderRouting(providerRouter, config, ["product"]);

    const run = await runs.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "test",
      scope: "Prepare provider-routed planning",
    });

    const result = await dispatchRun(
      { audit, artifacts, policy, config, providerRouter },
      {
        workspaceRoot: dir,
        run,
        scope: "Prepare provider-routed planning",
        briefing: "The product agent should use the configured fake model.",
      },
    );

    expect(result.steps.map((s) => s.role)).toEqual(["project_manager", "product"]);
    const featureSpec = (await artifacts.list({ run_id: run.id })).find(
      (artifact) => artifact.type === "feature-spec",
    );
    expect(featureSpec).toBeDefined();
    const written = await artifacts.read(featureSpec!.id);
    expect(written?.body).toContain("# Generated gpt-5.5");
    expect(written?.body).toContain("## Generation Metadata");

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("model.provider.selected");
    expect(log).toContain("model:openai-default");
  });

  it("passes an explicit owner-selected model to provider-backed agents", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const config = defaultConfig("freelancer");
    config.supreme_coordinator.provider = "openai";
    config.supreme_coordinator.model = "fake-model";
    const policy = new PolicyEngine(config, new ApprovalRegistry(dir));
    const runs = new RunEngine(dir, { audit, artifacts, policy });
    const providerRouter = new ProviderRouter();
    providerRouter.register(new FakeProvider());
    configureAgentProviderRouting(providerRouter, config, ["product"]);

    const run = await runs.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "test",
      scope: "Prepare explicit model routing",
    });

    await dispatchRun(
      { audit, artifacts, policy, config, providerRouter },
      {
        workspaceRoot: dir,
        run,
        scope: "Prepare explicit model routing",
        briefing: "The product agent should use the owner-selected model.",
      },
    );

    const featureSpec = (await artifacts.list({ run_id: run.id })).find(
      (artifact) => artifact.type === "feature-spec",
    );
    expect(featureSpec).toBeDefined();
    const written = await artifacts.read(featureSpec!.id);
    expect(written?.body).toContain("# Generated fake-model");
    expect(written?.body).toContain("- Model: fake-model");
  });

  it("propagates a specialist ok:false as a blocked dispatch result with blockers", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const runs = new RunEngine(dir, { audit, artifacts, policy });

    const run = await runs.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "test",
      scope: "Blocked planning",
    });

    const registry = registryWith(artifacts, audit, policy, {
      project_manager: "ok",
      product: { block: "missing acceptance evidence" },
    });
    const result = await dispatchRun(
      { audit, artifacts, policy, registry },
      {
        workspaceRoot: dir,
        run,
        scope: "Blocked planning",
      },
    );

    expect(result.steps.map((step) => step.ok)).toEqual([true, false]);
    const dispatcher = createCoordinatorRunDispatcher({ audit, artifacts, policy, registry });
    const dispatchResult = await dispatcher({
      workspaceRoot: dir,
      run,
      startInput: {
        type: "planning",
        triggerType: "owner_request",
        triggerSource: "test",
        scope: "Blocked planning",
      },
    });
    expect(dispatchResult.status).not.toBe("completed");
    expect(dispatchResult.status).toBe("blocked");
    expect(dispatchResult.blockers).toEqual(["product: missing acceptance evidence"]);
  });

  it("keeps completing when every specialist returns ok", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const runs = new RunEngine(dir, { audit, artifacts, policy });

    const run = await runs.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "test",
      scope: "Happy planning",
    });

    const registry = registryWith(artifacts, audit, policy, {
      project_manager: "ok",
      product: "ok",
    });
    const dispatcher = createCoordinatorRunDispatcher({ audit, artifacts, policy, registry });
    const dispatchResult = await dispatcher({
      workspaceRoot: dir,
      run,
      startInput: {
        type: "planning",
        triggerType: "owner_request",
        triggerSource: "test",
        scope: "Happy planning",
      },
    });
    expect(dispatchResult.status).toBe("completed");
    expect(dispatchResult.blockers).toBeUndefined();
  });

  it("ends the run blocked with dispatch_blockers and a run.blocked audit record through RunEngine", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const registry = registryWith(artifacts, audit, policy, {
      project_manager: "ok",
      product: { block: "missing acceptance evidence" },
    });
    const dispatcher = createCoordinatorRunDispatcher({ audit, artifacts, policy, registry });
    const runs = new RunEngine(dir, { audit, artifacts, policy, dispatcher });

    const run = await runs.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "test",
      scope: "Blocked planning through engine",
    });

    expect(run.status).toBe("blocked");
    expect(run["dispatch_blockers"]).toEqual(["product: missing acceptance evidence"]);

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("run.blocked");
    expect(log).not.toContain("run.completed");
  });

  it("completes the run through RunEngine when all specialists succeed", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const registry = registryWith(artifacts, audit, policy, {
      project_manager: "ok",
      product: "ok",
    });
    const dispatcher = createCoordinatorRunDispatcher({ audit, artifacts, policy, registry });
    const runs = new RunEngine(dir, { audit, artifacts, policy, dispatcher });

    const run = await runs.start({
      type: "planning",
      triggerType: "owner_request",
      triggerSource: "test",
      scope: "Happy planning through engine",
    });

    expect(run.status).toBe("completed");
    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("run.completed");
  });
});
