import { AlertTriangle, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { EmptyState } from "../components/dashboard/EmptyState";
import { ActionBanner } from "../components/dashboard/ActionBanner";
import { BaseCard, BaseCardHeader } from "../components/dashboard/BaseCard";
import { KpiBar } from "../components/dashboard/KpiBar";
import { ViewToolbar } from "../components/dashboard/ViewToolbar";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { clientName } from "../lib/builders";
import { formatLabel, timeAgo } from "../lib/format";
import type { AutonomousRetryResult } from "../lib/api";
import type { DashboardState } from "../lib/types";

export function RiskView({
  state,
  onRetryScan,
}: {
  state: DashboardState;
  onRetryScan: () => Promise<AutonomousRetryResult>;
}) {
  const blocked = state.projects.filter((project) => project.status === "blocked");
  const failed = state.runs.filter((run) => run.status === "failed");
  const blockedRuns = state.runs.filter((run) => run.status === "blocked");
  const latestRetryReport = [...state.artifacts]
    .filter((artifact) => artifact.type === "autonomy-retry-report")
    .sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""))[0];
  const retry = useAsyncAction(onRetryScan);

  const isClean =
    state.approvals.length === 0 &&
    blocked.length === 0 &&
    failed.length === 0 &&
    blockedRuns.length === 0;

  return (
    <SectionShell
      title="Risk"
      description="Approvals, blocked work, and policy-controlled execution."
      action={
        <ViewToolbar
          primary={{
            label: "Retry scan",
            icon: RotateCcw,
            onClick: () => void retry.run(),
            busy: retry.busy,
            busyLabel: "Retrying",
          }}
        />
      }
    >
      {retry.error ? (
        <ActionBanner
          tone="danger"
          title="Retry scan failed"
          detail={retry.error}
          onDismiss={retry.reset}
          className="mb-3"
        />
      ) : null}
      {latestRetryReport ? (
        <ActionBanner
          tone="info"
          title="Last retry scan"
          detail={`${latestRetryReport.retry_count ?? 0} retries · ${latestRetryReport.escalation_count ?? 0} escalations · ${latestRetryReport.created ? timeAgo(latestRetryReport.created) : "now"} · max ${latestRetryReport.max_attempts ?? "policy"}`}
          className="mb-3"
        />
      ) : null}

      <KpiBar>
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
          detail="Failed or blocked runs"
          icon={ShieldAlert}
          tone={failed.length + blockedRuns.length > 0 ? "danger" : "success"}
        />
      </KpiBar>

      <div className="mt-section grid gap-3 md:grid-cols-2">
        {state.approvals.map((approval) => (
          <BaseCard key={approval.id} variant="accent" accentTone="warning" className="gap-2">
            <BaseCardHeader title={formatLabel(approval.action)}>
              <StatusPill value="Pending" tone="warning" />
            </BaseCardHeader>
            <div className="text-body-secondary text-muted-foreground">{approval.scope}</div>
            <div className="text-meta font-mono">{approval.target}</div>
            <div className="text-meta">
              {approval.actor} · {approval.created ? timeAgo(approval.created) : "now"}
            </div>
          </BaseCard>
        ))}

        {blocked.map((project) => (
          <BaseCard
            key={`blocked-${project.id}`}
            variant="accent"
            accentTone="danger"
            className="gap-2"
          >
            <BaseCardHeader title={project.name}>
              <StatusPill value="Blocked" tone="danger" />
            </BaseCardHeader>
            <div className="text-body-secondary text-muted-foreground">
              {clientName(state.clients, project.client_id)}
            </div>
            <div className="text-meta">{project.stack || "Stack not set"}</div>
          </BaseCard>
        ))}

        {[...failed, ...blockedRuns].map((run) => (
          <BaseCard
            key={`run-risk-${run.id}`}
            variant="accent"
            accentTone="warning"
            className="gap-2"
          >
            <BaseCardHeader title={formatLabel(run.type)}>
              <StatusPill value={formatLabel(run.status)} tone="warning" />
            </BaseCardHeader>
            <div className="text-body-secondary text-muted-foreground">{run.scope}</div>
            <div className="text-meta font-mono">{run.id}</div>
          </BaseCard>
        ))}

        {isClean ? (
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
