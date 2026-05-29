import { useMemo, useState } from "react";
import {
  Archive,
  CircleAlert,
  KanbanSquare,
  LayoutGrid,
  ListChecks,
  RotateCcw,
  Workflow,
} from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Badge } from "../components/ui/badge";
import { WorkstreamCard } from "../components/dashboard/WorkstreamCard";
import { EmptyState } from "../components/dashboard/EmptyState";
import { BaseCard, BaseCardHeader } from "../components/dashboard/BaseCard";
import { StatusPill } from "../components/dashboard/StatusPill";
import { MiniStat } from "../components/dashboard/MetricTile";
import { buildCapacitySegments, buildPortfolioLanes, clientName } from "../lib/builders";
import {
  opportunityProgress,
  opportunityTone,
  projectProgress,
  projectTone,
  runProgress,
  runTone,
  toneBadgeVariant,
  toneProgressClass,
  type Tone,
} from "../lib/tone";
import { cn } from "../lib/utils";
import { formatLabel, formatMoney, timeAgo } from "../lib/format";
import type { DashboardState, PortfolioLane } from "../lib/types";
import type { ApprovalRecord } from "../lib/api";

type PortfolioTab = "map" | "workload" | "timeline" | "kanban";
type RecordKind = "project" | "opportunity" | "run";

interface PortfolioRecord {
  id: string;
  kind: RecordKind;
  title: string;
  status: string;
  tone: Tone;
  progress: number;
  clientId?: string;
  clientName: string;
  projectId?: string;
  agents: string[];
  risk: boolean;
  value?: number;
  meta: string;
  created?: string;
  updated?: string;
  sortDate?: string;
}

interface PortfolioFilters {
  client: string;
  status: string;
  agent: string;
  riskOnly: boolean;
  includeClosed: boolean;
}

const ALL = "all";
const UNASSIGNED_AGENT = "unassigned";
const DEFAULT_FILTERS: PortfolioFilters = {
  client: ALL,
  status: ALL,
  agent: ALL,
  riskOnly: false,
  includeClosed: false,
};

const RISK_RUN_STATUSES = new Set(["needs_human", "blocked", "failed"]);
const RISK_OPPORTUNITY_STATUSES = new Set(["stalled"]);
const TIMELINE_GRID_TEMPLATE = "minmax(160px, 260px) minmax(0, 1fr)";
const CLOSED_PORTFOLIO_STATUSES = new Set([
  "cancelled",
  "canceled",
  "completed",
  "delivered",
  "done",
  "lost",
  "won",
]);

export function PortfolioView({ state }: { state: DashboardState }) {
  const [tab, setTab] = useState<PortfolioTab>("map");
  const [filters, setFilters] = useState<PortfolioFilters>(DEFAULT_FILTERS);
  const lanes = useMemo(() => buildPortfolioLanes(state), [state]);
  const capacitySegments = useMemo(() => buildCapacitySegments(state), [state]);
  const records = useMemo(() => buildPortfolioRecords(state), [state]);
  const scopedRecords = useMemo(
    () => (filters.includeClosed ? records : records.filter((record) => !isClosedRecord(record))),
    [filters.includeClosed, records],
  );
  const filteredRecords = useMemo(
    () => scopedRecords.filter((record) => matchesFilters(record, filters)),
    [filters, scopedRecords],
  );
  const filteredLanes = useMemo(
    () => filterPortfolioLanes(lanes, filteredRecords),
    [filteredRecords, lanes],
  );
  const filterOptions = useMemo(() => buildFilterOptions(records), [records]);
  const closedRecordCount = records.filter(isClosedRecord).length;
  const activeFilterCount = [
    filters.client !== ALL,
    filters.status !== ALL,
    filters.agent !== ALL,
    filters.riskOnly,
    filters.includeClosed,
  ].filter(Boolean).length;
  const mapStreamCount = filteredLanes.reduce((sum, lane) => sum + lane.streams.length, 0);

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
          <Badge variant={activeFilterCount > 0 ? "info" : "outline"}>
            {activeFilterCount} filters
          </Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reset portfolio filters"
            disabled={activeFilterCount === 0}
            onClick={() => setFilters(DEFAULT_FILTERS)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as PortfolioTab)}>
        <div className="border-b border-border/60 px-5">
          <TabsList className="h-auto max-w-full flex-wrap items-start border-b-0 py-1 sm:h-9 sm:flex-nowrap sm:items-center sm:py-0">
            <TabsTrigger value="map" className="h-8 px-2.5 sm:h-9 sm:px-3">
              <LayoutGrid className="mr-1.5 h-3 w-3" />
              Portfolio Map
            </TabsTrigger>
            <TabsTrigger value="workload" className="h-8 px-2.5 sm:h-9 sm:px-3">
              <ListChecks className="mr-1.5 h-3 w-3" />
              Workload
            </TabsTrigger>
            <TabsTrigger value="timeline" className="h-8 px-2.5 sm:h-9 sm:px-3">
              <Workflow className="mr-1.5 h-3 w-3" />
              Activity timeline
            </TabsTrigger>
            <TabsTrigger value="kanban" className="h-8 px-2.5 sm:h-9 sm:px-3">
              <KanbanSquare className="mr-1.5 h-3 w-3" />
              Kanban
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="border-b border-border/60 bg-surface-subtle/20 px-5 py-3">
          <PortfolioFilterBar
            filters={filters}
            options={filterOptions}
            activeFilterCount={activeFilterCount}
            resultCount={filteredRecords.length}
            closedRecordCount={closedRecordCount}
            onChange={setFilters}
            onReset={() => setFilters(DEFAULT_FILTERS)}
          />
        </div>

        <div className="px-5 py-5">
          <TabsContent value="map" className="m-0">
            <PortfolioMapContent
              lanes={filteredLanes}
              loading={state.loading}
              filtered={activeFilterCount > 0}
              includeClosed={filters.includeClosed}
              visibleStreams={mapStreamCount}
              closedRecordCount={closedRecordCount}
            />
          </TabsContent>

          <TabsContent value="workload" className="m-0">
            <WorkloadContent records={filteredRecords} />
          </TabsContent>

          <TabsContent value="timeline" className="m-0">
            <ActivityTimelineContent records={filteredRecords} />
          </TabsContent>

          <TabsContent value="kanban" className="m-0">
            <KanbanContent records={filteredRecords} />
          </TabsContent>

          <CapacityAllocation segments={capacitySegments} />
        </div>
      </Tabs>
    </Card>
  );
}

function PortfolioFilterBar({
  filters,
  options,
  activeFilterCount,
  resultCount,
  closedRecordCount,
  onChange,
  onReset,
}: {
  filters: PortfolioFilters;
  options: {
    clients: { id: string; label: string }[];
    statuses: string[];
    agents: string[];
  };
  activeFilterCount: number;
  resultCount: number;
  closedRecordCount: number;
  onChange: (filters: PortfolioFilters) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <FilterSelect
          label="Client"
          value={filters.client}
          onValueChange={(client) => onChange({ ...filters, client })}
          items={[
            { value: ALL, label: "All clients" },
            ...options.clients.map((client) => ({
              value: client.id,
              label: client.label,
            })),
          ]}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onValueChange={(status) => onChange({ ...filters, status })}
          items={[
            { value: ALL, label: "All statuses" },
            ...options.statuses.map((status) => ({
              value: status,
              label: formatLabel(status),
            })),
          ]}
        />
        <FilterSelect
          label="Agent"
          value={filters.agent}
          onValueChange={(agent) => onChange({ ...filters, agent })}
          items={[
            { value: ALL, label: "All agents" },
            ...options.agents.map((agent) => ({
              value: agent,
              label: formatLabel(agent),
            })),
          ]}
        />
        <div className="flex flex-col gap-1">
          <div className="text-eyebrow">Risk</div>
          <Button
            variant={filters.riskOnly ? "default" : "outline"}
            size="sm"
            className="h-8 justify-start"
            onClick={() => onChange({ ...filters, riskOnly: !filters.riskOnly })}
          >
            <CircleAlert className="h-3.5 w-3.5" />
            Active risk only
          </Button>
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-eyebrow">Scope</div>
          <Button
            variant={filters.includeClosed ? "default" : "outline"}
            size="sm"
            className="h-8 justify-start"
            onClick={() => onChange({ ...filters, includeClosed: !filters.includeClosed })}
          >
            <Archive className="h-3.5 w-3.5" />
            {filters.includeClosed ? "Showing closed" : "Active only"}
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 lg:justify-end">
        <span className="text-meta">
          {resultCount} record{resultCount === 1 ? "" : "s"} · {closedRecordCount} closed
        </span>
        <Button variant="ghost" size="sm" disabled={activeFilterCount === 0} onClick={onReset}>
          Reset
        </Button>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  items,
  onValueChange,
}: {
  label: string;
  value: string;
  items: { value: string; label: string }[];
  onValueChange: (value: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="text-eyebrow">{label}</div>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger aria-label={`${label} filter`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function PortfolioMapContent({
  lanes,
  loading,
  filtered,
  includeClosed,
  visibleStreams,
  closedRecordCount,
}: {
  lanes: PortfolioLane[];
  loading: boolean;
  filtered: boolean;
  includeClosed: boolean;
  visibleStreams: number;
  closedRecordCount: number;
}) {
  if (lanes.length === 0) {
    return (
      <EmptyState
        title={
          loading
            ? "Loading company memory"
            : filtered
              ? "No matching workstreams"
              : "No active workstreams"
        }
        description={
          loading
            ? "The Operating Room is reading local BureauOS state."
            : filtered
              ? includeClosed || closedRecordCount === 0
                ? "Adjust filters to include more clients, statuses, agents, or risk states."
                : "Show closed work to include completed, cancelled, won, or lost records."
              : "Send an intake message to create the first client, project, opportunity, and approval trail."
        }
      />
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-section-title">Portfolio Map</h3>
          <p className="text-meta mt-0.5">
            {visibleStreams} visible {includeClosed ? "total" : "active"} project and revenue
            streams.
          </p>
        </div>
        {!includeClosed && closedRecordCount > 0 ? (
          <Badge variant="outline">{closedRecordCount} closed hidden</Badge>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-x-7 gap-y-4 md:grid-cols-2 xl:grid-cols-4">
        {lanes.map((lane, laneIndex) => (
          <div key={lane.key} className="relative flex min-w-0 flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-foreground">
                  {lane.label}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">{lane.subtitle}</div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-semibold text-foreground">
                  {lane.capacityPercent}%
                </div>
                <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                  Of visible work
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {lane.streams.map((item, index) => (
                <WorkstreamCard key={`${item.id}-${index}`} item={item} laneIndex={laneIndex} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function WorkloadContent({ records }: { records: PortfolioRecord[] }) {
  const groups = useMemo(() => buildWorkloadGroups(records), [records]);
  if (groups.length === 0) {
    return (
      <EmptyState
        title="No workload to show"
        description="Projects, opportunities, and runs with agent ownership appear here."
      />
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
      {groups.map((group) => (
        <BaseCard key={group.agent} className="gap-3">
          <BaseCardHeader
            title={formatLabel(group.agent)}
            subtitle={`${group.records.length} assigned record${group.records.length === 1 ? "" : "s"}`}
          >
            <Badge variant={group.riskCount > 0 ? "warning" : "outline"}>
              {group.riskCount} risk
            </Badge>
          </BaseCardHeader>
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Active" value={String(group.activeCount)} />
            <MiniStat label="Runs" value={String(group.runCount)} />
            <MiniStat label="Clients" value={String(group.clientCount)} />
          </div>
          <div className="flex flex-col gap-2">
            {group.records.slice(0, 5).map((record) => (
              <PortfolioRecordRow
                key={`${group.agent}:${record.kind}:${record.id}`}
                record={record}
              />
            ))}
          </div>
        </BaseCard>
      ))}
    </div>
  );
}

function ActivityTimelineContent({ records }: { records: PortfolioRecord[] }) {
  const dated = records.filter((record) => record.created || record.updated);
  const range = buildTimelineRange(dated);

  if (dated.length === 0 || !range) {
    return (
      <EmptyState
        title="No dated portfolio records"
        description="Created and updated timestamps from projects, opportunities, and runs are needed for the activity timeline."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-card/95">
      <div className="border-b border-border/60 bg-surface-subtle/35 px-4 py-2 text-[10px] text-muted-foreground">
        Bars span first-seen to last-activity, not planned duration or effort.
      </div>
      <div
        className="grid gap-3 border-b border-border/60 bg-surface-subtle/35 px-4 py-3 text-eyebrow"
        style={{ gridTemplateColumns: TIMELINE_GRID_TEMPLATE }}
      >
        <span>Record</span>
        <span className="min-w-0">Activity span</span>
      </div>
      <div className="divide-y divide-border/60">
        {dated.map((record) => {
          const start = record.created ?? record.updated ?? "";
          const end = record.updated ?? record.created ?? "";
          const startTime = Date.parse(start);
          const endTime = Date.parse(end);
          const left = range.percent(startTime);
          const width = Math.max(10, range.percent(endTime) - left + 8);
          return (
            <div
              key={`${record.kind}:${record.id}`}
              className="grid gap-3 px-4 py-3"
              style={{ gridTemplateColumns: TIMELINE_GRID_TEMPLATE }}
            >
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold text-foreground">
                  {record.title}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <StatusPill value={formatLabel(record.status)} tone={record.tone} />
                  <span className="text-meta">{record.clientName}</span>
                </div>
              </div>
              <div className="min-w-0">
                <div className="relative h-8 rounded-md border border-border/60 bg-background/35">
                  <div
                    className={cn(
                      "absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full",
                      toneProgressClass[record.tone],
                    )}
                    style={{
                      left: `${Math.min(left, 92)}%`,
                      width: `${Math.min(width, 100 - Math.min(left, 92))}%`,
                    }}
                  />
                </div>
                <div className="mt-1 flex justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>{start ? `First seen ${timeAgo(start)}` : "No start"}</span>
                  <span>{end ? `Last activity ${timeAgo(end)}` : "No update"}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KanbanContent({ records }: { records: PortfolioRecord[] }) {
  const groups = useMemo(() => buildStatusGroups(records), [records]);
  if (groups.length === 0) {
    return (
      <EmptyState
        title="No cards match filters"
        description="Portfolio Kanban renders project, opportunity, and run records from local state."
      />
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-3 2xl:grid-cols-4">
      {groups.map((group) => (
        <div key={group.status} className="min-w-0 rounded-lg border border-border/70 bg-card/95">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-surface-subtle/35 px-3 py-2.5">
            <div className="text-[12px] font-semibold text-foreground">
              {formatLabel(group.status)}
            </div>
            <Badge variant={toneBadgeVariant[group.tone]}>{group.records.length}</Badge>
          </div>
          <div className="flex flex-col gap-2 p-3">
            {group.records.map((record) => (
              <PortfolioRecordRow key={`${record.kind}:${record.id}`} record={record} framed />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PortfolioRecordRow({ record, framed }: { record: PortfolioRecord; framed?: boolean }) {
  return (
    <div
      className={cn(
        "min-w-0",
        framed && "rounded-md border border-border/60 bg-surface-subtle/45 p-2.5",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-foreground">{record.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{formatLabel(record.kind)}</Badge>
            <span className="text-meta truncate">{record.clientName}</span>
          </div>
        </div>
        <StatusPill value={formatLabel(record.status)} tone={record.tone} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full", toneProgressClass[record.tone])}
            style={{ width: `${record.progress}%` }}
          />
        </div>
        <span className="w-9 text-right text-[10px] text-muted-foreground">{record.progress}%</span>
      </div>
      <div className="mt-1 truncate text-[10px] text-muted-foreground">{record.meta}</div>
    </div>
  );
}

function CapacityAllocation({ segments }: { segments: ReturnType<typeof buildCapacitySegments> }) {
  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-border/60 pt-4 lg:flex-row lg:items-center">
      <div className="w-48 shrink-0">
        <div className="text-[12px] font-semibold text-foreground">Work mix</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          Share of tracked records by area, not team capacity.
        </div>
      </div>
      <div className="flex-1">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
          {segments.map((segment) => (
            <div
              key={segment.label}
              className={cn("h-full transition-all", segment.toneClass)}
              style={{ width: `${segment.width}%` }}
              title={`${segment.label} · ${segment.value}`}
            />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-y-1 text-[10px] lg:grid-cols-4">
          {segments.map((segment) => (
            <div key={segment.label} className="flex min-w-0 items-center gap-1.5">
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", segment.toneClass)} />
              <span className="truncate font-medium text-foreground/90">{segment.label}</span>
              <span className="truncate text-muted-foreground">{segment.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function buildPortfolioRecords(state: DashboardState): PortfolioRecord[] {
  const ownershipByProjectId = new Map(
    state.projectOwnership.map((ownership) => [ownership.project_id, ownership]),
  );

  const projectRecords = state.projects.map((project): PortfolioRecord => {
    const ownership = ownershipByProjectId.get(project.id);
    const agents = uniqueCompact([
      ownership?.manager_agent_id,
      ...(ownership?.assigned_agents ?? []),
      ownership?.escalation_agent_id,
      "project_manager",
    ]);
    return {
      id: project.id,
      kind: "project",
      title: project.name,
      status: project.status,
      tone: projectTone(project.status),
      progress: projectProgress(project.status),
      clientId: project.client_id,
      clientName: clientName(state.clients, project.client_id),
      projectId: project.id,
      agents,
      risk:
        project.status === "blocked" ||
        hasMatchingApproval(project.name, project.id, state.approvals),
      meta: project.repository || project.stack || "Project memory",
      created: project.created,
      updated: project.updated,
      sortDate: project.updated ?? project.created,
    };
  });

  const opportunityRecords = state.opportunities.map(
    (opportunity): PortfolioRecord => ({
      id: opportunity.id,
      kind: "opportunity",
      title: opportunity.title,
      status: opportunity.status,
      tone: opportunityTone(opportunity.status),
      progress: opportunityProgress(opportunity.status),
      clientId: opportunity.client_id,
      clientName: clientName(state.clients, opportunity.client_id),
      // No agent-ownership record exists for opportunities in kernel state, so
      // we mark them unassigned instead of fabricating sales/pricing/PM
      // ownership (SER-152). "unassigned" stays filterable and groupable.
      agents: [UNASSIGNED_AGENT],
      risk:
        RISK_OPPORTUNITY_STATUSES.has(opportunity.status) ||
        hasMatchingApproval(opportunity.title, opportunity.id, state.approvals),
      value: opportunity.expected_value,
      meta:
        opportunity.next_action ||
        `${formatMoney(opportunity.expected_value || 0)} · ${Math.round(opportunity.expected_margin || 0)}% margin`,
      created: opportunity.created,
      updated: opportunity.updated,
      sortDate: opportunity.updated ?? opportunity.created,
    }),
  );

  const runRecords = state.runs.map(
    (run): PortfolioRecord => ({
      id: run.id,
      kind: "run",
      title: `${formatLabel(run.type)} · ${run.scope}`,
      status: run.status,
      tone: runTone(run.status),
      progress: runProgress(run.status),
      clientId: run.client_id,
      clientName: run.client_id ? clientName(state.clients, run.client_id) : "No client",
      projectId: run.project_id,
      agents: uniqueCompact([run.created_by, "supreme_coordinator"]),
      risk: RISK_RUN_STATUSES.has(run.status),
      meta: run.source_work_item_id || run.trigger_source || run.trigger_type || "BureauOS run",
      created: run.created,
      updated: run.updated ?? run.completed,
      sortDate: run.updated ?? run.created,
    }),
  );

  return [...projectRecords, ...opportunityRecords, ...runRecords].sort((left, right) =>
    (right.sortDate ?? "").localeCompare(left.sortDate ?? ""),
  );
}

function matchesFilters(record: PortfolioRecord, filters: PortfolioFilters): boolean {
  if (filters.client !== ALL && record.clientId !== filters.client) return false;
  if (filters.status !== ALL && record.status !== filters.status) return false;
  if (filters.agent !== ALL && !record.agents.includes(filters.agent)) return false;
  if (filters.riskOnly && !record.risk) return false;
  return true;
}

function isClosedRecord(record: PortfolioRecord): boolean {
  return CLOSED_PORTFOLIO_STATUSES.has(record.status.toLowerCase());
}

function buildFilterOptions(records: PortfolioRecord[]): {
  clients: { id: string; label: string }[];
  statuses: string[];
  agents: string[];
} {
  const clients = new Map<string, string>();
  const statuses = new Set<string>();
  const agents = new Set<string>();
  for (const record of records) {
    if (record.clientId) clients.set(record.clientId, record.clientName);
    if (record.status) statuses.add(record.status);
    for (const agent of record.agents) agents.add(agent);
  }
  return {
    clients: [...clients.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    statuses: [...statuses].sort(),
    agents: [...agents].sort(),
  };
}

function filterPortfolioLanes(lanes: PortfolioLane[], records: PortfolioRecord[]): PortfolioLane[] {
  const visibleIds = new Set(
    records.filter((record) => record.kind !== "run").map((record) => record.id),
  );
  const filtered = lanes
    .map((lane) => ({
      ...lane,
      streams: lane.streams.filter((stream) => visibleIds.has(stream.id)),
    }))
    .filter((lane) => lane.streams.length > 0);
  const total = filtered.reduce((sum, lane) => sum + lane.streams.length, 0);
  return filtered.map((lane) => ({
    ...lane,
    capacityPercent: total ? Math.round((lane.streams.length / total) * 100) : 0,
    capacity: `${total ? Math.round((lane.streams.length / total) * 100) : 0}% Workload`,
    streams: lane.streams.slice(0, 5),
  }));
}

function buildWorkloadGroups(records: PortfolioRecord[]): {
  agent: string;
  records: PortfolioRecord[];
  riskCount: number;
  activeCount: number;
  runCount: number;
  clientCount: number;
}[] {
  const groups = new Map<string, PortfolioRecord[]>();
  for (const record of records) {
    const agents = record.agents.length > 0 ? record.agents : [UNASSIGNED_AGENT];
    for (const agent of agents) {
      groups.set(agent, [...(groups.get(agent) ?? []), record]);
    }
  }
  return [...groups.entries()]
    .map(([agent, groupRecords]) => ({
      agent,
      records: groupRecords,
      riskCount: groupRecords.filter((record) => record.risk).length,
      activeCount: groupRecords.filter(
        (record) => !["completed", "won", "lost", "delivered"].includes(record.status),
      ).length,
      runCount: groupRecords.filter((record) => record.kind === "run").length,
      clientCount: new Set(groupRecords.map((record) => record.clientId).filter(Boolean)).size,
    }))
    .sort(
      (left, right) =>
        right.riskCount - left.riskCount ||
        right.activeCount - left.activeCount ||
        left.agent.localeCompare(right.agent),
    );
}

function buildTimelineRange(records: PortfolioRecord[]):
  | {
      percent: (time: number) => number;
    }
  | undefined {
  const times = records
    .flatMap((record) => [record.created, record.updated])
    .map((value) => Date.parse(value ?? ""))
    .filter((value) => Number.isFinite(value));
  if (times.length === 0) return undefined;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const range = Math.max(max - min, 1);
  return {
    percent: (time) => {
      if (!Number.isFinite(time)) return 0;
      return Math.max(0, Math.min(100, ((time - min) / range) * 100));
    },
  };
}

function buildStatusGroups(records: PortfolioRecord[]): {
  status: string;
  tone: Tone;
  records: PortfolioRecord[];
}[] {
  const groups = new Map<string, PortfolioRecord[]>();
  for (const record of records) {
    groups.set(record.status, [...(groups.get(record.status) ?? []), record]);
  }
  return [...groups.entries()]
    .map(([status, groupRecords]) => ({
      status,
      tone: highestTone(groupRecords),
      records: groupRecords,
    }))
    .sort(
      (left, right) =>
        right.records.length - left.records.length || left.status.localeCompare(right.status),
    );
}

function highestTone(records: PortfolioRecord[]): Tone {
  if (records.some((record) => record.tone === "danger")) return "danger";
  if (records.some((record) => record.tone === "warning")) return "warning";
  if (records.some((record) => record.tone === "success")) return "success";
  if (records.some((record) => record.tone === "info")) return "info";
  return "neutral";
}

function hasMatchingApproval(title: string, id: string, approvals: ApprovalRecord[]): boolean {
  const needle = `${title} ${id}`.toLowerCase();
  return approvals.some((approval) => {
    const haystack = `${approval.target} ${approval.scope} ${approval.run_id ?? ""}`.toLowerCase();
    return title
      ? haystack.includes(title.toLowerCase()) || needle.includes(approval.target.toLowerCase())
      : haystack.includes(id.toLowerCase());
  });
}

function uniqueCompact(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
    ),
  );
}
