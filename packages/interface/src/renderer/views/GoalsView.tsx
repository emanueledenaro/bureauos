import { ArrowRight, Flag, Target, TrendingDown } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { GoalCard } from "../components/dashboard/GoalCard";
import { StatusPill } from "../components/dashboard/StatusPill";
import { KpiBar } from "../components/dashboard/KpiBar";
import { DataTable, type DataTableColumn } from "../components/dashboard/DataTable";
import { Button } from "../components/ui/button";
import { buildGoalItems } from "../lib/builders";
import type { AdaptiveMode, DashboardState, GoalItem } from "../lib/types";

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

  const columns: DataTableColumn<GoalItem>[] = [
    {
      id: "milestone",
      header: "Milestone",
      width: "minmax(0,1fr)",
      render: (goal) => (
        <div className="min-w-0">
          <div className="text-body truncate font-medium text-foreground">{goal.nextAction}</div>
          <div className="text-meta mt-0.5 truncate">{goal.target}</div>
        </div>
      ),
    },
    {
      id: "progress",
      header: "Progress",
      width: "120px",
      render: (goal) => <StatusPill value={`${goal.progress}%`} tone={goal.tone} />,
    },
    {
      id: "open",
      header: "",
      width: "120px",
      align: "end",
      hideOnMobile: true,
      render: (goal) => (
        <Button variant="outline" size="sm" onClick={() => onModeChange(goal.route)}>
          Open
          <ArrowRight className="h-3 w-3" />
        </Button>
      ),
    },
  ];

  return (
    <SectionShell
      title="Goals"
      description="Company OKRs and operating milestones derived from current registries."
    >
      <KpiBar>
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
      </KpiBar>

      <div className="mt-section grid gap-3 xl:grid-cols-2">
        {goals.map((goal) => (
          <GoalCard key={goal.id} goal={goal} onOpen={() => onModeChange(goal.route)} />
        ))}
      </div>

      <DataTable
        className="mt-section"
        columns={columns}
        rows={goals.slice(0, 6)}
        rowKey={(goal) => `milestone:${goal.id}`}
        mobileFallback="cards"
        emptyState={{
          title: "No goals loaded",
          description: "Goals derive from the current company registries.",
        }}
      />
    </SectionShell>
  );
}
