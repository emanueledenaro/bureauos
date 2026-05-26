import { useMemo } from "react";
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  FileText,
  History,
  MessageSquare,
  Sparkles,
} from "lucide-react";
import { CoordinatorPanel } from "../components/coordinator/CoordinatorPanel";
import { SectionShell } from "../components/dashboard/SectionShell";
import { BaseCard, BaseCardHeader } from "../components/dashboard/BaseCard";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { Avatar, AvatarFallback } from "../components/ui/avatar";
import { cn } from "../lib/utils";
import { formatLabel, formatMoney, timeAgo } from "../lib/format";
import { sortNewest } from "../lib/builders";
import type { CoordinatorAttachmentInput, CoordinatorChatResult } from "../lib/api";
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
  onModeChange,
}: {
  state: DashboardState;
  onMessage: (
    message: string,
    attachments?: CoordinatorAttachmentInput[],
  ) => Promise<CoordinatorChatResult>;
  onModeChange: (mode: AdaptiveMode) => void;
}) {
  return (
    <div className="grid h-full min-h-0 gap-3 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_320px] 2xl:grid-cols-[280px_minmax(0,1fr)_360px]">
      <HistoryColumn className="hidden lg:flex" />
      <div className="flex min-h-0 min-w-0 flex-col">
        <CoordinatorPanel onMessage={onMessage} />
      </div>
      <ContextColumn className="hidden xl:flex" state={state} onModeChange={onModeChange} />
    </div>
  );
}

function HistoryColumn({ className }: { className?: string }) {
  // Placeholder: oggi il backend serve un singolo thread.
  // L'archivio per sessione arriverà quando l'API esporrà thread separati.
  const buckets = [
    { id: "today", label: "Today", count: 1 },
    { id: "week", label: "This week", count: 0 },
    { id: "archive", label: "Archive", count: 0 },
  ];
  return (
    <aside className={cn("flex min-h-0 flex-col gap-3", className)}>
      <SectionShell
        title="Threads"
        description="Conversation history with the coordinator."
        contentClassName="p-0"
      >
        <ScrollArea className="h-full max-h-[calc(100vh-220px)]">
          <div className="flex flex-col gap-1 p-3">
            {buckets.map((bucket) => (
              <button
                key={bucket.id}
                className={cn(
                  "group flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left transition-colors focus-ring",
                  bucket.id === "today"
                    ? "bg-surface-raised text-foreground"
                    : "text-muted-foreground hover:bg-surface-subtle hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-2">
                  <History className="h-3.5 w-3.5" />
                  <span className="text-body-secondary font-medium">{bucket.label}</span>
                </span>
                <span className="text-meta">{bucket.count}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </SectionShell>
      <BaseCard padding="comfortable" className="gap-2">
        <BaseCardHeader title="Tips" />
        <ul className="text-meta space-y-1.5 leading-relaxed">
          <li>
            <span className="text-foreground">⌘ + ↵</span> to send a message.
          </li>
          <li>Attach images, PDF, CSV, JSON, MD up to 10 MB.</li>
          <li>The coordinator will create approvals before any external action.</li>
        </ul>
      </BaseCard>
    </aside>
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
  const pendingApprovals = state.approvals.length;
  const pipelineValue = state.pulse?.revenue.pipeline_value ?? 0;
  const blockedProjects = state.projects.filter((project) => project.status === "blocked").length;

  return (
    <aside className={cn("flex min-h-0 flex-col gap-3", className)}>
      <BaseCard padding="comfortable" className="gap-3">
        <BaseCardHeader title="Workspace pulse">
          <span className="text-meta">{state.pulse?.organization ?? "BureauOS"}</span>
        </BaseCardHeader>
        <div className="grid grid-cols-2 gap-2">
          <PulseStat icon={CheckCircle2} label="Approvals" value={String(pendingApprovals)} />
          <PulseStat icon={Calendar} label="Blockers" value={String(blockedProjects)} />
          <PulseStat icon={Sparkles} label="Agents" value={String(state.agents.length)} />
          <PulseStat icon={MessageSquare} label="Pipeline" value={formatMoney(pipelineValue)} />
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
              <div className="text-meta">
                No artifacts yet. They appear after the coordinator runs.
              </div>
            ) : (
              recentArtifacts.map((artifact) => (
                <div
                  key={artifact.id}
                  className="flex items-start gap-2.5 rounded-md border border-border/60 bg-surface-subtle p-2.5"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/60 bg-surface-raised text-muted-foreground">
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
        <BaseCardHeader title="Live agents" />
        <div className="flex flex-wrap gap-1.5">
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
