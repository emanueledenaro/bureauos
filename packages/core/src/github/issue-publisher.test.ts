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
import { GitHubIssueDraftService } from "./issue-drafts.js";
import {
  GitHubIssuePublishService,
  type GitHubIssuePublishClient,
  type GitHubIssuePublishClientIssue,
} from "./issue-publisher.js";

class RecordingGitHubClient implements GitHubIssuePublishClient {
  created: GitHubIssuePublishClientIssue[] = [];
  ensuredLabels: string[] = [];

  async createIssue(
    owner: string,
    repo: string,
    input: { title: string; body: string; labels?: readonly string[] },
  ): Promise<GitHubIssuePublishClientIssue> {
    const issue: GitHubIssuePublishClientIssue = {
      owner,
      repo,
      number: this.created.length + 1,
      title: input.title,
      url: `https://github.com/${owner}/${repo}/issues/${this.created.length + 1}`,
      labels: input.labels ?? [],
      state: "open",
    };
    this.created.push(issue);
    expect(input.body).toContain("## Policy Notes");
    return issue;
  }

  async ensureLabels(
    _owner: string,
    _repo: string,
    labels: readonly { name: string }[],
  ): Promise<void> {
    this.ensuredLabels = labels.map((label) => label.name);
  }
}

describe("GitHubIssuePublishService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-github-publish-"));
    await initWorkspace({ root: dir, organizationName: "GitHub Publish Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function prepareDrafts() {
    const intake = await new CoordinatorIntakeService(dir, {
      config: defaultConfig("agency"),
    }).process({
      clientName: "Pizzeria Aurora",
      message: "Ho parlato con una pizzeria: vuole sito con prenotazioni.",
      source: "owner_chat",
    });
    await new GitHubIssueDraftService(dir).draftForProject(intake.project.slug);
    return intake.project;
  }

  it("creates GitHub issues from approved project draft artifacts", async () => {
    const project = await prepareDrafts();
    const githubClient = new RecordingGitHubClient();

    const result = await new GitHubIssuePublishService(dir, {
      config: defaultConfig("agency"),
      githubClient,
    }).publishProjectDrafts({
      projectSlug: project.slug,
      owner: "emanueledenaro",
      repo: "pizzeria-aurora",
    });

    expect(result.status).toBe("created");
    expect(result.created).toHaveLength(5);
    expect(result.report?.type).toBe("github-issue-publish-report");
    expect(githubClient.created.map((issue) => issue.title)).toEqual(
      expect.arrayContaining([
        "Product: finalize scope for Pizzeria Aurora Booking Website",
        "Delivery: provision repository for Pizzeria Aurora Booking Website",
      ]),
    );
    expect(githubClient.ensuredLabels).toEqual(
      expect.arrayContaining(["type:feature", "stage:intake", "needs:decision"]),
    );

    const updatedProject = await new ProjectRegistry(dir).get(project.slug);
    expect(updatedProject?.repository).toBe("https://github.com/emanueledenaro/pizzeria-aurora");

    const reports = await new ArtifactStore(dir).list({ type: "github-issue-publish-report" });
    expect(reports).toHaveLength(1);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.issue_publish.created");
  });

  it("requests approval instead of creating issues when policy blocks issue creation", async () => {
    const project = await prepareDrafts();
    const config = defaultConfig("agency");
    config.autonomy.create_issues = false;
    const githubClient = new RecordingGitHubClient();

    const result = await new GitHubIssuePublishService(dir, {
      config,
      githubClient,
    }).publishProjectDrafts({
      projectSlug: project.slug,
      owner: "emanueledenaro",
      repo: "pizzeria-aurora",
    });

    expect(result.status).toBe("blocked");
    expect(result.created).toHaveLength(0);
    expect(result.source_artifacts).toHaveLength(5);
    expect(githubClient.created).toHaveLength(0);
    expect(result.approval?.action).toBe("create_issues");

    const approvals = await new ApprovalRegistry(dir).listPending();
    expect(approvals.map((approval) => approval.action)).toContain("create_issues");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.issue_publish.blocked");
  });

  it("ensures repository labels behind the policy gate and audits the write (SER-208)", async () => {
    const githubClient = new RecordingGitHubClient();

    const result = await new GitHubIssuePublishService(dir, {
      config: defaultConfig("agency"),
      githubClient,
    }).ensureRepositoryLabels({
      owner: "emanueledenaro",
      repo: "pizzeria-aurora",
      labels: [{ name: "type:feature" }, { name: "stage:intake" }],
    });

    expect(result.status).toBe("ensured");
    expect(result.labels.map((label) => label.name)).toEqual(["type:feature", "stage:intake"]);
    expect(githubClient.ensuredLabels).toEqual(["type:feature", "stage:intake"]);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.labels.ensured");
  });

  it("blocks ensure-labels and requests approval when policy denies the write (SER-208)", async () => {
    const config = defaultConfig("agency");
    config.autonomy.create_issues = false;
    const githubClient = new RecordingGitHubClient();

    const result = await new GitHubIssuePublishService(dir, {
      config,
      githubClient,
    }).ensureRepositoryLabels({
      owner: "emanueledenaro",
      repo: "pizzeria-aurora",
      labels: [{ name: "type:feature" }],
    });

    expect(result.status).toBe("blocked");
    expect(result.labels).toHaveLength(0);
    expect(githubClient.ensuredLabels).toHaveLength(0);
    expect(result.approval?.action).toBe("create_issues");

    const approvals = await new ApprovalRegistry(dir).listPending();
    expect(approvals.map((approval) => approval.action)).toContain("create_issues");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.labels.blocked");
  });
});
