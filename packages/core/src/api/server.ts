import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat, open } from "node:fs/promises";
import { URL } from "node:url";
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
import { CoordinatorIntakeService } from "../coordinator/intake.js";
import { GitHubIssueDraftService } from "../github/issue-drafts.js";
import {
  GitHubIssuePublishService,
  type GitHubIssuePublishClient,
} from "../github/issue-publisher.js";
import { BusinessReportService } from "../reports/business.js";

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
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
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

const ROUTES: Record<string, RouteHandler> = {
  "GET /health": ({ res }) => ok(res, { ok: true }),

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
  "GET /opportunities": async ({ res, options }) =>
    ok(res, await deps(options).opportunities.list()),
  "GET /approvals": async ({ res, options }) =>
    ok(res, await deps(options).approvals.listPending()),
  "GET /approvals/resolved": async ({ res, options }) =>
    ok(res, await deps(options).approvals.listResolved()),
  "GET /runs": async ({ res, options }) => ok(res, await deps(options).runs.list()),
  "GET /artifacts": async ({ res, options }) => ok(res, await deps(options).artifacts.list()),
  "GET /agents": ({ res }) => ok(res, AGENT_ROLES),

  "GET /reports": async ({ res, options }) => {
    const artifacts = await deps(options).artifacts.list();
    ok(
      res,
      artifacts.filter((artifact) => {
        return (
          artifact.type === "executive-report" ||
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

  "POST /coordinator/intake": async ({ res, options, req }) => {
    const body = (await readJson(req)) as {
      message?: string;
      source?: string;
      clientName?: string;
      projectName?: string;
      industry?: string;
      expectedValue?: number;
      expectedMargin?: number;
    };
    if (!body.message || !body.message.trim()) {
      ok(res, { error: "message required" }, 400);
      return;
    }
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

      if (options.token) {
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
