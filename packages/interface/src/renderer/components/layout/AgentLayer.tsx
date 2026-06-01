import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileText,
  type LucideIcon,
  MegaphoneIcon,
  Palette,
  Scale,
  ShieldAlert,
  Sparkles,
  TestTube2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { agentAbbr, runTone } from "../../lib/tone";
import { formatLabel, timeAgo } from "../../lib/format";
import type { AgentDefinition, CapabilityDefinition, RunRecord } from "../../lib/api";
import { type TFunction, useT } from "../../i18n/i18n";

const ROLE_ICON: Record<string, LucideIcon> = {
  project_manager: Users,
  product_manager: Sparkles,
  ux_designer: Palette,
  developer: Code2,
  development: Code2,
  qa: TestTube2,
  quality_assurance: TestTube2,
  compliance: Scale,
  legal: Scale,
  growth: MegaphoneIcon,
  marketing: MegaphoneIcon,
  sales: Users,
  security: ShieldAlert,
  ads: MegaphoneIcon,
  content: FileText,
};

function roleIcon(role: string): LucideIcon {
  return ROLE_ICON[role.toLowerCase()] ?? Bot;
}

const ACTIVE_RUN_STATUSES = new Set([
  "created",
  "context_loading",
  "planning",
  "dispatching",
  "in_progress",
  "verifying",
]);

function enabledActions(capability: CapabilityDefinition): string[] {
  return Object.entries(capability.actions)
    .filter(([, enabled]) => enabled)
    .map(([action]) => action);
}

function assignedCapabilities(
  agent: AgentDefinition,
  capabilities: CapabilityDefinition[],
): CapabilityDefinition[] {
  return capabilities.filter(
    (capability) =>
      capability.allowed_agents.includes(agent.id) || capability.allowed_agents.includes("*"),
  );
}

function latestRunForAgent(agent: AgentDefinition, runs: RunRecord[]): RunRecord | undefined {
  return runs
    .filter((run) => run.created_by === agent.id)
    .sort((a, b) => (b.updated ?? b.created ?? "").localeCompare(a.updated ?? a.created ?? ""))[0];
}

function runLabel(t: TFunction, run?: RunRecord): string {
  if (!run) return t("agentLayer.noRecentRun", "No recent run");
  return ACTIVE_RUN_STATUSES.has(run.status)
    ? t("agentLayer.currentRun", "Current run")
    : t("agentLayer.recentRun", "Recent run");
}

export function AgentLayer({
  agents,
  capabilities,
  runs,
  onOpenAgents,
}: {
  agents: AgentDefinition[];
  capabilities: CapabilityDefinition[];
  runs: RunRecord[];
  onOpenAgents: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const visible = agents.slice(0, 10);
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const selectedRun = selectedAgent ? latestRunForAgent(selectedAgent, runs) : undefined;
  const selectedCapabilities = selectedAgent
    ? assignedCapabilities(selectedAgent, capabilities)
    : [];
  const openAgent = (agent: AgentDefinition): void => {
    setSelectedAgentId(agent.id);
    setOpen(true);
  };
  return (
    <section className="min-w-0 border-t border-border/60 bg-surface px-3 py-2 sm:px-5">
      <div className="flex items-center gap-3 sm:hidden">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-between"
          onClick={() => {
            setSelectedAgentId(undefined);
            setOpen(true);
          }}
        >
          <span className="flex items-center gap-2">
            <Bot className="h-3.5 w-3.5" />
            {t("agentLayer.title", "Agent Layer")}
          </span>
          <span className="text-muted-foreground">{agents.length}</span>
        </Button>
      </div>
      <div className="hidden h-10 min-w-0 items-center gap-4 sm:flex">
        <div className="hidden min-w-[180px] shrink-0 md:block">
          <div className="text-[12px] font-semibold text-foreground">
            {t("agentLayer.title", "Agent Layer")}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {t("agentLayer.autonomousRoles", "{n} autonomous roles").replace(
              "{n}",
              String(agents.length),
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto no-scrollbar gradient-mask-fade">
          {visible.length > 0 ? (
            visible.map((agent) => {
              const Icon = roleIcon(agent.id);
              const run = latestRunForAgent(agent, runs);
              const assigned = assignedCapabilities(agent, capabilities);
              return (
                <Tooltip key={agent.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        "flex h-10 shrink-0 items-center gap-2 rounded-full border border-border/60 bg-surface-subtle px-3 transition-colors hover:border-border hover:bg-surface-raised focus-ring",
                        selectedAgentId === agent.id && open && "border-primary/70 bg-primary/10",
                      )}
                      onClick={() => openAgent(agent)}
                    >
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-raised text-foreground">
                        <Icon className="h-3 w-3" />
                      </span>
                      <div className="text-left leading-tight">
                        <div className="text-[11px] font-medium text-foreground">
                          {agentAbbr(agent.role) || "AG"}
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          {formatLabel(agent.role)}
                        </div>
                      </div>
                      <span className="ml-1 h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="font-medium">{formatLabel(agent.role)}</div>
                    <div className="mt-0.5 text-muted-foreground">{agent.category}</div>
                    <div className="mt-1 text-muted-foreground">
                      {run
                        ? `${runLabel(t, run)}: ${formatLabel(run.type)}`
                        : t("agentLayer.noRecentRun", "No recent run")}
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      {assigned.length}{" "}
                      {assigned.length === 1
                        ? t("agentLayer.assignedCapability", "assigned capability")
                        : t("agentLayer.assignedCapabilities", "assigned capabilities")}
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })
          ) : (
            <div className="text-[11px] text-muted-foreground">
              {t("agentLayer.noAgentsLoaded", "No agents loaded")}
            </div>
          )}
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={onOpenAgents}>
          {t("agentLayer.manageAgents", "Manage agents")}
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[92vw] max-w-md overflow-hidden p-0">
          {selectedAgent ? (
            <AgentDetailPanel
              agent={selectedAgent}
              run={selectedRun}
              capabilities={selectedCapabilities}
              onBack={() => setSelectedAgentId(undefined)}
              onOpenAgents={() => {
                setOpen(false);
                onOpenAgents();
              }}
            />
          ) : (
            <>
              <SheetHeader>
                <SheetTitle>{t("agentLayer.title", "Agent Layer")}</SheetTitle>
                <SheetDescription>
                  {t(
                    "agentLayer.autonomousRolesAvailable",
                    "{n} autonomous roles available.",
                  ).replace("{n}", String(agents.length))}
                </SheetDescription>
              </SheetHeader>
              <div className="grid max-h-[calc(100vh-92px)] gap-2 overflow-y-auto px-4 py-4">
                {agents.length > 0 ? (
                  agents.map((agent) => {
                    const Icon = roleIcon(agent.id);
                    const run = latestRunForAgent(agent, runs);
                    const assigned = assignedCapabilities(agent, capabilities);
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => setSelectedAgentId(agent.id)}
                        className="flex min-w-0 items-center gap-3 rounded-lg border border-border/60 bg-surface-subtle p-3 text-left transition hover:border-border hover:bg-surface-raised focus-ring"
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-raised text-foreground">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] font-semibold text-foreground">
                            {formatLabel(agent.role)}
                          </div>
                          <div className="truncate text-[10px] text-muted-foreground">
                            {run
                              ? `${runLabel(t, run)} · ${formatLabel(run.status)}`
                              : agent.category}
                          </div>
                        </div>
                        <span className="shrink-0 rounded bg-surface-raised px-1.5 py-0.5 text-[9px] text-muted-foreground">
                          {assigned.length}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-lg border border-border/60 bg-surface-subtle p-3 text-[11px] text-muted-foreground">
                    {t("agentLayer.noAgentsLoaded", "No agents loaded")}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function AgentDetailPanel({
  agent,
  run,
  capabilities,
  onBack,
  onOpenAgents,
}: {
  agent: AgentDefinition;
  run?: RunRecord;
  capabilities: CapabilityDefinition[];
  onBack: () => void;
  onOpenAgents: () => void;
}) {
  const t = useT();
  const Icon = roleIcon(agent.id);
  return (
    <>
      <SheetHeader>
        <div className="flex items-start gap-3 pr-8">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border/60 bg-surface-raised text-foreground">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <SheetTitle>{t("agentLayer.agentDetail", "Agent Detail")}</SheetTitle>
            <SheetDescription>
              {formatLabel(agent.role)} · {agent.category} · {agent.scope}
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>
      <div className="max-h-[calc(100vh-82px)] overflow-y-auto px-4 py-4">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] text-muted-foreground transition hover:text-foreground focus-ring"
        >
          <ChevronLeft className="h-3 w-3" />
          {t("agentLayer.agentList", "Agent list")}
        </button>

        <div className="rounded-lg border border-border/70 bg-surface-subtle p-4">
          <div className="text-[12px] font-semibold text-foreground">{formatLabel(agent.role)}</div>
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            {agent.description}
          </p>
        </div>

        <div className="mt-3 rounded-lg border border-border/70 bg-surface-subtle p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[12px] font-semibold text-foreground">{runLabel(t, run)}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {run
                  ? `${formatLabel(run.type)} · ${timeAgo(run.updated ?? run.created)}`
                  : t("agentLayer.noActiveOrRecentRun", "No active or recent run for this agent.")}
              </div>
            </div>
            {run ? (
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 py-0.5 text-[9px]",
                  runTone(run.status) === "success"
                    ? "bg-success-subtle text-success"
                    : runTone(run.status) === "warning"
                      ? "bg-warning-subtle text-warning"
                      : runTone(run.status) === "danger"
                        ? "bg-danger-subtle text-danger"
                        : "bg-surface-raised text-muted-foreground",
                )}
              >
                {formatLabel(run.status)}
              </span>
            ) : null}
          </div>
          {run ? (
            <>
              <div className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                {run.scope}
              </div>
              <div className="mt-2 truncate font-mono text-[10px] text-muted-foreground/80">
                {run.id}
              </div>
            </>
          ) : (
            <div className="mt-3 rounded-md border border-dashed border-border/60 p-3 text-[11px] text-muted-foreground">
              {t(
                "agentLayer.noActiveRunCoordinator",
                "No active run. The coordinator has not assigned work to this role yet.",
              )}
            </div>
          )}
        </div>

        <div className="mt-3 rounded-lg border border-border/70 bg-surface-subtle p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-foreground">
              {t("agentLayer.capabilityUsage", "Capability Usage")}
            </div>
            <span className="text-[10px] text-muted-foreground">
              {t("agentLayer.assigned", "{n} assigned").replace("{n}", String(capabilities.length))}
            </span>
          </div>
          <div className="mt-3 grid gap-2">
            {capabilities.length > 0 ? (
              capabilities.map((capability) => {
                const actions = enabledActions(capability);
                return (
                  <div
                    key={capability.id}
                    className="rounded-md border border-border/60 bg-surface-raised p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-semibold text-foreground">
                          {capability.name}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                          {capability.id}
                        </div>
                      </div>
                      <span className="shrink-0 rounded bg-surface-subtle px-1.5 py-0.5 text-[9px] text-muted-foreground">
                        {capability.risk_class}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {actions.length > 0 ? (
                        actions.map((action) => (
                          <span
                            key={action}
                            className="rounded bg-surface-subtle px-1.5 py-0.5 text-[9px] text-muted-foreground"
                          >
                            {action}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          {t("agentLayer.noEnabledActions", "No enabled actions")}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 text-[10px] text-muted-foreground">
                      {t("agentLayer.approvalGates", "Approval gates:")}{" "}
                      {capability.required_approvals.length
                        ? capability.required_approvals.join(", ")
                        : t("agentLayer.none", "none")}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-md border border-dashed border-border/60 p-3 text-[11px] text-muted-foreground">
                {t(
                  "agentLayer.noCapabilityAssigned",
                  "No capability assigned through `/capabilities` for this agent.",
                )}
              </div>
            )}
          </div>
        </div>

        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={onOpenAgents}>
          {t("agentLayer.manageAgents", "Manage agents")}
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
    </>
  );
}
