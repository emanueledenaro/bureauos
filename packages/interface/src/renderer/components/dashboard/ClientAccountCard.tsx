import { ArrowRight, Briefcase, TrendingUp } from "lucide-react";
import { BaseCard, BaseCardHeader } from "./BaseCard";
import { Button } from "../ui/button";
import { MiniStat } from "./MetricTile";
import { StatusPill } from "./StatusPill";
import { clientRiskTone } from "../../lib/tone";
import { formatLabel, formatMoney, timeAgo } from "../../lib/format";
import type { ClientIntelligenceItem } from "../../lib/api";

export function ClientAccountCard({
  item,
  onOpen,
}: {
  item: ClientIntelligenceItem;
  onOpen?: () => void;
}) {
  const topProject = item.projects[0];
  const topOpportunity = item.opportunities[0];
  const memoryPaths = [
    item.memory_paths.profile,
    item.memory_paths.revenue,
    item.memory_paths.relationship,
    item.memory_paths.risks,
  ];

  const subtitle = (
    <span className="flex flex-wrap gap-x-2 gap-y-1">
      <span>{item.client.industry}</span>
      <span aria-hidden>·</span>
      <span className="font-mono">{item.client.slug}</span>
      <span aria-hidden>·</span>
      <span>
        {item.latest_activity_at ? `Updated ${timeAgo(item.latest_activity_at)}` : "No activity"}
      </span>
    </span>
  );

  return (
    <BaseCard className="gap-4">
      <BaseCardHeader title={item.client.name} subtitle={subtitle}>
        <StatusPill value={formatLabel(item.risk)} tone={clientRiskTone(item.risk)} />
      </BaseCardHeader>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MiniStat label="Pipeline" value={formatMoney(item.revenue.pipeline_value)} />
        <MiniStat label="Won" value={formatMoney(item.revenue.won_value)} />
        <MiniStat label="Projects" value={String(item.delivery.projects_total)} />
        <MiniStat label="Open opps" value={String(item.revenue.open_opportunities)} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-border/60 bg-background/35 p-3">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Briefcase className="h-3 w-3" />
            <span className="text-eyebrow">Delivery</span>
          </div>
          <div className="text-body-secondary mt-2 text-foreground">
            {item.delivery.active_projects} active · {item.delivery.blocked_projects} blocked
          </div>
          <div className="text-meta mt-1">
            {item.delivery.repositories_linked} repos · {item.delivery.pending_approvals} approvals
          </div>
          {topProject ? (
            <div className="text-meta mt-2 truncate">
              {topProject.name} · {formatLabel(topProject.status)}
            </div>
          ) : null}
        </div>
        <div className="rounded-md border border-border/60 bg-background/35 p-3">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <TrendingUp className="h-3 w-3" />
            <span className="text-eyebrow">Revenue</span>
          </div>
          <div className="text-body-secondary mt-2 text-foreground">
            {Math.round(item.revenue.average_expected_margin)}% average margin
          </div>
          <div className="text-meta mt-1">
            {item.revenue.won_opportunities} won · {item.revenue.stalled_opportunities} stalled
          </div>
          {topOpportunity ? (
            <div className="text-meta mt-2 truncate">
              {topOpportunity.title} · {formatMoney(topOpportunity.expected_value)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-md border border-border/60 bg-background/35 p-3">
        <div className="text-eyebrow">Next action</div>
        <div className="text-body mt-1 leading-relaxed text-foreground">{item.next_action}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {memoryPaths.slice(0, 3).map((path) => (
          <span
            key={path}
            className="text-meta max-w-full truncate rounded-md border border-border/60 bg-background/35 px-2 py-1 font-mono"
            title={path}
          >
            {path}
          </span>
        ))}
        {onOpen ? (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onOpen}>
            Open account
            <ArrowRight className="h-3 w-3" />
          </Button>
        ) : null}
      </div>
    </BaseCard>
  );
}
