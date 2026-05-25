import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
import type { OpenAICodexOAuthFetch } from "@bureauos/providers";

class TestGitHubClient implements GitHubIssuePublishClient {
  created: GitHubIssuePublishClientIssue[] = [];
  createdPullRequests: Array<{
    number: number;
    title: string;
    url: string;
    head: string;
    base: string;
  }> = [];
  createdRepositories: Array<{
    owner: string;
    repo: string;
    fullName: string;
    url: string;
    private: boolean;
  }> = [];

  async createRepository(input: {
    owner: string;
    name: string;
    ownerType: "user" | "org";
    private: boolean;
    description?: string;
    autoInit?: boolean;
  }) {
    const repo = {
      owner: input.owner,
      repo: input.name,
      fullName: `${input.owner}/${input.name}`,
      url: `https://github.com/${input.owner}/${input.name}`,
      private: input.private,
      defaultBranch: input.autoInit === false ? "" : "main",
      createdAt: "2026-05-25T10:00:00.000Z",
    };
    this.createdRepositories.push(repo);
    return repo;
  }

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

  async createPullRequest(
    owner: string,
    repo: string,
    input: { title: string; body: string; head: string; base: string },
  ) {
    const pullRequest = {
      owner,
      repo,
      number: this.createdPullRequests.length + 1,
      title: input.title,
      url: `https://github.com/${owner}/${repo}/pull/${this.createdPullRequests.length + 1}`,
      head: input.head,
      headSha: "abc123",
      base: input.base,
      state: "open" as const,
      updatedAt: "2026-05-25T10:00:00.000Z",
    };
    this.createdPullRequests.push(pullRequest);
    return pullRequest;
  }
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
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

  it("moves resolved approvals into history for the ElectronJS approvals page", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    const intake = await fetch(`${server.url}/coordinator/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Pizzeria Aurora",
        message: "Ho parlato con una pizzeria: vuole sito con prenotazioni.",
      }),
    });
    const created = (await intake.json()) as { approvals: Array<{ id: string }> };
    const first = created.approvals[0];
    expect(first?.id).toBeTruthy();

    const resolved = await fetch(`${server.url}/approvals/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: first?.id, status: "approved", reason: "Scope approved" }),
    });
    expect(resolved.status).toBe(200);

    const history = await fetch(`${server.url}/approvals/resolved`);
    expect(history.status).toBe(200);
    const body = (await history.json()) as Array<{
      id: string;
      status: string;
      reason: string;
      resolved_by: string;
    }>;
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: first?.id,
          status: "approved",
          reason: "Scope approved",
          resolved_by: "owner",
        }),
      ]),
    );

    const pending = (await (await fetch(`${server.url}/approvals`)).json()) as Array<{
      id: string;
    }>;
    expect(pending.map((approval) => approval.id)).not.toContain(first?.id);
  });

  it("exposes safe workspace settings for the ElectronJS settings page", async () => {
    const config = defaultConfig("agency");
    config.organization.name = "Settings Agency";
    config.provider.openai = {
      name: "OpenAI Private",
      options: { defaultModel: "gpt-5-private", apiKey: "must-not-leak" },
    };
    server = await startApiServer({ workspaceRoot: dir, config });

    const response = await fetch(`${server.url}/settings`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      config_path: string;
      organization: { name: string };
      setup: { preset: string };
      supreme_coordinator: { provider: string; model: string };
      providers: { configured_overrides: string[]; enabled: string[] };
      agents: { roles: number };
      capabilities: { catalog: number };
    };
    expect(body.organization.name).toBe("Settings Agency");
    expect(body.setup.preset).toBe("agency");
    expect(body.config_path).toBe(workspacePaths(dir).configFile);
    expect(body.supreme_coordinator.provider).toBe("openai-codex");
    expect(body.providers.configured_overrides).toEqual(["openai"]);
    expect(body.providers.enabled).toContain("openai");
    expect(body.agents.roles).toBeGreaterThan(0);
    expect(body.capabilities.catalog).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
  });

  it("reads and updates growth memory for the ElectronJS growth page", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    const empty = await fetch(`${server.url}/growth/memory`);
    expect(empty.status).toBe(200);
    const emptyBody = (await empty.json()) as {
      ready: boolean;
      missing_sections: string[];
      sections: Array<{ path: string }>;
    };
    expect(emptyBody.ready).toBe(false);
    expect(emptyBody.missing_sections).toEqual(expect.arrayContaining(["brand", "offers"]));
    expect(JSON.stringify(emptyBody)).not.toContain(dir);

    const update = await fetch(`${server.url}/growth/memory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brand: "BureauOS helps owner-led companies run delivery and growth.",
        offers: "AAAS setup and operating room implementation.",
        channels: "GitHub, X, LinkedIn.",
      }),
    });
    expect(update.status).toBe(201);
    const updated = (await update.json()) as { ready: boolean };
    expect(updated.ready).toBe(true);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("growth.memory.updated");
  });

  it("exposes client intelligence for the ElectronJS clients page", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    await fetch(`${server.url}/coordinator/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Pizzeria Aurora",
        message: "Ho parlato con una pizzeria: vuole sito con prenotazioni.",
        expectedValue: 4500,
        expectedMargin: 40,
      }),
    });

    const response = await fetch(`${server.url}/clients/intelligence`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      totals: { clients: number; pipeline_value: number };
      clients: Array<{
        client: { slug: string };
        revenue: { pipeline_value: number };
        delivery: { projects_total: number };
        memory_paths: { profile: string };
      }>;
    };
    expect(body.totals.clients).toBe(1);
    expect(body.totals.pipeline_value).toBe(4500);
    expect(body.clients[0]).toMatchObject({
      client: { slug: "pizzeria-aurora" },
      revenue: { pipeline_value: 4500 },
      delivery: { projects_total: 1 },
      memory_paths: { profile: "clients/pizzeria-aurora/CLIENT.md" },
    });
    expect(JSON.stringify(body)).not.toContain(dir);
  });

  it("generates client account plans for the ElectronJS clients page", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    await fetch(`${server.url}/coordinator/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Pizzeria Aurora",
        message: "Ho parlato con una pizzeria: vuole sito con prenotazioni.",
        expectedValue: 4500,
        expectedMargin: 40,
      }),
    });

    const generated = await fetch(`${server.url}/client-account-plans/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientSlug: "pizzeria-aurora" }),
    });

    expect(generated.status).toBe(201);
    const result = (await generated.json()) as {
      plans: Array<{ type: string; client_name: string; value_score: number }>;
    };
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]).toMatchObject({
      type: "client-account-plan",
      client_name: "Pizzeria Aurora",
    });

    const listed = await fetch(`${server.url}/client-account-plans`);
    expect(listed.status).toBe(200);
    const plans = (await listed.json()) as Array<{ id: string; type: string }>;
    expect(plans).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "client-account-plan" })]),
    );

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("client.account_plan.generated");
  });

  it("generates client success reports and scans memory follow-ups through the local API", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    await fetch(`${server.url}/coordinator/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Pizzeria Aurora",
        message: "Ho parlato con una pizzeria: vuole sito con prenotazioni.",
        expectedValue: 4500,
        expectedMargin: 40,
      }),
    });
    const clientPath = join(
      workspacePaths(dir).clientsDir,
      "pizzeria-aurora",
      "CLIENT.md",
    );
    const clientDoc = await readFile(clientPath, "utf8");
    await writeFile(
      clientPath,
      clientDoc.replace(/^next_follow_up_at:.*$/m, "next_follow_up_at: 2026-05-24T09:00:00.000Z"),
      "utf8",
    );

    const generated = await fetch(`${server.url}/client-success-status/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientSlug: "pizzeria-aurora" }),
    });

    expect(generated.status).toBe(201);
    const result = (await generated.json()) as {
      reports: Array<{ type: string; client_name: string; follow_up_due: boolean }>;
    };
    expect(result.reports).toEqual([
      expect.objectContaining({
        type: "client-success-status-report",
        client_name: "Pizzeria Aurora",
        follow_up_due: true,
      }),
    ]);

    const scan = await fetch(`${server.url}/autonomy/memory-triggers/scan`, {
      method: "POST",
    });
    expect(scan.status).toBe(201);
    const scanResult = (await scan.json()) as {
      triggered: Array<{ kind: string; artifactIds: string[] }>;
    };
    expect(scanResult.triggered).toHaveLength(1);
    expect(scanResult.triggered[0]).toMatchObject({ kind: "client_follow_up_due" });
    expect(scanResult.triggered[0]!.artifactIds.length).toBeGreaterThan(0);

    const listed = await fetch(`${server.url}/client-success-status-reports`);
    expect(listed.status).toBe(200);
    const reports = (await listed.json()) as Array<{ type: string }>;
    expect(reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "client-success-status-report" }),
      ]),
    );

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("client.success_status.generated");
    expect(audit).toContain("memory.trigger.run_started");
  });

  it("generates project health and growth reviews for the ElectronJS operating room", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    await fetch(`${server.url}/coordinator/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Pizzeria Aurora",
        message: "Ho parlato con una pizzeria: vuole sito con prenotazioni.",
        expectedValue: 4500,
        expectedMargin: 40,
      }),
    });

    const health = await fetch(`${server.url}/project-health/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectSlug: "pizzeria-aurora-booking-website" }),
    });
    expect(health.status).toBe(201);
    const healthBody = (await health.json()) as {
      report: { type: string };
      projects: Array<{ risk: string }>;
    };
    expect(healthBody.report.type).toBe("project-health-report");
    expect(healthBody.projects).toHaveLength(1);

    const growth = await fetch(`${server.url}/growth/review/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recentDays: 14 }),
    });
    expect(growth.status).toBe(201);
    const growthBody = (await growth.json()) as {
      report: { type: string };
      pipeline_value: number;
    };
    expect(growthBody.report.type).toBe("growth-review");
    expect(growthBody.pipeline_value).toBe(4500);

    const reports = (await (await fetch(`${server.url}/project-health-reports`)).json()) as Array<{
      type: string;
    }>;
    expect(reports).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "project-health-report" })]),
    );
    const reviews = (await (await fetch(`${server.url}/growth/reviews`)).json()) as Array<{
      type: string;
    }>;
    expect(reviews).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "growth-review" })]),
    );
  });

  it("generates draft-only growth content through the local API", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    const memory = await fetch(`${server.url}/growth/memory`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        brand: "BureauOS is the AI operating room for owner-led software companies.",
        offers: "AAAS setup and autonomous delivery operations.",
        channels: "X, LinkedIn, GitHub.",
      }),
    });
    expect(memory.status).toBe(201);

    await fetch(`${server.url}/coordinator/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Nebula Studios",
        expectedValue: 12000,
        message: "Nebula Studios wants a BureauOS AAAS launch package.",
      }),
    });

    const response = await fetch(`${server.url}/growth/content-pipeline/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxDrafts: 2, focus: "AAAS launch" }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      memory_ready: boolean;
      drafts: Array<{ kind: string; artifact: { type: string } }>;
      report: { type: string; draft_count: number };
    };
    expect(body.memory_ready).toBe(true);
    expect(body.report).toMatchObject({
      type: "content-pipeline-report",
      draft_count: 2,
    });
    expect(body.drafts.map((draft) => draft.kind)).toEqual(["social", "campaign"]);

    const reports = (await (await fetch(`${server.url}/growth/content-pipeline`)).json()) as Array<{
      type: string;
      draft_count: number;
    }>;
    expect(reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "content-pipeline-report", draft_count: 2 }),
      ]),
    );

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("growth.content_pipeline.generated");
  });

  it("generates revenue pipeline artifacts through the local API", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    await fetch(`${server.url}/coordinator/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Nebula Studios",
        expectedValue: 12000,
        expectedMargin: 55,
        message: "Nebula Studios wants a BureauOS AAAS launch package.",
      }),
    });

    const response = await fetch(`${server.url}/revenue/pipeline/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxOpportunities: 3 }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      report: { type: string; proposal_ready_count: number };
      items: Array<{ stage: string; artifacts: Array<{ type: string }> }>;
    };
    expect(body.report).toMatchObject({
      type: "revenue-pipeline-report",
      proposal_ready_count: 1,
    });
    expect(body.items[0]?.stage).toBe("proposal_ready");
    expect(body.items[0]?.artifacts.map((artifact) => artifact.type)).toEqual([
      "lead-qualification-report",
      "pricing-brief",
      "proposal-brief",
    ]);

    const reports = (await (await fetch(`${server.url}/revenue/pipeline`)).json()) as Array<{
      type: string;
      proposal_ready_count: number;
    }>;
    expect(reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "revenue-pipeline-report", proposal_ready_count: 1 }),
      ]),
    );

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("revenue.pipeline.generated");
  });

  it("persists coordinator message history for the ElectronJS chat", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    const empty = await fetch(`${server.url}/coordinator/messages`);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);

    await fetch(`${server.url}/coordinator/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Pizzeria Aurora",
        message: "Ho parlato con Pizzeria Aurora: vuole un sito con prenotazioni.",
        attachments: [
          {
            name: "logo.png",
            type: "image/png",
            size: 5,
            dataUrl: "data:image/png;base64,aGVsbG8=",
          },
        ],
      }),
    });

    const response = await fetch(`${server.url}/coordinator/messages`);
    expect(response.status).toBe(200);
    const messages = (await response.json()) as Array<{
      role: string;
      text: string;
      attachments?: Array<{ name: string; type: string; size: number }>;
      result?: { project: { slug: string } };
    }>;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: "owner",
      text: "Ho parlato con Pizzeria Aurora: vuole un sito con prenotazioni.",
      attachments: [{ name: "logo.png", type: "image/png", size: 5 }],
    });
    expect(messages[1]).toMatchObject({
      role: "coordinator",
      result: { project: { slug: "pizzeria-aurora-booking-website" } },
    });

    const rawHistory = await readFile(workspacePaths(dir).coordinatorMessages, "utf8");
    expect(rawHistory).toContain("pizzeria-aurora-booking-website");
  });

  it("answers general coordinator chat messages from memory without creating an intake", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    const response = await fetch(`${server.url}/coordinator/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Che clienti abbiamo attivi oggi?" }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      mode: string;
      ownerMessage: { role: string; text: string };
      coordinatorMessage: { role: string; text: string; meta?: Record<string, unknown> };
      provider: { status: string };
      memory: { hits: unknown[] };
    };
    expect(body.mode).toBe("answer");
    expect(body.ownerMessage).toMatchObject({
      role: "owner",
      text: "Che clienti abbiamo attivi oggi?",
    });
    expect(body.coordinatorMessage.role).toBe("coordinator");
    expect(body.coordinatorMessage.text).toContain("memoria locale");
    expect(body.provider.status).toBe("unavailable");

    const clients = await fetch(`${server.url}/clients`);
    expect(await clients.json()).toEqual([]);

    const messages = (await (await fetch(`${server.url}/coordinator/messages`)).json()) as Array<{
      role: string;
    }>;
    expect(messages.map((message) => message.role)).toEqual(["owner", "coordinator"]);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("memory.global.search");
  });

  it("does not answer low-context coordinator chat from historical client context", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    await fetch(`${server.url}/coordinator/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Ho parlato con Pizzeria Aurora: vuole un sito con prenotazioni.",
      }),
    });

    const response = await fetch(`${server.url}/coordinator/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Ciao" }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      mode: string;
      coordinatorMessage: { text: string };
      provider: { status: string; reason?: string };
    };
    expect(body.mode).toBe("answer");
    expect(body.provider).toMatchObject({
      status: "unavailable",
      reason: "low_context_current_message",
    });
    expect(body.coordinatorMessage.text.toLowerCase()).not.toContain("pizzeria");
    expect(body.coordinatorMessage.text.toLowerCase()).not.toContain("prenotazioni");

    const clients = (await (await fetch(`${server.url}/clients`)).json()) as Array<{
      slug: string;
    }>;
    expect(clients.map((client) => client.slug)).toEqual(["pizzeria-aurora"]);
  });

  it("exposes audited global coordinator memory without leaking absolute paths", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    await fetch(`${server.url}/coordinator/intake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientName: "Pizzeria Aurora",
        message: "Ho parlato con una pizzeria: vuole sito con prenotazioni.",
      }),
    });

    const response = await fetch(`${server.url}/coordinator/memory?query=Pizzeria%20Aurora`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      topHits: Array<{ path: string; snippet: string; score: number }>;
      audit: { action: string; actor: string; capability: string };
    };
    expect(body.audit).toMatchObject({
      action: "memory.global.search",
      actor: "supreme_coordinator",
      capability: "global_memory_search",
    });
    expect(body.topHits.some((hit) => hit.path.startsWith("clients/pizzeria-aurora/"))).toBe(true);
    expect(JSON.stringify(body)).not.toContain(dir);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("memory.global.search");
  });

  it("routes opportunity-like coordinator chat messages into intake", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    const response = await fetch(`${server.url}/coordinator/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Ho parlato con Pizzeria Aurora: vuole un sito con prenotazioni.",
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      mode: string;
      result: { project: { slug: string } };
      coordinatorMessage: { result?: { project: { slug: string } } };
    };
    expect(body.mode).toBe("intake");
    expect(body.result.project.slug).toBe("pizzeria-aurora-booking-website");
    expect(body.coordinatorMessage.result?.project.slug).toBe("pizzeria-aurora-booking-website");

    const clients = (await (await fetch(`${server.url}/clients`)).json()) as Array<{
      slug: string;
    }>;
    expect(clients.map((client) => client.slug)).toEqual(["pizzeria-aurora"]);
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
      expect.arrayContaining([
        "executive-report",
        "cross-project-executive-report",
        "business-operating-report",
      ]),
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

  it("creates GitHub pull requests through the configured API GitHub client", async () => {
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

    const response = await fetch(`${server.url}/github/create-pr`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectSlug: "pizzeria-aurora-booking-website",
        owner: "emanueledenaro",
        repo: "pizzeria-aurora",
        title: "Implement booking website",
        head: "feature/booking-website",
        base: "main",
        draft: true,
        linkedIssueNumbers: [12],
        testEvidence: ["npm test -- booking passed"],
      }),
    });

    expect(response.status).toBe(201);
    const result = (await response.json()) as {
      status: string;
      pull_request: { number: number; title: string; url: string };
      report: { type: string };
    };
    expect(result.status).toBe("created");
    expect(result.pull_request).toMatchObject({
      number: 1,
      title: "Implement booking website",
    });
    expect(result.report.type).toBe("github-pr-publish-report");
    expect(githubClient.createdPullRequests).toHaveLength(1);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.pr_publish.created");
  });

  it("provisions GitHub repositories through the configured API GitHub client", async () => {
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

    const response = await fetch(`${server.url}/github/provision-repository`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectSlug: "pizzeria-aurora-booking-website",
        owner: "emanueledenaro",
        repo: "pizzeria-aurora",
        private: true,
        autoInit: true,
      }),
    });

    expect(response.status).toBe(201);
    const result = (await response.json()) as {
      status: string;
      repository: { url: string; private: boolean };
      report: { type: string };
    };
    expect(result.status).toBe("created");
    expect(result.repository).toMatchObject({
      url: "https://github.com/emanueledenaro/pizzeria-aurora",
      private: true,
    });
    expect(result.report.type).toBe("repository-provisioning-report");
    expect(githubClient.createdRepositories).toHaveLength(1);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("github.repository_provision.created");
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
      ownership: { manager_agent_id: string; project_id: string };
    };
    expect(body.packet.type).toBe("project-dispatch-packet");
    expect(body.handoffs).toHaveLength(6);
    expect(body.pipeline).toEqual(["product", "ux", "development", "qa", "security", "reviewer"]);
    expect(body.ownership.manager_agent_id).toBe("project_manager");

    const ownership = await fetch(`${server.url}/project-ownership`);
    expect(ownership.status).toBe(200);
    const ownershipBody = (await ownership.json()) as Array<{
      manager_agent_id: string;
      assigned_agents: string[];
    }>;
    expect(ownershipBody[0]).toMatchObject({
      manager_agent_id: "project_manager",
    });
    expect(ownershipBody[0]?.assigned_agents).toEqual(
      expect.arrayContaining(["development", "qa"]),
    );

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
        defaultModel: "gpt-5.5",
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
        defaultModel: "gpt-5.3-codex",
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

  it("exposes OpenCode-style provider auth methods", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    const response = await fetch(`${server.url}/provider/auth`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, Array<{ type: string; label: string }>>;
    expect(body["openai-codex"]).toEqual([{ type: "oauth", label: "ChatGPT Plus/Pro (browser)" }]);
    expect(body["openai"]).toEqual([{ type: "api", label: "API key" }]);
    expect(body["local"]).toEqual([{ type: "local", label: "Local endpoint" }]);
  });

  it("exposes provider connector metadata for the desktop settings view", async () => {
    const config = defaultConfig("agency");
    config.provider.openai = {
      name: "OpenAI Enterprise",
      env: ["OPENAI_ENTERPRISE_KEY"],
      options: { defaultModel: "gpt-5-enterprise" },
      models: {
        "gpt-5-enterprise": { name: "GPT-5 Enterprise" },
      },
    };
    config.disabled_providers = ["openrouter"];
    server = await startApiServer({ workspaceRoot: dir, config });

    const response = await fetch(`${server.url}/provider/connectors`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<{
      id: string;
      name: string;
      source: string;
      defaultModel: string;
      noApiFallback: boolean;
      authMethods: Array<{ type: string; label: string }>;
    }>;
    const codex = body.find((item) => item.id === "openai-codex");
    expect(codex).toMatchObject({
      name: "OpenAI Codex",
      noApiFallback: true,
      authMethods: [{ type: "oauth", label: "ChatGPT Plus/Pro (browser)" }],
    });
    const openai = body.find((item) => item.id === "openai");
    expect(openai).toMatchObject({
      name: "OpenAI Enterprise",
      source: "config",
      defaultModel: "gpt-5-enterprise",
    });
    expect(body.find((item) => item.id === "openrouter")).toBeUndefined();
  });

  it("exposes model choices for a provider from connector config", async () => {
    const config = defaultConfig("agency");
    config.provider.openai = {
      name: "OpenAI Enterprise",
      options: { defaultModel: "gpt-5-enterprise" },
      models: {
        "gpt-5-enterprise": { name: "GPT-5 Enterprise" },
      },
    };
    server = await startApiServer({ workspaceRoot: dir, config });

    const response = await fetch(`${server.url}/provider/models?provider=openai`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      provider: string;
      source: string;
      defaultModel: string;
      models: Array<{
        id: string;
        name: string;
        capabilities: string[];
        budgetTier: string;
      }>;
    };
    expect(body).toMatchObject({
      provider: "openai",
      source: "connector",
      defaultModel: "gpt-5-enterprise",
    });
    expect(body.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "gpt-5-enterprise", name: "GPT-5 Enterprise" }),
      ]),
    );
  });

  it("exposes model choices from a connected provider when available", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    await fetch(`${server.url}/providers/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "openai",
        apiKey: "sk-test-provider-secret",
        defaultModel: "gpt-4o",
      }),
    });
    const response = await fetch(`${server.url}/provider/models?provider=openai`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      source: string;
      defaultModel: string;
      models: Array<{ id: string; capabilities: string[]; budgetTier: string }>;
    };
    expect(body.source).toBe("connection");
    expect(body.defaultModel).toBe("gpt-4o");
    expect(body.models.map((model) => model.id)).toEqual(
      expect.arrayContaining(["gpt-5.5", "gpt-4o"]),
    );
  });

  it("exposes configured capability boundaries", async () => {
    const config = defaultConfig("agency");
    config.capabilities.codex = {
      type: "runtime",
      allowed_agents: ["development"],
      actions: { edit_code: true, deploy: false },
      required_approvals: ["linked_issue"],
      risk_class: "high",
      audit_required: true,
      status: "configured",
    };
    server = await startApiServer({ workspaceRoot: dir, config });

    const response = await fetch(`${server.url}/capabilities`);

    expect(response.status).toBe(200);
    const body = (await response.json()) as Array<{
      id: string;
      allowed_agents: string[];
      actions: Record<string, boolean>;
      required_approvals: string[];
    }>;
    const codex = body.find((item) => item.id === "codex");
    expect(codex).toMatchObject({
      allowed_agents: ["development"],
      actions: { edit_code: true, deploy: false },
      required_approvals: ["linked_issue"],
    });
  });

  it("audits capability use checks through the API", async () => {
    server = await startApiServer({ workspaceRoot: dir, config: defaultConfig("agency") });

    const response = await fetch(`${server.url}/capabilities/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent: "development",
        capabilityId: "codex",
        action: "read_repo",
        target: "github.com/acme/web",
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      artifact: { type: string };
      policy: { action: string };
    };
    expect(body.status).toBe("allowed");
    expect(body.artifact.type).toBe("capability-audit");
    expect(body.policy.action).toBe("observe_signals");
  });

  it("connects OpenAI Codex with the browser OAuth callback flow", async () => {
    const oauthFetch = (async () =>
      jsonResponse({
        access_token: "browser-oauth-access-token",
        refresh_token: "browser-oauth-refresh-token",
        expires_in: 3600,
      })) as OpenAICodexOAuthFetch;

    server = await startApiServer({
      workspaceRoot: dir,
      config: defaultConfig("agency"),
      openaiCodexOAuthFetch: oauthFetch,
      openaiCodexOAuthCallbackPort: 0,
    });

    const authorize = await fetch(`${server.url}/provider/openai-codex/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: 0 }),
    });
    expect(authorize.status, await authorize.clone().text()).toBe(201);
    const authorization = (await authorize.json()) as { url: string; method: string };
    expect(authorization.method).toBe("auto");

    const authUrl = new URL(authorization.url);
    const callbackUrl = new URL(authUrl.searchParams.get("redirect_uri")!);
    callbackUrl.searchParams.set("code", "oauth-browser-code");
    callbackUrl.searchParams.set("state", authUrl.searchParams.get("state")!);
    const callbackHit = await fetch(callbackUrl);
    expect(callbackHit.status).toBe(200);

    const complete = await fetch(`${server.url}/provider/openai-codex/oauth/callback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: 0, defaultModel: "gpt-5.3-codex" }),
    });
    expect(complete.status).toBe(201);
    const body = (await complete.json()) as {
      status: string;
      providers: Array<{
        provider: string;
        auth_mode: string;
        oauth_token_masked: string;
        no_api_fallback: boolean;
      }>;
    };
    const codex = body.providers.find((item) => item.provider === "openai-codex");
    expect(body.status).toBe("connected");
    expect(codex?.auth_mode).toBe("oauth");
    expect(codex?.oauth_token_masked).toBe("brow...oken");
    expect(codex?.no_api_fallback).toBe(true);
    expect(JSON.stringify(body)).not.toContain("browser-oauth-access-token");
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
