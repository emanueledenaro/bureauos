import { useState } from "react";
import { Activity, DollarSign, Loader2, Percent, Route } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { EmptyState } from "../components/dashboard/EmptyState";
import { ResponsiveTable } from "../components/dashboard/ResponsiveTable";
import { Button } from "../components/ui/button";
import { clientName, sortNewest } from "../lib/builders";
import { opportunityTone } from "../lib/tone";
import { formatLabel, formatMoney } from "../lib/format";
import type { RevenuePipelineResult } from "../lib/api";
import type { DashboardState } from "../lib/types";

export function RevenueView({
  state,
  onGeneratePipeline,
}: {
  state: DashboardState;
  onGeneratePipeline: () => Promise<RevenuePipelineResult>;
}) {
  const [generating, setGenerating] = useState(false);
  const [lastResult, setLastResult] = useState<RevenuePipelineResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const pipeline = state.opportunities.reduce((sum, item) => sum + (item.expected_value || 0), 0);
  const margin = state.opportunities.length
    ? state.opportunities.reduce((sum, item) => sum + (item.expected_margin || 0), 0) /
      state.opportunities.length
    : 0;
  return (
    <SectionShell title="Revenue" description="Pipeline, opportunity quality, and proposal state.">
      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-border/70 bg-surface-subtle/50 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-foreground">Lead Pipeline</div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            {lastResult
              ? `${lastResult.items.length} opportunities reviewed · ${lastResult.proposal_ready_count} proposal-ready`
              : "Qualifies opportunities and drafts pricing/proposal work without contacting clients."}
          </div>
          {error ? <div className="mt-1 text-[10px] text-danger">{error}</div> : null}
        </div>
        <Button
          size="sm"
          onClick={() => {
            setGenerating(true);
            setError(undefined);
            onGeneratePipeline()
              .then(setLastResult)
              .catch((e) => setError((e as Error).message))
              .finally(() => setGenerating(false));
          }}
          disabled={generating}
        >
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Route className="h-3.5 w-3.5" />
          )}
          {generating ? "Running" : "Run Pipeline"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
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
      </div>

      <ResponsiveTable className="mt-5" minWidth={680}>
        <div className="grid grid-cols-[minmax(0,1fr)_120px_120px_140px] bg-surface-subtle/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Opportunity</span>
          <span>Value</span>
          <span>Margin</span>
          <span>Status</span>
        </div>
        {sortNewest(state.opportunities)
          .slice(0, 12)
          .map((opportunity) => (
            <div
              key={opportunity.id}
              className="grid grid-cols-[minmax(0,1fr)_120px_120px_140px] items-center gap-3 border-t border-border/60 px-4 py-3 text-[11px]"
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{opportunity.title}</div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {clientName(state.clients, opportunity.client_id)}
                </div>
              </div>
              <span className="font-mono text-foreground">
                {formatMoney(opportunity.expected_value || 0)}
              </span>
              <span className="text-muted-foreground">
                {Math.round(opportunity.expected_margin || 0)}%
              </span>
              <StatusPill
                value={formatLabel(opportunity.status)}
                tone={opportunityTone(opportunity.status)}
              />
            </div>
          ))}
        {state.opportunities.length === 0 ? (
          <div className="border-t border-border/60 p-5">
            <EmptyState
              title="No opportunities yet"
              description="Client opportunities created by the coordinator will appear here."
            />
          </div>
        ) : null}
      </ResponsiveTable>
    </SectionShell>
  );
}
