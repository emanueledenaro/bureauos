import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  GenerateTextOptions,
  GenerateTextResult,
  ProviderAdapter,
  RuntimeAdapter,
  RuntimeContext,
  RuntimeResult,
  RuntimeTask,
  ValidationResult,
} from "@bureauos/providers";
import { ArtifactStore } from "../../artifacts/store.js";
import { AuditLog } from "../../audit/log.js";
import { CapabilityUseService } from "../../capabilities/usage.js";
import { defaultConfig } from "../../config/loader.js";
import { PolicyEngine } from "../../policy/engine.js";
import { ApprovalRegistry } from "../../registries/approval.js";
import { initWorkspace } from "../../init/initializer.js";
import { workspacePaths } from "../../paths.js";
import type { AgentCapabilityCheckInput } from "../runtime.js";
import { MODEL_PROVIDER_CAPABILITY, type AgentModelSelection } from "../provider-routing.js";
import { buildCodexRuntimeFromConfig } from "../../execution/codex-runtime.js";
import {
  ProjectTestRunnerService,
  type ProjectCommandRunner,
  type ProjectCommandRunnerOptions,
  type ProjectTestExecution,
  type ResolvedProjectTestCommand,
} from "../../execution/project-test-runner.js";
import { DevelopmentAgent } from "./development.js";
import { buildDefaultAgentRegistry } from "./index.js";
import { QaAgent } from "./qa.js";
import { ReviewerAgent } from "./reviewer.js";
import { SecurityAgent } from "./security.js";

const run = promisify(execFile);

class FakeProvider implements ProviderAdapter {
  readonly id = "openai-default";
  readonly type = "openai" as const;
  readonly name = "Fake OpenAI";
  readonly defaultModel = "fake-model";

  constructor(private readonly behavior: "ok" | "throw" = "ok") {}

  async listModels(): Promise<readonly string[]> {
    return [this.defaultModel];
  }

  async validateCredentials(): Promise<ValidationResult> {
    return { ok: true };
  }

  async generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
    if (this.behavior === "throw") throw new Error("provider unavailable");
    return {
      text: `# Model-Drafted ${options.model}\n\n${options.prompt}`,
      model: options.model,
    };
  }

  async *stream(): AsyncIterable<string> {
    yield "unused";
  }
}

function modelCapability(
  provider: ProviderAdapter,
  model = "fake-model",
): Map<string, AgentModelSelection> {
  return new Map([
    [
      MODEL_PROVIDER_CAPABILITY,
      { provider, model, validation: { ok: true } } satisfies AgentModelSelection,
    ],
  ]);
}

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

/**
 * Deterministic command runner so QA test-gating can be exercised without
 * spawning a real subprocess. Returns a fixed execution result for any command.
 */
class FakeProjectCommandRunner implements ProjectCommandRunner {
  readonly commands: ResolvedProjectTestCommand[] = [];

  constructor(private readonly execution: ProjectTestExecution) {}

  async run(
    command: ResolvedProjectTestCommand,
    _options: ProjectCommandRunnerOptions,
  ): Promise<ProjectTestExecution> {
    this.commands.push(command);
    return this.execution;
  }
}

const PASSING_EXECUTION: ProjectTestExecution = {
  exitCode: 0,
  stdout: "all tests passed",
  stderr: "",
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
};

const FAILING_EXECUTION: ProjectTestExecution = {
  exitCode: 1,
  stdout: "1 failing",
  stderr: "AssertionError",
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
};

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
      reviewer: "pr-review",
    };

    for (const [roleId, expectedType] of Object.entries(expectedArtifactTypes)) {
      const agent = registry.get(roleId);
      const context =
        roleId === "qa"
          ? {
              runId: `run_test_${roleId}`,
              scope: "Acceptance criteria:\n- smoke test passes",
              briefing: "PASS: smoke test passes",
            }
          : { runId: `run_test_${roleId}`, scope: "smoke test" };
      const out = await agent.execute({
        context,
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

  it("blocks concrete agents when the handoff contract targets another agent", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const handoff = await artifacts.write({
      type: "agent-handoff",
      createdBy: "project_manager",
      runId: "run_wrong_target",
      metadata: {
        source_agent_id: "project_manager",
        target_agent_id: "reviewer",
        run_id: "run_wrong_target",
        scope: "QA should not consume this reviewer packet",
        input_artifact_ids: ["art_packet"],
        expected_output_types: ["pr-review"],
        acceptance_checks: ["Reviewer produces a PR review or blocker."],
      },
      body: "# Agent Handoff",
    });
    const agent = new QaAgent({ artifacts, audit, policy });

    const out = await agent.execute({
      context: {
        runId: "run_wrong_target",
        scope: "Acceptance criteria:\n- handoff target is enforced",
        handoffArtifactId: handoff.id,
      },
      capabilities: new Map(),
    });

    expect(out.ok).toBe(false);
    expect(out.decisions).toContain("handoff:invalid");
    expect(out.blockers).toContain("wrong target_agent_id: expected qa, got reviewer");
    const validation = await artifacts.read(out.artifactIds[0]!);
    expect(validation?.record.type).toBe("agent-handoff-validation");
    expect(validation?.body).toContain("Expected agent: qa");
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

  it("runs the codex runtime in the run's isolated worktree when supplied (SER-243)", async () => {
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
            body: `# Gate ${input.action}\n\nAllowed.`,
          });
          return { status: "allowed", artifact };
        },
      },
    });

    const codeWorkspaceRoot = "/tmp/bureauos-some-worktree/run_dev";
    const out = await agent.execute({
      context: {
        // The agency workspace (`.bureauos`) and the code workspace are distinct:
        // the runtime must edit code in the isolated worktree, not the workspace.
        workspaceRoot: dir,
        codeWorkspaceRoot,
        runId: "run_dev",
        scope: "implement runtime work",
      },
      capabilities: new Map([["codex", runtime]]),
    });

    expect(out.ok).toBe(true);
    expect(runtime.prepared?.workspaceRoot).toBe(codeWorkspaceRoot);
    expect(runtime.prepared?.workspaceRoot).not.toBe(dir);
  });

  it("drives a REAL codex runtime end-to-end: the development agent writes real code (SER-239)", async () => {
    // The runtime's diff inspector reads `git status`, so the workspace must be
    // a git repo with a clean baseline.
    await run("git", ["init", "-q"], { cwd: dir });
    await run("git", ["config", "user.email", "ci@bureauos.test"], { cwd: dir });
    await run("git", ["config", "user.name", "BureauOS CI"], { cwd: dir });
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-q", "-m", "baseline"], { cwd: dir });

    const config = defaultConfig("freelancer");
    config.runtime.codex.enabled = true;
    // `node` is in the default allow-list; this makes a real file change,
    // standing in for a Codex edit without needing the Codex CLI.
    config.runtime.codex.commands = [
      {
        command: "node",
        args: ["-e", "require('fs').writeFileSync('built.ts','// built by the agent\\n')"],
        label: "edit",
      },
    ];

    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    // No injected fakes -> the real subprocess executor + git diff run.
    const runtime = buildCodexRuntimeFromConfig(config);
    expect(runtime).toBeDefined();

    const agent = new DevelopmentAgent({
      artifacts,
      audit,
      policy,
      capabilityUse: {
        async check(input) {
          const artifact = await artifacts.write({
            type: "capability-audit",
            createdBy: input.agent,
            runId: "run_dev_real",
            body: `# Gate ${input.action}\n\nAllowed.`,
          });
          return { status: "allowed", artifact };
        },
      },
    });

    const out = await agent.execute({
      context: {
        workspaceRoot: dir,
        runId: "run_dev_real",
        scope: "build a real file",
        projectId: "project_1",
      },
      capabilities: new Map([["codex", runtime!]]),
    });

    // The agent drove the real runtime to completion (not template-only)...
    expect(out.ok).toBe(true);
    expect(out.decisions).toContain("runtime_execution");
    // ...the real subprocess actually wrote the file to disk...
    const built = await readFile(join(dir, "built.ts"), "utf8");
    expect(built).toContain("built by the agent");
    // ...and it was recorded as a real execution, not a template fallback.
    const log = await readAudit(dir);
    expect(log).toContain("agent.development.runtime_executed");
    expect(log).not.toContain("agent.development.template_only");
  }, 30_000);

  it("executes a real edit when a linked work item satisfies the gate (no tests required for the isolated edit, SER-242)", async () => {
    // Clean git baseline so the runtime's diff inspector sees only the new edit.
    await run("git", ["init", "-q"], { cwd: dir });
    await run("git", ["config", "user.email", "ci@bureauos.test"], { cwd: dir });
    await run("git", ["config", "user.name", "BureauOS CI"], { cwd: dir });
    await run("git", ["add", "."], { cwd: dir });
    await run("git", ["commit", "-q", "-m", "baseline"], { cwd: dir });

    const config = defaultConfig("agency");
    config.runtime.codex.enabled = true;
    config.autonomy.push_commits = true; // edit_code -> push_commits
    config.autonomy.observe_signals = true; // run_tests -> observe_signals
    config.runtime.codex.commands = [
      {
        command: "node",
        args: ["-e", "require('fs').writeFileSync('feature.ts','// built by the agent\\n')"],
        label: "edit",
      },
    ];

    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    // The REAL capability checker (not a fake) — this proves the gate logic:
    // edit_code passes because a linked work item satisfies linked_issue and the
    // isolated edit no longer requires tests (SER-242).
    const capabilityUse = new CapabilityUseService(dir, {
      config,
      artifacts,
      approvals,
      policy,
      audit,
    });
    const runtime = buildCodexRuntimeFromConfig(config);
    const agent = new DevelopmentAgent({ artifacts, audit, policy, capabilityUse });

    const out = await agent.execute({
      context: {
        workspaceRoot: dir,
        runId: "run_dev_gate",
        scope: "implement booking feature",
        // A linked Linear issue (no numeric GitHub number) tracks the work.
        linkedWorkItem: { type: "linear_issue", identifier: "SER-242" },
      },
      capabilities: new Map([["codex", runtime!]]),
    });

    expect(out.ok).toBe(true);
    expect(out.decisions).toContain("runtime_execution");
    const built = await readFile(join(dir, "feature.ts"), "utf8");
    expect(built).toContain("built by the agent");
    const log = await readAudit(dir);
    expect(log).toContain("agent.development.runtime_executed");
    expect(log).not.toContain("agent.development.runtime_blocked");
  }, 30_000);

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

  it("verifies QA acceptance criteria with produced artifact evidence", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    await artifacts.write({
      type: "feature-spec",
      createdBy: "product",
      runId: "run_qa_pass",
      body: [
        "# Feature Spec",
        "",
        "## Acceptance Criteria",
        "",
        "- Coordinator chat hides prompts and thoughts from user-facing replies.",
        "- QA blocks ready-for-review when evidence is missing.",
      ].join("\n"),
    });
    await artifacts.write({
      type: "test-evidence-report",
      createdBy: "development",
      runId: "run_qa_pass",
      body: [
        "# Test Evidence",
        "",
        "PASS: Coordinator chat hides prompts and thoughts from user-facing replies.",
        "PASS: QA blocks ready-for-review when evidence is missing.",
      ].join("\n"),
    });
    const agent = new QaAgent({ artifacts, audit, policy });

    const out = await agent.execute({
      context: {
        runId: "run_qa_pass",
        scope: [
          "SER-31: Wire QA Agent",
          "",
          "Acceptance criteria:",
          "- Coordinator chat hides prompts and thoughts from user-facing replies.",
          "- QA blocks ready-for-review when evidence is missing.",
        ].join("\n"),
      },
      capabilities: new Map(),
    });

    expect(out.ok).toBe(true);
    expect(out.decisions).toContain("qa:ready_for_review");
    expect(out.blockers).toEqual([]);
    const written = await artifacts.read(out.artifactIds[0]!);
    expect(written?.record.type).toBe("test-plan");
    expect(written?.record.qa_readiness).toBe("ready_for_review");
    expect(written?.record.acceptance_pass_count).toBe(2);
    expect(written?.record.acceptance_fail_count).toBe(0);
    expect(written?.record.acceptance_unknown_count).toBe(0);
    expect(written?.record.source_artifact_ids).toHaveLength(2);
    expect(written?.body).toContain("QA Verification Report");
    expect(written?.body).toContain("Produced Artifacts Reviewed");
    expect(written?.body).toContain("Status: pass");
    expect(written?.body).toContain("Ready-for-review is allowed by QA evidence.");
  });

  it("blocks QA readiness when acceptance evidence fails or is missing", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    await artifacts.write({
      type: "test-evidence-report",
      createdBy: "development",
      runId: "run_qa_fail",
      body: ["# Test Evidence", "", "FAIL: Missing evidence blocks ready-for-review status."].join(
        "\n",
      ),
    });
    const agent = new QaAgent({ artifacts, audit, policy });

    const out = await agent.execute({
      context: {
        runId: "run_qa_fail",
        scope: [
          "Acceptance criteria:",
          "- Missing evidence blocks ready-for-review status.",
          "- QA writes verification report with pass/fail/unknown items.",
        ].join("\n"),
      },
      capabilities: new Map(),
    });

    expect(out.ok).toBe(false);
    expect(out.decisions).toContain("qa:blocked");
    expect(out.blockers).toEqual([
      "failed acceptance criterion: Missing evidence blocks ready-for-review status.",
      "missing evidence for acceptance criterion: QA writes verification report with pass/fail/unknown items.",
    ]);
    const written = await artifacts.read(out.artifactIds[0]!);
    expect(written?.record.qa_readiness).toBe("blocked");
    expect(written?.record.acceptance_pass_count).toBe(0);
    expect(written?.record.acceptance_fail_count).toBe(1);
    expect(written?.record.acceptance_unknown_count).toBe(1);
    expect(written?.body).toContain("Status: fail");
    expect(written?.body).toContain("Status: unknown");
    expect(written?.body).toContain("Ready-for-review is blocked");
  });

  it("runs real project tests and reaches ready-for-review when they pass (SER-240)", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    await artifacts.write({
      type: "test-evidence-report",
      createdBy: "development",
      runId: "run_qa_tests_pass",
      body: ["# Test Evidence", "", "PASS: feature works end to end."].join("\n"),
    });

    const codeWorkspaceRoot = await mkdtemp(join(tmpdir(), "bureauos-qa-worktree-"));
    await writeFile(
      join(codeWorkspaceRoot, "package.json"),
      JSON.stringify({ packageManager: "pnpm@9.12.0", scripts: { test: "pnpm -r run test" } }),
      "utf8",
    );
    const commandRunner = new FakeProjectCommandRunner(PASSING_EXECUTION);
    const agent = new QaAgent({
      artifacts,
      audit,
      policy,
      projectTestRunnerFactory: (workspaceRoot, deps) =>
        new ProjectTestRunnerService(workspaceRoot, { ...deps, commandRunner }),
    });

    try {
      const out = await agent.execute({
        context: {
          runId: "run_qa_tests_pass",
          scope: ["Acceptance criteria:", "- feature works end to end."].join("\n"),
          codeWorkspaceRoot,
        },
        capabilities: new Map(),
      });

      expect(out.ok).toBe(true);
      expect(out.decisions).toContain("qa:ready_for_review");
      expect(out.decisions).toContain("qa:tests_passed");
      expect(out.blockers).toEqual([]);
      expect(commandRunner.commands).toHaveLength(1);
      // The QA report plus the test-evidence-report are both attached.
      expect(out.artifactIds).toHaveLength(2);
      const evidence = await artifacts.read(out.artifactIds[1]!);
      expect(evidence?.record.type).toBe("test-evidence-report");
      expect(evidence?.record.created_by).toBe("qa");
      expect(evidence?.record.test_status).toBe("passed");
      const log = await readFile(workspacePaths(dir).auditLog, "utf8");
      expect(log).toContain("agent.qa.tests_gated");
    } finally {
      await rm(codeWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("blocks ready-for-review and does not advance when project tests fail (SER-240)", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    // Acceptance evidence passes; the failing test suite alone must block.
    await artifacts.write({
      type: "test-evidence-report",
      createdBy: "development",
      runId: "run_qa_tests_fail",
      body: ["# Test Evidence", "", "PASS: feature works end to end."].join("\n"),
    });

    const codeWorkspaceRoot = await mkdtemp(join(tmpdir(), "bureauos-qa-worktree-"));
    await writeFile(
      join(codeWorkspaceRoot, "package.json"),
      JSON.stringify({ packageManager: "pnpm@9.12.0", scripts: { test: "pnpm -r run test" } }),
      "utf8",
    );
    const commandRunner = new FakeProjectCommandRunner(FAILING_EXECUTION);
    const agent = new QaAgent({
      artifacts,
      audit,
      policy,
      projectTestRunnerFactory: (workspaceRoot, deps) =>
        new ProjectTestRunnerService(workspaceRoot, { ...deps, commandRunner }),
    });

    try {
      const out = await agent.execute({
        context: {
          runId: "run_qa_tests_fail",
          scope: ["Acceptance criteria:", "- feature works end to end."].join("\n"),
          codeWorkspaceRoot,
        },
        capabilities: new Map(),
      });

      // ok:false means the coordinator pipeline does not advance to reviewer/release.
      expect(out.ok).toBe(false);
      expect(out.decisions).toContain("qa:tests_failed");
      expect(out.blockers).toContain("project tests failed");
      const evidence = await artifacts.read(out.artifactIds[1]!);
      expect(evidence?.record.test_status).toBe("failed");
    } finally {
      await rm(codeWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("blocks ready-for-review when no project test command is configured (SER-240)", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    await artifacts.write({
      type: "test-evidence-report",
      createdBy: "development",
      runId: "run_qa_tests_missing",
      body: ["# Test Evidence", "", "PASS: feature works end to end."].join("\n"),
    });

    // Worktree has no package.json test script: the runner reports "blocked".
    const codeWorkspaceRoot = await mkdtemp(join(tmpdir(), "bureauos-qa-worktree-"));
    const commandRunner = new FakeProjectCommandRunner(PASSING_EXECUTION);
    const agent = new QaAgent({
      artifacts,
      audit,
      policy,
      projectTestRunnerFactory: (workspaceRoot, deps) =>
        new ProjectTestRunnerService(workspaceRoot, { ...deps, commandRunner }),
    });

    try {
      const out = await agent.execute({
        context: {
          runId: "run_qa_tests_missing",
          scope: ["Acceptance criteria:", "- feature works end to end."].join("\n"),
          codeWorkspaceRoot,
        },
        capabilities: new Map(),
      });

      expect(out.ok).toBe(false);
      expect(out.decisions).toContain("qa:tests_blocked");
      expect(out.blockers).toContain("no project test command configured or discovered");
      // The fake command runner is never invoked when there is no test command.
      expect(commandRunner.commands).toHaveLength(0);
    } finally {
      await rm(codeWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("soft-passes a test-less static deliverable when allow_missing_tests is on (no-test-infra)", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));

    // Worktree has no package.json test script: the runner reports "blocked".
    const codeWorkspaceRoot = await mkdtemp(join(tmpdir(), "bureauos-qa-worktree-"));
    const commandRunner = new FakeProjectCommandRunner(PASSING_EXECUTION);
    const agent = new QaAgent({
      artifacts,
      audit,
      policy,
      allowMissingTests: true,
      projectTestRunnerFactory: (workspaceRoot, deps) =>
        new ProjectTestRunnerService(workspaceRoot, { ...deps, commandRunner }),
    });

    try {
      const out = await agent.execute({
        context: {
          runId: "run_qa_soft_pass",
          // The two test-DEPENDENT criteria the product agent emits — they can
          // only be met with tests, so they are exactly what the soft-pass covers.
          scope: [
            "Acceptance criteria:",
            "- Behavior described in the briefing is implemented and verifiable.",
            "- Tests cover at least one happy path and one edge case.",
          ].join("\n"),
          codeWorkspaceRoot,
        },
        capabilities: new Map(),
      });

      // The run completes: no hard block on the missing-test gate nor on the
      // test-dependent acceptance criteria.
      expect(out.ok).toBe(true);
      expect(out.blockers).toEqual([]);
      expect(out.decisions).toContain("qa:ready_for_review");
      expect(out.decisions).toContain("qa:tests_soft_passed_no_tests");
      expect(out.notes).toContain("soft-passed");
      // The fake command runner is never invoked when there is no test command.
      expect(commandRunner.commands).toHaveLength(0);
      // Traceability: a dedicated soft-pass audit line + a note in the QA report.
      const log = await readFile(workspacePaths(dir).auditLog, "utf8");
      expect(log).toContain("agent.qa.soft_passed_no_tests");
      const report = await artifacts.read(out.artifactIds[0]!);
      expect(report?.record.no_test_soft_pass).toBe(true);
      expect(report?.body).toContain("No-Test Soft-Pass");
    } finally {
      await rm(codeWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("still blocks on a NON-test acceptance criterion even with allow_missing_tests on", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));

    const codeWorkspaceRoot = await mkdtemp(join(tmpdir(), "bureauos-qa-worktree-"));
    const commandRunner = new FakeProjectCommandRunner(PASSING_EXECUTION);
    const agent = new QaAgent({
      artifacts,
      audit,
      policy,
      allowMissingTests: true,
      projectTestRunnerFactory: (workspaceRoot, deps) =>
        new ProjectTestRunnerService(workspaceRoot, { ...deps, commandRunner }),
    });

    try {
      const out = await agent.execute({
        context: {
          runId: "run_qa_soft_pass_nontest",
          // A non-test criterion with no evidence: must still block; the soft-pass
          // only relaxes the test-dependent ones.
          scope: ["Acceptance criteria:", "- The change is scoped to a single concern."].join(
            "\n",
          ),
          codeWorkspaceRoot,
        },
        capabilities: new Map(),
      });

      expect(out.ok).toBe(false);
      expect(out.blockers).toContain(
        "missing evidence for acceptance criterion: The change is scoped to a single concern.",
      );
      expect(out.decisions).toContain("qa:blocked");
    } finally {
      await rm(codeWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("still blocks when tests EXIST and FAIL regardless of allow_missing_tests", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    await artifacts.write({
      type: "test-evidence-report",
      createdBy: "development",
      runId: "run_qa_flag_on_tests_fail",
      body: ["# Test Evidence", "", "PASS: feature works end to end."].join("\n"),
    });

    // The worktree HAS a test script, so the runner runs it and it FAILS — this
    // is never the no-test-infra case, so the soft-pass must not apply.
    const codeWorkspaceRoot = await mkdtemp(join(tmpdir(), "bureauos-qa-worktree-"));
    await writeFile(
      join(codeWorkspaceRoot, "package.json"),
      JSON.stringify({ packageManager: "pnpm@9.12.0", scripts: { test: "pnpm -r run test" } }),
      "utf8",
    );
    const commandRunner = new FakeProjectCommandRunner(FAILING_EXECUTION);
    const agent = new QaAgent({
      artifacts,
      audit,
      policy,
      allowMissingTests: true,
      projectTestRunnerFactory: (workspaceRoot, deps) =>
        new ProjectTestRunnerService(workspaceRoot, { ...deps, commandRunner }),
    });

    try {
      const out = await agent.execute({
        context: {
          runId: "run_qa_flag_on_tests_fail",
          scope: ["Acceptance criteria:", "- feature works end to end."].join("\n"),
          codeWorkspaceRoot,
        },
        capabilities: new Map(),
      });

      expect(out.ok).toBe(false);
      expect(out.decisions).toContain("qa:tests_failed");
      expect(out.decisions).not.toContain("qa:tests_soft_passed_no_tests");
      expect(out.blockers).toContain("project tests failed");
      const log = await readFile(workspacePaths(dir).auditLog, "utf8");
      expect(log).not.toContain("agent.qa.soft_passed_no_tests");
    } finally {
      await rm(codeWorkspaceRoot, { recursive: true, force: true });
    }
  });

  it("flags auth payment and secrets paths in security review", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    await artifacts.write({
      type: "technical-plan",
      createdBy: "development",
      runId: "run_security_sensitive",
      body: [
        "# Runtime Diff",
        "",
        "Changed files:",
        "- packages/core/src/auth/oauth-callback.ts",
        "- packages/core/src/payments/stripe-webhook.ts",
        "- packages/core/src/config/secrets.ts",
      ].join("\n"),
    });
    const agent = new SecurityAgent({ artifacts, audit, policy });

    const out = await agent.execute({
      context: {
        runId: "run_security_sensitive",
        scope: "Review security-sensitive runtime changes before PR readiness.",
      },
      capabilities: new Map(),
    });

    expect(out.ok).toBe(false);
    expect(out.decisions).toContain("security:blocked");
    expect(out.blockers).toEqual([
      "unresolved high security finding in packages/core/src/auth/oauth-callback.ts: auth",
      "unresolved high security finding in packages/core/src/payments/stripe-webhook.ts: payment",
      "unresolved critical security finding in packages/core/src/config/secrets.ts: secret",
    ]);

    const written = await artifacts.read(out.artifactIds[0]!);
    expect(written?.record.type).toBe("security-review");
    expect(written?.record.risk_level).toBe("critical");
    expect(written?.record.finding_count).toBe(3);
    expect(written?.record.unresolved_high_risk_count).toBe(3);
    expect(written?.record.finding_severities).toEqual(["high", "high", "critical"]);
    expect(written?.record.source_artifact_ids).toHaveLength(1);
    expect(written?.body).toContain("Severity: critical");
    expect(written?.body).toContain("Category: secret");
    expect(written?.body).toContain("Required mitigation:");
    expect(written?.body).toContain("PR ready status is blocked");
  });

  it("allows security readiness when sensitive findings are mitigated", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const agent = new SecurityAgent({ artifacts, audit, policy });

    const out = await agent.execute({
      context: {
        runId: "run_security_mitigated",
        scope: "Review auth change.",
        briefing: [
          "Changed files:",
          "- packages/core/src/auth/session.ts",
          "SECURITY PASS: auth packages/core/src/auth/session.ts has denial-path tests.",
        ].join("\n"),
      },
      capabilities: new Map(),
    });

    expect(out.ok).toBe(true);
    expect(out.decisions).toContain("security:high_risk_ready");
    expect(out.blockers).toEqual([]);
    const written = await artifacts.read(out.artifactIds[0]!);
    expect(written?.record.risk_level).toBe("high");
    expect(written?.record.finding_count).toBe(1);
    expect(written?.record.unresolved_high_risk_count).toBe(0);
    expect(written?.body).toContain("Status: mitigated");
    expect(written?.body).toContain("PR ready status is allowed");
  });

  it("writes structured reviewer findings from diff and test artifacts", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const agent = new ReviewerAgent({ artifacts, audit, policy });

    const out = await agent.execute({
      context: {
        runId: "run_review",
        scope: "Review PR for auth callback changes",
        briefing: [
          "Changed files:",
          "- packages/core/src/auth/oauth-callback.ts",
          "Test evidence: (none)",
          "Diff note: TODO remove temporary console.log before merge.",
        ].join("\n"),
      },
      capabilities: new Map(),
    });

    expect(out.ok).toBe(false);
    expect(out.decisions).toContain("review:changes_requested");
    expect(out.blockers).toContain(
      "The diff touches sensitive auth, secret, payment, billing, or security surface.",
    );

    const written = await artifacts.read(out.artifactIds[0]!);
    expect(written?.record.type).toBe("pr-review");
    expect(written?.record.finding_count).toBe(3);
    expect(written?.record.finding_severities).toEqual(["medium", "high", "low"]);
    expect(written?.record.comment_capabilities).toEqual(["github.comment", "linear.comment"]);
    expect(written?.body).toContain("Severity: high");
    expect(written?.body).toContain("File/area: packages/core/src/auth/oauth-callback.ts");
    expect(written?.body).toContain("Rationale:");
    expect(written?.body).toContain("Recommendation:");
    expect(written?.body).toContain("github.comment");
    expect(written?.body).toContain("linear.comment");
  });

  it("states residual risks when reviewer finds no issues", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const agent = new ReviewerAgent({ artifacts, audit, policy });

    const out = await agent.execute({
      context: {
        runId: "run_clean_review",
        scope: "Review PR for timeline copy update",
        briefing: [
          "Changed files:",
          "- packages/interface/src/renderer/views/TimelineView.tsx",
          "Test evidence: pnpm --filter @bureauos/interface test passed",
        ].join("\n"),
      },
      capabilities: new Map(),
    });

    expect(out.ok).toBe(true);
    expect(out.decisions).toContain("review:approve_with_residual_risk");
    expect(out.blockers).toEqual([]);
    expect(out.notes).toContain("explicit residual risks");

    const written = await artifacts.read(out.artifactIds[0]!);
    expect(written?.record.finding_count).toBe(0);
    expect(written?.body).toContain("No structured findings");
    expect(written?.body).toContain("Residual Risks");
    expect(written?.body).toContain(
      "Merge and deployment still require separate policy-gated approval",
    );
  });

  it("enriches reviewer/QA/security artifacts via the provider while keeping the gate deterministic (SER-170)", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const capabilities = modelCapability(new FakeProvider("ok"));

    // Reviewer: clean diff with test evidence -> deterministic approve, body enriched.
    const reviewer = new ReviewerAgent({ artifacts, audit, policy });
    const reviewerOut = await reviewer.execute({
      context: {
        runId: "run_provider_review",
        scope: "Review PR for timeline copy update",
        briefing: [
          "Changed files:",
          "- packages/interface/src/renderer/views/TimelineView.tsx",
          "Test evidence: pnpm --filter @bureauos/interface test passed",
        ].join("\n"),
      },
      capabilities,
    });
    expect(reviewerOut.ok).toBe(true);
    expect(reviewerOut.decisions).toContain("review:approve_with_residual_risk");
    const reviewerArtifact = await artifacts.read(reviewerOut.artifactIds[0]!);
    expect(reviewerArtifact?.record.finding_count).toBe(0);
    expect(reviewerArtifact?.body).toContain("# Model-Drafted fake-model");
    expect(reviewerArtifact?.body).toContain("## Generation Metadata");

    // QA: passing acceptance evidence -> deterministic ready, body enriched.
    await artifacts.write({
      type: "test-evidence-report",
      createdBy: "development",
      runId: "run_provider_qa",
      body: ["# Test Evidence", "", "PASS: smoke test passes."].join("\n"),
    });
    const qa = new QaAgent({ artifacts, audit, policy });
    const qaOut = await qa.execute({
      context: {
        runId: "run_provider_qa",
        scope: ["Acceptance criteria:", "- smoke test passes."].join("\n"),
      },
      capabilities,
    });
    expect(qaOut.ok).toBe(true);
    expect(qaOut.decisions).toContain("qa:ready_for_review");
    const qaArtifact = await artifacts.read(qaOut.artifactIds[0]!);
    expect(qaArtifact?.record.qa_readiness).toBe("ready_for_review");
    expect(qaArtifact?.record.acceptance_pass_count).toBe(1);
    expect(qaArtifact?.body).toContain("# Model-Drafted fake-model");
    expect(qaArtifact?.body).toContain("## Generation Metadata");

    // Security: unresolved secret path -> deterministic block, body enriched.
    await artifacts.write({
      type: "technical-plan",
      createdBy: "development",
      runId: "run_provider_security",
      body: ["# Runtime Diff", "", "Changed files:", "- packages/core/src/config/secrets.ts"].join(
        "\n",
      ),
    });
    const security = new SecurityAgent({ artifacts, audit, policy });
    const securityOut = await security.execute({
      context: {
        runId: "run_provider_security",
        scope: "Review security-sensitive runtime changes before PR readiness.",
      },
      capabilities,
    });
    expect(securityOut.ok).toBe(false);
    expect(securityOut.decisions).toContain("security:blocked");
    expect(securityOut.blockers).toEqual([
      "unresolved critical security finding in packages/core/src/config/secrets.ts: secret",
    ]);
    const securityArtifact = await artifacts.read(securityOut.artifactIds[0]!);
    expect(securityArtifact?.record.risk_level).toBe("critical");
    expect(securityArtifact?.record.unresolved_high_risk_count).toBe(1);
    expect(securityArtifact?.body).toContain("# Model-Drafted fake-model");
    expect(securityArtifact?.body).toContain("## Generation Metadata");

    const log = await readAudit(dir);
    expect(log).toContain("agent.reviewer.executed");
    expect(log).toContain("agent.qa.executed");
    expect(log).toContain("agent.security.executed");
    expect(log).toContain("model:openai-default");
  });

  it("falls back to the deterministic body when the provider fails for reviewer/QA/security (SER-170)", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const capabilities = modelCapability(new FakeProvider("throw"));

    const reviewer = new ReviewerAgent({ artifacts, audit, policy });
    const reviewerOut = await reviewer.execute({
      context: {
        runId: "run_fallback_review",
        scope: "Review PR for timeline copy update",
        briefing: [
          "Changed files:",
          "- packages/interface/src/renderer/views/TimelineView.tsx",
          "Test evidence: pnpm --filter @bureauos/interface test passed",
        ].join("\n"),
      },
      capabilities,
    });
    expect(reviewerOut.ok).toBe(true);
    const reviewerArtifact = await artifacts.read(reviewerOut.artifactIds[0]!);
    // Deterministic template body is used verbatim; no model output leaks in.
    expect(reviewerArtifact?.body).toContain("# PR Review");
    expect(reviewerArtifact?.body).not.toContain("# Model-Drafted");
    expect(reviewerArtifact?.body).toContain("## Provider Unavailable");

    const qa = new QaAgent({ artifacts, audit, policy });
    const qaOut = await qa.execute({
      context: {
        runId: "run_fallback_qa",
        scope: ["Acceptance criteria:", "- smoke test passes."].join("\n"),
        briefing: "PASS: smoke test passes.",
      },
      capabilities,
    });
    const qaArtifact = await artifacts.read(qaOut.artifactIds[0]!);
    expect(qaArtifact?.body).toContain("# QA Verification Report");
    expect(qaArtifact?.body).not.toContain("# Model-Drafted");

    const security = new SecurityAgent({ artifacts, audit, policy });
    const securityOut = await security.execute({
      context: {
        runId: "run_fallback_security",
        scope: "Review auth change.",
        briefing: ["Changed files:", "- packages/core/src/auth/session.ts"].join("\n"),
      },
      capabilities,
    });
    const securityArtifact = await artifacts.read(securityOut.artifactIds[0]!);
    expect(securityArtifact?.body).toContain("# Security Review");
    expect(securityArtifact?.body).not.toContain("# Model-Drafted");

    const log = await readAudit(dir);
    // The provider error is surfaced in the audit trail for each agent.
    expect(log).toContain("provider generation failed");
  });
});

async function readAudit(dir: string): Promise<string> {
  return readFile(workspacePaths(dir).auditLog, "utf8");
}
