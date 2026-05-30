import { readFile, rename, writeFile } from "node:fs/promises";
import { AuditLog, type AuditEvent } from "../audit/log.js";
import { workspacePaths } from "../paths.js";
import { fileExists, listDocs, readDoc, withFileLock } from "../registries/base.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { CompanyRegistry } from "../registries/company.js";
import { OpportunityRegistry, type OpportunityRecord } from "../registries/opportunity.js";
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";
import { ApprovalRegistry, type ApprovalRecord } from "../registries/approval.js";
import type { RunRecord } from "../runs/engine.js";

export const ROOT_CONSOLIDATION_ACTOR = "supreme_coordinator";

/** How many entries each bounded ROOT section may list. Keeps the always-loaded index compact. */
const SECTION_LIMIT = 12;
const DECISIONS_LIMIT = 8;
const TOPICS_LIMIT = 24;

const CLOSED_OPPORTUNITY = new Set(["won", "lost"]);
const HIGH_APPROVAL_RISK = new Set(["high", "critical"]);

export interface RootMemoryView {
  organization: string;
  generatedAt: string;
  summary: string;
  activeClients: Array<{ name: string; status: string; industry: string }>;
  activeProjects: Array<{ name: string; client: string; status: string }>;
  priorities: string[];
  blockers: string[];
  risks: string[];
  recentDecisions: Array<{ date: string; what: string }>;
  topics: { clients: string[]; projects: string[]; opportunities: string[] };
}

export interface RootConsolidationInputs {
  organization: string;
  now: Date;
  clients: ClientRecord[];
  projects: ProjectRecord[];
  opportunities: OpportunityRecord[];
  pendingApprovals: ApprovalRecord[];
  blockedRuns: RunRecord[];
  recentDecisions: Array<{ date: string; what: string }>;
}

function clientNameMap(clients: ClientRecord[]): Map<string, string> {
  return new Map(clients.map((client) => [client.id, client.name]));
}

function blockerText(reason: unknown): string {
  if (Array.isArray(reason)) return reason.filter(Boolean).map(String).join("; ");
  if (typeof reason === "string") return reason.trim();
  return "";
}

/**
 * Shape live workspace state into the compact, deterministic view that backs
 * the always-loaded ROOT index. Pure: no IO, no clock, no model — so the same
 * inputs always render the same ROOT (idempotent re-consolidation).
 */
export function buildRootMemoryView(input: RootConsolidationInputs): RootMemoryView {
  const names = clientNameMap(input.clients);
  const nameFor = (clientId: string): string => names.get(clientId) ?? clientId ?? "unassigned";

  // The live book of clients: everything still in play (leads, active, paused).
  // Churned/archived drop off the always-loaded index (churned still surfaces
  // under Risk Register). A `status === "active"` filter alone hid real
  // in-progress leads/intake clients from ROOT.
  const activeClients = input.clients
    .filter((client) => client.status !== "archived" && client.status !== "churned")
    .map((client) => ({
      name: client.name,
      status: client.status,
      industry: client.industry || "unspecified",
    }));

  const activeProjects = input.projects
    .filter((project) => project.status === "in_progress" || project.status === "approved")
    .map((project) => ({
      name: project.name,
      client: nameFor(project.client_id),
      status: project.status,
    }));

  const openOpportunities = input.opportunities.filter(
    (opportunity) => !CLOSED_OPPORTUNITY.has(opportunity.status),
  );

  const priorities = openOpportunities.slice(0, SECTION_LIMIT).map((opportunity) => {
    const action = (opportunity.next_action || "").trim();
    const head = `${nameFor(opportunity.client_id)}: ${opportunity.title}`;
    return action ? `${head} -> ${action}` : head;
  });

  const blockedProjects = input.projects.filter((project) => project.status === "blocked");
  const blockers = [
    ...blockedProjects.map(
      (project) => `Project "${project.name}" (${nameFor(project.client_id)}) blocked`,
    ),
    ...input.blockedRuns.map((run) => {
      const reason = blockerText(run.blocking_reason ?? run.dispatch_blockers ?? run.blockers);
      return `Run ${run.id} (${run.type}) blocked${reason ? ` - ${reason}` : ""}`;
    }),
  ].slice(0, SECTION_LIMIT);

  const risks = [
    ...input.pendingApprovals
      .filter((approval) => HIGH_APPROVAL_RISK.has((approval.risk_level ?? "").toLowerCase()))
      .map(
        (approval) =>
          `Approval pending: ${approval.target} (${approval.action}, ${approval.risk_level})`,
      ),
    ...input.opportunities
      .filter((opportunity) => opportunity.status === "stalled")
      .map(
        (opportunity) =>
          `Stalled opportunity: ${opportunity.title} (${nameFor(opportunity.client_id)})`,
      ),
    ...input.clients
      .filter((client) => client.status === "paused" || client.status === "churned")
      .map((client) => `Client at risk: ${client.name} (${client.status})`),
  ].slice(0, SECTION_LIMIT);

  const topics = {
    clients: input.clients.map((client) => client.name).slice(0, TOPICS_LIMIT),
    projects: input.projects.map((project) => project.name).slice(0, TOPICS_LIMIT),
    opportunities: input.opportunities
      .map((opportunity) => opportunity.title)
      .slice(0, TOPICS_LIMIT),
  };

  const pipelineValue = openOpportunities.reduce(
    (sum, opportunity) => sum + (Number(opportunity.expected_value) || 0),
    0,
  );
  const summary =
    `${activeClients.length} client(s) in play, ${activeProjects.length} active project(s), ` +
    `${openOpportunities.length} open opportunity(ies) (pipeline ${pipelineValue}), ` +
    `${input.pendingApprovals.length} pending approval(s).`;

  return {
    organization: input.organization,
    generatedAt: input.now.toISOString(),
    summary,
    activeClients,
    activeProjects,
    priorities,
    blockers,
    risks,
    recentDecisions: input.recentDecisions.slice(0, DECISIONS_LIMIT),
    topics,
  };
}

function bulletList(lines: string[], empty = "(none)"): string {
  if (lines.length === 0) return empty;
  return lines.map((line) => `- ${line}`).join("\n");
}

/**
 * Render the always-loaded ROOT index from a shaped view. Mirrors the section
 * layout of the `bureau init` ROOT template so the file stays a compact "map of
 * memory" — the structured sections are machine-maintained while the static
 * Retrieval Map / Standing Policies scaffolding is preserved.
 */
export function renderRootMemory(view: RootMemoryView): string {
  const activeClients = bulletList(
    view.activeClients.map((client) => `${client.name} (${client.status}) - ${client.industry}`),
  );
  const activeProjects = bulletList(
    view.activeProjects.map((project) => `${project.name} (${project.client}) - ${project.status}`),
  );
  const priorities = bulletList(view.priorities);
  const blockers = bulletList(view.blockers);
  const risks = bulletList(view.risks, "(empty)");
  const decisions = bulletList(
    view.recentDecisions.map((decision) => `${decision.date}: ${decision.what}`),
  );
  const topicLines: string[] = [];
  if (view.topics.clients.length) topicLines.push(`Clients: ${view.topics.clients.join(", ")}`);
  if (view.topics.projects.length) topicLines.push(`Projects: ${view.topics.projects.join(", ")}`);
  if (view.topics.opportunities.length) {
    topicLines.push(`Opportunities: ${view.topics.opportunities.join(", ")}`);
  }
  const topics = bulletList(topicLines, "(empty)");

  return `# BureauOS Root Memory

> Workspace: ${view.organization}
> Generated: ${view.generatedAt}
> Auto-consolidated from live workspace state.

This file is the always-loaded executive index. It is intentionally compact and
machine-maintained: the sections below are regenerated from current workspace
state. It is the **map** of memory, not memory itself. Deeper context lives in:
- COMPANY.md, CLIENTS.md, PROJECTS.md, DECISIONS.md
- BRAND.md, OFFERS.md, CHANNELS.md, LEADS.md, CAMPAIGNS.md
- PRICING.md, PROPOSALS.md, COMPLIANCE.md, APPROVALS.md, PUBLIC_CLAIMS.md
- clients/<slug>/, projects/<slug>/, runs/<id>.md
- memory/<YYYY-MM-DD>.md (daily notes)

## Active Context

${view.summary}

## Active Clients

${activeClients}

## Active Projects

${activeProjects}

## Current Priorities

${priorities}

## Blockers

${blockers}

## Recent Decisions

${decisions}

## Standing Policies

See POLICIES.md.

## Risk Register

${risks}

## Topics Index

${topics}

## Retrieval Map

- Company facts: COMPANY.md
- Per-client memory: clients/<slug>/
- Per-project memory: projects/<slug>/
- Daily operational notes: memory/<YYYY-MM-DD>.md
- Durable decisions: DECISIONS.md
- Active approvals: APPROVALS.md
- Brand and offers: BRAND.md, OFFERS.md
`;
}

export interface RootConsolidationResult {
  rootPath: string;
  generatedAt: string;
  counts: {
    activeClients: number;
    activeProjects: number;
    openOpportunities: number;
    blockers: number;
    pendingApprovals: number;
    recentDecisions: number;
  };
  audit: AuditEvent;
}

export interface RootMemoryConsolidationDeps {
  audit?: AuditLog;
}

/**
 * Keep `ROOT.md` (the Supreme Coordinator's always-loaded memory index) current
 * by regenerating its structured sections from live workspace state. Runs on
 * demand (`bureau memory consolidate`) and on a daemon schedule, honoring
 * `memory.promote_daily_notes_to_durable_memory`. Deterministic and offline: no
 * model is required, so it never invents facts. Every consolidation is audited.
 */
export class RootMemoryConsolidationService {
  private readonly audit: AuditLog;

  constructor(
    private readonly workspaceRoot: string,
    deps: RootMemoryConsolidationDeps = {},
  ) {
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
  }

  async consolidate({ now = new Date() }: { now?: Date } = {}): Promise<RootConsolidationResult> {
    const paths = workspacePaths(this.workspaceRoot);
    const company = await new CompanyRegistry(this.workspaceRoot).get();
    const [clients, projects, opportunities, pendingApprovals] = await Promise.all([
      new ClientRegistry(this.workspaceRoot).list(),
      new ProjectRegistry(this.workspaceRoot).list(),
      new OpportunityRegistry(this.workspaceRoot).list(),
      new ApprovalRegistry(this.workspaceRoot).listPending(),
    ]);
    const blockedRuns = await this.readBlockedRuns(paths.runsDir);
    const recentDecisions = await this.readRecentDecisions(paths.decisionsLog);

    const view = buildRootMemoryView({
      organization: company.name,
      now,
      clients,
      projects,
      opportunities,
      pendingApprovals,
      blockedRuns,
      recentDecisions,
    });
    const content = renderRootMemory(view);

    // Serialize against any concurrent writer and replace atomically (temp +
    // rename) so a crash mid-write can never leave a truncated always-loaded
    // index.
    await withFileLock(paths.rootMemory, async () => {
      const tmp = `${paths.rootMemory}.tmp-${process.pid}`;
      await writeFile(tmp, content, "utf8");
      await rename(tmp, paths.rootMemory);
    });

    const audit = await this.audit.append({
      actor: ROOT_CONSOLIDATION_ACTOR,
      action: "memory.root.consolidated",
      target: "ROOT.md",
      result: "ok",
    });

    return {
      rootPath: paths.rootMemory,
      generatedAt: view.generatedAt,
      counts: {
        activeClients: view.activeClients.length,
        activeProjects: view.activeProjects.length,
        openOpportunities: opportunities.filter((o) => !CLOSED_OPPORTUNITY.has(o.status)).length,
        blockers: view.blockers.length,
        pendingApprovals: pendingApprovals.length,
        recentDecisions: view.recentDecisions.length,
      },
      audit,
    };
  }

  private async readBlockedRuns(runsDir: string): Promise<RunRecord[]> {
    let files: string[] = [];
    try {
      files = await listDocs(runsDir);
    } catch {
      return [];
    }
    const blocked: RunRecord[] = [];
    for (const file of files) {
      try {
        const doc = await readDoc<RunRecord>(file);
        if (doc.front.status === "blocked") blocked.push(doc.front);
      } catch {
        // Skip unreadable/partial run files; consolidation must never throw.
      }
    }
    return blocked;
  }

  private async readRecentDecisions(
    decisionsLog: string,
  ): Promise<Array<{ date: string; what: string }>> {
    if (!(await fileExists(decisionsLog))) return [];
    const raw = await readFile(decisionsLog, "utf8").catch(() => "");
    // decisionBlock writes `## <ISO timestamp> - <what>` headers.
    const entries: Array<{ date: string; what: string }> = [];
    const re = /^##\s+(\S+)\s+-\s+(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = re.exec(raw))) {
      const ts = match[1] ?? "";
      const what = (match[2] ?? "").trim();
      if (!what) continue;
      entries.push({ date: ts.slice(0, 10), what });
    }
    // Most recent last in an append-only log; surface the newest first.
    return entries.reverse().slice(0, DECISIONS_LIMIT);
  }
}
