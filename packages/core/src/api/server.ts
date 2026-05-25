import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat, open } from "node:fs/promises";
import { URL } from "node:url";
import { createHmac, timingSafeEqual } from "node:crypto";
import { CapabilityRegistry } from "@bureauos/capabilities";
import type { BureauConfig } from "../config/schema.js";
import { workspacePaths } from "../paths.js";
import { ClientRegistry } from "../registries/client.js";
import { ProjectRegistry } from "../registries/project.js";
import { OpportunityRegistry } from "../registries/opportunity.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { ArtifactStore } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { PolicyEngine } from "../policy/engine.js";
import { RunEngine } from "../runs/engine.js";
import { AGENT_ROLES } from "../agents/roles.js";
import {
  CoordinatorIntakeService,
  type CoordinatorAttachmentInput,
} from "../coordinator/intake.js";
import { CoordinatorChatService } from "../coordinator/chat.js";
import { CoordinatorMessageStore } from "../coordinator/messages.js";
import { CoordinatorGlobalMemoryService } from "../memory/global.js";
import { ProjectDispatchService } from "../dispatch/project-dispatch.js";
import { GitHubIssueDraftService } from "../github/issue-drafts.js";
import {
  GitHubIssuePublishService,
  type GitHubIssuePublishClient,
} from "../github/issue-publisher.js";
import { BusinessReportService } from "../reports/business.js";
import { GitHubWebhookIngestionService } from "../github/webhook-ingestion.js";
import { GitHubSignalTriggerService } from "../github/signal-triggers.js";
import {
  ProviderAuthStore,
  buildConfiguredProviderRouter,
  listProviderConnectors,
  type OpenAICodexOAuthFetch,
  type ProviderCatalogConfig,
  type ProviderConnection,
  type ProviderType,
} from "@bureauos/providers";
import {
  authorizeOpenAICodexOAuth,
  completeOpenAICodexOAuth,
  providerAuthMethods,
} from "../providers/openai-codex-oauth-session.js";

/**
 * Local HTTP API server.
 *
 * Endpoints expose kernel state for the Owner Interface (Phase 4). Read-only
 * for the first cut except for the approval resolve endpoints. CORS is open
 * for `http://localhost:*` so the Electron renderer can hit it during dev.
 */

export interface ApiServerOptions {
  workspaceRoot: string;
  config: BureauConfig;
  port?: number;
  token?: string;
  githubClient?: GitHubIssuePublishClient;
  githubWebhookSecret?: string;
  openaiCodexOAuthFetch?: OpenAICodexOAuthFetch;
  openaiCodexOAuthCallbackPort?: number;
}

export interface ApiServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

interface RouteContext {
  url: URL;
  method: string;
  req: IncomingMessage;
  res: ServerResponse;
  options: ApiServerOptions;
}

type RouteHandler = (ctx: RouteContext) => Promise<void> | void;

type ProviderStatus = ProviderConnection & {
  status: "ok" | "missing";
  reason?: string;
};

interface ProviderModelList {
  provider: ProviderType;
  source: "connector" | "connection";
  defaultModel: string;
  models: Array<{ id: string; name: string }>;
}

interface SettingsSummary {
  config_path: string;
  organization: BureauConfig["organization"];
  setup: BureauConfig["setup"];
  interface: BureauConfig["interface"];
  supreme_coordinator: BureauConfig["supreme_coordinator"];
  autonomy: BureauConfig["autonomy"];
  growth_autonomy: BureauConfig["growth_autonomy"];
  memory: BureauConfig["memory"];
  limits: BureauConfig["limits"];
  github: BureauConfig["github"];
  triggers: BureauConfig["triggers"];
  agents: {
    configured: number;
    roles: number;
  };
  capabilities: {
    configured: number;
    catalog: number;
  };
  providers: {
    connectors: number;
    configured_overrides: string[];
    enabled: string[];
    disabled: string[];
  };
}

const PROVIDER_TYPES: ReadonlySet<ProviderType> = new Set([
  "openai-codex",
  "openai",
  "anthropic",
  "google",
  "local",
  "openrouter",
  "custom",
]);

function ok(res: ServerResponse, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.end(JSON.stringify(payload));
}

function notFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: "not found" }));
}

function unauthorized(res: ServerResponse): void {
  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: "unauthorized" }));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readRaw(req);
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

async function readRaw(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function headerString(req: IncomingMessage, name: string): string {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function verifyGitHubSignature(secret: string, raw: string, signature: string): boolean {
  if (!signature.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function deps(options: ApiServerOptions) {
  const approvals = new ApprovalRegistry(options.workspaceRoot);
  const policy = new PolicyEngine(options.config, approvals);
  const audit = new AuditLog(workspacePaths(options.workspaceRoot).auditLog);
  const artifacts = new ArtifactStore(options.workspaceRoot);
  return {
    clients: new ClientRegistry(options.workspaceRoot),
    projects: new ProjectRegistry(options.workspaceRoot),
    opportunities: new OpportunityRegistry(options.workspaceRoot),
    approvals,
    audit,
    artifacts,
    policy,
    runs: new RunEngine(options.workspaceRoot, { audit, artifacts, policy }),
  };
}

function parseProvider(value: unknown): ProviderType | undefined {
  if (typeof value !== "string") return undefined;
  return PROVIDER_TYPES.has(value as ProviderType) ? (value as ProviderType) : undefined;
}

function defaultProviderId(provider: ProviderType): string {
  return `${provider}-default`;
}

function parseAttachments(value: unknown): CoordinatorAttachmentInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): CoordinatorAttachmentInput[] => {
    if (!item || typeof item !== "object") return [];
    const source = item as Record<string, unknown>;
    const name = source["name"];
    if (typeof name !== "string" || !name.trim()) return [];
    return [
      {
        name,
        ...(typeof source["type"] === "string" ? { type: source["type"] } : {}),
        ...(typeof source["size"] === "number" ? { size: source["size"] } : {}),
        ...(typeof source["text"] === "string" ? { text: source["text"] } : {}),
        ...(typeof source["dataUrl"] === "string" ? { dataUrl: source["dataUrl"] } : {}),
      },
    ];
  });
}

function attachmentMetadata(
  attachments: readonly CoordinatorAttachmentInput[],
): Array<{ name: string; type: string; size: number }> {
  return attachments.map((attachment) => ({
    name: attachment.name,
    type: attachment.type ?? "application/octet-stream",
    size: attachment.size ?? 0,
  }));
}

async function providerStatuses(
  workspaceRoot: string,
  config: ProviderCatalogConfig,
): Promise<ProviderStatus[]> {
  const { router, connections } = await buildConfiguredProviderRouter(
    workspaceRoot,
    process.env,
    config,
  );
  const validations = await router.validate();
  return connections.map((connection) => {
    const validation = validations.get(connection.id);
    return {
      ...connection,
      status: validation?.ok ? "ok" : "missing",
      ...(validation?.reason ? { reason: validation.reason } : {}),
    };
  });
}

async function providerModels(
  provider: ProviderType,
  workspaceRoot: string,
  config: ProviderCatalogConfig,
): Promise<ProviderModelList> {
  const connector = listProviderConnectors(config).find((item) => item.id === provider);
  if (!connector) throw new Error(`unknown provider connector: ${provider}`);

  const fallbackModels = connector.models.map((model) => ({ ...model }));
  const fallback = {
    provider,
    source: "connector" as const,
    defaultModel: connector.defaultModel,
    models: fallbackModels,
  };

  const { router, connections } = await buildConfiguredProviderRouter(
    workspaceRoot,
    process.env,
    config,
  );
  const connection = connections.find((item) => item.provider === provider);
  if (!connection) return fallback;

  const adapter = router.get(connection.id);
  if (!adapter) return fallback;

  const ids = await adapter.listModels();
  const models = ids.map((id) => {
    const configured = fallbackModels.find((model) => model.id === id);
    return { id, name: configured?.name ?? id };
  });
  return {
    provider,
    source: "connection",
    defaultModel: connection.default_model || adapter.defaultModel || connector.defaultModel,
    models: models.length > 0 ? models : fallbackModels,
  };
}

function settingsSummary(options: ApiServerOptions): SettingsSummary {
  const connectors = listProviderConnectors(options.config);
  const capabilities = CapabilityRegistry.fromConfig(options.config.capabilities).list();
  return {
    config_path: workspacePaths(options.workspaceRoot).configFile,
    organization: options.config.organization,
    setup: options.config.setup,
    interface: options.config.interface,
    supreme_coordinator: options.config.supreme_coordinator,
    autonomy: options.config.autonomy,
    growth_autonomy: options.config.growth_autonomy,
    memory: options.config.memory,
    limits: options.config.limits,
    github: options.config.github,
    triggers: options.config.triggers,
    agents: {
      configured: Object.keys(options.config.agents).length,
      roles: AGENT_ROLES.length,
    },
    capabilities: {
      configured: Object.keys(options.config.capabilities).length,
      catalog: capabilities.length,
    },
    providers: {
      connectors: connectors.length,
      configured_overrides: Object.keys(options.config.provider ?? {}),
      enabled: connectors.map((connector) => connector.id),
      disabled: options.config.disabled_providers,
    },
  };
}

const ROUTES: Record<string, RouteHandler> = {
  "GET /health": ({ res }) => ok(res, { ok: true }),

  "GET /settings": ({ res, options }) => {
    ok(res, settingsSummary(options));
  },

  "GET /company-pulse": async ({ res, options }) => {
    const d = deps(options);
    const [clients, projects, opportunities, approvals, runs] = await Promise.all([
      d.clients.list(),
      d.projects.list(),
      d.opportunities.list(),
      d.approvals.listPending(),
      d.runs.list(),
    ]);
    const pipelineValue = opportunities.reduce((acc, o) => acc + (o.expected_value || 0), 0);
    ok(res, {
      organization: options.config.organization.name,
      preset: options.config.setup.preset,
      mode: options.config.setup.mode,
      counts: {
        clients: clients.length,
        projects: projects.length,
        opportunities: opportunities.length,
        approvals_pending: approvals.length,
        runs: runs.length,
      },
      revenue: {
        pipeline_value: pipelineValue,
        active_opportunities: opportunities.filter((o) => o.status !== "won" && o.status !== "lost")
          .length,
      },
    });
  },

  "GET /clients": async ({ res, options }) => ok(res, await deps(options).clients.list()),
  "GET /projects": async ({ res, options }) => ok(res, await deps(options).projects.list()),
  "GET /project-ownership": async ({ res, options }) =>
    ok(res, await deps(options).projects.listOwnership()),
  "GET /opportunities": async ({ res, options }) =>
    ok(res, await deps(options).opportunities.list()),
  "GET /approvals": async ({ res, options }) =>
    ok(res, await deps(options).approvals.listPending()),
  "GET /approvals/resolved": async ({ res, options }) =>
    ok(res, await deps(options).approvals.listResolved()),
  "GET /runs": async ({ res, options }) => ok(res, await deps(options).runs.list()),
  "GET /artifacts": async ({ res, options }) => ok(res, await deps(options).artifacts.list()),
  "GET /agents": ({ res }) => ok(res, AGENT_ROLES),

  "GET /capabilities": ({ res, options }) => {
    ok(res, CapabilityRegistry.fromConfig(options.config.capabilities).list());
  },

  "GET /coordinator/messages": async ({ res, options, url }) => {
    const requestedLimit = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200)
      : 50;
    ok(res, await new CoordinatorMessageStore(options.workspaceRoot).list(limit));
  },

  "GET /coordinator/memory": async ({ res, options, url }) => {
    const query = url.searchParams.get("query") ?? "";
    const requestedLimit = Number(url.searchParams.get("limit") ?? "12");
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 50)
      : 12;
    ok(
      res,
      await new CoordinatorGlobalMemoryService(options.workspaceRoot).assemble({
        query,
        limit,
        source: "api",
      }),
    );
  },

  "POST /coordinator/messages": async ({ res, options, req }) => {
    const body = (await readJson(req)) as {
      message?: string;
      source?: string;
      attachments?: unknown;
    };
    if (!body.message || !body.message.trim()) {
      ok(res, { error: "message required" }, 400);
      return;
    }
    const service = new CoordinatorChatService(options.workspaceRoot, {
      config: options.config,
    });
    ok(
      res,
      await service.process({
        message: body.message,
        source: body.source ?? "electron",
        attachments: parseAttachments(body.attachments),
      }),
      201,
    );
  },

  "GET /providers": async ({ res, options }) => {
    ok(res, await providerStatuses(options.workspaceRoot, options.config));
  },

  "GET /provider/connectors": ({ res, options }) => {
    ok(res, listProviderConnectors(options.config));
  },

  "GET /provider/models": async ({ res, options, url }) => {
    const provider = parseProvider(url.searchParams.get("provider"));
    if (!provider) {
      ok(res, { error: "provider required" }, 400);
      return;
    }
    ok(res, await providerModels(provider, options.workspaceRoot, options.config));
  },

  "GET /provider/auth": ({ res, options }) => {
    ok(res, providerAuthMethods(options.config));
  },

  "POST /provider/openai-codex/oauth/authorize": async ({ res, options }) => {
    ok(
      res,
      await authorizeOpenAICodexOAuth({
        callbackPort: options.openaiCodexOAuthCallbackPort,
      }),
      201,
    );
  },

  "POST /provider/openai-codex/oauth/callback": async ({ res, options, req }) => {
    const payload = (await readJson(req)) as {
      method?: number;
      code?: string;
      defaultModel?: string;
    };
    const result = await completeOpenAICodexOAuth({
      workspaceRoot: options.workspaceRoot,
      payload,
      fetch: options.openaiCodexOAuthFetch,
    });
    if (result.status === "pending") {
      ok(res, result, 202);
      return;
    }
    await deps(options).audit.append({
      actor: "owner",
      action: "provider.oauth.connected",
      target: "openai-codex",
      result: "ok",
    });
    ok(
      res,
      { ...result, providers: await providerStatuses(options.workspaceRoot, options.config) },
      201,
    );
  },

  "POST /providers/auth/login": async ({ res, options, req }) => {
    const body = (await readJson(req)) as {
      provider?: string;
      id?: string;
      mode?: "oauth" | "api-key" | "local";
      apiKey?: string;
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: string;
      baseUrl?: string;
      defaultModel?: string;
    };
    const provider = parseProvider(body.provider);
    if (!provider) {
      ok(res, { error: "provider required" }, 400);
      return;
    }
    const d = deps(options);
    const record = await ProviderAuthStore.forWorkspace(options.workspaceRoot).upsert({
      provider,
      ...(body.id ? { id: body.id } : {}),
      ...(body.mode ? { mode: body.mode } : {}),
      ...(body.apiKey ? { apiKey: body.apiKey } : {}),
      ...(body.accessToken ? { accessToken: body.accessToken } : {}),
      ...(body.refreshToken ? { refreshToken: body.refreshToken } : {}),
      ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
      ...(body.baseUrl ? { baseUrl: body.baseUrl } : {}),
      ...(body.defaultModel ? { defaultModel: body.defaultModel } : {}),
    });
    await d.audit.append({
      actor: "owner",
      action: "provider.auth.login",
      target: `${provider}:${record.id}`,
      result: "ok",
    });
    ok(res, await providerStatuses(options.workspaceRoot, options.config), 201);
  },

  "POST /providers/auth/logout": async ({ res, options, req }) => {
    const body = (await readJson(req)) as {
      provider?: string;
      id?: string;
    };
    const provider = parseProvider(body.provider);
    if (!provider) {
      ok(res, { error: "provider required" }, 400);
      return;
    }
    const id = body.id || defaultProviderId(provider);
    const removed = await ProviderAuthStore.forWorkspace(options.workspaceRoot).remove(
      provider,
      id,
    );
    if (removed) {
      await deps(options).audit.append({
        actor: "owner",
        action: "provider.auth.logout",
        target: `${provider}:${id}`,
        result: "ok",
      });
    }
    ok(res, { removed, providers: await providerStatuses(options.workspaceRoot, options.config) });
  },

  "GET /reports": async ({ res, options }) => {
    const artifacts = await deps(options).artifacts.list();
    ok(
      res,
      artifacts.filter((artifact) => {
        return (
          artifact.type === "executive-report" ||
          artifact.type === "cross-project-executive-report" ||
          artifact.type === "business-operating-report" ||
          artifact.type === "client-account-plan"
        );
      }),
    );
  },

  "POST /reports/generate": async ({ res, options }) => {
    const result = await new BusinessReportService(options.workspaceRoot, {
      config: options.config,
    }).generate();
    ok(res, result, 201);
  },

  "POST /github/issue-drafts": async ({ res, options, req }) => {
    const body = (await readJson(req)) as {
      projectSlug?: string;
    };
    if (!body.projectSlug || !body.projectSlug.trim()) {
      ok(res, { error: "projectSlug required" }, 400);
      return;
    }
    const result = await new GitHubIssueDraftService(options.workspaceRoot).draftForProject(
      body.projectSlug,
    );
    ok(res, result, 201);
  },

  "POST /github/create-issues": async ({ res, options, req }) => {
    const body = (await readJson(req)) as {
      projectSlug?: string;
      owner?: string;
      repo?: string;
      draftArtifactIds?: string[];
      ensureLabels?: boolean;
    };
    if (!body.projectSlug || !body.owner || !body.repo) {
      ok(res, { error: "projectSlug, owner, and repo required" }, 400);
      return;
    }
    if (!options.githubClient) {
      ok(res, { error: "GitHub client not configured" }, 400);
      return;
    }
    const result = await new GitHubIssuePublishService(options.workspaceRoot, {
      config: options.config,
      githubClient: options.githubClient,
    }).publishProjectDrafts({
      projectSlug: body.projectSlug,
      owner: body.owner,
      repo: body.repo,
      ...(Array.isArray(body.draftArtifactIds) ? { draftArtifactIds: body.draftArtifactIds } : {}),
      ...(typeof body.ensureLabels === "boolean" ? { ensureLabels: body.ensureLabels } : {}),
    });
    ok(res, result, result.status === "created" ? 201 : 202);
  },

  "POST /github/webhook": async ({ res, options, req, url }) => {
    const raw = await readRaw(req);
    const signature = headerString(req, "x-hub-signature-256");
    if (
      options.githubWebhookSecret &&
      !verifyGitHubSignature(options.githubWebhookSecret, raw, signature)
    ) {
      unauthorized(res);
      return;
    }
    const event = headerString(req, "x-github-event");
    if (!event) {
      ok(res, { error: "x-github-event header required" }, 400);
      return;
    }
    const payload = raw ? (JSON.parse(raw) as unknown) : {};
    const result = await new GitHubWebhookIngestionService(options.workspaceRoot).ingest({
      event,
      payload,
      ...(headerString(req, "x-github-delivery")
        ? { deliveryId: headerString(req, "x-github-delivery") }
        : {}),
      ...(url.searchParams.get("client") ? { clientSlug: url.searchParams.get("client")! } : {}),
      source: "api",
    });
    const d = deps(options);
    const triggers = await new GitHubSignalTriggerService({
      runs: d.runs,
      audit: d.audit,
      policy: d.policy,
      workspaceRoot: options.workspaceRoot,
      coordinator: {
        audit: d.audit,
        artifacts: d.artifacts,
        policy: d.policy,
      },
    }).trigger({
      repository: result.repository,
      report: result.report,
      failingChecks: result.failingChecks,
      staleIssues: [],
      stalePullRequests: [],
    });
    ok(res, { ...result, triggers }, 202);
  },

  "POST /coordinator/intake": async ({ res, options, req }) => {
    const body = (await readJson(req)) as {
      message?: string;
      source?: string;
      clientName?: string;
      projectName?: string;
      industry?: string;
      expectedValue?: number;
      expectedMargin?: number;
      attachments?: unknown;
    };
    if (!body.message || !body.message.trim()) {
      ok(res, { error: "message required" }, 400);
      return;
    }
    const attachments = parseAttachments(body.attachments);
    const service = new CoordinatorIntakeService(options.workspaceRoot, {
      config: options.config,
    });
    const result = await service.process({
      message: body.message,
      source: body.source ?? "electron",
      ...(body.clientName ? { clientName: body.clientName } : {}),
      ...(body.projectName ? { projectName: body.projectName } : {}),
      ...(body.industry ? { industry: body.industry } : {}),
      ...(typeof body.expectedValue === "number" ? { expectedValue: body.expectedValue } : {}),
      ...(typeof body.expectedMargin === "number" ? { expectedMargin: body.expectedMargin } : {}),
      attachments,
    });
    await new CoordinatorMessageStore(options.workspaceRoot).appendMany([
      {
        role: "owner",
        text: body.message,
        attachments: attachmentMetadata(attachments),
      },
      {
        role: "coordinator",
        text: result.summary,
        result,
      },
    ]);
    ok(res, result, 201);
  },

  "POST /projects/dispatch": async ({ res, options, req }) => {
    const body = (await readJson(req)) as {
      projectSlug?: string;
      runType?: string;
      scope?: string;
      briefing?: string;
      source?: string;
    };
    if (!body.projectSlug || !body.projectSlug.trim()) {
      ok(res, { error: "projectSlug required" }, 400);
      return;
    }
    const service = new ProjectDispatchService(options.workspaceRoot, {
      config: options.config,
    });
    const result = await service.dispatch({
      projectSlug: body.projectSlug,
      ...(body.runType ? { runType: body.runType as never } : {}),
      ...(body.scope ? { scope: body.scope } : {}),
      ...(body.briefing ? { briefing: body.briefing } : {}),
      ...(body.source ? { source: body.source } : {}),
    });
    ok(res, result, 201);
  },

  "GET /audit": async ({ res, options, url }) => {
    const n = Number(url.searchParams.get("n") ?? "100");
    try {
      const content = await readFile(workspacePaths(options.workspaceRoot).auditLog, "utf8");
      const lines = content.trim().split("\n").filter(Boolean).slice(-n);
      ok(
        res,
        lines.map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return { raw: l };
          }
        }),
      );
    } catch {
      ok(res, []);
    }
  },

  "GET /events": async ({ res, options }) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.write("retry: 5000\n\n");

    const auditPath = workspacePaths(options.workspaceRoot).auditLog;
    let offset = 0;
    let buffer = "";
    try {
      const s = await stat(auditPath);
      offset = s.size;
    } catch {
      offset = 0;
    }

    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 25_000);
    const poll = setInterval(async () => {
      try {
        const s = await stat(auditPath);
        if (s.size <= offset) return;
        const fh = await open(auditPath, "r");
        try {
          const length = s.size - offset;
          const buf = Buffer.alloc(length);
          await fh.read(buf, 0, length, offset);
          offset = s.size;
          buffer += buf.toString("utf8");
        } finally {
          await fh.close();
        }
        let nl = buffer.indexOf("\n");
        while (nl >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf("\n");
          if (!line) continue;
          try {
            const parsed = JSON.parse(line);
            res.write(`event: audit\ndata: ${JSON.stringify(parsed)}\n\n`);
          } catch {
            res.write(`event: raw\ndata: ${JSON.stringify({ raw: line })}\n\n`);
          }
        }
      } catch {
        // Log file may not exist yet; ignore until the first event lands.
      }
    }, 1000);

    const teardown = () => {
      clearInterval(heartbeat);
      clearInterval(poll);
    };
    res.on("close", teardown);
    res.on("error", teardown);
  },

  "POST /approvals/resolve": async ({ res, options, req }) => {
    const body = (await readJson(req)) as {
      id?: string;
      status?: "approved" | "rejected";
      reason?: string;
    };
    if (!body.id || !body.status) {
      res.statusCode = 400;
      ok(res, { error: "id and status required" }, 400);
      return;
    }
    const d = deps(options);
    const updated = await d.approvals.resolve(body.id, body.status, "owner", body.reason ?? "");
    await d.audit.append({
      actor: "owner",
      action: `approval.${body.status}`,
      target: body.id,
      result: "ok",
    });
    ok(res, updated);
  },
};

function matchRoute(method: string, pathname: string): RouteHandler | undefined {
  return ROUTES[`${method} ${pathname}`];
}

export async function startApiServer(options: ApiServerOptions): Promise<ApiServer> {
  const server = createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://localhost:${options.port ?? 0}`);

      if (method === "OPTIONS") {
        res.statusCode = 204;
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.end();
        return;
      }

      const githubWebhookRoute = method === "POST" && url.pathname === "/github/webhook";
      if (options.token && !(githubWebhookRoute && options.githubWebhookSecret)) {
        const auth = req.headers["authorization"];
        if (auth !== `Bearer ${options.token}`) {
          unauthorized(res);
          return;
        }
      }

      const handler = matchRoute(method, url.pathname);
      if (!handler) {
        notFound(res);
        return;
      }
      await handler({ url, method, req, res, options });
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("server failed to bind"));
        return;
      }
      resolve({
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
    server.on("error", reject);
  });
}
