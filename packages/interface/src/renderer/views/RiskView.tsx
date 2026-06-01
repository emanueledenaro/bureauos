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
import { useT } from "../i18n/i18n";
import { clientName } from "../lib/builders";
import { timeAgo } from "../lib/format";
import { actionLabel, statusLabel } from "../lib/status-labels";
import type {
  AutonomousRetryResult,
  PolicyExplainDecision,
  PolicyExplainOutcome,
  RunRecord,
} from "../lib/api";
import type { Tone } from "../lib/tone";
import type { DashboardState } from "../lib/types";

const policyTone: Record<PolicyExplainOutcome, Tone> = {
  allow: "success",
  deny: "danger",
  require_approval: "warning",
  escalate: "warning",
};

function policyOutcomeLabel(
  outcome: PolicyExplainOutcome,
  t: (key: string, fallback: string) => string,
): string {
  if (outcome === "allow") return t("risk.outcomeAllowed", "Allowed");
  if (outcome === "deny") return t("risk.outcomeDenied", "Denied");
  if (outcome === "require_approval") return t("risk.outcomeApprovalRequired", "Approval Required");
  return t("risk.outcomeEscalated", "Escalated");
}

function decisionTitle(decision: PolicyExplainDecision): string {
  const capability = [decision.capability, decision.action].filter(Boolean).join(".");
  return capability || decision.policy_action;
}

function stringList(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function runBlocker(run: RunRecord): string {
  return (
    run.retry_blocker_reason ||
    run.blocking_reason ||
    run.dispatch_error ||
    run.error ||
    [...stringList(run.dispatch_blockers), ...stringList(run.blockers)].join(", ")
  );
}

function retryLineage(run: RunRecord, t: (key: string, fallback: string) => string): string {
  if (run.retry_parent_run_id) {
    return `${t("risk.retryLineageRetry", "Retry")} ${run.retry_attempt ?? "?"}/${run.retry_max_attempts ?? "?"} ${t("risk.retryLineageOf", "of")} ${run.retry_parent_run_id}`;
  }
  if (run.retry_child_runs?.length) {
    return `${run.retry_child_runs.length} ${run.retry_child_runs.length === 1 ? t("risk.retryLineageRunStarted", "retry run started") : t("risk.retryLineageRunsStarted", "retry runs started")}`;
  }
  if (run.retry_escalated_at)
    return `${t("risk.retryLineageEscalated", "Escalated")} ${timeAgo(run.retry_escalated_at)}`;
  if (run.retry_attempts)
    return `${run.retry_attempts} ${run.retry_attempts === 1 ? t("risk.retryLineageAttemptUsed", "attempt used") : t("risk.retryLineageAttemptsUsed", "attempts used")}`;
  return "";
}

export function RiskView({
  state,
  onRetryScan,
}: {
  state: DashboardState;
  onRetryScan: () => Promise<AutonomousRetryResult>;
}) {
  const t = useT();
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
      title={t("risk.title", "Risk")}
      description={t(
        "risk.description",
        "Approvals, blocked work, and policy-controlled execution.",
      )}
      action={
        <ViewToolbar
          primary={{
            label: t("risk.retryScan", "Retry scan"),
            icon: RotateCcw,
            onClick: () => void retry.run(),
            busy: retry.busy,
            busyLabel: t("risk.retrying", "Retrying"),
          }}
        />
      }
    >
      {retry.error ? (
        <ActionBanner
          tone="danger"
          title={t("risk.retryScanFailed", "Retry scan failed")}
          detail={retry.error}
          onDismiss={retry.reset}
          className="mb-3"
        />
      ) : null}
      {latestRetryReport ? (
        <ActionBanner
          tone="info"
          title={t("risk.lastRetryScan", "Last retry scan")}
          detail={`${latestRetryReport.retry_count ?? 0} ${t("risk.retries", "retries")} · ${latestRetryReport.escalation_count ?? 0} ${t("risk.escalations", "escalations")} · ${latestRetryReport.created ? timeAgo(latestRetryReport.created) : t("risk.now", "now")} · ${t("risk.max", "max")} ${latestRetryReport.max_attempts ?? t("risk.policy", "policy")}`}
          className="mb-3"
        />
      ) : null}

      <KpiBar>
        <MetricTile
          label={t("risk.pendingApprovals", "Pending approvals")}
          value={String(state.approvals.length)}
          detail={t("risk.ownerReviewRequired", "Owner review required")}
          icon={ShieldCheck}
          tone={state.approvals.length > 0 ? "warning" : "success"}
        />
        <MetricTile
          label={t("risk.blockedProjects", "Blocked projects")}
          value={String(blocked.length)}
          detail={t("risk.deliveryRisk", "Delivery risk")}
          icon={AlertTriangle}
          tone={blocked.length > 0 ? "danger" : "success"}
        />
        <MetricTile
          label={t("risk.runRecovery", "Run recovery")}
          value={String(failed.length + blockedRuns.length)}
          detail={t("risk.failedOrBlockedRuns", "Failed or blocked runs")}
          icon={ShieldAlert}
          tone={failed.length + blockedRuns.length > 0 ? "danger" : "success"}
        />
      </KpiBar>

      <div className="mt-section rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold text-foreground">
              {t("risk.policyExplain", "Policy Explain")}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {policyExplain
                ? `${policyExplain.decisions.length} ${t("risk.recentDecisions", "recent decisions")} · ${policyExplain.counts.require_approval} ${t("risk.approvalGates", "approval gates")}`
                : t("risk.loadingPolicyDecisions", "Loading policy decisions")}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            <StatusPill
              value={`${t("risk.allow", "Allow")} ${policyExplain?.counts.allow ?? 0}`}
              tone="success"
            />
            <StatusPill
              value={`${t("risk.deny", "Deny")} ${policyExplain?.counts.deny ?? 0}`}
              tone="danger"
            />
            {/* "Gated" = recent policy DECISIONS that required approval — distinct
                from the "Pending approvals" KPI above (the owner's pending queue).
                Labeled to avoid reading as a contradictory approval count (SER-224). */}
            <StatusPill
              value={`${t("risk.gated", "Gated")} ${policyExplain?.counts.require_approval ?? 0}`}
              tone="warning"
            />
          </div>
        </div>

        {!policyExplain ? (
          <EmptyState
            className="mt-3"
            title={t("risk.loadingPolicyDecisions", "Loading policy decisions")}
            description={t(
              "risk.loadingPolicyDecisionsDesc",
              "Fetching recent capability checks and their policy outcomes.",
            )}
            icon={ShieldCheck}
          />
        ) : policyDecisions.length > 0 ? (
          <div className="mt-3 grid gap-2 lg:grid-cols-3">
            {policyDecisions.map((decision) => (
              <BaseCard key={decision.id} className="min-w-0 gap-2">
                <BaseCardHeader title={decisionTitle(decision)}>
                  <StatusPill
                    value={policyOutcomeLabel(decision.outcome, t)}
                    tone={policyTone[decision.outcome]}
                  />
                </BaseCardHeader>
                <div className="grid gap-1 text-[10px] text-muted-foreground">
                  <div className="flex justify-between gap-2">
                    <span>{t("risk.agent", "Agent")}</span>
                    <span className="truncate font-mono text-foreground">{decision.agent}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>{t("risk.rule", "Rule")}</span>
                    <span className="truncate font-mono text-foreground">
                      {decision.matched_rule}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>{t("risk.risk", "Risk")}</span>
                    <span className="truncate text-foreground">{decision.risk_class}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>{t("risk.approval", "Approval")}</span>
                    <span className="truncate text-foreground">
                      {decision.approval_required
                        ? decision.approval_id || t("risk.required", "required")
                        : t("risk.none", "none")}
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
            title={t("risk.noPolicyDecisions", "No policy decisions")}
            description={t(
              "risk.noPolicyDecisionsDesc",
              "Capability checks will appear here with their matched rule and approval boundary.",
            )}
            icon={ShieldCheck}
          />
        )}
      </div>

      <div className="mt-section grid gap-3 md:grid-cols-2">
        {state.approvals.map((approval) => (
          <BaseCard key={approval.id} variant="accent" accentTone="warning" className="gap-2">
            <BaseCardHeader title={actionLabel(approval.action, t)}>
              <StatusPill value={t("risk.pending", "Pending")} tone="warning" />
            </BaseCardHeader>
            <div className="text-body-secondary text-muted-foreground">{approval.scope}</div>
            <div className="text-meta font-mono">{approval.target}</div>
            <div className="text-meta">
              {approval.actor} ·{" "}
              {approval.created ? timeAgo(approval.created) : t("risk.now", "now")}
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
              <StatusPill value={t("risk.blocked", "Blocked")} tone="danger" />
            </BaseCardHeader>
            <div className="text-body-secondary text-muted-foreground">
              {clientName(state.clients, project.client_id)}
            </div>
            <div className="text-meta">
              {project.stack || t("risk.stackNotSet", "Stack not set")}
            </div>
          </BaseCard>
        ))}

        {[...failed, ...blockedRuns].map((run) => (
          <BaseCard
            key={`run-risk-${run.id}`}
            variant="accent"
            accentTone="warning"
            className="gap-2"
          >
            <BaseCardHeader title={statusLabel(run.type, t)}>
              <StatusPill value={statusLabel(run.status, t)} tone="warning" />
            </BaseCardHeader>
            <div className="text-body-secondary text-muted-foreground">{run.scope}</div>
            <div className="text-meta font-mono">{run.id}</div>
            {retryLineage(run, t) ? (
              <div className="text-meta text-muted-foreground">{retryLineage(run, t)}</div>
            ) : null}
            {runBlocker(run) ? (
              <div className="line-clamp-2 text-[11px] leading-relaxed text-warning">
                {runBlocker(run)}
              </div>
            ) : null}
            {run.retry_blocker_approval_id ? (
              <div className="text-meta font-mono text-warning">
                {t("risk.approval", "Approval")} {run.retry_blocker_approval_id}
              </div>
            ) : null}
            {run.next_retry_at ? (
              <div className="text-meta text-muted-foreground">
                {t("risk.nextRetry", "Next retry")} {timeAgo(run.next_retry_at)}
              </div>
            ) : null}
          </BaseCard>
        ))}

        {isClean ? (
          <div className="md:col-span-2">
            <EmptyState
              title={t("risk.noActiveRisk", "No active risk")}
              description={t(
                "risk.noActiveRiskDesc",
                "Policy gates and blocked project signals will appear here.",
              )}
              icon={ShieldCheck}
            />
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}
