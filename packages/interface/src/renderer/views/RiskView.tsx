import { useState } from "react";
import { AlertTriangle, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { EmptyState } from "../components/dashboard/EmptyState";
import { Button } from "../components/ui/button";
import { clientName } from "../lib/builders";
import { formatLabel, timeAgo } from "../lib/format";
import type { DashboardState } from "../lib/types";

export function RiskView({
  state,
  onRetryScan,
}: {
  state: DashboardState;
  onRetryScan: () => Promise<unknown>;
}) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const blocked = state.projects.filter((project) => project.status === "blocked");
  const failed = state.runs.filter((run) => run.status === "failed");
  const blockedRuns = state.runs.filter((run) => run.status === "blocked");
  const latestRetryReport = [...state.artifacts]
    .filter((artifact) => artifact.type === "autonomy-retry-report")
    .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""))[0];

  const retryScan = async (): Promise<void> => {
    setRetrying(true);
    setError(undefined);
    try {
      await onRetryScan();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <SectionShell
      title="Risk"
      description="Approvals, blocked work, and policy-controlled execution."
      action={
        <Button variant="outline" size="sm" onClick={() => void retryScan()} disabled={retrying}>
          <RotateCcw className={retrying ? "animate-spin" : ""} />
          Retry scan
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile
          label="Pending approvals"
          value={String(state.approvals.length)}
          detail="Owner review required"
          icon={ShieldCheck}
          tone={state.approvals.length > 0 ? "warning" : "success"}
        />
        <MetricTile
          label="Blocked projects"
          value={String(blocked.length)}
          detail="Delivery risk"
          icon={AlertTriangle}
          tone={blocked.length > 0 ? "danger" : "success"}
        />
        <MetricTile
          label="Run recovery"
          value={String(failed.length + blockedRuns.length)}
          detail={
            latestRetryReport
              ? `${latestRetryReport.retry_count ?? 0} retries · ${latestRetryReport.escalation_count ?? 0} escalations`
              : "Failed or blocked runs"
          }
          icon={ShieldAlert}
          tone={failed.length + blockedRuns.length > 0 ? "danger" : "success"}
        />
      </div>

      {latestRetryReport || error ? (
        <div className="mt-4 rounded-lg border border-border/70 bg-surface-subtle/60 px-4 py-3 text-[11px]">
          {error ? (
            <div className="text-danger">Retry scan failed: {error}</div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
              <span className="font-medium text-foreground">Last retry scan</span>
              <span>{latestRetryReport?.created ? timeAgo(latestRetryReport.created) : "now"}</span>
              <span>{latestRetryReport?.retry_count ?? 0} retries</span>
              <span>{latestRetryReport?.escalation_count ?? 0} escalations</span>
              <span>max {latestRetryReport?.max_attempts ?? "policy"}</span>
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {state.approvals.map((approval) => (
          <div
            key={approval.id}
            className="flex flex-col gap-2 rounded-lg border border-border/70 bg-surface-subtle/60 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-[12px] font-semibold text-foreground">
                {formatLabel(approval.action)}
              </div>
              <StatusPill value="Pending" tone="warning" />
            </div>
            <div className="text-[11px] text-muted-foreground">{approval.scope}</div>
            <div className="font-mono text-[10px] text-muted-foreground/80">{approval.target}</div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {approval.actor} · {approval.created ? timeAgo(approval.created) : "now"}
            </div>
          </div>
        ))}

        {blocked.map((project) => (
          <div
            key={`blocked-${project.id}`}
            className="flex flex-col gap-2 rounded-lg border border-danger/30 bg-danger-subtle/20 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-[12px] font-semibold text-foreground">{project.name}</div>
              <StatusPill value="Blocked" tone="danger" />
            </div>
            <div className="text-[11px] text-muted-foreground">
              {clientName(state.clients, project.client_id)}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {project.stack || "Stack not set"}
            </div>
          </div>
        ))}

        {[...failed, ...blockedRuns].map((run) => (
          <div
            key={`run-risk-${run.id}`}
            className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning-subtle/20 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="text-[12px] font-semibold text-foreground">
                {formatLabel(run.type)}
              </div>
              <StatusPill value={formatLabel(run.status)} tone="warning" />
            </div>
            <div className="text-[11px] text-muted-foreground">{run.scope}</div>
            <div className="font-mono text-[10px] text-muted-foreground/80">{run.id}</div>
          </div>
        ))}

        {state.approvals.length === 0 && blocked.length === 0 && failed.length === 0 && blockedRuns.length === 0 ? (
          <div className="md:col-span-2">
            <EmptyState
              title="No active risk"
              description="Policy gates and blocked project signals will appear here."
              icon={ShieldCheck}
            />
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}
