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
import { useT, type TFunction } from "../i18n/i18n";
import type {
  ArtifactRecord,
  BusinessReportResult,
  ClientIntelligenceSummary,
  ClientRecord,
  CompanyPulse,
  OpportunityRecord,
} from "../lib/api";

interface RevenueHistoryPoint {
  created: string;
  pipeline: number;
  active: number;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function revenueHistory(
  artifacts: readonly ArtifactRecord[],
  current: Pick<RevenueHistoryPoint, "pipeline" | "active">,
): RevenueHistoryPoint[] {
  const reports = artifacts
    .filter((artifact) => artifact.type === "revenue-pipeline-report")
    .map((artifact) => ({
      created: artifact.created ?? artifact.generated_at ?? "",
      pipeline: numberValue(artifact.pipeline_value),
      active: numberValue(artifact.open_opportunities),
    }))
    .filter((point) => point.created)
    .sort((left, right) => left.created.localeCompare(right.created));

  if (reports.length === 0) return [];
  const latest = reports[reports.length - 1];
  const latestMatchesCurrent =
    latest?.pipeline === current.pipeline && latest.active === current.active;
  return latestMatchesCurrent
    ? reports
    : [
        ...reports,
        {
          created: new Date().toISOString(),
          pipeline: current.pipeline,
          active: current.active,
        },
      ];
}

function metricTrend(
  t: TFunction,
  current: number,
  previous: number | undefined,
  format: (value: number) => string,
): { value: string; tone: "success" | "warning" | "neutral" } | undefined {
  if (previous === undefined) return undefined;
  const delta = current - previous;
  if (delta === 0)
    return { value: t("revenuePulse.trendFlat", "flat vs last report"), tone: "neutral" };
  const prefix = delta > 0 ? "+" : "-";
  return {
    value: `${prefix}${format(Math.abs(delta))} ${t("revenuePulse.trendVsLastReport", "vs last report")}`,
    tone: delta > 0 ? "success" : "warning",
  };
}

function historyValues(
  history: readonly RevenueHistoryPoint[],
  key: "pipeline" | "active",
): number[] | undefined {
  if (history.length < 2) return undefined;
  return history.map((point) => point[key]);
}

export function RevenuePulseView({
  pulse,
  clients,
  clientIntelligence,
  opportunities,
  artifacts,
  pipelineValue,
  onGenerateReport,
}: {
  pulse?: CompanyPulse;
  clients: ClientRecord[];
  clientIntelligence?: ClientIntelligenceSummary;
  opportunities: OpportunityRecord[];
  artifacts: ArtifactRecord[];
  /**
   * Pipeline value from the shared `pipelineValue(state)` builder (single source
   * of truth: prefers client-intelligence totals over the pulse figure). Passed
   * in so this tile matches Header/Revenue/Today/Clients instead of reading the
   * raw pulse value directly (SER-204).
   */
  pipelineValue: number;
  onGenerateReport: () => Promise<BusinessReportResult>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BusinessReportResult | undefined>();

  const pipeline = pipelineValue;
  const active = pulse?.revenue.active_opportunities ?? 0;
  const margin = opportunities.length
    ? opportunities.reduce((sum, item) => sum + (item.expected_margin || 0), 0) /
      opportunities.length
    : 0;
  const won = opportunities
    .filter((item) => item.status === "won")
    .reduce((sum, item) => sum + (item.expected_value || 0), 0);
  const history = revenueHistory(artifacts, { pipeline, active });
  const previous = history.length >= 2 ? history[history.length - 2] : undefined;
  const hasHistory = history.length >= 2;
  const clientsWithPipeline =
    clientIntelligence?.clients.filter((item) => item.revenue.pipeline_value > 0).length ?? 0;
  const topClients = (clientIntelligence?.clients ?? [])
    .map((item) => ({
      client: item.client,
      value: item.revenue.won_value + item.revenue.pipeline_value,
      won: item.revenue.won_value,
      pipeline: item.revenue.pipeline_value,
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
            <h2 className="text-[14px] font-semibold text-foreground">
              {t("revenuePulse.title", "Revenue Pulse")}
            </h2>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("revenuePulse.description", "Revenue and pipeline health from stored BOS records.")}
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
            {busy
              ? t("revenuePulse.generating", "Generating")
              : t("revenuePulse.viewFullReport", "View full report")}
          </Button>
          {report ? (
            <div className="mt-2 text-[10px] text-success">
              {t("revenuePulse.portfolioReport", "Portfolio report")}{" "}
              {report.cross_project_report.id} {t("revenuePulse.ready", "ready")}
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
          <MetricTile
            label={t("revenuePulse.pipelineValue", "Pipeline Value")}
            value={formatMoney(pipeline)}
            detail={
              hasHistory
                ? `${history.length} ${t("revenuePulse.storedSnapshots", "stored snapshots")}`
                : t("revenuePulse.noTrendHistory", "No trend history yet")
            }
            tone="success"
            icon={DollarSign}
            sparkline={historyValues(history, "pipeline")}
            trend={metricTrend(t, pipeline, previous?.pipeline, formatMoney)}
          />
          <MetricTile
            label={t("revenuePulse.expectedMargin", "Expected Margin")}
            value={`${Math.round(margin)}%`}
            detail={
              opportunities.length > 0
                ? t("revenuePulse.averageExpectedMargin", "Average expected margin")
                : t("revenuePulse.noMarginData", "No opportunity margin data yet")
            }
            tone="info"
            icon={Target}
          />
          <MetricTile
            label={t("revenuePulse.activeOpportunities", "Active Opportunities")}
            value={String(active)}
            detail={
              hasHistory
                ? t("revenuePulse.trackedFromReports", "Tracked from pipeline reports")
                : t("revenuePulse.noTrendHistory", "No trend history yet")
            }
            tone="warning"
            icon={Activity}
            sparkline={historyValues(history, "active")}
            trend={metricTrend(t, active, previous?.active, (value) => String(value))}
          />
          <MetricTile
            label={t("revenuePulse.wonRevenue", "Won Revenue")}
            value={formatMoney(won)}
            detail={
              clientIntelligence
                ? t("revenuePulse.closedWonValue", "Closed won value from client memory")
                : t("revenuePulse.waitingForIntelligence", "Waiting for client intelligence")
            }
            tone="success"
            icon={TrendingUp}
          />
          <MetricTile
            label={t("revenuePulse.clientsWithPipeline", "Clients With Pipeline")}
            value={String(clientsWithPipeline)}
            detail={
              clientIntelligence
                ? `${clients.length} ${t("revenuePulse.clientsTotal", "clients total")}`
                : t("revenuePulse.waitingForIntelligence", "Waiting for client intelligence")
            }
            tone="neutral"
            icon={Wallet}
          />
        </div>

        <div className="rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-semibold text-foreground">
              {t("revenuePulse.topClientsByLtv", "Top Clients by LTV")}
            </div>
            <span className="text-[10px] text-muted-foreground">
              {t("revenuePulse.clientMemory", "Client memory")}
            </span>
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
                  <span
                    className="font-mono text-muted-foreground"
                    title={t("revenuePulse.wonPlusOpenPipeline", "Won + open pipeline")}
                  >
                    {formatMoney(item.value)}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              title={
                clientIntelligence
                  ? t("revenuePulse.noClientRevenue", "No client revenue yet")
                  : t("revenuePulse.intelligenceLoading", "Client intelligence loading")
              }
              description={
                clientIntelligence
                  ? t(
                      "revenuePulse.emptyDescriptionHasIntel",
                      "Top accounts will appear once durable client revenue or pipeline exists.",
                    )
                  : t(
                      "revenuePulse.emptyDescriptionNoIntel",
                      "Top clients use client intelligence, not inferred UI-only totals.",
                    )
              }
              className="mt-3 min-h-0 border-0 bg-transparent p-2"
            />
          )}
        </div>
      </div>
    </Card>
  );
}
