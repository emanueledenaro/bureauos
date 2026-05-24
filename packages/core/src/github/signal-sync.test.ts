import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { OpportunityRegistry } from "../registries/opportunity.js";
import {
  GitHubSignalSyncService,
  type GitHubSignalCheckRun,
  type GitHubSignalClient,
  type GitHubSignalIssue,
  type GitHubSignalPullRequest,
} from "./signal-sync.js";

class FakeGitHubSignalClient implements GitHubSignalClient {
  issues: GitHubSignalIssue[] = [
    {
      owner: "acme",
      repo: "web",
      number: 7,
      title: "Booking form fails on mobile",
      url: "https://github.com/acme/web/issues/7",
      labels: ["type:bug"],
      state: "open",
      updatedAt: "2026-05-01T09:00:00.000Z",
    },
  ];
  pullRequests: GitHubSignalPullRequest[] = [
    {
      owner: "acme",
      repo: "web",
      number: 12,
      title: "Add booking checkout",
      url: "https://github.com/acme/web/pull/12",
      head: "feature/booking",
      headSha: "abc123def456",
      base: "main",
      state: "open",
      updatedAt: "2026-05-01T10:00:00.000Z",
    },
  ];
  checks: GitHubSignalCheckRun[] = [
    {
      owner: "acme",
      repo: "web",
      id: 91,
      name: "ci / test",
      url: "https://github.com/acme/web/actions/runs/91",
      status: "completed",
      conclusion: "failure",
      headSha: "abc123def456",
      startedAt: "2026-05-24T08:00:00.000Z",
      completedAt: "2026-05-24T08:04:00.000Z",
    },
    {
      owner: "acme",
      repo: "web",
      id: 92,
      name: "lint",
      url: "https://github.com/acme/web/actions/runs/92",
      status: "completed",
      conclusion: "success",
      headSha: "abc123def456",
      startedAt: "2026-05-24T08:00:00.000Z",
      completedAt: "2026-05-24T08:01:00.000Z",
    },
  ];

  async listIssues(): Promise<readonly GitHubSignalIssue[]> {
    return this.issues;
  }

  async listPullRequests(): Promise<readonly GitHubSignalPullRequest[]> {
    return this.pullRequests;
  }

  async listCheckRunsForRef(): Promise<readonly GitHubSignalCheckRun[]> {
    return this.checks;
  }
}

describe("GitHubSignalSyncService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-github-signals-"));
    await initWorkspace({ root: dir, organizationName: "GitHub Signals Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists GitHub issues, PRs, stale work, and failing check signals", async () => {
    const result = await new GitHubSignalSyncService(dir, {
      githubClient: new FakeGitHubSignalClient(),
    }).sync({
      owner: "acme",
      repo: "web",
      staleDays: 7,
    });

    expect(result.issues).toHaveLength(1);
    expect(result.pullRequests).toHaveLength(1);
    expect(result.checks).toHaveLength(2);
    expect(result.failingChecks.map((check) => check.name)).toEqual(["ci / test"]);
    expect(result.staleIssues.map((issue) => issue.number)).toEqual([7]);
    expect(result.stalePullRequests.map((pr) => pr.number)).toEqual([12]);
    expect(result.createdOpportunities.map((opportunity) => opportunity.source)).toEqual([
      "github:acme/web#7",
    ]);
    expect(result.report.type).toBe("github-signal-report");

    const report = await new ArtifactStore(dir).read(result.report.id);
    expect(report?.body).toContain("## Failing Checks");
    expect(report?.body).toContain("ci / test failure");
    expect(report?.body).toContain("## Stale Work");

    const opportunities = await new OpportunityRegistry(dir).list();
    expect(opportunities).toHaveLength(1);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.check_failed.detected");
    expect(audit).toContain("github.issue_stale.detected");
    expect(audit).toContain("github.pr_stale.detected");
    expect(audit).toContain("github.signals.synced");
  });
});
