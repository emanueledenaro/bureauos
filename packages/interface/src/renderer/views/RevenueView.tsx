import { Activity, DollarSign, Percent, WandSparkles } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { ActionBanner } from "../components/dashboard/ActionBanner";
import { KpiBar } from "../components/dashboard/KpiBar";
import { ViewToolbar } from "../components/dashboard/ViewToolbar";
import { DataTable, type DataTableColumn } from "../components/dashboard/DataTable";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { clientName, sortNewest } from "../lib/builders";
import { opportunityTone } from "../lib/tone";
import { formatLabel, formatMoney } from "../lib/format";
import type { OpportunityRecord, RevenuePipelineResult } from "../lib/api";
import type { DashboardState } from "../lib/types";

export function RevenueView({
  state,
  onGeneratePipeline,
}: {
  state: DashboardState;
  onGeneratePipeline?: () => Promise<RevenuePipelineResult>;
}) {
  const pipeline = state.opportunities.reduce((sum, item) => sum + (item.expected_value || 0), 0);
  const margin = state.opportunities.length
    ? state.opportunities.reduce((sum, item) => sum + (item.expected_margin || 0), 0) /
      state.opportunities.length
    : 0;
  const generate = useAsyncAction(onGeneratePipeline ?? (async () => undefined as never));

  const columns: DataTableColumn<OpportunityRecord>[] = [
    {
      id: "title",
      header: "Opportunity",
      width: "minmax(0,1fr)",
      render: (opportunity) => (
        <div className="min-w-0">
          <div className="text-body truncate font-medium text-foreground">{opportunity.title}</div>
          <div className="text-meta mt-0.5 truncate">
            {clientName(state.clients, opportunity.client_id)}
          </div>
        </div>
      ),
    },
    {
      id: "value",
      header: "Value",
      width: "120px",
      align: "end",
      render: (opportunity) => (
        <span className="text-body font-mono text-foreground">
          {formatMoney(opportunity.expected_value || 0)}
        </span>
      ),
    },
    {
      id: "margin",
      header: "Margin",
      width: "100px",
      align: "end",
      render: (opportunity) => (
        <span className="text-meta">{Math.round(opportunity.expected_margin || 0)}%</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      width: "140px",
      render: (opportunity) => (
        <StatusPill
          value={formatLabel(opportunity.status)}
          tone={opportunityTone(opportunity.status)}
        />
      ),
    },
  ];

  return (
    <SectionShell
      title="Revenue"
      description="Pipeline, opportunity quality, and proposal state."
      action={
        onGeneratePipeline ? (
          <ViewToolbar
            primary={{
              label: "Generate pipeline report",
              icon: WandSparkles,
              onClick: () => void generate.run(),
              busy: generate.busy,
              busyLabel: "Generating",
            }}
          />
        ) : undefined
      }
    >
      {generate.error ? (
        <ActionBanner
          tone="danger"
          title="Pipeline report failed"
          detail={generate.error}
          onDismiss={generate.reset}
          className="mb-3"
        />
      ) : null}
      {generate.result ? (
        <ActionBanner
          tone="success"
          title="Pipeline report generated"
          detail={`Report ${generate.result.report.id}`}
          onDismiss={generate.reset}
          className="mb-3"
        />
      ) : null}

      <KpiBar>
        <MetricTile
          label="Pipeline"
          value={formatMoney(pipeline)}
          detail="Expected value"
          icon={DollarSign}
          tone="success"
        />
        <MetricTile
          label="Opportunities"
          value={String(state.opportunities.length)}
          detail={`${state.pulse?.revenue.active_opportunities ?? 0} active`}
          icon={Activity}
          tone="info"
        />
        <MetricTile
          label="Average margin"
          value={`${Math.round(margin)}%`}
          detail="Expected margin"
          icon={Percent}
          tone={margin > 30 ? "success" : "warning"}
        />
      </KpiBar>

      <DataTable
        className="mt-section"
        columns={columns}
        rows={sortNewest(state.opportunities).slice(0, 12)}
        rowKey={(opportunity) => opportunity.id}
        mobileFallback="cards"
        emptyState={{
          title: "No opportunities yet",
          description: "Client opportunities created by the coordinator will appear here.",
        }}
      />
    </SectionShell>
  );
}
