import { useEffect, useState } from "react";
import { Bell, Command, Menu, MessageSquare, Moon } from "lucide-react";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { formatDate, formatMoney, formatTime } from "../../lib/format";
import { buildTodayActions } from "../../lib/builders";
import { toneIndicatorClass, toneTextClass, type Tone } from "../../lib/tone";
import type { AdaptiveMode, DashboardState } from "../../lib/types";

const QUICK_MODES: { id: AdaptiveMode; label: string }[] = [
  { id: "portfolio", label: "Portfolio" },
  { id: "today", label: "Today" },
  { id: "goals", label: "Goals" },
];

const MODE_LABELS: Record<AdaptiveMode, string> = {
  coordinator: "Coordinator",
  portfolio: "Portfolio",
  today: "Today",
  goals: "Goals",
  revenue: "Revenue",
  delivery: "Delivery",
  growth: "Growth",
  clients: "Clients",
  risk: "Risk",
  approvals: "Approvals",
  memory: "Memory",
  agents: "Agents",
  reports: "Reports",
  settings: "Settings",
};

export function Header({
  state,
  mode,
  onModeChange,
  onOpenSidebar,
  onOpenQuickChat,
  onOpenApprovals,
}: {
  state: DashboardState;
  mode: AdaptiveMode;
  onModeChange: (mode: AdaptiveMode) => void;
  onOpenSidebar: () => void;
  onOpenQuickChat: () => void;
  onOpenApprovals: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const blockedProjects = state.projects.filter((project) => project.status === "blocked").length;
  const localNotifications = state.notifications.filter(
    (notification) => notification.status !== "dismissed",
  ).length;
  const bellCount = localNotifications || state.approvals.length;
  const riskTone: Tone =
    blockedProjects > 0 ? "danger" : state.approvals.length > 0 ? "warning" : "success";
  const riskLabel =
    blockedProjects > 0
      ? `${blockedProjects} blocked`
      : state.approvals.length > 0
        ? `${state.approvals.length} approvals`
        : "Clear";
  const pipeline = state.pulse?.revenue.pipeline_value ?? 0;
  const autonomyTone: Tone = state.error ? "danger" : state.loading ? "warning" : "success";
  const autonomyLabel = state.error ? "Offline" : state.loading ? "Connecting" : "Active";
  const nextAction = buildTodayActions(state)[0];

  return (
    <header className="flex h-16 items-center gap-3 border-b border-border/60 bg-surface/95 px-3 sm:px-5">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenSidebar}
        aria-label="Open navigation"
      >
        <Menu className="h-4 w-4" />
      </Button>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <div className="truncate whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Operating Room
            </div>
            <h1 className="truncate text-[15px] font-semibold text-foreground">
              {MODE_LABELS[mode]}
            </h1>
          </div>
          <div className="hidden items-center gap-1 text-[11px] text-muted-foreground lg:flex">
            <span aria-hidden>·</span>
            {QUICK_MODES.map((item, index) => (
              <div key={item.id} className="flex items-center gap-1">
                <button
                  onClick={() => onModeChange(item.id)}
                  className={cn(
                    "h-7 rounded-md px-2 transition-colors hover:bg-surface-subtle hover:text-foreground focus-ring",
                    mode === item.id ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </button>
                {index < QUICK_MODES.length - 1 ? (
                  <span className="text-border" aria-hidden>
                    /
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {nextAction
            ? `Next: ${nextAction.title} · ${nextAction.source}`
            : `${state.pulse?.organization ?? "BureauOS"} · no urgent action`}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden md:flex items-center gap-2">
          <TopMetric tone={autonomyTone} label="Autonomous" value={autonomyLabel} />
          <TopMetric tone={riskTone} label="Risk" value={riskLabel} className="hidden lg:flex" />
          <TopMetric
            tone={pipeline > 0 ? "success" : "warning"}
            label="Revenue"
            value={pipeline > 0 ? formatMoney(pipeline) : "No pipeline"}
            className="hidden xl:flex"
          />
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenQuickChat}
              className="hidden md:inline-flex"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Quick chat
              <span className="ml-1 inline-flex items-center gap-0.5 rounded border border-border/70 bg-surface-raised px-1 py-0.5 text-[9px] text-muted-foreground">
                <Command className="h-2.5 w-2.5" />K
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Quick chat with coordinator (⌘K)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden relative"
              onClick={onOpenQuickChat}
              aria-label="Quick chat with coordinator"
            >
              <MessageSquare className="h-4 w-4" />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Quick chat</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hidden sm:inline-flex"
              aria-label="Theme"
            >
              <Moon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Dark mode</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative"
              onClick={onOpenApprovals}
              aria-label="Open pending approvals"
            >
              <Bell className="h-4 w-4" />
              {bellCount > 0 ? (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-warning" />
              ) : null}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {localNotifications > 0
              ? `${localNotifications} local notifications`
              : `${state.approvals.length} pending approvals`}
          </TooltipContent>
        </Tooltip>

        <div className="hidden flex-col text-right text-[10px] leading-tight text-muted-foreground xl:flex">
          <span className="text-foreground/80">{formatDate(now)}</span>
          <span>{formatTime(now)}</span>
        </div>

        <Avatar className="h-8 w-8">
          <AvatarFallback>ED</AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}

function TopMetric({
  tone,
  label,
  value,
  className,
}: {
  tone: Tone;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg border border-border/60 bg-background/35 px-3",
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", toneIndicatorClass[tone])} />
      <div className="leading-tight">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn("text-[11px] font-medium", toneTextClass[tone])}>{value}</div>
      </div>
    </div>
  );
}
