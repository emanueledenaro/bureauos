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
import type {
  AutonomousRetryResult,
  PolicyExplainDecision,
  PolicyExplainOutcome,
} from "../lib/api";
import type { Tone } from "../lib/tone";
import type { DashboardState } from "../lib/types";

const policyTone: Record<PolicyExplainOutcome, Tone> = {
  allow: "success",
  deny: "danger",
  require_approval: "warning",
  escalate: "warning",
};

function policyOutcomeLabel(outcome: PolicyExplainOutcome): string {
  if (outcome === "allow") return "Allowed";
  if (outcome === "deny") return "Denied";
  if (outcome === "require_approval") return "Approval Required";
  return "Escalated";
}

function decisionTitle(decision: PolicyExplainDecision): string {
  const capability = [decision.capability, decision.action].filter(Boolean).join(".");
  return capability || decision.policy_action;
}

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
  const policyExplain = state.policyExplain;
  const policyDecisions = policyExplain?.decisions.slice(0, 6) ?? [];
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

      <div className="mt-section rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold text-foreground">Policy Explain</div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {policyExplain
                ? `${policyExplain.decisions.length} recent decisions · ${policyExplain.counts.require_approval} approval gates`
                : "Loading policy decisions"}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <StatusPill value={`Allow ${policyExplain?.counts.allow ?? 0}`} tone="success" />
            <StatusPill value={`Deny ${policyExplain?.counts.deny ?? 0}`} tone="danger" />
            <StatusPill
              value={`Approval ${policyExplain?.counts.require_approval ?? 0}`}
              tone="warning"
            />
          </div>
        </div>

        {policyDecisions.length > 0 ? (
          <div className="mt-3 grid gap-2 lg:grid-cols-3">
            {policyDecisions.map((decision) => (
              <BaseCard key={decision.id} className="min-w-0 gap-2">
                <BaseCardHeader title={decisionTitle(decision)}>
                  <StatusPill
                    value={policyOutcomeLabel(decision.outcome)}
                    tone={policyTone[decision.outcome]}
                  />
                </BaseCardHeader>
                <div className="grid gap-1 text-[10px] text-muted-foreground">
                  <div className="flex justify-between gap-2">
                    <span>Agent</span>
                    <span className="truncate font-mono text-foreground">{decision.agent}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Rule</span>
                    <span className="truncate font-mono text-foreground">
                      {decision.matched_rule}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Risk</span>
                    <span className="truncate text-foreground">{decision.risk_class}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Approval</span>
                    <span className="truncate text-foreground">
                      {decision.approval_required ? decision.approval_id || "required" : "none"}
                    </span>
                  </div>
                </div>
                <div className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                  {decision.reason}
                </div>
                <div className="truncate font-mono text-[10px] text-muted-foreground/80">
                  {decision.target}
                </div>
                {decision.missing_gates.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {decision.missing_gates.map((gate) => (
                      <span
                        key={gate}
                        className="rounded bg-warning-subtle/30 px-1.5 py-0.5 text-[9px] text-warning"
                      >
                        {gate}
                      </span>
                    ))}
                  </div>
                ) : null}
              </BaseCard>
            ))}
          </div>
        ) : (
          <EmptyState
            className="mt-3"
            title="No policy decisions"
            description="Capability checks will appear here with their matched rule and approval boundary."
            icon={ShieldCheck}
          />
        )}
      </div>

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
