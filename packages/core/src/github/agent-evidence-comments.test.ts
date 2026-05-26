import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { defaultConfig } from "../config/loader.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry } from "../registries/approval.js";
import {
  GitHubAgentEvidenceCommentService,
  type GitHubAgentEvidenceComment,
  type GitHubAgentEvidenceCommentClient,
} from "./agent-evidence-comments.js";

class RecordingGitHubCommentClient implements GitHubAgentEvidenceCommentClient {
  comments: GitHubAgentEvidenceComment[] = [];
  created: Array<{ owner: string; repo: string; issueNumber: number; body: string }> = [];
  updated: Array<{ owner: string; repo: string; commentId: number; body: string }> = [];

  async listComments(): Promise<readonly GitHubAgentEvidenceComment[]> {
    return this.comments;
  }

  async createComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<GitHubAgentEvidenceComment> {
    this.created.push({ owner, repo, issueNumber, body });
    const comment = {
      id: this.comments.length + 1,
      body,
      url: `https://github.com/${owner}/${repo}/issues/${issueNumber}#issuecomment-${this.comments.length + 1}`,
    };
    this.comments.push(comment);
    return comment;
  }

  async updateComment(
    owner: string,
    repo: string,
    commentId: number,
    body: string,
  ): Promise<GitHubAgentEvidenceComment> {
    this.updated.push({ owner, repo, commentId, body });
    const comment = {
      id: commentId,
      body,
      url: `https://github.com/${owner}/${repo}/issues/comments/${commentId}`,
    };
    this.comments = this.comments.map((item) => (item.id === commentId ? comment : item));
    return comment;
  }
}

describe("GitHubAgentEvidenceCommentService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-github-agent-comments-"));
    await initWorkspace({ root: dir, organizationName: "GitHub Comment Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("posts policy-gated agent evidence comments with run and artifact links", async () => {
    const artifacts = new ArtifactStore(dir);
    const evidence = await artifacts.write({
      type: "pr-review",
      createdBy: "reviewer",
      runId: "run_review",
      body: "# PR Review\n\nNo blockers.",
    });
    const githubClient = new RecordingGitHubCommentClient();

    const result = await new GitHubAgentEvidenceCommentService(dir, {
      config: defaultConfig("agency"),
      githubClient,
      artifacts,
    }).publish({
      agent: "reviewer",
      owner: "acme",
      repo: "web",
      issueNumber: 42,
      targetType: "pull_request",
      runId: "run_review",
      artifactIds: [evidence.id],
      summary: "Reviewer found no blockers after focused PR review.",
      status: "ready",
      testEvidence: ["pnpm --filter @bureauos/core test passed"],
    });

    expect(result.status).toBe("posted");
    expect(result.capability.status).toBe("allowed");
    expect(result.report?.type).toBe("github-agent-evidence-comment-report");
    expect(githubClient.created).toHaveLength(1);
    expect(githubClient.updated).toHaveLength(0);
    expect(githubClient.created[0]?.body).toContain(
      '<!-- bureauos:agent-evidence agent="reviewer" run="run_review" target="github://acme/web/pull/42" -->',
    );
    expect(githubClient.created[0]?.body).toContain("Run: `run_review`");
    expect(githubClient.created[0]?.body).toContain(evidence.id);
    expect(githubClient.created[0]?.body).toContain(
      "Merge, deployment, client contact, publishing, billing, and destructive actions remain separate policy-gated operations.",
    );

    const report = await artifacts.read(result.report!.id);
    expect(report?.body).toContain("GitHub Agent Evidence Comment Report");
    expect(report?.body).toContain(result.capability.artifact.id);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.agent_evidence_comment.posted");
    expect(audit).toContain("capability.use.allowed");
  });

  it("updates an existing marker comment instead of duplicating evidence", async () => {
    const artifacts = new ArtifactStore(dir);
    const evidence = await artifacts.write({
      type: "test-plan",
      createdBy: "qa",
      runId: "run_qa",
      body: "# Test Plan\n\nSmoke complete.",
    });
    const githubClient = new RecordingGitHubCommentClient();
    githubClient.comments.push({
      id: 99,
      body: '<!-- bureauos:agent-evidence agent="qa" run="run_qa" target="github://acme/web/issues/7" -->\nold body',
      url: "https://github.com/acme/web/issues/7#issuecomment-99",
    });

    const result = await new GitHubAgentEvidenceCommentService(dir, {
      config: defaultConfig("agency"),
      githubClient,
      artifacts,
    }).publish({
      agent: "qa",
      owner: "acme",
      repo: "web",
      issueNumber: 7,
      targetType: "issue",
      runId: "run_qa",
      artifactIds: [evidence.id],
      summary: "QA evidence refreshed after rerun.",
      status: "passed",
      testEvidence: ["playwright smoke passed"],
    });

    expect(result.status).toBe("updated");
    expect(githubClient.created).toHaveLength(0);
    expect(githubClient.updated).toHaveLength(1);
    expect(githubClient.updated[0]).toMatchObject({
      owner: "acme",
      repo: "web",
      commentId: 99,
    });
    expect(githubClient.updated[0]?.body).toContain("QA evidence refreshed after rerun.");
  });

  it("blocks comment publication before calling GitHub when policy denies comments", async () => {
    const config = defaultConfig("agency");
    config.autonomy.comment_on_issues = false;
    const githubClient = new RecordingGitHubCommentClient();

    const result = await new GitHubAgentEvidenceCommentService(dir, {
      config,
      githubClient,
    }).publish({
      agent: "development",
      owner: "acme",
      repo: "web",
      issueNumber: 12,
      targetType: "issue",
      runId: "run_dev",
      artifactIds: ["art_missing"],
      summary: "Development handoff is ready, but comments are policy-disabled.",
      status: "blocked",
    });

    expect(result.status).toBe("blocked");
    expect(result.capability.policy.action).toBe("comment_on_issues");
    expect(result.capability.approval?.action).toBe("comment_on_issues");
    expect(githubClient.created).toHaveLength(0);
    expect(githubClient.updated).toHaveLength(0);

    const approvals = await new ApprovalRegistry(dir).listPending();
    expect(approvals.map((approval) => approval.action)).toContain("comment_on_issues");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.agent_evidence_comment.blocked");
    expect(audit).toContain("capability.use.blocked");
  });
});
