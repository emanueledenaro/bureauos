import { Bot, ShieldCheck, Wrench } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { KpiBar } from "../components/dashboard/KpiBar";
import { ResponsiveTable } from "../components/dashboard/ResponsiveTable";
import { BaseCard } from "../components/dashboard/BaseCard";
import { Badge } from "../components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { agentAbbr, runTone, type Tone } from "../lib/tone";
import { formatLabel, timeAgo } from "../lib/format";
import type { CapabilityDefinition, RunRecord } from "../lib/api";
import type { DashboardState } from "../lib/types";
import { useT } from "../i18n/i18n";
import type { TFunction } from "../i18n/i18n";

// Run statuses that mean the agent is actively working right now (mirrors the
// Agent Layer footer so the two surfaces stay consistent).
const ACTIVE_RUN_STATUSES = new Set([
  "created",
  "context_loading",
  "planning",
  "dispatching",
  "in_progress",
  "verifying",
]);

// Capability availability tones, shared between the headline KPI and the table
// rows so "available" is never counted in one place and greyed out in another.
function capabilityStatusTone(status: CapabilityDefinition["status"]): Tone {
  switch (status) {
    case "blocked":
      return "danger";
    case "configured":
      return "success";
    case "available":
      return "info";
    default:
      return "neutral";
  }
}

function latestRunForAgent(agentId: string, runs: RunRecord[]): RunRecord | undefined {
  return runs
    .filter((run) => run.created_by === agentId)
    .sort((a, b) => (b.updated ?? b.created ?? "").localeCompare(a.updated ?? a.created ?? ""))[0];
}

interface AgentRuntimeState {
  label: string;
  detail: string;
  tone: Tone;
  active: boolean;
}

function agentRuntimeState(agentId: string, runs: RunRecord[], t: TFunction): AgentRuntimeState {
  const run = latestRunForAgent(agentId, runs);
  if (!run) {
    return {
      label: t("agents.idle", "Idle"),
      detail: t("agents.noActiveRun", "No active run"),
      tone: "neutral",
      active: false,
    };
  }
  const active = ACTIVE_RUN_STATUSES.has(run.status);
  const phase = active ? t("agents.runPhaseCurrent", "Current") : t("agents.runPhaseLast", "Last");
  return {
    label: active ? t("agents.running", "Running") : formatLabel(run.status),
    detail: `${phase} ${t("agents.runWord", "run")} · ${formatLabel(run.type)} · ${timeAgo(
      run.updated ?? run.created,
    )}`,
    tone: active ? "info" : runTone(run.status),
    active,
  };
}

export function AgentsView({ state }: { state: DashboardState }) {
  const t = useT();
  const readyCapabilities = state.capabilities.filter(
    (capability) => capability.status === "configured" || capability.status === "available",
  ).length;
  const highRisk = state.capabilities.filter(
    (capability) => capability.risk_class === "high" || capability.risk_class === "critical",
  ).length;
  const activeAgents = state.agents.filter(
    (agent) => agentRuntimeState(agent.id, state.runs, t).active,
  ).length;
  const assignedTo = (agentId: string): CapabilityDefinition[] =>
    state.capabilities.filter(
      (capability) =>
        capability.allowed_agents.includes(agentId) || capability.allowed_agents.includes("*"),
    );
  const enabledActions = (capability: CapabilityDefinition): string[] =>
    Object.entries(capability.actions)
      .filter(([, enabled]) => enabled)
      .map(([action]) => action);

  return (
    <SectionShell
      title={t("agents.title", "Agents")}
      description={t("agents.description", "The autonomous organization and role boundaries.")}
    >
      <KpiBar>
        <MetricTile
          label={t("agents.agentsLabel", "Agents")}
          value={String(state.agents.length)}
          detail={
            activeAgents > 0
              ? `${activeAgents} ${t("agents.withActiveRun", "with an active run")}`
              : t("agents.roleContractsIdle", "Role contracts · all idle")
          }
          icon={Bot}
          tone={activeAgents > 0 ? "info" : "neutral"}
        />
        <MetricTile
          label={t("agents.capabilitiesReady", "Capabilities ready")}
          value={String(readyCapabilities)}
          detail={`${state.capabilities.length} ${t("agents.inCatalogConfiguredOrAvailable", "in catalog · configured or available")}`}
          icon={Wrench}
          tone="success"
        />
        <MetricTile
          label={t("agents.highRisk", "High risk")}
          value={String(highRisk)}
          detail={t("agents.approvalSensitiveTools", "Approval-sensitive tools")}
          icon={ShieldCheck}
          tone={highRisk > 0 ? "warning" : "success"}
        />
      </KpiBar>

      <div className="mt-section grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {state.agents.map((agent) => {
          const runtime = agentRuntimeState(agent.id, state.runs, t);
          return (
            <BaseCard key={agent.id} className="gap-3">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-surface-raised text-card-title">
                  {agentAbbr(agent.role)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-card-title truncate">{formatLabel(agent.role)}</div>
                  <div className="text-eyebrow">{agent.category}</div>
                </div>
                <StatusPill value={runtime.label} tone={runtime.tone} />
              </div>
              <div className="text-meta">{runtime.detail}</div>
              <p className="text-body-secondary line-clamp-3 leading-relaxed text-muted-foreground">
                {agent.description}
              </p>
              <div className="mt-auto flex flex-wrap gap-1.5">
                {assignedTo(agent.id)
                  .slice(0, 4)
                  .map((capability) => (
                    <Tooltip key={capability.id}>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="cursor-default px-2 py-1 text-micro">
                          {capability.id}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="font-medium">{capability.name}</div>
                        <div className="text-meta mt-0.5">
                          {enabledActions(capability).join(", ") ||
                            t("agents.noEnabledActionsLower", "no enabled actions")}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                {assignedTo(agent.id).length === 0 ? (
                  <span className="text-meta">
                    {t("agents.noCapabilityAssigned", "No capability assigned")}
                  </span>
                ) : null}
              </div>
            </BaseCard>
          );
        })}
      </div>

      <ResponsiveTable className="mt-5" minWidth={840}>
        <div className="grid grid-cols-[170px_90px_100px_minmax(0,1.5fr)_minmax(0,1fr)] bg-surface-subtle/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>{t("agents.colCapability", "Capability")}</span>
          <span>{t("agents.colType", "Type")}</span>
          <span>{t("agents.colStatus", "Status")}</span>
          <span>{t("agents.colEnabledActions", "Enabled actions")}</span>
          <span>{t("agents.colRequiredApprovals", "Required approvals")}</span>
        </div>
        {state.capabilities.map((capability) => (
          <div
            key={capability.id}
            className="grid grid-cols-[170px_90px_100px_minmax(0,1.5fr)_minmax(0,1fr)] items-center gap-3 border-t border-border/60 px-4 py-3 text-[11px]"
          >
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{capability.name}</div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                {capability.id}
              </div>
            </div>
            <span className="text-muted-foreground">{capability.type}</span>
            <StatusPill value={capability.status} tone={capabilityStatusTone(capability.status)} />
            <span className="truncate text-muted-foreground">
              {enabledActions(capability).join(", ") ||
                t("agents.noEnabledActions", "No enabled actions")}
            </span>
            <span className="truncate text-muted-foreground">
              {capability.required_approvals.length
                ? capability.required_approvals.join(", ")
                : t("agents.noOwnerDecision", "No owner decision")}
            </span>
          </div>
        ))}
      </ResponsiveTable>
    </SectionShell>
  );
}
