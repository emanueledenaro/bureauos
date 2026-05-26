import { FileText } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { EmptyState } from "../components/dashboard/EmptyState";
import { BaseCard } from "../components/dashboard/BaseCard";
import { Badge } from "../components/ui/badge";
import { sortNewest } from "../lib/builders";
import { formatLabel, timeAgo } from "../lib/format";
import type { DashboardState } from "../lib/types";

const REPORT_TYPES = new Set([
  "executive-report",
  "cross-project-executive-report",
  "business-operating-report",
  "client-account-plan",
  "client-success-status-report",
  "revenue-pipeline-report",
]);

export function ReportsView({ state }: { state: DashboardState }) {
  const reports = state.artifacts.filter((artifact) => REPORT_TYPES.has(artifact.type));
  return (
    <SectionShell
      title="Reports"
      description="Executive, client, revenue, and business reports generated from current registries."
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sortNewest(reports).map((artifact) => (
          <BaseCard key={artifact.id} variant="interactive" className="gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-md border border-border/60 bg-surface-raised text-muted-foreground">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-card-title">{formatLabel(artifact.type)}</div>
                  <div className="text-meta mt-0.5 truncate font-mono">{artifact.id}</div>
                </div>
              </div>
              <Badge variant="muted">{artifact.type.split("-")[0]}</Badge>
            </div>
            <div className="text-meta">
              {artifact.created ? `Created ${timeAgo(artifact.created)}` : "Created"}
            </div>
          </BaseCard>
        ))}
        {reports.length === 0 ? (
          <div className="md:col-span-2 xl:col-span-3">
            <EmptyState
              title="No reports yet"
              description="Generate a business report from the Revenue Pulse panel."
              icon={FileText}
            />
          </div>
        ) : null}
      </div>
    </SectionShell>
  );
}
