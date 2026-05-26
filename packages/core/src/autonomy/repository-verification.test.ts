import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ClientRegistry } from "../registries/client.js";
import { ProjectRegistry } from "../registries/project.js";
import type {
  GitHubSignalCheckRun,
  GitHubSignalClient,
  GitHubSignalIssue,
  GitHubSignalPullRequest,
} from "../github/signal-sync.js";
import { ProjectRepositoryVerificationService } from "./repository-verification.js";

class FakeGitHubSignalClient implements GitHubSignalClient {
  async listIssues(owner: string, repo: string): Promise<readonly GitHubSignalIssue[]> {
    return [
      {
        owner,
        repo,
        number: 7,
        title: "Booking form fails on mobile",
        url: `https://github.com/${owner}/${repo}/issues/7`,
        labels: ["type:bug"],
        state: "open",
        updatedAt: "2000-01-01T00:00:00.000Z",
      },
    ];
  }

  async listPullRequests(owner: string, repo: string): Promise<readonly GitHubSignalPullRequest[]> {
    return [
      {
        owner,
        repo,
        number: 12,
        title: "Add booking checkout",
        url: `https://github.com/${owner}/${repo}/pull/12`,
        head: "feature/booking",
        headSha: "abc123def456",
        base: "main",
        state: "open",
        updatedAt: "2000-01-01T00:00:00.000Z",
      },
    ];
  }

  async listCheckRunsForRef(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<readonly GitHubSignalCheckRun[]> {
    return [
      {
        owner,
        repo,
        id: 91,
        name: "ci / test",
        url: `https://github.com/${owner}/${repo}/actions/runs/91`,
        status: "completed",
        conclusion: "failure",
        headSha: ref,
        startedAt: "2026-05-24T08:00:00.000Z",
        completedAt: "2026-05-24T08:04:00.000Z",
      },
    ];
  }
}

describe("ProjectRepositoryVerificationService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-repo-verification-"));
    await initWorkspace({
      root: dir,
      organizationName: "Repository Verification",
      preset: "agency",
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes an empty verification report without inventing projects", async () => {
    const result = await new ProjectRepositoryVerificationService(dir).verify();

    expect(result.projects).toEqual([]);
    expect(result.report).toMatchObject({
      type: "repository-verification-report",
      status: "submitted",
      project_count: 0,
    });
    const written = await new ArtifactStore(dir).read(result.report.id);
    expect(written?.body).toContain("No projects recorded");
  });

  it("marks projects with no repository as missing", async () => {
    const client = await new ClientRegistry(dir).create({
      name: "Miraglia Pizza",
      status: "active",
      industry: "food_and_beverage",
    });
    const project = await new ProjectRegistry(dir).create({
      name: "Miraglia Booking Website",
      clientId: client.id,
      status: "in_progress",
    });

    const result = await new ProjectRepositoryVerificationService(dir).verify({
      projectId: project.id,
    });

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({
      project: { id: project.id },
      client: { id: client.id },
      status: "missing",
      repository: "",
      signal_report_id: "",
    });
  });

  it("parses GitHub repositories but keeps them unverified without a live client", async () => {
    const client = await new ClientRegistry(dir).create({
      name: "Miraglia Pizza",
      status: "active",
      industry: "food_and_beverage",
    });
    const project = await new ProjectRegistry(dir).create({
      name: "Miraglia Booking Website",
      clientId: client.id,
      status: "in_progress",
      repository: "https://github.com/example/miraglia.git",
    });

    const result = await new ProjectRepositoryVerificationService(dir).verify({
      projectId: project.id,
    });

    expect(result.projects[0]).toMatchObject({
      status: "unverified",
      parsed_repository: "example/miraglia",
      issues_count: 0,
      pull_requests_count: 0,
      failing_checks_count: 0,
    });
  });

  it("marks non-GitHub repository links as unsupported", async () => {
    const client = await new ClientRegistry(dir).create({
      name: "Miraglia Pizza",
      status: "active",
      industry: "food_and_beverage",
    });
    const project = await new ProjectRegistry(dir).create({
      name: "Miraglia Booking Website",
      clientId: client.id,
      status: "in_progress",
      repository: "https://notgithub.com/example/miraglia",
    });

    const result = await new ProjectRepositoryVerificationService(dir).verify({
      projectId: project.id,
    });

    expect(result.projects[0]).toMatchObject({
      status: "unsupported",
      parsed_repository: "",
    });
  });

  it("syncs live GitHub signals and marks risky repositories for attention", async () => {
    const client = await new ClientRegistry(dir).create({
      name: "Miraglia Pizza",
      status: "active",
      industry: "food_and_beverage",
    });
    const project = await new ProjectRegistry(dir).create({
      name: "Miraglia Booking Website",
      clientId: client.id,
      status: "in_progress",
      repository: "git@github.com:example/miraglia.git",
    });
    const artifacts = new ArtifactStore(dir);
    const audit = new AuditLog(workspacePaths(dir).auditLog);

    const result = await new ProjectRepositoryVerificationService(dir, {
      artifacts,
      audit,
      githubClient: new FakeGitHubSignalClient(),
    }).verify({ projectId: project.id, staleDays: 7 });

    expect(result.projects[0]).toMatchObject({
      status: "attention",
      parsed_repository: "example/miraglia",
      issues_count: 1,
      pull_requests_count: 1,
      checks_count: 1,
      failing_checks_count: 1,
      stale_issues_count: 1,
      stale_pull_requests_count: 1,
    });
    expect(result.projects[0]?.signal_report_id).toMatch(/^art_/);
    expect(await artifacts.list({ type: "github-signal-report" })).toHaveLength(1);
    expect(await artifacts.list({ type: "repository-verification-report" })).toHaveLength(1);

    const log = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(log).toContain("github.signals.synced");
    expect(log).toContain("github.check_failed.detected");
    expect(log).toContain("project.repositories.verified");
  });
});
