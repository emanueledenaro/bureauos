import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import type {
  GitHubIssuePublishClient,
  GitHubIssuePublishClientIssue,
} from "../github/issue-publisher.js";
import { startApiServer, type ApiServer } from "./server.js";

class TestGitHubClient implements GitHubIssuePublishClient {
  created: GitHubIssuePublishClientIssue[] = [];

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
    return issue;
  }
}

describe("API server", () => {
  let dir: string;
  let server: ApiServer | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-api-"));
    await initWorkspace({ root: dir, organizationName: "API Test Agency", preset: "agency" });
  });

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
    await rm(dir, { recursive: true, force: true });
  });

  it("accepts coordinator intake requests for the ElectronJS app", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    const response = await fetch(`${server.url}/coordinator/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Pizzeria Aurora",
        message:
          "Ho parlato con una pizzeria: vuole sito con prenotazioni, logo, posizione e contenuti.",
      }),
    });

    expect(response.status).toBe(201);
    const result = (await response.json()) as {
      client: { slug: string };
      project: { slug: string };
      approvals: unknown[];
    };
    expect(result.client.slug).toBe("pizzeria-aurora");
    expect(result.project.slug).toBe("pizzeria-aurora-booking-website");
    expect(result.approvals.length).toBeGreaterThanOrEqual(3);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("coordinator.intake.completed");
  });

  it("generates reports for the ElectronJS reports surface", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    await fetch(`${server.url}/coordinator/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Pizzeria Aurora",
        message: "Ho parlato con una pizzeria: vuole sito con prenotazioni.",
        expectedValue: 4500,
      }),
    });

    const generated = await fetch(`${server.url}/reports/generate`, { method: "POST" });
    expect(generated.status).toBe(201);

    const reports = await fetch(`${server.url}/reports`);
    expect(reports.status).toBe(200);
    const body = (await reports.json()) as Array<{ type: string }>;
    expect(body.map((report) => report.type)).toEqual(
      expect.arrayContaining(["executive-report", "business-operating-report"]),
    );
  });

  it("generates GitHub issue drafts from a project slug", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    await fetch(`${server.url}/coordinator/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Pizzeria Aurora",
        message: "Ho parlato con una pizzeria: vuole sito con prenotazioni.",
      }),
    });

    const response = await fetch(`${server.url}/github/issue-drafts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectSlug: "pizzeria-aurora-booking-website" }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      drafts: Array<{ title: string; labels: string[] }>;
      artifacts: unknown[];
    };
    expect(body.drafts).toHaveLength(5);
    expect(body.artifacts).toHaveLength(5);
    expect(body.drafts[0]?.labels).toEqual(expect.arrayContaining(["type:feature"]));

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.issue_drafts.generated");
  });

  it("creates GitHub issues through the configured API GitHub client", async () => {
    const githubClient = new TestGitHubClient();
    server = await startApiServer({
      workspaceRoot: dir,
      config: defaultConfig("agency"),
      githubClient,
    });

    await fetch(`${server.url}/coordinator/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Pizzeria Aurora",
        message: "Ho parlato con una pizzeria: vuole sito con prenotazioni.",
      }),
    });
    await fetch(`${server.url}/github/issue-drafts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectSlug: "pizzeria-aurora-booking-website" }),
    });

    const response = await fetch(`${server.url}/github/create-issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectSlug: "pizzeria-aurora-booking-website",
        owner: "emanueledenaro",
        repo: "pizzeria-aurora",
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as { status: string; created: unknown[] };
    expect(body.status).toBe("created");
    expect(body.created).toHaveLength(5);
    expect(githubClient.created).toHaveLength(5);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.issue_publish.created");
  });

  it("rejects GitHub issue creation when no API GitHub client is configured", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    const response = await fetch(`${server.url}/github/create-issues`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectSlug: "pizzeria-aurora-booking-website",
        owner: "emanueledenaro",
        repo: "pizzeria-aurora",
      }),
    });

    expect(response.status).toBe(400);
  });
});
