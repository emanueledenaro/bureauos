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

  async function writeReadyAgentEvidence(runId: string) {
    const artifacts = new ArtifactStore(dir);
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
      body: "# QA Verification Report\n\nReady-for-review is allowed by QA evidence.",
    });
    const reviewer = await artifacts.write({
      type: "pr-review",
      createdBy: "reviewer",
      runId,
      metadata: {
        recommendation: "approve_with_residual_risk",
        finding_count: 0,
      },
      body: "# PR Review\n\nNo structured findings.",
    });
    const security = await artifacts.write({
      type: "security-review",
      createdBy: "security",
      runId,
      metadata: {
        risk_level: "low",
        finding_count: 0,
        unresolved_high_risk_count: 0,
      },
      body: "# Security Review\n\nNo structured security findings.",
    });
    return { qa, reviewer, security };
  }

  it("creates a GitHub pull request only when policy gates have evidence", async () => {
    const project = await prepareProject();
    const githubClient = new RecordingGitHubPrClient();
    const agentEvidence = await writeReadyAgentEvidence("run_pr_1");

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
      linkedLinearIssue: {
        identifier: "SER-29",
        url: "https://linear.app/serium/issue/SER-29/open-draft-github-pr",
      },
      linkedIssueNumbers: [12],
      testEvidence: ["npm test -- booking passed"],
      runId: "run_pr_1",
      evidenceArtifactIds: [
        agentEvidence.qa.id,
        agentEvidence.reviewer.id,
        agentEvidence.security.id,
      ],
      draft: false,
    });

    expect(result.status).toBe("created");
    expect(result.pull_request).toMatchObject({
      number: 1,
      title: "Implement booking website",
      head: "feature/booking-website",
      base: "main",
    });
    expect(result.report?.type).toBe("github-pr-publish-report");
    expect(githubClient.created[0]?.input.body).toContain("## Summary");
    expect(githubClient.created[0]?.input.body).toContain("## Linked Issue");
    expect(githubClient.created[0]?.input.body).toContain("## Verification");
    expect(githubClient.created[0]?.input.body).toContain("[SER-29]");
    expect(githubClient.created[0]?.input.body).toContain("GitHub: #12");
    expect(githubClient.created[0]?.input.body).toContain("BureauOS run: run_pr_1");
    expect(githubClient.created[0]?.input.body).toContain("npm test -- booking passed");
    expect(githubClient.created[0]?.input.body).toContain(agentEvidence.qa.id);
    expect(githubClient.created[0]?.input.body).toContain("QA:");
    expect(githubClient.created[0]?.input.body).toContain("Reviewer:");
    expect(githubClient.created[0]?.input.body).toContain("Security:");
    expect(githubClient.created[0]?.input.draft).toBe(true);

    const updatedProject = await new ProjectRegistry(dir).get(project.slug);
    expect(updatedProject?.repository).toBe("https://github.com/emanueledenaro/pizzeria-aurora");

    const reports = await new ArtifactStore(dir).list({ type: "github-pr-publish-report" });
    expect(reports).toHaveLength(1);
    const written = await new ArtifactStore(dir).read(reports[0]!.id);
    expect(written?.body).toContain("GitHub Pull Request Publish Report");
    expect(written?.body).toContain("SER-29");
    expect(written?.body).toContain("run_pr_1");
    expect(written?.body).toContain(agentEvidence.security.id);
    expect(written?.body).toContain("Merge pull request");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.pr_publish.created");
  });

  it("blocks run-backed PR creation when agent verification artifacts are missing", async () => {
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
      linkedIssueNumbers: [12],
      testEvidence: ["npm test passed"],
      runId: "run_missing_agent_evidence",
      evidenceArtifactIds: [],
    });

    expect(result.status).toBe("blocked");
    expect(githubClient.created).toHaveLength(0);
    expect(result.policy.reason).toContain("qa_verification_artifact");
    expect(result.policy.reason).toContain("reviewer_artifact");
  });

  it("requires security review before PR promotion for sensitive evidence", async () => {
    const project = await prepareProject();
    const githubClient = new RecordingGitHubPrClient();
    const artifacts = new ArtifactStore(dir);
    const qaAndReviewer = await writeReadyAgentEvidence("run_sensitive_pr");
    const diff = await artifacts.write({
      type: "run-report",
      createdBy: "development",
      runId: "run_sensitive_pr",
      metadata: {
        changed_files: ["packages/core/src/auth/oauth-callback.ts"],
      },
      body: "# Development Runtime Execution\n\nChanged files: packages/core/src/auth/oauth-callback.ts",
    });

    const result = await new GitHubPullRequestPublishService(dir, {
      config: defaultConfig("agency"),
      githubClient,
    }).publish({
      projectSlug: project.slug,
      owner: "emanueledenaro",
      repo: "pizzeria-aurora",
      title: "Implement auth callback",
      head: "feature/auth-callback",
      linkedIssueNumbers: [12],
      testEvidence: ["npm test passed"],
      runId: "run_sensitive_pr",
      evidenceArtifactIds: [qaAndReviewer.qa.id, qaAndReviewer.reviewer.id, diff.id],
    });

    expect(result.status).toBe("blocked");
    expect(githubClient.created).toHaveLength(0);
    expect(result.policy.reason).toContain("security_review_artifact");
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
