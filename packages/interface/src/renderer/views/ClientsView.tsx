import { Briefcase, DollarSign, FileText, RefreshCw, UserCheck, Users } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { ClientAccountCard } from "../components/dashboard/ClientAccountCard";
import { EmptyState } from "../components/dashboard/EmptyState";
import { ActionBanner } from "../components/dashboard/ActionBanner";
import { KpiBar } from "../components/dashboard/KpiBar";
import { ViewToolbar } from "../components/dashboard/ViewToolbar";
import { OperationalFocus } from "../components/dashboard/OperationalFocus";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { pipelineValue } from "../lib/builders";
import { clientRiskTone } from "../lib/tone";
import { formatMoney, timeAgo } from "../lib/format";
import { statusLabel } from "../lib/status-labels";
import type { ClientSuccessStatusResult, MemoryTriggerResult } from "../lib/api";
import type { AdaptiveMode, DashboardState } from "../lib/types";
import { useT } from "../i18n/i18n";

export function ClientsView({
  state,
  onModeChange,
  onGenerateSuccessStatus,
  onMemoryTriggerScan,
}: {
  state: DashboardState;
  onModeChange: (mode: AdaptiveMode) => void;
  onGenerateSuccessStatus: () => Promise<ClientSuccessStatusResult>;
  onMemoryTriggerScan: () => Promise<MemoryTriggerResult>;
}) {
  const t = useT();
  const intelligence = state.clientIntelligence;
  const clients = intelligence?.clients ?? [];
  const status = useAsyncAction(onGenerateSuccessStatus);
  const scan = useAsyncAction(onMemoryTriggerScan);
  const noClients = clients.length === 0;
  const riskWeight: Record<string, number> = {
    blocked: 0,
    follow_up_due: 1,
    proposal: 2,
    active: 3,
    cold: 4,
  };
  const focusClient = [...clients].sort(
    (left, right) =>
      (riskWeight[left.risk] ?? 10) - (riskWeight[right.risk] ?? 10) ||
      right.revenue.pipeline_value - left.revenue.pipeline_value ||
      right.delivery.active_projects - left.delivery.active_projects,
  )[0];

  return (
    <SectionShell
      title={t("clients.title", "Clients")}
      description={t(
        "clients.description",
        "Client memory, project history, and commercial value.",
      )}
      action={
        <ViewToolbar
          primary={{
            label: t("clients.generateStatusReports", "Generate status reports"),
            icon: FileText,
            onClick: () => void status.run(),
            busy: status.busy,
            busyLabel: t("clients.generating", "Generating"),
            disabled: noClients,
          }}
          secondary={[
            {
              label: t("clients.runFollowUpScan", "Run follow-up scan"),
              icon: RefreshCw,
              onClick: () => void scan.run(),
              busy: scan.busy,
              busyLabel: t("clients.scanning", "Scanning"),
              disabled: noClients,
            },
          ]}
        />
      }
    >
      {status.error ? (
        <ActionBanner
          tone="danger"
          title={t("clients.statusReportFailed", "Status report failed")}
          detail={status.error}
          onDismiss={status.reset}
          className="mb-3"
        />
      ) : null}
      {status.result ? (
        <ActionBanner
          tone="success"
          title={t("clients.statusReportsGenerated", "Status reports generated")}
          detail={`${status.result.reports.length} ${t("clients.reportsCreated", "report(s) created")}`}
          onDismiss={status.reset}
          className="mb-3"
        />
      ) : null}
      {scan.error ? (
        <ActionBanner
          tone="danger"
          title={t("clients.followUpScanFailed", "Follow-up scan failed")}
          detail={scan.error}
          onDismiss={scan.reset}
          className="mb-3"
        />
      ) : null}
      {scan.result ? (
        <ActionBanner
          tone="success"
          title={t("clients.followUpScanComplete", "Follow-up scan complete")}
          detail={`${scan.result.triggered.length} ${t("clients.runsTriggered", "run(s) triggered")} · ${scan.result.skipped.length} ${t("clients.skipped", "skipped")}`}
          onDismiss={scan.reset}
          className="mb-3"
        />
      ) : null}

      <OperationalFocus
        className="mb-section"
        tone={focusClient ? clientRiskTone(focusClient.risk) : "neutral"}
        icon={UserCheck}
        title={
          focusClient
            ? focusClient.client.name
            : t("clients.createFirstAccount", "Create the first client account memory")
        }
        detail={
          focusClient
            ? focusClient.next_action
            : t(
                "clients.noIntelligence",
                "No client intelligence is available yet. The coordinator needs a client profile before follow-up, delivery, or revenue decisions.",
              )
        }
        signals={
          focusClient
            ? [
                statusLabel(focusClient.risk, t),
                formatMoney(focusClient.revenue.pipeline_value),
                focusClient.relationship.follow_up_due && focusClient.relationship.next_follow_up_at
                  ? `${t("clients.due", "Due")} ${timeAgo(focusClient.relationship.next_follow_up_at)}`
                  : `${focusClient.delivery.active_projects} ${t("clients.activeProjectsSignal", "active projects")}`,
              ]
            : [t("clients.zeroClients", "0 clients"), t("clients.noAccountPlan", "No account plan")]
        }
      />

      <KpiBar
        columns={4}
        className="grid-flow-row grid-cols-2 auto-cols-auto overflow-visible pb-0 lg:grid-cols-4"
      >
        <MetricTile
          label={t("clients.clientsMetric", "Clients")}
          value={String(intelligence?.totals.clients ?? state.clients.length)}
          detail={t("clients.memoryProfiles", "Memory profiles")}
          icon={Users}
          tone="info"
        />
        <MetricTile
          label={t("clients.pipeline", "Pipeline")}
          value={formatMoney(pipelineValue(state))}
          detail={`${formatMoney(intelligence?.totals.won_value ?? 0)} ${t("clients.wonValue", "won value")}`}
          icon={DollarSign}
          tone="success"
        />
        <MetricTile
          label={t("clients.activeProjects", "Active projects")}
          value={String(intelligence?.totals.active_projects ?? 0)}
          detail={`${intelligence?.totals.blocked_projects ?? 0} ${t("clients.blocked", "blocked")}`}
          icon={Briefcase}
          tone={intelligence?.totals.blocked_projects ? "danger" : "info"}
        />
        <MetricTile
          label={t("clients.followUpsDue", "Follow-ups due")}
          value={String(intelligence?.totals.follow_ups_due ?? 0)}
          detail={t("clients.relationshipMemory", "Relationship memory")}
          icon={Users}
          tone={intelligence?.totals.follow_ups_due ? "warning" : "success"}
        />
      </KpiBar>

      <div className="mt-section grid gap-3 xl:grid-cols-2">
        {clients.map((item) => (
          <ClientAccountCard
            key={item.client.id}
            item={item}
            onOpen={() => onModeChange("memory")}
          />
        ))}
        {noClients ? (
          <div className="xl:col-span-2">
            <EmptyState
              title={t("clients.noClientsYet", "No clients yet")}
              description={t(
                "clients.emptyStateDescription",
                "A client memory profile is created from the coordinator intake.",
              )}
            />
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}
