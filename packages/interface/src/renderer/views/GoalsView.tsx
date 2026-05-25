import { ArrowRight, Flag, Target, TrendingDown } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { GoalCard } from "../components/dashboard/GoalCard";
import { StatusPill } from "../components/dashboard/StatusPill";
import { Button } from "../components/ui/button";
import { buildGoalItems } from "../lib/builders";
import type { AdaptiveMode, DashboardState } from "../lib/types";

export function GoalsView({
  state,
  onModeChange,
}: {
  state: DashboardState;
  onModeChange: (mode: AdaptiveMode) => void;
}) {
  const goals = buildGoalItems(state);
  const averageProgress = goals.length
    ? Math.round(goals.reduce((sum, goal) => sum + goal.progress, 0) / goals.length)
    : 0;
  const atRisk = goals.filter((goal) => goal.tone === "danger" || goal.tone === "warning").length;
  const nextGoal = goals[0];

  return (
    <SectionShell
      title="Goals"
      description="Company OKRs and operating milestones derived from current registries."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile
          label="Goal health"
          value={`${averageProgress}%`}
          detail="Average objective progress"
          icon={Target}
          tone={averageProgress >= 70 ? "success" : averageProgress >= 40 ? "warning" : "danger"}
        />
        <MetricTile
          label="At risk"
          value={String(atRisk)}
          detail="Needs owner or coordinator attention"
          icon={TrendingDown}
          tone={atRisk > 0 ? "warning" : "success"}
        />
        <MetricTile
          label="Next milestone"
          value={nextGoal ? `${nextGoal.progress}%` : "0%"}
          detail={nextGoal?.title ?? "No goals loaded"}
          icon={Flag}
          tone={nextGoal?.tone ?? "neutral"}
        />
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-2">
        {goals.map((goal) => (
          <GoalCard key={goal.id} goal={goal} onOpen={() => onModeChange(goal.route)} />
        ))}
      </div>

      <div className="mt-5 overflow-hidden rounded-lg border border-border/70">
        <div className="grid grid-cols-[minmax(0,1fr)_120px_120px] bg-surface-subtle/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Milestone</span>
          <span>Progress</span>
          <span />
        </div>
        {goals.slice(0, 6).map((goal) => (
          <div
            key={`milestone:${goal.id}`}
            className="grid grid-cols-[minmax(0,1fr)_120px_120px] items-center gap-3 border-t border-border/60 px-4 py-3 text-[11px]"
          >
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">{goal.nextAction}</div>
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{goal.target}</div>
            </div>
            <StatusPill value={`${goal.progress}%`} tone={goal.tone} />
            <Button variant="outline" size="sm" onClick={() => onModeChange(goal.route)}>
              Open
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}
