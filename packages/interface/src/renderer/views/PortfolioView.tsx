import { useMemo } from "react";
import {
  Filter,
  KanbanSquare,
  LayoutGrid,
  ListChecks,
  MoreHorizontal,
  Workflow,
} from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Badge } from "../components/ui/badge";
import { WorkstreamCard } from "../components/dashboard/WorkstreamCard";
import { EmptyState } from "../components/dashboard/EmptyState";
import { buildCapacitySegments, buildPortfolioLanes } from "../lib/builders";
import { cn } from "../lib/utils";
import type { DashboardState } from "../lib/types";

export function PortfolioView({ state }: { state: DashboardState }) {
  const lanes = useMemo(() => buildPortfolioLanes(state), [state]);
  const capacitySegments = useMemo(() => buildCapacitySegments(state), [state]);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-5 py-3.5">
        <div>
          <h2 className="text-[14px] font-semibold text-foreground">Portfolio Operating Room</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Live portfolio view of workstreams, projects, and autonomous execution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Filter className="h-3 w-3" />
            Filters
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="More">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Tabs defaultValue="map">
        <div className="border-b border-border/60 px-5">
          <TabsList className="border-b-0">
            <TabsTrigger value="map">
              <LayoutGrid className="mr-1.5 h-3 w-3" />
              Portfolio Map
            </TabsTrigger>
            <TabsTrigger value="workload">
              <ListChecks className="mr-1.5 h-3 w-3" />
              Workload
            </TabsTrigger>
            <TabsTrigger value="gantt">
              <Workflow className="mr-1.5 h-3 w-3" />
              Gantt
            </TabsTrigger>
            <TabsTrigger value="kanban">
              <KanbanSquare className="mr-1.5 h-3 w-3" />
              Kanban
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="px-5 py-5">
          {lanes.length > 0 ? (
            <div className="grid gap-x-7 gap-y-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
              {lanes.map((lane, laneIndex) => (
                <div key={lane.key} className="relative flex min-w-0 flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-foreground">
                        {lane.label}
                      </div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {lane.subtitle}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] font-semibold text-foreground">
                        {lane.capacityPercent}%
                      </div>
                      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                        Capacity
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    {lane.streams.map((item, index) => (
                      <WorkstreamCard
                        key={`${item.id}-${index}`}
                        item={item}
                        laneIndex={laneIndex}
                      />
                    ))}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {lane.streams[0]?.badges.map((badge) => (
                      <Badge
                        key={badge}
                        variant="outline"
                        className="h-5 px-2 text-[9px] font-mono uppercase"
                      >
                        {badge}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title={state.loading ? "Loading company memory" : "No active workstreams"}
              description={
                state.loading
                  ? "The Operating Room is reading local BureauOS state."
                  : "Send an intake message to create the first client, project, opportunity, and approval trail."
              }
            />
          )}

          <div className="mt-6 flex flex-col gap-3 border-t border-border/60 pt-4 lg:flex-row lg:items-center">
            <div className="w-48 shrink-0">
              <div className="text-[12px] font-semibold text-foreground">Capacity Allocation</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Live distribution of team capacity.
              </div>
            </div>
            <div className="flex-1">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                {capacitySegments.map((segment) => (
                  <div
                    key={segment.label}
                    className={cn("h-full transition-all", segment.toneClass)}
                    style={{ width: `${segment.width}%` }}
                    title={`${segment.label} · ${segment.value}`}
                  />
                ))}
              </div>
              <div className="mt-3 grid gap-y-1 grid-cols-2 lg:grid-cols-4 text-[10px]">
                {capacitySegments.map((segment) => (
                  <div key={segment.label} className="flex items-center gap-1.5">
                    <span className={cn("h-1.5 w-1.5 rounded-full", segment.toneClass)} />
                    <span className="text-foreground/90 font-medium">{segment.label}</span>
                    <span className="text-muted-foreground">{segment.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Tabs>
    </Card>
  );
}
