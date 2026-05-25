import { AlertTriangle, Briefcase, DollarSign, FileText, RefreshCw, Users } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { ClientAccountCard } from "../components/dashboard/ClientAccountCard";
import { EmptyState } from "../components/dashboard/EmptyState";
import { ActionBanner } from "../components/dashboard/ActionBanner";
import { KpiBar } from "../components/dashboard/KpiBar";
import { ViewToolbar } from "../components/dashboard/ViewToolbar";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { formatMoney } from "../lib/format";
import type { ClientSuccessStatusResult, MemoryTriggerResult } from "../lib/api";
import type { DashboardState } from "../lib/types";

export function ClientsView({
  state,
  onGenerateSuccessStatus,
  onMemoryTriggerScan,
}: {
  state: DashboardState;
  onGenerateSuccessStatus: () => Promise<ClientSuccessStatusResult>;
  onMemoryTriggerScan: () => Promise<MemoryTriggerResult>;
}) {
  const intelligence = state.clientIntelligence;
  const clients = intelligence?.clients ?? [];
  const status = useAsyncAction(onGenerateSuccessStatus);
  const scan = useAsyncAction(onMemoryTriggerScan);
  const noClients = clients.length === 0;

  return (
    <SectionShell
      title="Clients"
      description="Client memory, project history, and commercial value."
      action={
        <ViewToolbar
          primary={{
            label: "Generate status reports",
            icon: FileText,
            onClick: () => void status.run(),
            busy: status.busy,
            busyLabel: "Generating",
            disabled: noClients,
          }}
          secondary={[
            {
              label: "Run follow-up scan",
              icon: RefreshCw,
              onClick: () => void scan.run(),
              busy: scan.busy,
              busyLabel: "Scanning",
              disabled: noClients,
            },
          ]}
        />
      }
    >
      {status.error ? (
        <ActionBanner
          tone="danger"
          title="Status report failed"
          detail={status.error}
          onDismiss={status.reset}
          className="mb-3"
        />
      ) : null}
      {status.result ? (
        <ActionBanner
          tone="success"
          title="Status reports generated"
          detail={`${status.result.reports.length} report(s) created`}
          onDismiss={status.reset}
          className="mb-3"
        />
      ) : null}
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
          label="Clients"
          value={String(intelligence?.totals.clients ?? state.clients.length)}
          detail="Memory profiles"
          icon={Users}
          tone="info"
        />
        <MetricTile
          label="Pipeline"
          value={formatMoney(intelligence?.totals.pipeline_value ?? 0)}
          detail="Open opportunity value"
          icon={DollarSign}
          tone="success"
        />
        <MetricTile
          label="Won value"
          value={formatMoney(intelligence?.totals.won_value ?? 0)}
          detail="Closed won opportunities"
          icon={DollarSign}
          tone="success"
        />
      </KpiBar>

      <div className="mt-3">
        <KpiBar>
          <MetricTile
            label="Active projects"
            value={String(intelligence?.totals.active_projects ?? 0)}
            detail="Across all clients"
            icon={Briefcase}
            tone="info"
          />
          <MetricTile
            label="Blocked projects"
            value={String(intelligence?.totals.blocked_projects ?? 0)}
            detail="Client delivery risk"
            icon={AlertTriangle}
            tone={intelligence?.totals.blocked_projects ? "danger" : "success"}
          />
          <MetricTile
            label="Follow-ups due"
            value={String(intelligence?.totals.follow_ups_due ?? 0)}
            detail="Relationship memory"
            icon={Users}
            tone={intelligence?.totals.follow_ups_due ? "warning" : "success"}
          />
        </KpiBar>
      </div>

      <div className="mt-section grid gap-3 xl:grid-cols-2">
        {clients.map((item) => (
          <ClientAccountCard key={item.client.id} item={item} />
        ))}
        {noClients ? (
          <div className="xl:col-span-2">
            <EmptyState
              title="No clients yet"
              description="A client memory profile is created from the coordinator intake."
            />
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}
