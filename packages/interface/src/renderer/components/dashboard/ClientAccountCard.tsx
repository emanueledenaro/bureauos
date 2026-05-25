import { ArrowRight, Briefcase, TrendingUp } from "lucide-react";
import { Button } from "../ui/button";
import { MiniStat } from "./MetricTile";
import { StatusPill } from "./StatusPill";
import { clientRiskTone } from "../../lib/tone";
import { formatLabel, formatMoney, timeAgo } from "../../lib/format";
import type { ClientIntelligenceItem } from "../../lib/api";

export function ClientAccountCard({ item }: { item: ClientIntelligenceItem }) {
  const topProject = item.projects[0];
  const topOpportunity = item.opportunities[0];
  const memoryPaths = [
    item.memory_paths.profile,
    item.memory_paths.revenue,
    item.memory_paths.relationship,
    item.memory_paths.risks,
  ];

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border/70 bg-surface-subtle/60 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-foreground">
            {item.client.name}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>{item.client.industry}</span>
            <span aria-hidden>·</span>
            <span className="font-mono">{item.client.slug}</span>
            {item.latest_activity_at ? (
              <>
                <span aria-hidden>·</span>
                <span>Updated {timeAgo(item.latest_activity_at)}</span>
              </>
            ) : (
              <>
                <span aria-hidden>·</span>
                <span>No activity</span>
              </>
            )}
          </div>
        </div>
        <StatusPill value={formatLabel(item.risk)} tone={clientRiskTone(item.risk)} />
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MiniStat label="Pipeline" value={formatMoney(item.revenue.pipeline_value)} />
        <MiniStat label="Won" value={formatMoney(item.revenue.won_value)} />
        <MiniStat label="Projects" value={String(item.delivery.projects_total)} />
        <MiniStat label="Open opps" value={String(item.revenue.open_opportunities)} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-border/60 bg-surface-raised/60 p-3 text-[11px]">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Briefcase className="h-3 w-3" />
            <span className="font-medium uppercase tracking-wide text-[10px]">Delivery</span>
          </div>
          <div className="mt-2 text-foreground">
            {item.delivery.active_projects} active · {item.delivery.blocked_projects} blocked
          </div>
          <div className="mt-1 text-muted-foreground">
            {item.delivery.repositories_linked} repos · {item.delivery.pending_approvals} approvals
          </div>
          {topProject ? (
            <div className="mt-2 truncate text-muted-foreground">
              {topProject.name} · {formatLabel(topProject.status)}
            </div>
          ) : null}
        </div>
        <div className="rounded-md border border-border/60 bg-surface-raised/60 p-3 text-[11px]">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <TrendingUp className="h-3 w-3" />
            <span className="font-medium uppercase tracking-wide text-[10px]">Revenue</span>
          </div>
          <div className="mt-2 text-foreground">
            {Math.round(item.revenue.average_expected_margin)}% average margin
          </div>
          <div className="mt-1 text-muted-foreground">
            {item.revenue.won_opportunities} won · {item.revenue.stalled_opportunities} stalled
          </div>
          {topOpportunity ? (
            <div className="mt-2 truncate text-muted-foreground">
              {topOpportunity.title} · {formatMoney(topOpportunity.expected_value)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-md border border-border/60 bg-surface-raised/60 p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Next action</div>
        <div className="mt-1 text-[12px] leading-relaxed text-foreground">{item.next_action}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {memoryPaths.slice(0, 3).map((path) => (
          <span
            key={path}
            className="max-w-full truncate rounded border border-border/60 bg-surface-raised/40 px-2 py-1 font-mono text-[10px] text-muted-foreground"
            title={path}
          >
            {path}
          </span>
        ))}
        <Button variant="ghost" size="sm" className="ml-auto">
          Open account
          <ArrowRight className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
