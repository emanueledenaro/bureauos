import {
  Activity,
  AlarmClock,
  ArrowRight,
  Briefcase,
  ListChecks,
  RefreshCw,
  ShieldAlert,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { Button } from "../components/ui/button";
import { ActionBanner } from "../components/dashboard/ActionBanner";
import { KpiBar } from "../components/dashboard/KpiBar";
import { ViewToolbar } from "../components/dashboard/ViewToolbar";
import { DataTable, type DataTableColumn } from "../components/dashboard/DataTable";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { actionStateLabel, runTone, toneIndicatorClass, type Tone } from "../lib/tone";
import { buildTodayActions, sortNewest } from "../lib/builders";
import { formatLabel, formatMoney } from "../lib/format";
import type { MemoryTriggerResult } from "../lib/api";
import type { AdaptiveMode, DashboardState, TodayAction } from "../lib/types";

export function TodayView({
  state,
  onModeChange,
  onMemoryTriggerScan,
}: {
  state: DashboardState;
  onModeChange: (mode: AdaptiveMode) => void;
  onMemoryTriggerScan: () => Promise<MemoryTriggerResult>;
}) {
  const actions = buildTodayActions(state);
  const nextAction = actions[0];
  const blocked = state.projects.filter((project) => project.status === "blocked").length;
  const followUpsDue =
    state.clientIntelligence?.clients.filter((item) => item.relationship.follow_up_due).length ?? 0;
  const runIssues = state.runs.filter((run) =>
    ["needs_human", "blocked", "failed"].includes(run.status),
  ).length;
  const activeRuns = state.runs.filter((run) => !["completed", "cancelled"].includes(run.status));
  const activeProjects = state.projects.filter(
    (project) => !["delivered", "cancelled"].includes(project.status),
  ).length;
  const pipeline =
    state.clientIntelligence?.totals.pipeline_value ?? state.pulse?.revenue.pipeline_value ?? 0;
  const activeOpportunities =
    state.pulse?.revenue.active_opportunities ??
    state.opportunities.filter((opportunity) => !["won", "lost"].includes(opportunity.status))
      .length;
  const scan = useAsyncAction(onMemoryTriggerScan);

  const columns: DataTableColumn<TodayAction>[] = [
    {
      id: "source",
      header: "Source",
      width: "110px",
      mobileLabel: "Source",
      render: (action) => (
        <span className="text-body font-medium text-foreground">{action.source}</span>
      ),
    },
    {
      id: "state",
      header: "State",
      width: "100px",
      mobileLabel: "State",
      render: (action) => (
        <StatusPill value={formatLabel(actionStateLabel(action.tone))} tone={action.tone} />
      ),
    },
    {
      id: "work",
      header: "Work",
      width: "minmax(0,1fr)",
      mobileLabel: "Work",
      render: (action) => (
        <div className="min-w-0">
          <div className="text-body truncate font-medium text-foreground">{action.title}</div>
          <div className="text-meta mt-0.5 truncate">{action.detail}</div>
        </div>
      ),
    },
    {
      id: "signal",
      header: "Signal",
      width: "140px",
      mobileLabel: "Signal",
      render: (action) => <span className="text-meta truncate">{action.meta}</span>,
    },
    {
      id: "open",
      header: "",
      width: "90px",
      align: "end",
      hideOnMobile: true,
      render: (action) => (
        <Button variant="outline" size="sm" onClick={() => onModeChange(action.route)}>
          Open
          <ArrowRight className="h-3 w-3" />
        </Button>
      ),
    },
  ];

  return (
    <SectionShell
      title="Today"
      description="Decisions, blockers, client follow-ups, and current company signals."
      action={
        <ViewToolbar
          primary={{
            label: "Run follow-up scan",
            icon: RefreshCw,
            onClick: () => void scan.run(),
            busy: scan.busy,
            busyLabel: "Scanning",
          }}
        />
      }
    >
      {scan.error ? (
        <ActionBanner
          tone="danger"
          title="Follow-up scan failed"
          detail={scan.error}
          onDismiss={scan.reset}
          className="mb-3"
        />
      ) : null}
      {scan.result ? (
        <ActionBanner
          tone="success"
          title="Follow-up scan complete"
          detail={`${scan.result.triggered.length} run(s) triggered · ${scan.result.skipped.length} skipped`}
          onDismiss={scan.reset}
          className="mb-3"
        />
      ) : null}

      <CommandBrief
        action={nextAction}
        pipeline={pipeline}
        activeOpportunities={activeOpportunities}
        activeProjects={activeProjects}
        activeRuns={activeRuns.length}
        blocked={blocked}
        runIssues={runIssues}
        followUpsDue={followUpsDue}
        approvals={state.approvals.length}
        clients={state.clients.length}
        onModeChange={onModeChange}
      />

      <KpiBar className="mt-3" columns={4}>
        <MetricTile
          label="Action queue"
          value={String(actions.length)}
          detail={`${state.approvals.length} approvals waiting`}
          icon={ListChecks}
          tone={actions.length > 0 ? "warning" : "success"}
        />
        <MetricTile
          label="Pipeline"
          value={pipeline > 0 ? formatMoney(pipeline) : "$0"}
          detail={`${activeOpportunities} active opportunities`}
          icon={Wallet}
          tone={pipeline > 0 ? "success" : "neutral"}
        />
        <MetricTile
          label="Delivery blockers"
          value={String(blocked)}
          detail={`${runIssues} runs need attention`}
          icon={ShieldAlert}
          tone={blocked > 0 ? "danger" : "success"}
        />
        <MetricTile
          label="Client follow-ups"
          value={String(followUpsDue)}
          detail="Due relationship work"
          icon={AlarmClock}
          tone={followUpsDue > 0 ? "warning" : "success"}
        />
      </KpiBar>

      <DataTable
        className="mt-section"
        columns={columns}
        rows={actions.slice(0, 12)}
        rowKey={(action) => action.id}
        mobileFallback="cards"
        emptyState={{
          title: "No action required",
          description: "Approvals, blockers, overdue follow-ups, and failed runs will appear here.",
        }}
      />

      <div className="mt-section grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-border/70 bg-surface-subtle/45 p-4">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="text-section-title">Active Runs</div>
          </div>
          <div className="mt-3 divide-y divide-border/60">
            {sortNewest(state.runs)
              .filter((run) => !["completed", "cancelled"].includes(run.status))
              .slice(0, 6)
              .map((run) => (
                <div
                  key={run.id}
                  className="grid grid-cols-[100px_minmax(0,1fr)_96px] items-center gap-3 py-2.5 text-body"
                >
                  <span className="font-medium text-foreground">{formatLabel(run.type)}</span>
                  <span className="text-meta truncate">{run.scope}</span>
                  <StatusPill value={formatLabel(run.status)} tone={runTone(run.status)} />
                </div>
              ))}
            {activeRuns.length === 0 ? <div className="text-meta py-4">No active runs.</div> : null}
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-surface-subtle/45 p-4">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="text-section-title">Recent Signals</div>
          </div>
          <div className="mt-3 divide-y divide-border/60">
            {[...state.audit]
              .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
              .slice(0, 6)
              .map((event) => (
                <div
                  key={`${event.timestamp}:${event.action}:${event.target ?? ""}`}
                  className="grid grid-cols-[minmax(0,1fr)_80px] items-center gap-3 py-2.5 text-body"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {formatLabel(event.action)}
                    </div>
                    <div className="text-meta mt-0.5 truncate">
                      {event.actor}
                      {event.target ? ` · ${event.target}` : ""}
                    </div>
                  </div>
                  <StatusPill
                    value={formatLabel(event.result)}
                    tone={event.result === "ok" ? "success" : "warning"}
                  />
                </div>
              ))}
            {state.audit.length === 0 ? (
              <div className="text-meta py-4">No audit signals yet.</div>
            ) : null}
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

function CommandBrief({
  action,
  pipeline,
  activeOpportunities,
  activeProjects,
  activeRuns,
  blocked,
  runIssues,
  followUpsDue,
  approvals,
  clients,
  onModeChange,
}: {
  action?: TodayAction;
  pipeline: number;
  activeOpportunities: number;
  activeProjects: number;
  activeRuns: number;
  blocked: number;
  runIssues: number;
  followUpsDue: number;
  approvals: number;
  clients: number;
  onModeChange: (mode: AdaptiveMode) => void;
}) {
  const riskTotal = approvals + blocked + runIssues;
  const tone: Tone = action?.tone ?? (riskTotal > 0 ? "warning" : "success");
  const route = action?.route ?? "portfolio";
  const stats: CommandStat[] = [
    {
      label: "Pipeline",
      value: pipeline > 0 ? formatMoney(pipeline) : "$0",
      detail: `${activeOpportunities} active`,
      icon: Wallet,
      tone: pipeline > 0 ? "success" : "neutral",
    },
    {
      label: "Delivery",
      value: String(activeProjects),
      detail: `${activeRuns} running`,
      icon: Briefcase,
      tone: blocked + runIssues > 0 ? "danger" : activeRuns > 0 ? "info" : "success",
    },
    {
      label: "Clients",
      value: String(clients),
      detail: `${followUpsDue} follow-up${followUpsDue === 1 ? "" : "s"}`,
      icon: Users,
      tone: followUpsDue > 0 ? "warning" : "success",
    },
    {
      label: "Risk",
      value: String(riskTotal),
      detail: `${approvals} approval${approvals === 1 ? "" : "s"}`,
      icon: ShieldAlert,
      tone: riskTotal > 0 ? (blocked + runIssues > 0 ? "danger" : "warning") : "success",
    },
  ];

  return (
    <div className="relative overflow-hidden rounded-lg border border-border/70 bg-surface-raised/55">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${toneIndicatorClass[tone]}`} />
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        <div className="min-w-0 pl-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              value={action ? formatLabel(action.source) : "Clear"}
              tone={tone}
              className="shrink-0"
            />
            <span className="text-micro">Executive brief</span>
          </div>
          <h3 className="mt-3 max-w-3xl text-[18px] font-semibold leading-6 text-foreground">
            {action?.title ?? "Company operating clean"}
          </h3>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-muted-foreground">
            {action?.detail ??
              "No urgent owner decision. BOS keeps monitoring memory, revenue, delivery, client follow-ups, and risk."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => onModeChange(route)}>
              {action ? `Open ${action.source.toLowerCase()}` : "Open portfolio"}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            {action?.meta ? (
              <span className="text-micro rounded-md border border-border/60 bg-background/35 px-2 py-1">
                {action.meta}
              </span>
            ) : null}
          </div>
        </div>

        <div className="grid min-w-0 grid-cols-2 gap-2">
          {stats.map((stat) => (
            <CommandStatTile key={stat.label} stat={stat} />
          ))}
        </div>
      </div>
    </div>
  );
}

interface CommandStat {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: Tone;
}

function CommandStatTile({ stat }: { stat: CommandStat }) {
  const Icon = stat.icon;
  return (
    <div className="min-w-0 rounded-md border border-border/60 bg-background/35 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-micro truncate font-medium uppercase">{stat.label}</span>
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="text-[17px] font-semibold leading-none text-foreground">{stat.value}</span>
        <span className={`mb-0.5 h-1.5 w-1.5 rounded-full ${toneIndicatorClass[stat.tone]}`} />
      </div>
      <div className="text-micro mt-1 truncate">{stat.detail}</div>
    </div>
  );
}
