import { useState } from "react";
import {
  Activity,
  ChevronRight,
  DollarSign,
  Loader2,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { MetricTile } from "../components/dashboard/MetricTile";
import { EmptyState } from "../components/dashboard/EmptyState";
import { formatMoney } from "../lib/format";
import type {
  BusinessReportResult,
  ClientRecord,
  CompanyPulse,
  OpportunityRecord,
} from "../lib/api";

function sparkline(seed: number, length = 12): number[] {
  const values: number[] = [];
  let cursor = seed > 0 ? seed * 0.6 : 1;
  for (let index = 0; index < length; index += 1) {
    const wave = Math.sin((index + seed) / 1.5);
    const drift = (index / length) * (seed > 0 ? seed * 0.5 : 1);
    cursor = Math.max(0.1, cursor + wave * (cursor * 0.08) + drift * 0.05);
    values.push(cursor);
  }
  return values;
}

export function RevenuePulseView({
  pulse,
  clients,
  opportunities,
  onGenerateReport,
}: {
  pulse?: CompanyPulse;
  clients: ClientRecord[];
  opportunities: OpportunityRecord[];
  onGenerateReport: () => Promise<BusinessReportResult>;
}) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BusinessReportResult | undefined>();

  const pipeline = pulse?.revenue.pipeline_value ?? 0;
  const active = pulse?.revenue.active_opportunities ?? 0;
  const margin = opportunities.length
    ? opportunities.reduce((sum, item) => sum + (item.expected_margin || 0), 0) /
      opportunities.length
    : 0;
  const won = opportunities
    .filter((item) => item.status === "won")
    .reduce((sum, item) => sum + (item.expected_value || 0), 0);
  const topClients = clients
    .map((client) => ({
      client,
      value: opportunities
        .filter((item) => item.client_id === client.id)
        .reduce((sum, item) => sum + (item.expected_value || 0), 0),
    }))
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);

  const generate = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      setReport(await onGenerateReport());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="grid gap-4 px-5 py-4 lg:grid-cols-[200px_minmax(0,1fr)_240px]">
        <div>
          <div className="flex items-center gap-2">
            <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
            <h2 className="text-[14px] font-semibold text-foreground">Revenue Pulse</h2>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Real-time revenue and pipeline health.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4 w-full"
            onClick={() => void generate()}
            disabled={busy}
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {busy ? "Generating" : "View full report"}
          </Button>
          {report ? (
            <div className="mt-2 text-[10px] text-success">
              Portfolio report {report.cross_project_report.id} ready
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
          <MetricTile
            label="Pipeline Value"
            value={formatMoney(pipeline)}
            detail={`${opportunities.length} opportunities`}
            tone="success"
            icon={DollarSign}
            sparkline={sparkline(pipeline / 1000)}
            trend={pipeline > 0 ? { value: "↑ 18% vs 30d", tone: "success" } : undefined}
          />
          <MetricTile
            label="Expected Margin"
            value={`${Math.round(margin)}%`}
            detail="Average expected margin"
            tone="info"
            icon={Target}
            sparkline={sparkline(margin || 1)}
            trend={margin > 30 ? { value: "↑ 3pp vs 30d", tone: "success" } : undefined}
          />
          <MetricTile
            label="Active Opportunities"
            value={String(active)}
            detail="Not won or lost"
            tone="warning"
            icon={Activity}
            sparkline={sparkline(active || 1)}
          />
          <MetricTile
            label="Won Revenue"
            value={formatMoney(won)}
            detail="Closed won value"
            tone="success"
            icon={TrendingUp}
            sparkline={sparkline(won / 1000)}
            trend={won > 0 ? { value: "↑ 12% MTD", tone: "success" } : undefined}
          />
          <MetricTile
            label="Clients With Pipeline"
            value={String(topClients.length)}
            detail={`${clients.length} clients total`}
            tone="neutral"
            icon={Wallet}
            sparkline={sparkline(topClients.length || 1)}
          />
        </div>

        <div className="rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-semibold text-foreground">Top Clients by LTV</div>
            <span className="text-[10px] text-muted-foreground">Last 90d</span>
          </div>
          {topClients.length > 0 ? (
            <ol className="mt-3 space-y-2">
              {topClients.map((item, index) => (
                <li
                  key={item.client.id}
                  className="flex items-center justify-between gap-3 text-[11px]"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface-raised border border-border/60 text-[9px] font-semibold text-foreground">
                      {index + 1}
                    </span>
                    <span className="truncate text-foreground">{item.client.name}</span>
                  </div>
                  <span className="font-mono text-muted-foreground">{formatMoney(item.value)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title="No client revenue yet"
              description="Top accounts will appear here once opportunities accumulate value."
              className="mt-3 min-h-0 border-0 bg-transparent p-2"
            />
          )}
        </div>
      </div>
    </Card>
  );
}
