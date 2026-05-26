import { useMemo } from "react";
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  FileText,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { CoordinatorPanel } from "../components/coordinator/CoordinatorPanel";
import { BaseCard, BaseCardHeader } from "../components/dashboard/BaseCard";
import { StatusPill } from "../components/dashboard/StatusPill";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { cn } from "../lib/utils";
import { formatLabel, formatMoney, timeAgo } from "../lib/format";
import { buildTodayActions, sortNewest } from "../lib/builders";
import { actionStateLabel } from "../lib/tone";
import type {
  CoordinatorAttachmentInput,
  CoordinatorChatResult,
  CoordinatorChatStreamHandlers,
} from "../lib/api";
import type { AdaptiveMode, DashboardState } from "../lib/types";

/**
 * Pagina dedicata del Supreme Coordinator. Layout 3 colonne su xl+
 * (history | conversation | context), 2 colonne su lg (history | conversation),
 * 1 colonna sotto lg (solo conversation, con drawer per history/context).
 *
 * La conversazione è l'unica primary action della view; i pannelli laterali
 * sono context-only (mai action-critical) per non distrarre dal dialogo.
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
  return (
    <div className="grid h-full min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-h-0 min-w-0 flex-col">
        <CoordinatorPanel state={state} onMessage={onMessage} onStreamMessage={onStreamMessage} />
      </div>
      <ContextColumn className="hidden xl:flex" state={state} onModeChange={onModeChange} />
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
  const recentArtifacts = useMemo(() => sortNewest(state.artifacts).slice(0, 4), [state.artifacts]);
  const nextActions = useMemo(() => buildTodayActions(state).slice(0, 4), [state]);
  const pendingApprovals = state.approvals.length;
  const pipelineValue =
    state.clientIntelligence?.totals.pipeline_value ?? state.pulse?.revenue.pipeline_value ?? 0;
  const blockedProjects = state.projects.filter((project) => project.status === "blocked").length;
  const activeRuns = state.runs.filter((run) => !["completed", "cancelled"].includes(run.status));

  return (
    <aside className={cn("flex min-h-0 flex-col gap-3", className)}>
      <BaseCard padding="comfortable" className="gap-3">
        <BaseCardHeader title="Company context">
          <span className="text-meta">{state.pulse?.organization ?? "BureauOS"}</span>
        </BaseCardHeader>
        <div className="grid grid-cols-2 gap-2">
          <PulseStat icon={CheckCircle2} label="Approvals" value={String(pendingApprovals)} />
          <PulseStat icon={Calendar} label="Blockers" value={String(blockedProjects)} />
          <PulseStat icon={Sparkles} label="Runs" value={String(activeRuns.length)} />
          <PulseStat icon={MessageSquare} label="Pipeline" value={formatMoney(pipelineValue)} />
        </div>
      </BaseCard>

      <BaseCard padding="comfortable" className="gap-2">
        <BaseCardHeader title="Next queue">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onModeChange("today")}
            className="text-meta"
          >
            Inbox
            <ArrowRight className="h-3 w-3" />
          </Button>
        </BaseCardHeader>
        <div className="flex flex-col gap-2">
          {nextActions.length === 0 ? (
            <div className="rounded-md border border-border/60 bg-background/35 p-3 text-meta">
              No urgent owner action.
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
        <BaseCardHeader title="Recent artifacts">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onModeChange("memory")}
            className="text-meta"
          >
            All
            <ArrowRight className="h-3 w-3" />
          </Button>
        </BaseCardHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-2 pr-2">
            {recentArtifacts.length === 0 ? (
              <div className="text-meta">No artifacts yet.</div>
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
                      {artifact.created ? timeAgo(artifact.created) : "created"}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </BaseCard>

      <BaseCard padding="comfortable" className="gap-2">
        <BaseCardHeader title="Agent bench">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onModeChange("agents")}
            className="text-meta"
          >
            Open
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
          {state.agents.length === 0 ? <span className="text-meta">No agents loaded</span> : null}
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
