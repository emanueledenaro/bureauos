import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog, type AuditEvent } from "../audit/log.js";
import { workspacePaths } from "../paths.js";
import { appendDailyNote } from "./daily.js";
import {
  ROOT_CONSOLIDATION_ACTOR,
  buildRootMemoryView,
  gatherRootConsolidationInputs,
  type RootMemoryView,
} from "./consolidation.js";

/**
 * The Morning Brief is the coordinator's short, proactive daily digest for the
 * owner — the "assistant leaves a briefing on your desk each morning" behavior,
 * as opposed to only answering when asked. It is deliberately concise and
 * owner-facing, complementing (not duplicating) the comprehensive executive /
 * business-operating reports from `BusinessReportService`. See SER-235.
 *
 * The brief has three parts: a one-line state HEADLINE, a compact STATE
 * snapshot, the CONNECTIONS the coordinator noticed across the company, and the
 * top "look at today" next actions.
 */

const CLOSED_OPPORTUNITY = new Set(["won", "lost"]);

/** Numeric signals computed from live state that `RootMemoryView` does not carry. */
export interface MorningBriefSignals {
  pipelineValue: number;
  openOpportunities: number;
  pendingApprovals: number;
}

export interface MorningBriefState {
  activeClients: number;
  activeProjects: number;
  openOpportunities: number;
  pipelineValue: number;
  blockers: number;
  pendingApprovals: number;
}

export interface MorningBrief {
  generatedAt: string;
  organization: string;
  headline: string;
  state: MorningBriefState;
  connections: string[];
  lookToday: string[];
}

const CONNECTIONS_LIMIT = 4;
const LOOK_TODAY_LIMIT = 3;

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

/** Compact money rendering matching the Operating Room (e.g. 20000 -> "$20K"). */
function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0";
  const abs = Math.abs(value);
  if (abs >= 1000) return `$${Math.round(value / 1000)}K`;
  return `$${Math.round(value)}`;
}

/**
 * Shape the always-loaded ROOT view plus today's numeric signals into the
 * owner-facing Morning Brief. Pure: no IO, no clock (the caller passes `now`),
 * no model — the same inputs always render the same brief, so it never invents
 * facts and is trivially unit-testable.
 */
export function buildMorningBrief(
  view: RootMemoryView,
  signals: MorningBriefSignals,
  now: Date,
): MorningBrief {
  const state: MorningBriefState = {
    activeClients: view.activeClients.length,
    activeProjects: view.activeProjects.length,
    openOpportunities: signals.openOpportunities,
    pipelineValue: signals.pipelineValue,
    blockers: view.blockers.length,
    pendingApprovals: signals.pendingApprovals,
  };

  const headline = buildHeadline(state);
  const connections = buildConnections(view, state);
  const lookToday = buildLookToday(view, state);

  return {
    generatedAt: now.toISOString(),
    organization: view.organization,
    headline,
    state,
    connections,
    lookToday,
  };
}

function buildHeadline(state: MorningBriefState): string {
  const parts: string[] = [];
  if (state.blockers > 0) parts.push(`${state.blockers} blocker${plural(state.blockers)}`);
  if (state.pendingApprovals > 0) {
    parts.push(`${state.pendingApprovals} approval${plural(state.pendingApprovals)} waiting`);
  }
  if (parts.length === 0) return "Company operating clean.";
  return `${parts.join(" and ")} need your attention.`;
}

function buildConnections(view: RootMemoryView, state: MorningBriefState): string[] {
  const out: string[] = [];
  if (state.openOpportunities > 0) {
    out.push(
      `${state.openOpportunities} open opportunit${state.openOpportunities === 1 ? "y" : "ies"} ` +
        `worth ${formatMoney(state.pipelineValue)} waiting on the next move.`,
    );
  }
  if (state.activeClients > 0 && state.activeProjects === 0) {
    out.push(
      `${state.activeClients} client${plural(state.activeClients)} in memory but no active ` +
        `project yet — qualification gap.`,
    );
  }
  if (state.activeProjects > 0 && state.openOpportunities === 0) {
    out.push("Delivery is underway but the new-business pipeline is empty — top up the funnel.");
  }
  for (const blocker of view.blockers) {
    if (out.length >= CONNECTIONS_LIMIT) break;
    out.push(`Blocked: ${blocker}`);
  }
  for (const risk of view.risks) {
    if (out.length >= CONNECTIONS_LIMIT) break;
    out.push(`Risk: ${risk}`);
  }
  return out.slice(0, CONNECTIONS_LIMIT);
}

function buildLookToday(view: RootMemoryView, state: MorningBriefState): string[] {
  const out: string[] = [];
  if (state.pendingApprovals > 0) {
    out.push(
      `Resolve ${state.pendingApprovals} pending approval${plural(state.pendingApprovals)}.`,
    );
  }
  for (const blocker of view.blockers) {
    if (out.length >= LOOK_TODAY_LIMIT) break;
    out.push(`Unblock: ${blocker}`);
  }
  for (const priority of view.priorities) {
    if (out.length >= LOOK_TODAY_LIMIT) break;
    out.push(priority);
  }
  if (out.length === 0) out.push("Nothing urgent — keep the pipeline moving.");
  return out.slice(0, LOOK_TODAY_LIMIT);
}

/** Render the brief to compact Markdown for the artifact body. Pure. */
export function renderMorningBrief(brief: MorningBrief): string {
  const date = brief.generatedAt.slice(0, 10);
  const lines: string[] = [];
  lines.push(`# Morning Brief — ${date}`);
  lines.push("");
  lines.push(`${brief.organization} · ${brief.headline}`);
  lines.push("");
  lines.push("## State");
  lines.push(
    `- Pipeline: ${formatMoney(brief.state.pipelineValue)} across ` +
      `${brief.state.openOpportunities} open opportunit${brief.state.openOpportunities === 1 ? "y" : "ies"}`,
  );
  lines.push(
    `- Clients in play: ${brief.state.activeClients} · Active projects: ${brief.state.activeProjects}`,
  );
  lines.push(
    `- Blockers: ${brief.state.blockers} · Pending approvals: ${brief.state.pendingApprovals}`,
  );
  lines.push("");
  lines.push("## Connections");
  if (brief.connections.length === 0) {
    lines.push("_No cross-cutting patterns flagged today._");
  } else {
    for (const c of brief.connections) lines.push(`- ${c}`);
  }
  lines.push("");
  lines.push("## Look at today");
  brief.lookToday.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
  lines.push("");
  return lines.join("\n");
}

export interface MorningBriefResult {
  brief: MorningBrief;
  artifact: ArtifactRecord;
  audit: AuditEvent;
}

export interface MorningBriefDeps {
  artifacts?: ArtifactStore;
  audit?: AuditLog;
}

/**
 * Generate today's Morning Brief from live workspace state and persist it as a
 * `morning-brief` artifact, a daily-note event, and an audit record. Offline
 * and deterministic (no model, no external calls); reuses
 * {@link gatherRootConsolidationInputs} so it reads exactly the same live state
 * as ROOT consolidation.
 */
export class MorningBriefService {
  private readonly artifacts: ArtifactStore;
  private readonly audit: AuditLog;

  constructor(
    private readonly workspaceRoot: string,
    deps: MorningBriefDeps = {},
  ) {
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
  }

  async generate({ now = new Date() }: { now?: Date } = {}): Promise<MorningBriefResult> {
    const inputs = await gatherRootConsolidationInputs(this.workspaceRoot, now);
    const view = buildRootMemoryView(inputs);
    const openOpportunities = inputs.opportunities.filter(
      (opportunity) => !CLOSED_OPPORTUNITY.has(opportunity.status),
    );
    const signals: MorningBriefSignals = {
      pipelineValue: openOpportunities.reduce(
        (sum, opportunity) => sum + (opportunity.expected_value || 0),
        0,
      ),
      openOpportunities: openOpportunities.length,
      pendingApprovals: inputs.pendingApprovals.length,
    };
    const brief = buildMorningBrief(view, signals, now);
    const artifact = await this.artifacts.write({
      type: "morning-brief",
      createdBy: ROOT_CONSOLIDATION_ACTOR,
      body: renderMorningBrief(brief),
      status: "submitted",
    });
    await appendDailyNote(this.workspaceRoot, "Events", `Generated morning brief ${artifact.id}.`);
    const audit = await this.audit.append({
      actor: ROOT_CONSOLIDATION_ACTOR,
      action: "memory.morning_brief.generated",
      target: artifact.id,
      result: "ok",
    });
    return { brief, artifact, audit };
  }
}
