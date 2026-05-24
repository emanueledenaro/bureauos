import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createHmac } from "node:crypto";
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

  it("persists coordinator chat attachments as project artifacts", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    const response = await fetch(`${server.url}/coordinator/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message:
          "Ho parlato con Pizzeria Aurora: cliente ha mandato logo e brief per sito prenotazioni.",
        attachments: [
          {
            name: "brand-brief.md",
            type: "text/markdown",
            size: 22,
            text: "# Brand\n\nRosso e nero.",
          },
          {
            name: "logo.png",
            type: "image/png",
            size: 5,
            dataUrl: "data:image/png;base64,aGVsbG8=",
          },
        ],
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      client: { slug: string };
      run: { id: string };
      project: { slug: string };
      artifacts: Array<{ type: string }>;
    };
    expect(body.client.slug).toBe("pizzeria-aurora");
    expect(body.project.slug).toBe("pizzeria-aurora-booking-website");
    expect(body.artifacts.filter((artifact) => artifact.type === "owner-attachment")).toHaveLength(
      2,
    );

    const files = await readdir(
      join(dir, ".bureauos", "memory", "artifacts", "attachments", body.run.id),
    );
    expect(files).toEqual(
      expect.arrayContaining([
        expect.stringContaining("brand-brief.md"),
        expect.stringContaining("logo.png"),
      ]),
    );

    const assets = await readFile(
      join(dir, ".bureauos", "memory", "projects", body.project.slug, "ASSETS.md"),
      "utf8",
    );
    expect(assets).toContain("brand-brief.md");
    expect(assets).toContain("logo.png");
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

  it("ingests signed GitHub webhooks into signal memory", async () => {
    const secret = "webhook-secret";
    server = await startApiServer({
      workspaceRoot: dir,
      config: defaultConfig("agency"),
      token: "owner-api-token",
      githubWebhookSecret: secret,
    });
    const payload = JSON.stringify({
      action: "opened",
      repository: {
        name: "web",
        full_name: "acme/web",
        owner: { login: "acme" },
      },
      issue: {
        number: 7,
        title: "Booking form fails on mobile",
        html_url: "https://github.com/acme/web/issues/7",
        labels: [{ name: "type:bug" }],
        state: "open",
        updated_at: "2026-05-24T10:00:00.000Z",
      },
    });
    const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

    const response = await fetch(`${server.url}/github/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "issues",
        "x-github-delivery": "delivery-api-1",
        "x-hub-signature-256": signature,
      },
      body: payload,
    });

    expect(response.status).toBe(202);
    const body = (await response.json()) as {
      repository: string;
      createdOpportunities: Array<{ source: string }>;
      report: { type: string };
    };
    expect(body.repository).toBe("acme/web");
    expect(body.createdOpportunities.map((opportunity) => opportunity.source)).toEqual([
      "github:acme/web#7",
    ]);
    expect(body.report.type).toBe("github-signal-report");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.issue_webhook.ingested");
  });

  it("rejects GitHub webhooks with invalid signatures", async () => {
    server = await startApiServer({
      workspaceRoot: dir,
      config: defaultConfig("agency"),
      githubWebhookSecret: "webhook-secret",
    });

    const response = await fetch(`${server.url}/github/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "issues",
        "x-hub-signature-256": "sha256=invalid",
      },
      body: JSON.stringify({
        repository: {
          name: "web",
          full_name: "acme/web",
          owner: { login: "acme" },
        },
      }),
    });

    expect(response.status).toBe(401);
  });

  it("dispatches a project into project-scoped agent handoffs", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    await fetch(`${server.url}/coordinator/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Pizzeria Aurora",
        message: "Ho parlato con una pizzeria: vuole sito con prenotazioni.",
      }),
    });

    const response = await fetch(`${server.url}/projects/dispatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectSlug: "pizzeria-aurora-booking-website",
        runType: "feature",
        scope: "Prepare dev-ready work",
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      packet: { type: string };
      handoffs: unknown[];
      pipeline: string[];
    };
    expect(body.packet.type).toBe("project-dispatch-packet");
    expect(body.handoffs).toHaveLength(6);
    expect(body.pipeline).toEqual(["product", "ux", "development", "qa", "security", "reviewer"]);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("project.dispatch.completed");
  });

  it("connects and disconnects provider auth without leaking secrets to the API response", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    const login = await fetch(`${server.url}/providers/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai",
        apiKey: "sk-test-provider-secret",
        defaultModel: "gpt-5",
      }),
    });

    expect(login.status).toBe(201);
    const loginBody = (await login.json()) as Array<{
      provider: string;
      source: string;
      api_key_masked: string;
      default_model: string;
    }>;
    const openai = loginBody.find((provider) => provider.provider === "openai");
    expect(openai?.source).toBe("auth");
    expect(openai?.api_key_masked).toBe("sk-t...cret");
    expect(JSON.stringify(loginBody)).not.toContain("sk-test-provider-secret");

    const providers = await fetch(`${server.url}/providers`);
    expect(providers.status).toBe(200);
    const providerBody = (await providers.json()) as Array<{ provider: string; source: string }>;
    expect(providerBody.find((provider) => provider.provider === "openai")?.source).toBe("auth");

    const logout = await fetch(`${server.url}/providers/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "openai" }),
    });
    expect(logout.status).toBe(200);
    const logoutBody = (await logout.json()) as { removed: boolean };
    expect(logoutBody.removed).toBe(true);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("provider.auth.login");
    expect(audit).toContain("provider.auth.logout");
    expect(audit).not.toContain("sk-test-provider-secret");
  });

  it("connects OpenAI Codex OAuth without falling back to OpenAI API auth", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    const login = await fetch(`${server.url}/providers/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai-codex",
        accessToken: "oauth-access-token-api",
        refreshToken: "oauth-refresh-token-api",
        defaultModel: "gpt-5",
      }),
    });

    expect(login.status).toBe(201);
    const loginBody = (await login.json()) as Array<{
      provider: string;
      source: string;
      auth_mode: string;
      oauth_token_masked: string;
      no_api_fallback: boolean;
    }>;
    const codex = loginBody.find((provider) => provider.provider === "openai-codex");
    expect(codex?.source).toBe("auth");
    expect(codex?.auth_mode).toBe("oauth");
    expect(codex?.oauth_token_masked).toBe("oaut...-api");
    expect(codex?.no_api_fallback).toBe(true);
    expect(JSON.stringify(loginBody)).not.toContain("oauth-access-token-api");
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
