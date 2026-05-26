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
import { ArtifactStore } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import type { AgentCapabilityChecker } from "../agents/runtime.js";
import { defaultConfig } from "../config/loader.js";
import type { BureauConfig } from "../config/schema.js";
import { CoordinatorIntakeService } from "../coordinator/intake.js";
import {
  DevelopmentBranchService,
  type DevelopmentBranchClient,
  type DevelopmentBranchCreateRequest,
} from "../execution/development-branch.js";
import {
  ProjectTestRunnerService,
  type ProjectCommandRunner,
  type ProjectCommandRunnerOptions,
  type ProjectTestExecution,
  type ResolvedProjectTestCommand,
} from "../execution/project-test-runner.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { dispatchRun } from "../runs/coordinator.js";
import { RunEngine } from "../runs/engine.js";
import {
  GitHubPullRequestPublishService,
  type GitHubPullRequestPublishClient,
  type GitHubPullRequestPublishClientPr,
} from "./pr-publisher.js";

class RecordingGitHubClient implements DevelopmentBranchClient, GitHubPullRequestPublishClient {
  readonly branchChecks: string[] = [];
  readonly branches: DevelopmentBranchCreateRequest[] = [];
  readonly pullRequests: Array<{
    owner: string;
    repo: string;
    input: { title: string; body: string; head: string; base: string; draft?: boolean };
  }> = [];

  async branchExists(branchName: string): Promise<boolean> {
    this.branchChecks.push(branchName);
    return false;
  }

  async createBranch(input: DevelopmentBranchCreateRequest): Promise<void> {
    this.branches.push(input);
  }

  async createPullRequest(
    owner: string,
    repo: string,
    input: { title: string; body: string; head: string; base: string; draft?: boolean },
  ): Promise<GitHubPullRequestPublishClientPr> {
    this.pullRequests.push({ owner, repo, input });
    return {
      owner,
      repo,
      number: this.pullRequests.length,
      title: input.title,
      url: `https://github.com/${owner}/${repo}/pull/${this.pullRequests.length}`,
      head: input.head,
      headSha: "phase8sha",
      base: input.base,
      state: "open",
      updatedAt: "2026-05-26T08:00:00.000Z",
    };
  }
}

class FakeCodexRuntime implements RuntimeAdapter {
  readonly id = "codex-phase8-fake";
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
      artifacts: ["runtime-diff-artifact"],
      evidence: "fake runtime edited the Phase 8 target and ran tests",
      changedFiles: ["packages/core/src/github/phase8-target.ts"],
      commands: ["pnpm --filter @bureauos/core test -- phase8"],
      exitCode: 0,
    };
  }
}

class PassingCommandRunner implements ProjectCommandRunner {
  readonly commands: ResolvedProjectTestCommand[] = [];

  async run(
    command: ResolvedProjectTestCommand,
    _options: ProjectCommandRunnerOptions,
  ): Promise<ProjectTestExecution> {
    this.commands.push(command);
    return {
      exitCode: 0,
      stdout: "phase 8 e2e tests passed\n",
      stderr: "",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
    };
  }
}

function allowingCapabilityChecker(args: {
  artifacts: ArtifactStore;
  runId: string;
}): AgentCapabilityChecker {
  return {
    async check(input) {
      const artifact = await args.artifacts.write({
        type: "capability-audit",
        createdBy: input.agent,
        runId: args.runId,
        body: `# Capability Gate

- Capability: ${input.capabilityId}.${input.action}
- Target: ${input.target ?? "(none)"}
- Result: allowed by fake Phase 8 E2E gate.
`,
      });
      return {
        status: "allowed",
        artifact,
        target: input.target,
        policy: { reason: "allowed by fake Phase 8 E2E gate" },
      };
    },
  };
}

describe("Phase 8 PR execution E2E", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-phase8-pr-"));
    await initWorkspace({ root: dir, organizationName: "Phase 8 Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function prepareProject(config: BureauConfig) {
    const intake = await new CoordinatorIntakeService(dir, { config }).process({
      clientName: "Phase 8 Client",
      message: "Build a policy-gated PR execution test for the delivery workflow.",
      source: "linear",
    });
    return intake.project;
  }

  it("runs the fake runtime, records branch and PR calls, and attaches plan/diff/test/PR artifacts", async () => {
    const config = defaultConfig("agency");
    const project = await prepareProject(config);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const github = new RecordingGitHubClient();
    const runtime = new FakeCodexRuntime();
    const commandRunner = new PassingCommandRunner();

    const branchService = new DevelopmentBranchService(dir, {
      audit,
      policy,
      branchClient: github,
    });
    const testRunner = new ProjectTestRunnerService(dir, {
      artifacts,
      audit,
      commandRunner,
    });
    const prPublisher = new GitHubPullRequestPublishService(dir, {
      config,
      githubClient: github,
      artifacts,
      approvals,
      policy,
      audit,
    });
    const runs = new RunEngine(dir, {
      audit,
      artifacts,
      policy,
      dispatcher: async ({ workspaceRoot, run, startInput }) => {
        const branch = await branchService.create({
          runId: run.id,
          scope: startInput.scope,
          actor: "development",
          linearIssueIdentifier: "SER-36",
          baseRef: "main",
        });
        if (branch.status === "blocked") {
          return {
            status: "blocked",
            blockers: [branch.reason ?? "branch creation blocked"],
            metadata: { branch_name: branch.branchName },
          };
        }

        const dispatch = await dispatchRun(
          {
            artifacts,
            audit,
            policy,
            developmentRuntime: runtime,
            capabilityUse: allowingCapabilityChecker({ artifacts, runId: run.id }),
          },
          {
            workspaceRoot,
            run,
            scope: startInput.scope,
            briefing: "Linear SER-36 acceptance criteria require fake runtime, tests, and PR.",
          },
        );
        const agentArtifactIds = dispatch.steps.flatMap((step) => step.artifactIds);
        const testResult = await testRunner.run({
          runId: run.id,
          projectId: project.id,
          clientId: project.client_id,
          createdBy: "qa",
          command: {
            command: "pnpm",
            args: ["--filter", "@bureauos/core", "test", "--", "phase8"],
            cwd: ".",
            label: "core phase8 e2e",
          },
        });
        if (!testResult.prGateSatisfied) {
          return {
            status: "blocked",
            artifactIds: [dispatch.briefingArtifactId, ...agentArtifactIds, testResult.artifact.id],
            blockers: [testResult.reason ?? "tests did not satisfy PR gate"],
          };
        }

        const evidenceArtifactIds = [
          dispatch.briefingArtifactId,
          ...agentArtifactIds,
          testResult.artifact.id,
        ];
        const pr = await prPublisher.publish({
          projectSlug: project.slug,
          owner: "emanueledenaro",
          repo: "bureauos-phase8",
          title: "Add Phase 8 PR execution E2E",
          head: branch.branchName,
          base: "main",
          linkedLinearIssue: {
            identifier: "SER-36",
            url: "https://linear.app/serium/issue/SER-36/add-end-to-end-pr-execution-test-with-fake-runtime-and-github-client",
          },
          linkedIssueNumbers: [36],
          testEvidence: [
            ...testResult.testEvidence,
            "fake runtime edited the Phase 8 target and ran tests",
          ],
          runId: run.id,
          evidenceArtifactIds,
        });
        if (pr.status === "blocked") {
          return {
            status: "needs_human",
            artifactIds: evidenceArtifactIds,
            blockers: [pr.policy.reason],
          };
        }

        return {
          status: "completed",
          artifactIds: [...evidenceArtifactIds, pr.report!.id],
          decisions: [
            `branch_created:${branch.branchName}`,
            `draft_pr_opened:${pr.pull_request!.url}`,
          ],
          metadata: {
            branch_name: branch.branchName,
            draft_pr_url: pr.pull_request!.url,
            test_evidence_artifact_id: testResult.artifact.id,
          },
        };
      },
    });

    const run = await runs.start({
      type: "feature",
      triggerType: "external_signal",
      triggerSource: "linear:SER-36",
      scope: "Add end-to-end PR execution test",
      projectId: project.id,
      clientId: project.client_id,
    });

    expect(run.status).toBe("completed");
    expect(runtime.prepared).toMatchObject({
      workspaceRoot: dir,
      runId: run.id,
      projectId: project.id,
      clientId: project.client_id,
    });
    expect(runtime.executed).toMatchObject({
      capability: "edit_code",
      intent: "development_agent_execution",
      scope: "Add end-to-end PR execution test",
    });
    expect(github.branches).toEqual([
      {
        branchName: "bureauos/ser-36-add-end-to-end-pr-execution-test",
        baseRef: "main",
        force: false,
      },
    ]);
    expect(github.pullRequests).toHaveLength(1);
    expect(github.pullRequests[0]?.input).toMatchObject({
      head: "bureauos/ser-36-add-end-to-end-pr-execution-test",
      base: "main",
      draft: true,
    });
    expect(github.pullRequests[0]?.input.body).toContain("[SER-36]");
    expect(github.pullRequests[0]?.input.body).toContain("GitHub: #36");
    expect(github.pullRequests[0]?.input.body).toContain("fake runtime edited the Phase 8 target");
    expect(commandRunner.commands[0]?.commandLine).toBe(
      "pnpm --filter @bureauos/core test -- phase8",
    );

    const runArtifacts = await artifacts.list({ run_id: run.id });
    const artifactTypes = new Set(runArtifacts.map((artifact) => artifact.type));
    expect(artifactTypes.has("technical-plan")).toBe(true);
    expect(artifactTypes.has("run-report")).toBe(true);
    expect(artifactTypes.has("test-evidence-report")).toBe(true);
    expect(artifactTypes.has("github-pr-publish-report")).toBe(true);

    const diffReport = runArtifacts.find(
      (artifact) => artifact.type === "run-report" && artifact.created_by === "development",
    );
    expect(diffReport).toBeDefined();
    const diffReportDoc = await artifacts.read(diffReport!.id);
    expect(diffReportDoc?.body).toContain("packages/core/src/github/phase8-target.ts");
    expect(diffReportDoc?.body).toContain("fake runtime edited the Phase 8 target");

    const prReport = runArtifacts.find((artifact) => artifact.type === "github-pr-publish-report");
    expect(prReport).toBeDefined();
    expect(run.artifacts).toContain(prReport!.id);
    const prReportDoc = await artifacts.read(prReport!.id);
    expect(prReportDoc?.body).toContain("GitHub Pull Request Publish Report");
    expect(prReportDoc?.body).toContain("SER-36");
    expect(prReportDoc?.body).toContain(run.id);

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("development.branch.created");
    expect(log).toContain("agent.development.runtime_executed");
    expect(log).toContain("execution.tests.passed");
    expect(log).toContain("github.pr_publish.created");
    expect(log).toContain("run.dispatch_completed");
  });

  it("blocks before fake runtime and GitHub calls when PR work is disabled by policy", async () => {
    const config = defaultConfig("agency");
    config.autonomy.open_pull_requests = false;
    const project = await prepareProject(config);
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const approvals = new ApprovalRegistry(dir);
    const policy = new PolicyEngine(config, approvals);
    const github = new RecordingGitHubClient();
    const runtime = new FakeCodexRuntime();
    let dispatcherCalled = false;

    const runs = new RunEngine(dir, {
      audit,
      artifacts,
      policy,
      dispatcher: async () => {
        dispatcherCalled = true;
        return { status: "failed", error: "dispatcher should not run when policy blocks" };
      },
    });

    const run = await runs.start({
      type: "feature",
      triggerType: "external_signal",
      triggerSource: "linear:SER-36",
      scope: "Add end-to-end PR execution test",
      projectId: project.id,
      clientId: project.client_id,
    });

    expect(run.status).toBe("needs_human");
    expect(dispatcherCalled).toBe(false);
    expect(runtime.executed).toBeUndefined();
    expect(github.branches).toHaveLength(0);
    expect(github.pullRequests).toHaveLength(0);

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("run.policy_blocked");
    expect(log).not.toContain("github.pr_publish.created");
  });
});
