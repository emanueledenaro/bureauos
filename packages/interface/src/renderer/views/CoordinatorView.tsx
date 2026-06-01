import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  FileText,
  MessageSquare,
  PanelRightOpen,
  Sparkles,
} from "lucide-react";
import { CoordinatorPanel } from "../components/coordinator/CoordinatorPanel";
import { BaseCard, BaseCardHeader } from "../components/dashboard/BaseCard";
import { StatusPill } from "../components/dashboard/StatusPill";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet";
import { cn } from "../lib/utils";
import { formatLabel, formatMoney, timeAgo } from "../lib/format";
import { buildTodayActions, pipelineValue, sortNewest } from "../lib/builders";
import { actionStateLabel } from "../lib/tone";
import { useT } from "../i18n/i18n";
import type {
  CoordinatorAttachmentInput,
  CoordinatorChatResult,
  CoordinatorChatStreamHandlers,
} from "../lib/api";
import type { AdaptiveMode, DashboardState } from "../lib/types";

/**
 * Pagina dedicata del Supreme Coordinator. Layout 2 colonne su xl+
 * (conversation | context); sotto xl una sola colonna (solo conversation) con
 * la colonna context raggiungibile tramite un drawer aperto dal bottone
 * "Context" nell'header del coordinator.
 *
 * La conversazione è l'unica primary action della view; il pannello context è
 * context-only (mai action-critical) per non distrarre dal dialogo.
 */
export function CoordinatorView({
  state,
  onMessage,
  onStreamMessage,
  onModeChange,
}: {
  state: DashboardState;
  onMessage: (
    message: string,
    attachments?: CoordinatorAttachmentInput[],
  ) => Promise<CoordinatorChatResult>;
  onStreamMessage?: (
    message: string,
    attachments: CoordinatorAttachmentInput[] | undefined,
    handlers: CoordinatorChatStreamHandlers,
  ) => Promise<CoordinatorChatResult>;
  onModeChange: (mode: AdaptiveMode) => void;
}) {
  const t = useT();
  const [contextOpen, setContextOpen] = useState(false);

  // The drawer only exists below xl, where the context column is hidden. If the
  // window grows into xl+ while the drawer is open, close it so a stale overlay
  // does not linger over the now-visible inline column.
  useEffect(() => {
    if (!contextOpen || typeof window === "undefined") return;
    const xl = window.matchMedia("(min-width: 1280px)");
    if (xl.matches) {
      setContextOpen(false);
      return;
    }
    const onChange = (event: MediaQueryListEvent): void => {
      if (event.matches) setContextOpen(false);
    };
    xl.addEventListener("change", onChange);
    return () => xl.removeEventListener("change", onChange);
  }, [contextOpen]);

  // Navigating away from the coordinator page should also dismiss the drawer.
  const handleModeChange = (mode: AdaptiveMode): void => {
    setContextOpen(false);
    onModeChange(mode);
  };

  return (
    <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-h-0 min-w-0 flex-col">
        <CoordinatorPanel
          state={state}
          onMessage={onMessage}
          onStreamMessage={onStreamMessage}
          headerSlot={
            <Button
              variant="outline"
              size="sm"
              className="xl:hidden"
              onClick={() => setContextOpen(true)}
              aria-label={t("coordinator.openCompanyContext", "Open company context")}
            >
              <PanelRightOpen className="h-3.5 w-3.5" />
              {t("coordinator.context", "Context")}
            </Button>
          }
        />
      </div>

      {/* xl+: context lives inline as the second column. */}
      <ContextColumn className="hidden xl:flex" state={state} onModeChange={handleModeChange} />

      {/* Below xl: the same context column is reachable through a drawer. */}
      <Sheet open={contextOpen} onOpenChange={setContextOpen}>
        <SheetContent side="right" className="w-[320px] gap-0 p-0 sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>{t("coordinator.companyContext", "Company context")}</SheetTitle>
            <SheetDescription>
              {t(
                "coordinator.drawerDescription",
                "Pulse, next queue, recent artifacts, and the agent bench.",
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <ContextColumn state={state} onModeChange={handleModeChange} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ContextColumn({
  className,
  state,
  onModeChange,
}: {
  className?: string;
  state: DashboardState;
  onModeChange: (mode: AdaptiveMode) => void;
}) {
  const t = useT();
  const recentArtifacts = useMemo(() => sortNewest(state.artifacts).slice(0, 4), [state.artifacts]);
  const nextActions = useMemo(() => buildTodayActions(state).slice(0, 4), [state]);
  const pendingApprovals = state.approvals.length;
  const pipeline = pipelineValue(state);
  const blockedProjects = state.projects.filter((project) => project.status === "blocked").length;
  const activeRuns = state.runs.filter((run) => !["completed", "cancelled"].includes(run.status));

  return (
    <aside className={cn("flex min-h-0 flex-col gap-3", className)}>
      <BaseCard padding="comfortable" className="gap-3">
        <BaseCardHeader title={t("coordinator.companyContext", "Company context")}>
          <span className="text-meta">{state.pulse?.organization ?? "BureauOS"}</span>
        </BaseCardHeader>
        <div className="grid grid-cols-2 gap-2">
          <PulseStat
            icon={CheckCircle2}
            label={t("coordinator.approvals", "Approvals")}
            value={String(pendingApprovals)}
          />
          <PulseStat
            icon={Calendar}
            label={t("coordinator.blockers", "Blockers")}
            value={String(blockedProjects)}
          />
          <PulseStat
            icon={Sparkles}
            label={t("coordinator.runs", "Runs")}
            value={String(activeRuns.length)}
          />
          <PulseStat
            icon={MessageSquare}
            label={t("coordinator.pipeline", "Pipeline")}
            value={formatMoney(pipeline)}
          />
        </div>
      </BaseCard>

      <BaseCard padding="comfortable" className="gap-2">
        <BaseCardHeader title={t("coordinator.nextQueue", "Next queue")}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onModeChange("today")}
            className="text-meta"
          >
            {t("coordinator.inbox", "Inbox")}
            <ArrowRight className="h-3 w-3" />
          </Button>
        </BaseCardHeader>
        <div className="flex flex-col gap-2">
          {nextActions.length === 0 ? (
            <div className="rounded-md border border-border/60 bg-background/35 p-3 text-meta">
              {t("coordinator.noUrgentAction", "No urgent owner action.")}
            </div>
          ) : (
            nextActions.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => onModeChange(action.route)}
                className="group rounded-md border border-border/60 bg-background/35 p-3 text-left transition-colors hover:border-border hover:bg-surface-subtle focus-ring"
              >
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="truncate text-body-secondary font-medium text-foreground">
                    {action.title}
                  </span>
                  <StatusPill
                    value={formatLabel(actionStateLabel(action.tone))}
                    tone={action.tone}
                    className="shrink-0"
                  />
                </div>
                <div className="text-meta mt-1 truncate">{action.detail}</div>
              </button>
            ))
          )}
        </div>
      </BaseCard>

      <BaseCard padding="comfortable" className="min-h-0 flex-1 gap-2">
        <BaseCardHeader title={t("coordinator.recentArtifacts", "Recent artifacts")}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onModeChange("memory")}
            className="text-meta"
          >
            {t("coordinator.all", "All")}
            <ArrowRight className="h-3 w-3" />
          </Button>
        </BaseCardHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-2 pr-2">
            {recentArtifacts.length === 0 ? (
              <div className="text-meta">{t("coordinator.noArtifacts", "No artifacts yet.")}</div>
            ) : (
              recentArtifacts.map((artifact) => (
                <div
                  key={artifact.id}
                  className="flex items-start gap-2.5 rounded-md border border-border/60 bg-background/35 p-2.5"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/60 bg-surface-subtle text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-body-secondary truncate font-medium text-foreground">
                      {formatLabel(artifact.type)}
                    </div>
                    <div className="text-meta truncate font-mono">{artifact.id}</div>
                    <div className="text-meta">
                      {artifact.created
                        ? timeAgo(artifact.created)
                        : t("coordinator.created", "created")}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </BaseCard>

      <BaseCard padding="comfortable" className="gap-2">
        <BaseCardHeader title={t("coordinator.agentBench", "Agent bench")}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onModeChange("agents")}
            className="text-meta"
          >
            {t("coordinator.open", "Open")}
            <ArrowRight className="h-3 w-3" />
          </Button>
        </BaseCardHeader>
        <div className="flex flex-wrap items-center gap-1.5">
          {state.agents.slice(0, 6).map((agent) => (
            <Avatar key={agent.id} className="h-7 w-7">
              <AvatarFallback className="text-[10px]">
                {agent.role
                  .split(/[_-]/)
                  .slice(0, 2)
                  .map((p) => p[0]?.toUpperCase() ?? "")
                  .join("")
                  .slice(0, 2) || "AG"}
              </AvatarFallback>
            </Avatar>
          ))}
          {state.agents.length > 6 ? (
            <span className="text-meta ml-1">+{state.agents.length - 6}</span>
          ) : null}
          {state.agents.length === 0 ? (
            <span className="text-meta">{t("coordinator.noAgents", "No agents loaded")}</span>
          ) : null}
        </div>
      </BaseCard>
    </aside>
  );
}

function PulseStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-surface-subtle p-2.5">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-muted-foreground" />
        <span className="text-eyebrow">{label}</span>
      </div>
      <div className="text-card-title mt-1.5">{value}</div>
    </div>
  );
}
