import { useState } from "react";
import { Activity, AlarmClock, ArrowRight, ListChecks, RefreshCw, ShieldAlert } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { EmptyState } from "../components/dashboard/EmptyState";
import { Button } from "../components/ui/button";
import { actionStateLabel, runTone } from "../lib/tone";
import { buildTodayActions, sortNewest } from "../lib/builders";
import { formatLabel } from "../lib/format";
import type { MemoryTriggerResult } from "../lib/api";
import type { AdaptiveMode, DashboardState } from "../lib/types";

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
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | undefined>();

  const scanMemoryTriggers = async (): Promise<void> => {
    setScanning(true);
    try {
      const result = await onMemoryTriggerScan();
      setScanResult(
        `${result.triggered.length} follow-up run(s), ${result.skipped.length} skipped`,
      );
    } catch (error) {
      setScanResult(error instanceof Error ? error.message : String(error));
    } finally {
      setScanning(false);
    }
  };

  return (
    <SectionShell
      title="Today"
      description="A real operating view of what needs attention now."
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void scanMemoryTriggers()}
          disabled={scanning}
        >
          <RefreshCw className="h-3 w-3" />
          {scanning ? "Scanning" : "Run follow-up scan"}
        </Button>
      }
    >
      {scanResult ? (
        <div className="mb-3 rounded-md border border-border/60 bg-surface-subtle px-3 py-2 text-[11px] text-muted-foreground">
          {scanResult}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
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
      </div>

      <div className="mt-5 overflow-hidden rounded-lg border border-border/70">
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid grid-cols-[100px_90px_minmax(0,1fr)_140px_90px] bg-surface-subtle/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Source</span>
              <span>State</span>
              <span>Work</span>
              <span>Signal</span>
              <span />
            </div>
            {actions.slice(0, 12).map((action) => (
              <div
                key={action.id}
                className="grid grid-cols-[100px_90px_minmax(0,1fr)_140px_90px] items-center gap-3 border-t border-border/60 px-4 py-3 text-[11px] transition-colors hover:bg-surface-subtle/40"
              >
                <span className="truncate font-medium text-foreground">{action.source}</span>
                <StatusPill value={formatLabel(actionStateLabel(action.tone))} tone={action.tone} />
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">{action.title}</div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {action.detail}
                  </div>
                </div>
                <span className="truncate text-muted-foreground">{action.meta}</span>
                <Button variant="outline" size="sm" onClick={() => onModeChange(action.route)}>
                  Open
                  <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        {actions.length === 0 ? (
          <div className="border-t border-border/60 p-5">
            <EmptyState
              title="No action required"
              description="Approvals, blockers, overdue follow-ups, and failed runs will appear here."
            />
          </div>
        ) : null}
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="text-[12px] font-semibold text-foreground">Active Runs</div>
          </div>
          <div className="mt-3 divide-y divide-border/60">
            {sortNewest(state.runs)
              .filter((run) => !["completed", "cancelled"].includes(run.status))
              .slice(0, 6)
              .map((run) => (
                <div
                  key={run.id}
                  className="grid grid-cols-[100px_minmax(0,1fr)_96px] items-center gap-3 py-2.5 text-[11px]"
                >
                  <span className="font-medium text-foreground">{formatLabel(run.type)}</span>
                  <span className="truncate text-muted-foreground">{run.scope}</span>
                  <StatusPill value={formatLabel(run.status)} tone={runTone(run.status)} />
                </div>
              ))}
            {state.runs.filter((run) => !["completed", "cancelled"].includes(run.status)).length ===
            0 ? (
              <div className="py-4 text-[11px] text-muted-foreground">No active runs.</div>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="text-[12px] font-semibold text-foreground">Recent Signals</div>
          </div>
          <div className="mt-3 divide-y divide-border/60">
            {[...state.audit]
              .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
              .slice(0, 6)
              .map((event) => (
                <div
                  key={`${event.timestamp}:${event.action}:${event.target ?? ""}`}
                  className="grid grid-cols-[minmax(0,1fr)_80px] items-center gap-3 py-2.5 text-[11px]"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">
                      {formatLabel(event.action)}
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
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
              <div className="py-4 text-[11px] text-muted-foreground">No audit signals yet.</div>
            ) : null}
          </div>
        </div>
      </div>
    </SectionShell>
  );
}
