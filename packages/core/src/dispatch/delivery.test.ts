import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { defaultConfig } from "../config/loader.js";
import type { BureauConfig } from "../config/schema.js";
import { ProjectWorkspaceService } from "../execution/project-workspace.js";
import { runGit } from "../execution/git.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { ClientRegistry } from "../registries/client.js";
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";
import type { RunRecord } from "../runs/engine.js";
import {
  type GitHubPullRequestPublishClient,
  type GitHubPullRequestPublishClientPr,
} from "../github/pr-publisher.js";
import {
  deliverDispatchedRun,
  type DispatchBranchPusher,
  type DispatchDeliveryDeps,
} from "./delivery.js";

const TIMEOUT_MS = 30_000;

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
 * Stub pusher: pushes the run branch to a LOCAL BARE REPO (real git, no network),
 * standing in for the project's GitHub remote. `project.repository` stays a real
 * GitHub URL so owner/repo parse correctly, but the push never reaches GitHub.
 */
class LocalBareRepoPusher implements DispatchBranchPusher {
  readonly setRemoteCalls: Array<{ slug: string; url: string }> = [];
  constructor(
    private readonly workspace: ProjectWorkspaceService,
    private readonly bareRepo: string,
  ) {}

  async setProjectRemote(slug: string, remoteUrl: string): Promise<void> {
    // Record the URL the production code would point origin at, then redirect
    // origin to the local bare repo for the actual push.
    this.setRemoteCalls.push({ slug, url: remoteUrl });
    await this.workspace.setProjectRemote(slug, this.bareRepo);
  }

  async pushRunBranch(slug: string, runId: string): Promise<string> {
    return this.workspace.pushRunBranch(slug, runId);
  }
}

function runRecord(id: string, projectId: string, clientId: string): RunRecord {
  return {
    id,
    type: "feature",
    status: "completed",
    trigger_type: "owner_request",
    trigger_source: "test",
    project_id: projectId,
    client_id: clientId,
    scope: "Build the booking page",
    created_by: "project_manager",
    artifacts: [],
    decisions: [],
    created: "2026-05-30T00:00:00.000Z",
    updated: "2026-05-30T00:00:00.000Z",
    completed: "2026-05-30T00:00:00.000Z",
    source_work_item_type: "github_issue",
    source_work_item_id: "12",
    source_work_item_url: "https://github.com/acme/site/issues/12",
    linear_identifier: "SER-241",
    linear_url: "https://linear.app/serium/issue/SER-241",
  };
}

describe("deliverDispatchedRun (SER-241)", () => {
  let dir: string;
  let remote: string;
  let workspace: ProjectWorkspaceService;
  let artifacts: ArtifactStore;
  let approvals: ApprovalRegistry;
  let projects: ProjectRegistry;
  let clients: ClientRegistry;
  let audit: AuditLog;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-delivery-"));
    await initWorkspace({ root: dir, organizationName: "Delivery Agency", preset: "agency" });
    // A local bare repo stands in for the project's GitHub remote: real git, no
    // network, never a real GitHub account.
    remote = join(dir, "remote.git");
    await runGit(["init", "--bare", remote]);
    workspace = new ProjectWorkspaceService(dir);
    artifacts = new ArtifactStore(dir);
    approvals = new ApprovalRegistry(dir);
    projects = new ProjectRegistry(dir);
    clients = new ClientRegistry(dir);
    audit = new AuditLog(workspacePaths(dir).auditLog);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /**
   * Create a project linked to a real GitHub URL (so owner/repo parse) with a
   * committed run branch. The push itself is redirected to the local bare repo by
   * {@link LocalBareRepoPusher} — never a real GitHub account.
   */
  async function seedProjectWithCommit(runId: string): Promise<ProjectRecord> {
    const project = await projects.create({
      name: "Acme Site",
      clientId: "client_acme",
      repository: "https://github.com/acme/site",
    });
    await workspace.acquireRunWorktree(project.slug, runId);
    await writeFile(join(workspace.worktreePath(project.slug, runId), "feature.ts"), "// work\n");
    const commit = await workspace.commitRunWork(project.slug, runId, "feat: booking page");
    expect(commit.committed).toBe(true);
    return project;
  }

  /** Seed the qa/reviewer/security evidence the PR publisher's gate validates. */
  async function seedReadyEvidence(runId: string): Promise<ArtifactRecord[]> {
    const qa = await artifacts.write({
      type: "test-plan",
      createdBy: "qa",
      runId,
      metadata: {
        qa_readiness: "ready_for_review",
        acceptance_pass_count: 2,
        acceptance_fail_count: 0,
        acceptance_unknown_count: 0,
      },
      body: "# QA Verification Report\n\nReady for review.",
    });
    const reviewer = await artifacts.write({
      type: "pr-review",
      createdBy: "reviewer",
      runId,
      metadata: { recommendation: "approve_with_residual_risk", finding_count: 0 },
      body: "# PR Review\n\nNo findings.",
    });
    const security = await artifacts.write({
      type: "security-review",
      createdBy: "security",
      runId,
      metadata: { risk_level: "low", finding_count: 0, unresolved_high_risk_count: 0 },
      body: "# Security Review\n\nNo findings.",
    });
    const tests = await artifacts.write({
      type: "test-evidence-report",
      createdBy: "qa",
      runId,
      metadata: { summary: "pnpm test passed", commands: ["pnpm test"] },
      body: "# Test Evidence\n\npnpm test passed.",
    });
    return [qa, reviewer, security, tests];
  }

  function deps(
    config: BureauConfig,
    githubClient?: GitHubPullRequestPublishClient,
  ): DispatchDeliveryDeps {
    return {
      workspaceRoot: dir,
      config,
      // The push targets the local bare repo, never real GitHub.
      workspace: new LocalBareRepoPusher(workspace, remote),
      policy: new PolicyEngine(config, approvals),
      audit,
      artifacts,
      projects,
      clients,
      approvals,
      ...(githubClient ? { githubClient } : {}),
    };
  }

  it(
    "gated-ALLOW: pushes the run branch to the remote, opens a draft PR, and records the link",
    async () => {
      // Autonomy enables push_commits + open_pull_requests (the gated-ALLOW path);
      // the PR publisher's linked_issue/tests_required gates clear on real run
      // evidence (a linked GitHub issue on the run + QA test evidence).
      const config = defaultConfig("agency");
      const runId = "run_allow";
      const project = await seedProjectWithCommit(runId);
      const evidence = await seedReadyEvidence(runId);
      const run = runRecord(runId, project.id, project.client_id);
      const github = new RecordingPrClient();

      const result = await deliverDispatchedRun(deps(config, github), {
        project,
        run,
        scope: "Build the booking page",
        commit: { committed: true, branch: workspace.branchForRun(project.slug, runId) },
        hadWorktree: true,
        runOk: true,
        producedArtifacts: evidence,
      });

      expect(result.status).toBe("delivered");
      expect(result.pushed).toBe(true);
      expect(result.pullRequestUrl).toContain("/pull/1");

      // The branch (with its commit) now exists in the local bare remote.
      const branch = workspace.branchForRun(project.slug, runId);
      const remoteSha = (
        await runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: remote })
      ).stdout.trim();
      expect(remoteSha).toMatch(/^[0-9a-f]{40}$/);

      // A draft PR was opened against main with the run's evidence in the body.
      expect(github.created).toHaveLength(1);
      expect(github.created[0]?.input).toMatchObject({ head: branch, base: "main", draft: true });
      expect(github.created[0]?.owner).toBe("acme");

      // The PR link is recorded as a run report artifact, and the delivery audited.
      const reports = await artifacts.list({ type: "github-pr-publish-report" });
      expect(reports).toHaveLength(1);
      const log = await readFile(workspacePaths(dir).auditLog, "utf8");
      expect(log).toContain("project.dispatch.branch_pushed");
      expect(log).toContain("project.dispatch.delivered");
    },
    TIMEOUT_MS,
  );

  it(
    "gated-DENY: blocks when open_pull_requests is disabled — nothing opened, pending owner decision",
    async () => {
      // push_commits stays enabled so the branch can push, but open_pull_requests
      // is off and no approval exists: the PR is blocked and an approval requested.
      const config = defaultConfig("agency");
      config.autonomy.open_pull_requests = false;
      const runId = "run_deny";
      const project = await seedProjectWithCommit(runId);
      const evidence = await seedReadyEvidence(runId);
      const run = runRecord(runId, project.id, project.client_id);
      const github = new RecordingPrClient();

      const result = await deliverDispatchedRun(deps(config, github), {
        project,
        run,
        scope: "Build the booking page",
        commit: { committed: true, branch: workspace.branchForRun(project.slug, runId) },
        hadWorktree: true,
        runOk: true,
        producedArtifacts: evidence,
      });

      expect(result.status).toBe("blocked");
      expect(result.reason).toContain("pull request blocked");
      expect(result.approvalId).toBeTruthy();
      // No PR was opened on the (fake) remote.
      expect(github.created).toHaveLength(0);

      // A pending owner decision was surfaced for the PR.
      const pending = await approvals.listPending();
      expect(pending.map((a) => a.action)).toContain("open_pull_requests");
      const log = await readFile(workspacePaths(dir).auditLog, "utf8");
      expect(log).toContain("project.dispatch.delivery_blocked");
    },
    TIMEOUT_MS,
  );

  it(
    "gated-DENY: blocks before any push when push_commits is disabled and no approval exists",
    async () => {
      const config = defaultConfig("agency");
      config.autonomy.push_commits = false;
      const runId = "run_no_push";
      const project = await seedProjectWithCommit(runId);
      const run = runRecord(runId, project.id, project.client_id);
      const github = new RecordingPrClient();

      const result = await deliverDispatchedRun(deps(config, github), {
        project,
        run,
        scope: "Build the booking page",
        commit: { committed: true, branch: workspace.branchForRun(project.slug, runId) },
        hadWorktree: true,
        runOk: true,
        producedArtifacts: await seedReadyEvidence(runId),
      });

      expect(result.status).toBe("blocked");
      expect(result.pushed).toBe(false);
      expect(result.reason).toContain("push blocked");
      // Nothing was pushed to the remote and no PR opened.
      await expect(
        runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${result.branch}`], {
          cwd: remote,
        }),
      ).rejects.toThrow();
      expect(github.created).toHaveLength(0);
    },
    TIMEOUT_MS,
  );

  it("skips delivery (today's behavior) when the run produced no commit, with no PR client needed", async () => {
    const config = defaultConfig("agency");
    const project = await projects.create({
      name: "Acme Site",
      clientId: "client_acme",
      repository: remote,
    });
    const run = runRecord("run_nochange", project.id, project.client_id);

    const result = await deliverDispatchedRun(deps(config), {
      project,
      run,
      scope: "noop",
      commit: { committed: false, branch: workspace.branchForRun(project.slug, "run_nochange") },
      hadWorktree: true,
      runOk: true,
      producedArtifacts: [],
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("no committed work");
  });

  it("skips delivery when the project has no linked repository", async () => {
    const config = defaultConfig("agency");
    const project = await projects.create({ name: "No Repo", clientId: "client_acme" });
    const run = runRecord("run_norepo", project.id, project.client_id);

    const result = await deliverDispatchedRun(deps(config, new RecordingPrClient()), {
      project,
      run,
      scope: "x",
      commit: { committed: true, branch: workspace.branchForRun(project.slug, "run_norepo") },
      hadWorktree: true,
      runOk: true,
      producedArtifacts: [],
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("no linked repository");
  });

  it(
    "skips delivery with an audited reason when the linked repository cannot be parsed",
    async () => {
      const config = defaultConfig("agency");
      const runId = "run_badrepo";
      const project = await projects.create({
        name: "Bad Repo",
        clientId: "client_acme",
        repository: "not a github url",
      });
      await workspace.acquireRunWorktree(project.slug, runId);
      await writeFile(join(workspace.worktreePath(project.slug, runId), "f.ts"), "// x\n");
      const commit = await workspace.commitRunWork(project.slug, runId, "feat: x");
      const run = runRecord(runId, project.id, project.client_id);

      const result = await deliverDispatchedRun(deps(config, new RecordingPrClient()), {
        project,
        run,
        scope: "x",
        commit,
        hadWorktree: true,
        runOk: true,
        producedArtifacts: [],
      });

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("unparseable repository");
      const log = await readFile(workspacePaths(dir).auditLog, "utf8");
      expect(log).toContain("project.dispatch.delivery_skipped");
    },
    TIMEOUT_MS,
  );

  it(
    "blocks as a pending owner decision when a committed run has a repo but no GitHub client",
    async () => {
      const config = defaultConfig("agency");
      const runId = "run_noclient";
      const project = await seedProjectWithCommit(runId);
      const run = runRecord(runId, project.id, project.client_id);

      // No githubClient injected and no token: cannot open a PR.
      const result = await deliverDispatchedRun(deps(config), {
        project,
        run,
        scope: "x",
        commit: { committed: true, branch: workspace.branchForRun(project.slug, runId) },
        hadWorktree: true,
        runOk: true,
        producedArtifacts: [],
      });

      expect(result.status).toBe("blocked");
      expect(result.pushed).toBe(false);
      expect(result.reason).toContain("no GitHub token");
      const log = await readFile(workspacePaths(dir).auditLog, "utf8");
      expect(log).toContain("project.dispatch.delivery_blocked");
    },
    TIMEOUT_MS,
  );
});
