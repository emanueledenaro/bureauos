import {
  Activity,
  ArrowUpRight,
  ClipboardCheck,
  DollarSign,
  FileText,
  Percent,
  ShieldCheck,
  Tags,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { ActionBanner } from "../components/dashboard/ActionBanner";
import { KpiBar } from "../components/dashboard/KpiBar";
import { ViewToolbar } from "../components/dashboard/ViewToolbar";
import { DataTable, type DataTableColumn } from "../components/dashboard/DataTable";
import { OperationalFocus } from "../components/dashboard/OperationalFocus";
import { BaseCard, BaseCardHeader } from "../components/dashboard/BaseCard";
import { Badge } from "../components/ui/badge";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { clientName, sortNewest } from "../lib/builders";
import { opportunityTone } from "../lib/tone";
import { formatLabel, formatMoney } from "../lib/format";
import type { OpportunityRecord, RevenuePipelineResult } from "../lib/api";
import type { DashboardState } from "../lib/types";

interface ServiceEvidence {
  id: string;
  type: string;
  created?: string;
}

const COMMERCIAL_GATE_PATTERN =
  /proposal|pricing|price|billing|budget|ads|campaign|client|public|commit/i;

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
  const openOpportunities = state.opportunities.filter(
    (opportunity) => !["won", "lost"].includes(opportunity.status),
  );
  const stalledOpportunity = sortNewest(openOpportunities).find(
    (opportunity) => opportunity.status === "stalled",
  );
  const proposalOpportunity = sortNewest(openOpportunities).find((opportunity) =>
    ["proposal_draft", "proposal_sent"].includes(opportunity.status),
  );
  const highestValueOpportunity = [...openOpportunities].sort(
    (left, right) => (right.expected_value || 0) - (left.expected_value || 0),
  )[0];
  const revenueFocus =
    stalledOpportunity ?? proposalOpportunity ?? highestValueOpportunity ?? undefined;
  const revenueFocusDetail = revenueFocus
    ? revenueFocus.next_action ||
      revenueFocus.proposal_status ||
      revenueFocus.qualification_status ||
      `Advance ${formatLabel(revenueFocus.status)} with ${clientName(state.clients, revenueFocus.client_id)}.`
    : "No commercial opportunity is recorded yet. The coordinator needs a client, scope, value, and next action before proposal work.";
  const revenueReports = sortNewest(
    state.artifacts.filter((artifact) => artifact.type === "revenue-pipeline-report"),
  );
  const proposalArtifacts = sortNewest(
    state.artifacts.filter((artifact) => artifact.type === "proposal-brief"),
  );
  const pricingArtifacts = sortNewest(
    state.artifacts.filter((artifact) => artifact.type === "pricing-brief"),
  );
  const conversionArtifacts = sortNewest(
    state.artifacts.filter((artifact) => artifact.type === "conversion-audit"),
  );
  const accountArtifacts = sortNewest(
    state.artifacts.filter(
      (artifact) =>
        artifact.type === "client-account-plan" || artifact.type === "client-success-status-report",
    ),
  );
  const commercialApprovals = sortNewest(
    state.approvals.filter((approval) =>
      COMMERCIAL_GATE_PATTERN.test(
        `${approval.action} ${approval.scope} ${approval.target} ${approval.source ?? ""}`,
      ),
    ),
  );
  const qualifiedOpportunities = sortNewest(
    state.opportunities.filter((opportunity) => opportunity.qualification_status),
  );
  const proposalOpportunities = sortNewest(
    state.opportunities.filter(
      (opportunity) =>
        opportunity.proposal_status ||
        ["proposal_draft", "proposal_sent"].includes(opportunity.status),
    ),
  );
  const pricingOpportunities = sortNewest(
    state.opportunities.filter((opportunity) => opportunity.pricing_status),
  );

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
      id: "next",
      header: "Next action",
      width: "minmax(180px,0.85fr)",
      mobileLabel: "Next action",
      render: (opportunity) => (
        <span className="text-body-secondary line-clamp-2 text-foreground/80">
          {opportunity.next_action ||
            opportunity.proposal_status ||
            opportunity.qualification_status ||
            "No next action recorded"}
        </span>
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

      <OperationalFocus
        className="mb-section"
        tone={revenueFocus ? opportunityTone(revenueFocus.status) : "neutral"}
        icon={ArrowUpRight}
        title={
          revenueFocus
            ? `${revenueFocus.title} · ${clientName(state.clients, revenueFocus.client_id)}`
            : "Create the first qualified opportunity"
        }
        detail={revenueFocusDetail}
        signals={
          revenueFocus
            ? [
                formatMoney(revenueFocus.expected_value || 0),
                `${Math.round(revenueFocus.expected_margin || 0)}% margin`,
                formatLabel(revenueFocus.status),
              ]
            : ["0 open pipeline", "No proposal target"]
        }
      />

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

      <div className="mt-section">
        <SectionHeading
          title="Revenue service coverage"
          meta={`${revenueReports.length + proposalArtifacts.length + pricingArtifacts.length + conversionArtifacts.length + accountArtifacts.length} artifacts`}
        />
        <div className="mt-2 grid items-stretch gap-3 lg:grid-cols-2 xl:grid-cols-5">
          <ServiceCard
            icon={FileText}
            title="Pipeline reports"
            status={`${revenueReports.length} report artifacts`}
            badge={revenueReports[0]?.id ?? "Generate report"}
            detail="Opportunity qualification, pipeline value, proposal readiness, and next actions from the revenue service."
            evidence={revenueReports.slice(0, 4)}
          />
          <ServiceCard
            icon={ClipboardCheck}
            title="Qualification"
            status={`${qualifiedOpportunities.length}/${state.opportunities.length} opportunities`}
            badge={qualifiedOpportunities.length ? "Tracked" : "Needs intake"}
            detail="Qualification status is visible per opportunity, without inventing missing client context."
            evidence={qualifiedOpportunities.slice(0, 4).map((opportunity) => ({
              id: opportunity.id,
              type: opportunity.qualification_status ?? opportunity.status,
              created: opportunity.created,
            }))}
          />
          <ServiceCard
            icon={FileText}
            title="Proposal drafts"
            status={`${proposalArtifacts.length} proposal artifacts`}
            badge={`${proposalOpportunities.length} in state`}
            detail="Proposal artifacts and proposal states are draft-first; final sends remain owner-gated."
            evidence={[
              ...proposalArtifacts.slice(0, 2),
              ...proposalOpportunities.slice(0, 2).map((opportunity) => ({
                id: opportunity.id,
                type: opportunity.proposal_status ?? opportunity.status,
                created: opportunity.created,
              })),
            ]}
          />
          <ServiceCard
            icon={Tags}
            title="Pricing and conversion"
            status={`${pricingArtifacts.length + conversionArtifacts.length} artifacts`}
            badge={`${pricingOpportunities.length} priced`}
            detail="Pricing notes and conversion audits are visible, while price changes stay behind policy gates."
            evidence={[
              ...pricingArtifacts.slice(0, 2),
              ...conversionArtifacts.slice(0, 2),
              ...pricingOpportunities.slice(0, 1).map((opportunity) => ({
                id: opportunity.id,
                type: opportunity.pricing_status ?? opportunity.status,
                created: opportunity.created,
              })),
            ]}
          />
          <ServiceCard
            icon={ShieldCheck}
            title="Account health gates"
            status={`${accountArtifacts.length} account reports`}
            badge={`${commercialApprovals.length} pending gates`}
            detail="Client account plans, success reports, and serious commercial approvals stay one surface away."
            evidence={[
              ...accountArtifacts.slice(0, 2),
              ...commercialApprovals.slice(0, 2).map((approval) => ({
                id: approval.id,
                type: approval.action,
                created: approval.created,
              })),
            ]}
          />
        </div>
      </div>

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

function SectionHeading({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex min-h-8 min-w-0 flex-wrap items-end justify-between gap-2">
      <h3 className="text-section-title">{title}</h3>
      {meta ? <span className="text-meta truncate">{meta}</span> : null}
    </div>
  );
}

function ServiceCard({
  icon: Icon,
  title,
  status,
  badge,
  detail,
  evidence,
}: {
  icon: LucideIcon;
  title: string;
  status: string;
  badge: string;
  detail: string;
  evidence: ServiceEvidence[];
}) {
  return (
    <BaseCard className="h-full gap-3">
      <BaseCardHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/60 bg-background/45 text-muted-foreground">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="truncate">{title}</span>
          </span>
        }
        subtitle={status}
      >
        <Badge variant="muted" className="max-w-[150px] truncate">
          {badge}
        </Badge>
      </BaseCardHeader>
      <p className="text-body-secondary line-clamp-3 text-foreground/80">{detail}</p>
      <div className="mt-auto space-y-1 border-t border-border/60 pt-3">
        {evidence.length > 0 ? (
          evidence.slice(0, 4).map((item) => (
            <div
              key={item.id}
              className="flex min-w-0 items-center justify-between gap-3 text-meta"
            >
              <span className="min-w-0 truncate font-mono">{item.id}</span>
              <span className="shrink-0">{formatLabel(item.type)}</span>
            </div>
          ))
        ) : (
          <div className="text-meta">No local evidence yet.</div>
        )}
      </div>
    </BaseCard>
  );
}
