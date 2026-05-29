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
});
