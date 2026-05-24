import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
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
    req.on("data", (chunk: Buffer) => { raw += chunk.toString("utf8"); });
    req.on("end", () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
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
        active_opportunities: opportunities.filter((o) => o.status !== "won" && o.status !== "lost").length,
      },
    });
  },

  "GET /clients": async ({ res, options }) => ok(res, await deps(options).clients.list()),
  "GET /projects": async ({ res, options }) => ok(res, await deps(options).projects.list()),
  "GET /opportunities": async ({ res, options }) => ok(res, await deps(options).opportunities.list()),
  "GET /approvals": async ({ res, options }) => ok(res, await deps(options).approvals.listPending()),
  "GET /approvals/resolved": async ({ res, options }) => ok(res, await deps(options).approvals.listResolved()),
  "GET /runs": async ({ res, options }) => ok(res, await deps(options).runs.list()),
  "GET /artifacts": async ({ res, options }) => ok(res, await deps(options).artifacts.list()),
  "GET /agents": ({ res }) => ok(res, AGENT_ROLES),

  "GET /audit": async ({ res, options, url }) => {
    const n = Number(url.searchParams.get("n") ?? "100");
    try {
      const content = await readFile(workspacePaths(options.workspaceRoot).auditLog, "utf8");
      const lines = content.trim().split("\n").filter(Boolean).slice(-n);
      ok(res, lines.map((l) => {
        try { return JSON.parse(l); } catch { return { raw: l }; }
      }));
    } catch {
      ok(res, []);
    }
  },

  "POST /approvals/resolve": async ({ res, options, req }) => {
    const body = (await readJson(req)) as { id?: string; status?: "approved" | "rejected"; reason?: string };
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
