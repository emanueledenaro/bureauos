import { useEffect, useState } from "react";
import { Bell, Moon } from "lucide-react";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../lib/utils";
import { formatDate, formatMoney, formatTime } from "../../lib/format";
import { toneIndicatorClass, toneTextClass, type Tone } from "../../lib/tone";
import type { AdaptiveMode, DashboardState } from "../../lib/types";

const QUICK_MODES: { id: AdaptiveMode; label: string }[] = [
  { id: "portfolio", label: "Portfolio" },
  { id: "today", label: "Today" },
  { id: "goals", label: "Goals" },
];

export function Header({
  state,
  mode,
  onModeChange,
}: {
  state: DashboardState;
  mode: AdaptiveMode;
  onModeChange: (mode: AdaptiveMode) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const blockedProjects = state.projects.filter((project) => project.status === "blocked").length;
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

  return (
    <header className="flex h-16 items-center justify-between gap-4 border-b border-border/60 bg-surface px-5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <h1 className="text-[15px] font-semibold text-foreground">Company Pulse</h1>
          <div className="hidden items-center gap-1 text-[11px] text-muted-foreground md:flex">
            <span className="uppercase tracking-wide text-[10px]">Adaptive</span>
            <span aria-hidden>·</span>
            {QUICK_MODES.map((item, index) => (
              <button
                key={item.id}
                onClick={() => onModeChange(item.id)}
                className={cn(
                  "transition-colors hover:text-foreground focus-ring rounded-sm px-1",
                  mode === item.id ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {item.label}
                {index < QUICK_MODES.length - 1 ? <span className="ml-1 text-border">/</span> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {state.pulse?.organization ?? "BureauOS"} · Operating Room
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <div className="hidden items-center gap-2 xl:flex">
          <TopMetric tone={autonomyTone} label="Autonomous Mode" value={autonomyLabel} />
          <TopMetric tone={riskTone} label="Risk Level" value={riskLabel} />
          <TopMetric
            tone={pipeline > 0 ? "success" : "warning"}
            label="Revenue Health"
            value={pipeline > 0 ? formatMoney(pipeline) : "No pipeline"}
          />
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Theme">
              <Moon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Dark mode</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
              <Bell className="h-4 w-4" />
              {state.approvals.length > 0 ? (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-warning" />
              ) : null}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{state.approvals.length} pending approvals</TooltipContent>
        </Tooltip>

        <div className="hidden flex-col text-right text-[10px] leading-tight text-muted-foreground sm:flex">
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

function TopMetric({ tone, label, value }: { tone: Tone; label: string; value: string }) {
  return (
    <div className="flex h-9 items-center gap-2.5 rounded-md border border-border/70 bg-surface-subtle px-3">
      <span className={cn("h-1.5 w-1.5 rounded-full", toneIndicatorClass[tone])} />
      <div className="leading-tight">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn("text-[11px] font-medium", toneTextClass[tone])}>{value}</div>
      </div>
    </div>
  );
}
