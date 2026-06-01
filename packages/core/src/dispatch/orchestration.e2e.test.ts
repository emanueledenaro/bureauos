import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { defaultConfig } from "../config/loader.js";
import type { BureauConfig } from "../config/schema.js";
import { CoordinatorIntakeService } from "../coordinator/intake.js";
import { ProjectWorkspaceService } from "../execution/project-workspace.js";
import { runGit } from "../execution/git.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ProjectRegistry } from "../registries/project.js";
import type { ProjectTestRunnerResult } from "../execution/project-test-runner.js";
import type { ProjectTestRunner, ProjectTestRunnerFactory } from "../agents/runtime.js";
import { ProjectDispatchService } from "./project-dispatch.js";
import type { DispatchBranchPusher } from "./delivery.js";
import {
  type GitHubPullRequestPublishClient,
  type GitHubPullRequestPublishClientPr,
} from "../github/pr-publisher.js";

const TIMEOUT_MS = 90_000;

/**
 * End-to-end orchestration proof for SER-242 (the capstone of SER-238..241).
 *
 * Drives the WHOLE specialist loop through a single `ProjectDispatchService.dispatch`
 * call on a seeded throwaway project (real temp dir + real git), with every
 * external dependency replaced by a deterministic fake:
 *
 * - Dev "writes code": codex runtime is enabled and configured with a single
 *   allow-listed `node -e` command that writes a file into the run's isolated
 *   worktree. The real {@link CodexRuntimeAdapter}/{@link HostCodexRuntimeRunner}
 *   safety boundary still runs; this is a deterministic stand-in for the real
 *   coding tool (no real Codex, no model call). It proves the orchestration:
 *   the dev step runs in the worktree, its gates pass with a linked work item,
 *   and the edit is committed onto the run branch. It does NOT prove model-driven
 *   code generation — only that real edited+committed code flows to QA/delivery.
 * - QA "runs tests": a fake {@link ProjectTestRunner} injected via the new
 *   `projectTestRunnerFactory` seam returns a deterministic passed/failed result
 *   (writing a real `test-evidence-report` artifact) — no subprocess.
 * - Delivery: a {@link RecordingPrClient} fake + a {@link LocalBareRepoPusher}
 *   that redirects the push to a LOCAL BARE REPO — never a real GitHub account.
 */

/** Fake PR client: records calls, never touches a real GitHub account. */
class RecordingPrClient implements GitHubPullRequestPublishClient {
  readonly created: Array<{
    owner: string;
    repo: string;
    input: { title: string; body: string; head: string; base: string; draft?: boolean };
  }> = [];

  async createPullRequest(
    owner: string,
    repo: string,
    input: { title: string; body: string; head: string; base: string; draft?: boolean },
  ): Promise<GitHubPullRequestPublishClientPr> {
    this.created.push({ owner, repo, input });
    return {
      owner,
      repo,
      number: this.created.length,
      title: input.title,
      url: `https://github.com/${owner}/${repo}/pull/${this.created.length}`,
      head: input.head,
      headSha: "deadbeef",
      base: input.base,
      state: "open",
      updatedAt: "2026-05-30T00:00:00.000Z",
    };
  }
}

/**
 * Redirects the project's push to a LOCAL BARE REPO (real git, no network).
 * `project.repository` stays a real GitHub URL so owner/repo parse, but the push
 * lands in the bare repo — never reaching GitHub.
 */
class LocalBareRepoPusher implements DispatchBranchPusher {
  readonly setRemoteCalls: Array<{ slug: string; url: string }> = [];
  constructor(
    private readonly workspace: ProjectWorkspaceService,
    private readonly bareRepo: string,
  ) {}

  async setProjectRemote(slug: string, remoteUrl: string): Promise<void> {
    this.setRemoteCalls.push({ slug, url: remoteUrl });
    await this.workspace.setProjectRemote(slug, this.bareRepo);
  }

  async pushRunBranch(slug: string, runId: string): Promise<string> {
    return this.workspace.pushRunBranch(slug, runId);
  }
}

/**
 * Deterministic project test runner factory for the QA agent. Writes a real
 * `test-evidence-report` artifact (so delivery's evidence gate has run evidence)
 * and reports `passed`/`failed` without spawning any process. Mirrors the real
 * {@link ProjectTestRunnerService.run} contract.
 */
function fakeTestRunnerFactory(outcome: "passed" | "failed"): ProjectTestRunnerFactory {
  return (_workspaceRoot, deps) => {
    const runner: ProjectTestRunner = {
      async run(input = {}): Promise<ProjectTestRunnerResult> {
        const artifact: ArtifactRecord = await deps.artifacts.write({
          type: "test-evidence-report",
          createdBy: input.createdBy ?? "qa",
          ...(input.runId ? { runId: input.runId } : {}),
          ...(input.projectId ? { projectId: input.projectId } : {}),
          ...(input.clientId ? { clientId: input.clientId } : {}),
          metadata: {
            test_status: outcome,
            command: "fake test runner",
            command_source: "configured",
            exit_code: outcome === "passed" ? 0 : 1,
            pr_gate_satisfied: outcome === "passed",
          },
          body: `# Test Evidence Report\n\n- Status: ${outcome}\n- Command: fake test runner\n`,
        });
        await deps.audit.append({
          actor: input.createdBy ?? "qa",
          action: outcome === "passed" ? "execution.tests.passed" : "execution.tests.failed",
          target: input.runId ?? "fake-tests",
          artifact_id: artifact.id,
          result: "ok",
        });
        const evidence = `fake test runner ${outcome} (${artifact.id})`;
        return {
          status: outcome,
          exitCode: outcome === "passed" ? 0 : 1,
          stdout: "",
          stderr: "",
          timedOut: false,
          artifact,
          testEvidence: outcome === "passed" ? [evidence] : [],
          prGateSatisfied: outcome === "passed",
        };
      },
    };
    return runner;
  };
}

/**
 * A feature briefing whose acceptance criteria are explicitly marked passed, so
 * the QA agent's deterministic acceptance analysis reaches `ready_for_review`.
 * The orchestration then turns on the QA REAL-test gate (fake runner) as the
 * decisive pass/fail signal for the three scenarios.
 */
const READY_BRIEFING = `Build the booking page.

## Acceptance Criteria

- Booking page renders the reservation form
- Submitting a booking shows a confirmation

## Verification Evidence

passed: Booking page renders the reservation form
passed: Submitting a booking shows a confirmation
`;

/**
 * Enable the codex runtime with a single allow-listed `node -e` command that
 * writes a real file into the run's worktree (the deterministic dev-edit
 * stand-in), and turn on the autonomy the dev gates need. `push_commits`
 * (edit_code) + `observe_signals` (run_tests) are on at level 2 already, but we
 * set them explicitly so the test does not depend on the preset's defaults.
 */
function codexWritesFileConfig(): BureauConfig {
  const config = defaultConfig("agency");
  config.runtime.codex.enabled = true;
  config.runtime.codex.commands = [
    {
      command: "node",
      args: ["-e", "require('fs').writeFileSync('feature.ts','// built by the dev agent\\n')"],
      label: "edit",
    },
  ];
  config.autonomy.push_commits = true;
  config.autonomy.observe_signals = true;
  return config;
}

describe("ProjectDispatchService end-to-end orchestration proof (SER-242)", () => {
  let dir: string;
  let remote: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-orchestration-e2e-"));
    await initWorkspace({ root: dir, organizationName: "Orchestration Agency", preset: "agency" });
    // A local bare repo stands in for the project's GitHub remote: real git, no
    // network, never a real GitHub account.
    remote = join(dir, "remote.git");
    await runGit(["init", "--bare", remote]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it(
    "happy path: dev writes+commits code, QA passes real tests, reviewer reviews, delivery opens a draft PR — all under ONE run",
    async () => {
      const config = codexWritesFileConfig();
      const intake = await new CoordinatorIntakeService(dir, { config }).process({
        clientName: "Pizzeria Aurora",
        message: "Vuole un sito con prenotazioni.",
        source: "owner_chat",
      });
      // Link the project to a real GitHub URL so owner/repo parse; the push is
      // redirected to the local bare repo by LocalBareRepoPusher.
      await new ProjectRegistry(dir).update(intake.project.slug, {
        repository: "https://github.com/acme/site",
      });

      const github = new RecordingPrClient();
      const result = await new ProjectDispatchService(dir, {
        config,
        githubPrPublishClient: github,
        // The push targets the local bare repo, never a real GitHub account.
        dispatchBranchPusher: new LocalBareRepoPusher(new ProjectWorkspaceService(dir), remote),
        // Deterministic PASSING test runner: QA gates on it, not a subprocess.
        projectTestRunnerFactory: fakeTestRunnerFactory("passed"),
      }).dispatch({
        projectSlug: intake.project.slug,
        runType: "feature",
        // A linked Linear work item satisfies the dev edit_code `linked_issue` gate.
        source: "linear://issue/SER-242",
        scope: "Build the booking page",
        briefing: READY_BRIEFING,
      });

      // The full feature pipeline ran in order, under ONE run.
      expect(result.pipeline).toEqual([
        "product",
        "ux",
        "development",
        "qa",
        "security",
        "reviewer",
      ]);
      expect(result.dispatch.steps.map((step) => step.role)).toEqual(result.pipeline);
      // No specialist blocked: the whole loop completed.
      expect(result.dispatch.steps.every((step) => step.ok)).toBe(true);

      // The developer produced a committed file on the run branch.
      const repo = join(dir, "workspaces", intake.project.slug);
      const branch = `bureauos/${intake.project.slug}/${result.run.id}`;
      const committedFiles = (
        await runGit(["show", "--name-only", "--pretty=format:", branch], { cwd: repo })
      ).stdout;
      expect(committedFiles).toContain("feature.ts");

      // QA ran the REAL-test gate against the worktree and passed.
      const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
      expect(audit).toContain("agent.qa.tests_gated");
      const qaStep = result.dispatch.steps.find((step) => step.role === "qa");
      expect(qaStep?.notes).toContain("project tests passed");

      // The reviewer produced a review artifact.
      const artifacts = await new ArtifactStore(dir).list({ run_id: result.run.id });
      expect(artifacts.map((a) => a.type)).toEqual(
        expect.arrayContaining(["technical-plan", "test-plan", "security-review", "pr-review"]),
      );

      // Gated delivery DELIVERED: branch pushed to the (local bare) remote and a
      // draft PR opened via the fake client — never a real GitHub account.
      expect(result.delivery?.status).toBe("delivered");
      expect(result.delivery?.pushed).toBe(true);
      expect(result.delivery?.pullRequestUrl).toContain("/pull/1");
      expect(github.created).toHaveLength(1);
      expect(github.created[0]?.input).toMatchObject({ head: branch, base: "main", draft: true });
      const remoteSha = (
        await runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: remote })
      ).stdout.trim();
      expect(remoteSha).toMatch(/^[0-9a-f]{40}$/);

      // One run, with audit + artifacts: completed dispatch, pushed branch, delivered.
      expect(audit).toContain("project.dispatch.completed");
      expect(audit).toContain("project.dispatch.branch_pushed");
      expect(audit).toContain("project.dispatch.delivered");
      expect(result.summary).toContain("Delivered");
    },
    TIMEOUT_MS,
  );

  it(
    "blocked-on-QA: a failing test runner blocks the run, downstream delivery never fires",
    async () => {
      const config = codexWritesFileConfig();
      const intake = await new CoordinatorIntakeService(dir, { config }).process({
        clientName: "Trattoria Belluno",
        message: "Vuole un sito con prenotazioni.",
        source: "owner_chat",
      });
      await new ProjectRegistry(dir).update(intake.project.slug, {
        repository: "https://github.com/acme/site",
      });

      const github = new RecordingPrClient();
      const result = await new ProjectDispatchService(dir, {
        config,
        githubPrPublishClient: github,
        // Deterministic FAILING test runner: QA must block the run on it.
        projectTestRunnerFactory: fakeTestRunnerFactory("failed"),
      }).dispatch({
        projectSlug: intake.project.slug,
        runType: "feature",
        source: "linear://issue/SER-242",
        scope: "Build the booking page",
        briefing: READY_BRIEFING,
      });

      // QA blocked the run on the failing real-test gate.
      const qaStep = result.dispatch.steps.find((step) => step.role === "qa");
      expect(qaStep?.ok).toBe(false);
      expect(qaStep?.blockers.join(" ")).toContain("project tests failed");
      expect(result.dispatch.steps.some((step) => !step.ok)).toBe(true);

      // The run is surfaced as blocked, with the QA reason — no clean completion.
      expect(result.summary).toContain("blocked");
      expect(result.next_actions.join(" ")).toContain("Resolve specialist blockers");
      const risks = await readFile(
        join(workspacePaths(dir).projectsDir, intake.project.slug, "RISKS.md"),
        "utf8",
      );
      expect(risks).toContain("project tests failed");

      // Downstream delivery did NOT happen: no result, nothing pushed/opened.
      expect(result.delivery).toBeUndefined();
      expect(github.created).toHaveLength(0);
      const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
      expect(audit).toContain("project.dispatch.blocked");
      expect(audit).not.toContain("project.dispatch.delivered");
      expect(audit).not.toContain("project.dispatch.branch_pushed");
      // Nothing reached the (local bare) remote.
      const branch = `bureauos/${intake.project.slug}/${result.run.id}`;
      await expect(
        runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: remote }),
      ).rejects.toThrow();
    },
    TIMEOUT_MS,
  );

  it(
    "escalation: a gated delivery (open_pull_requests off) surfaces a pending owner decision — nothing opened on the remote",
    async () => {
      const config = codexWritesFileConfig();
      // push_commits stays on so the branch can push, but open_pull_requests is
      // off with no approval: the PR is blocked and an owner decision requested.
      config.autonomy.open_pull_requests = false;
      const intake = await new CoordinatorIntakeService(dir, { config }).process({
        clientName: "Caffe Milano",
        message: "Vuole un sito con prenotazioni.",
        source: "owner_chat",
      });
      await new ProjectRegistry(dir).update(intake.project.slug, {
        repository: "https://github.com/acme/site",
      });

      const github = new RecordingPrClient();
      const result = await new ProjectDispatchService(dir, {
        config,
        githubPrPublishClient: github,
        dispatchBranchPusher: new LocalBareRepoPusher(new ProjectWorkspaceService(dir), remote),
        projectTestRunnerFactory: fakeTestRunnerFactory("passed"),
      }).dispatch({
        projectSlug: intake.project.slug,
        runType: "feature",
        source: "linear://issue/SER-242",
        scope: "Build the booking page",
        briefing: READY_BRIEFING,
      });

      // The run completed (dev + QA + reviewer all ok); delivery is the gate.
      expect(result.dispatch.steps.every((step) => step.ok)).toBe(true);

      // Delivery is surfaced as a pending owner decision, NOT delivered.
      expect(result.delivery?.status).toBe("blocked");
      expect(result.delivery?.reason).toContain("pull request blocked");
      expect(result.delivery?.approvalId).toBeTruthy();
      expect(result.summary).toContain("pending owner decision");

      // A pending owner decision for the PR exists; nothing was opened on the remote.
      const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
      expect(audit).toContain("project.dispatch.delivery_blocked");
      expect(github.created).toHaveLength(0);
    },
    TIMEOUT_MS,
  );
});
