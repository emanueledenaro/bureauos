import { Activity, AlarmClock, ArrowRight, ListChecks, RefreshCw, ShieldAlert } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { EmptyState } from "../components/dashboard/EmptyState";
import { Button } from "../components/ui/button";
import { ActionBanner } from "../components/dashboard/ActionBanner";
import { KpiBar } from "../components/dashboard/KpiBar";
import { ViewToolbar } from "../components/dashboard/ViewToolbar";
import { DataTable, type DataTableColumn } from "../components/dashboard/DataTable";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { actionStateLabel, runTone } from "../lib/tone";
import { buildTodayActions, sortNewest } from "../lib/builders";
import { formatLabel } from "../lib/format";
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
  const blocked = state.projects.filter((project) => project.status === "blocked").length;
  const followUpsDue =
    state.clientIntelligence?.clients.filter((item) => item.relationship.follow_up_due).length ?? 0;
  const runIssues = state.runs.filter((run) =>
    ["needs_human", "blocked", "failed"].includes(run.status),
  ).length;
  const scan = useAsyncAction(onMemoryTriggerScan);

  const columns: DataTableColumn<TodayAction>[] = [
    {
      id: "source",
      header: "Source",
      width: "110px",
      mobileLabel: "Source",
      render: (action) => <span className="text-body font-medium text-foreground">{action.source}</span>,
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
      description="A real operating view of what needs attention now."
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

      <KpiBar>
        <MetricTile
          label="Action queue"
          value={String(actions.length)}
          detail={`${state.approvals.length} approvals waiting`}
          icon={ListChecks}
          tone={actions.length > 0 ? "warning" : "success"}
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
        <div className="rounded-lg border border-border bg-surface-subtle p-4">
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
            {state.runs.filter((run) => !["completed", "cancelled"].includes(run.status)).length ===
            0 ? (
              <div className="text-meta py-4">No active runs.</div>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface-subtle p-4">
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
