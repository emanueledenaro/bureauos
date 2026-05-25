import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { defaultConfig } from "../config/loader.js";
import { CoordinatorIntakeService } from "../coordinator/intake.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { ProjectRegistry } from "../registries/project.js";
import {
  GitHubPullRequestPublishService,
  type GitHubPullRequestPublishClient,
  type GitHubPullRequestPublishClientPr,
} from "./pr-publisher.js";

class RecordingGitHubPrClient implements GitHubPullRequestPublishClient {
  created: Array<{
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
      headSha: "abc123",
      base: input.base,
      state: "open",
      updatedAt: "2026-05-25T10:00:00.000Z",
    };
  }
}

describe("GitHubPullRequestPublishService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-github-pr-"));
    await initWorkspace({ root: dir, organizationName: "GitHub PR Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function prepareProject() {
    const intake = await new CoordinatorIntakeService(dir, {
      config: defaultConfig("agency"),
    }).process({
      clientName: "Pizzeria Aurora",
      message: "Ho parlato con una pizzeria: vuole sito con prenotazioni.",
      source: "owner_chat",
    });
    return intake.project;
  }

  it("creates a GitHub pull request only when policy gates have evidence", async () => {
    const project = await prepareProject();
    const githubClient = new RecordingGitHubPrClient();

    const result = await new GitHubPullRequestPublishService(dir, {
      config: defaultConfig("agency"),
      githubClient,
    }).publish({
      projectSlug: project.slug,
      owner: "emanueledenaro",
      repo: "pizzeria-aurora",
      title: "Implement booking website",
      head: "feature/booking-website",
      base: "main",
      linkedIssueNumbers: [12],
      testEvidence: ["npm test -- booking passed"],
      draft: true,
    });

    expect(result.status).toBe("created");
    expect(result.pull_request).toMatchObject({
      number: 1,
      title: "Implement booking website",
      head: "feature/booking-website",
      base: "main",
    });
    expect(result.report?.type).toBe("github-pr-publish-report");
    expect(githubClient.created[0]?.input.body).toContain("Linked issues: #12");
    expect(githubClient.created[0]?.input.body).toContain("npm test -- booking passed");
    expect(githubClient.created[0]?.input.draft).toBe(true);

    const updatedProject = await new ProjectRegistry(dir).get(project.slug);
    expect(updatedProject?.repository).toBe("https://github.com/emanueledenaro/pizzeria-aurora");

    const reports = await new ArtifactStore(dir).list({ type: "github-pr-publish-report" });
    expect(reports).toHaveLength(1);
    const written = await new ArtifactStore(dir).read(reports[0]!.id);
    expect(written?.body).toContain("GitHub Pull Request Publish Report");
    expect(written?.body).toContain("Merge pull request");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.pr_publish.created");
  });

  it("requests approval instead of opening a PR when required gates are missing", async () => {
    const project = await prepareProject();
    const githubClient = new RecordingGitHubPrClient();

    const result = await new GitHubPullRequestPublishService(dir, {
      config: defaultConfig("agency"),
      githubClient,
    }).publish({
      projectSlug: project.slug,
      owner: "emanueledenaro",
      repo: "pizzeria-aurora",
      title: "Implement booking website",
      head: "feature/booking-website",
    });

    expect(result.status).toBe("blocked");
    expect(result.pull_request).toBeUndefined();
    expect(githubClient.created).toHaveLength(0);
    expect(result.approval?.action).toBe("open_pull_requests");
    expect(result.policy.reason).toContain("missing required PR gate");

    const approvals = await new ApprovalRegistry(dir).listPending();
    expect(approvals.map((approval) => approval.action)).toContain("open_pull_requests");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.pr_publish.blocked");
  });

  it("requests approval when policy disables PR creation", async () => {
    const project = await prepareProject();
    const config = defaultConfig("agency");
    config.autonomy.open_pull_requests = false;
    const githubClient = new RecordingGitHubPrClient();

    const result = await new GitHubPullRequestPublishService(dir, {
      config,
      githubClient,
    }).publish({
      projectSlug: project.slug,
      owner: "emanueledenaro",
      repo: "pizzeria-aurora",
      title: "Implement booking website",
      head: "feature/booking-website",
      linkedIssueNumbers: [12],
      testEvidence: ["npm test passed"],
    });

    expect(result.status).toBe("blocked");
    expect(githubClient.created).toHaveLength(0);
    expect(result.policy.outcome).toBe("require_approval");
    expect(result.approval?.action).toBe("open_pull_requests");
  });
});
