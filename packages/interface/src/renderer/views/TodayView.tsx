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
import { buildTodayActions, pipelineValue, sortNewest } from "../lib/builders";
import { formatLabel, formatMoney } from "../lib/format";
import { statusLabel } from "../lib/status-labels";
import { useT } from "../i18n/i18n";
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
  const t = useT();
  const actions = buildTodayActions(state, t);
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
  const pipeline = pipelineValue(state);
  const activeOpportunities =
    state.pulse?.revenue.active_opportunities ??
    state.opportunities.filter((opportunity) => !["won", "lost"].includes(opportunity.status))
      .length;
  const scan = useAsyncAction(onMemoryTriggerScan);

  const columns: DataTableColumn<TodayAction>[] = [
    {
      id: "source",
      header: t("today.colSource", "Source"),
      width: "110px",
      mobileLabel: t("today.colSource", "Source"),
      render: (action) => (
        <span className="text-body font-medium text-foreground">{action.source}</span>
      ),
    },
    {
      id: "state",
      header: t("today.colState", "State"),
      width: "100px",
      mobileLabel: t("today.colState", "State"),
      render: (action) => (
        <StatusPill value={statusLabel(actionStateLabel(action.tone), t)} tone={action.tone} />
      ),
    },
    {
      id: "work",
      header: t("today.colWork", "Work"),
      width: "minmax(0,1fr)",
      mobileLabel: t("today.colWork", "Work"),
      render: (action) => (
        <div className="min-w-0">
          <div className="text-body truncate font-medium text-foreground">{action.title}</div>
          <div className="text-meta mt-0.5 truncate">{action.detail}</div>
        </div>
      ),
    },
    {
      id: "signal",
      header: t("today.colSignal", "Signal"),
      width: "140px",
      mobileLabel: t("today.colSignal", "Signal"),
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
          {t("today.open", "Open")}
          <ArrowRight className="h-3 w-3" />
        </Button>
      ),
    },
  ];

  return (
    <SectionShell
      title={t("today.title", "Today")}
      description={t(
        "today.description",
        "Decisions, blockers, client follow-ups, and current company signals.",
      )}
      action={
        <ViewToolbar
          primary={{
            label: t("today.runFollowUpScan", "Run follow-up scan"),
            icon: RefreshCw,
            onClick: () => void scan.run(),
            busy: scan.busy,
            busyLabel: t("today.scanning", "Scanning"),
          }}
        />
      }
    >
      {scan.error ? (
        <ActionBanner
          tone="danger"
          title={t("today.followUpScanFailed", "Follow-up scan failed")}
          detail={scan.error}
          onDismiss={scan.reset}
          className="mb-3"
        />
      ) : null}
      {scan.result ? (
        <ActionBanner
          tone="success"
          title={t("today.followUpScanComplete", "Follow-up scan complete")}
          detail={`${scan.result.triggered.length} ${t("today.runsTriggered", "run(s) triggered")} · ${scan.result.skipped.length} ${t("today.skipped", "skipped")}`}
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
          label={t("today.actionQueue", "Action queue")}
          value={String(actions.length)}
          detail={`${state.approvals.length} ${t("today.approvalsWaiting", "approvals waiting")}`}
          icon={ListChecks}
          tone={actions.length > 0 ? "warning" : "success"}
        />
        <MetricTile
          label={t("today.pipeline", "Pipeline")}
          value={pipeline > 0 ? formatMoney(pipeline) : "$0"}
          detail={`${activeOpportunities} ${t("today.activeOpportunities", "active opportunities")}`}
          icon={Wallet}
          tone={pipeline > 0 ? "success" : "neutral"}
        />
        <MetricTile
          label={t("today.deliveryBlockers", "Delivery blockers")}
          value={String(blocked)}
          detail={`${runIssues} ${t("today.runsNeedAttention", "runs need attention")}`}
          icon={ShieldAlert}
          tone={blocked > 0 ? "danger" : "success"}
        />
        <MetricTile
          label={t("today.clientFollowUps", "Client follow-ups")}
          value={String(followUpsDue)}
          detail={t("today.dueRelationshipWork", "Due relationship work")}
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
          title: t("today.noActionRequired", "No action required"),
          description: t(
            "today.noActionDescription",
            "Approvals, blockers, overdue follow-ups, and failed runs will appear here.",
          ),
        }}
      />

      <div className="mt-section grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-border/70 bg-surface-subtle/45 p-4">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="text-section-title">{t("today.activeRuns", "Active Runs")}</div>
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
                  <span className="font-medium text-foreground">{statusLabel(run.type, t)}</span>
                  <span className="text-meta truncate">{run.scope}</span>
                  <StatusPill value={statusLabel(run.status, t)} tone={runTone(run.status)} />
                </div>
              ))}
            {activeRuns.length === 0 ? (
              <div className="text-meta py-4">{t("today.noActiveRuns", "No active runs.")}</div>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-surface-subtle/45 p-4">
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="text-section-title">{t("today.recentSignals", "Recent Signals")}</div>
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
              <div className="text-meta py-4">
                {t("today.noAuditSignals", "No audit signals yet.")}
              </div>
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
  const t = useT();
  const riskTotal = approvals + blocked + runIssues;
  const tone: Tone = action?.tone ?? (riskTotal > 0 ? "warning" : "success");
  const route = action?.route ?? "portfolio";
  const stats: CommandStat[] = [
    {
      label: t("today.statPipeline", "Pipeline"),
      value: pipeline > 0 ? formatMoney(pipeline) : "$0",
      detail: `${activeOpportunities} ${t("today.statActive", "active")}`,
      icon: Wallet,
      tone: pipeline > 0 ? "success" : "neutral",
    },
    {
      label: t("today.statDelivery", "Delivery"),
      value: String(activeProjects),
      detail: `${activeRuns} ${t("today.statRunning", "running")}`,
      icon: Briefcase,
      tone: blocked + runIssues > 0 ? "danger" : activeRuns > 0 ? "info" : "success",
    },
    {
      label: t("today.statClients", "Clients"),
      value: String(clients),
      detail: `${followUpsDue} ${followUpsDue === 1 ? t("today.followUpSingular", "follow-up") : t("today.followUpPlural", "follow-ups")}`,
      icon: Users,
      tone: followUpsDue > 0 ? "warning" : "success",
    },
    {
      label: t("today.statRisk", "Risk"),
      value: String(riskTotal),
      detail: `${approvals} ${approvals === 1 ? t("today.approvalSingular", "approval") : t("today.approvalPlural", "approvals")}`,
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
              value={action ? formatLabel(action.source) : t("today.clear", "Clear")}
              tone={tone}
              className="shrink-0"
            />
            <span className="text-micro">{t("today.executiveBrief", "Executive brief")}</span>
          </div>
          <h3 className="mt-3 max-w-3xl text-[18px] font-semibold leading-6 text-foreground">
            {action?.title ?? t("today.companyOperatingClean", "Company operating clean")}
          </h3>
          <p className="mt-1 max-w-3xl text-[12px] leading-relaxed text-muted-foreground">
            {action?.detail ??
              t(
                "today.noUrgentDecision",
                "No urgent owner decision. BOS keeps monitoring memory, revenue, delivery, client follow-ups, and risk.",
              )}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => onModeChange(route)}>
              {action
                ? `${t("today.open", "Open")} ${action.source.toLowerCase()}`
                : t("today.openPortfolio", "Open portfolio")}
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
