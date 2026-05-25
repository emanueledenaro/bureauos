import { Activity, AlertTriangle, ChevronRight, GitBranch } from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/dashboard/EmptyState";
import { cn } from "../lib/utils";
import { timeAgo } from "../lib/format";
import type { ArtifactRecord, AuditEvent } from "../lib/api";

export function TimelineView({
  events,
  artifacts,
}: {
  events: AuditEvent[];
  artifacts: ArtifactRecord[];
}) {
  const visible = [...events]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 6)
    .reverse();
  const signalReports = artifacts
    .filter((artifact) => artifact.type === "github-signal-report")
    .sort((a, b) => new Date(b.created ?? "").getTime() - new Date(a.created ?? "").getTime())
    .slice(0, 3);
  const failingChecks = signalReports.reduce(
    (sum, report) => sum + (report.failing_checks_count ?? 0),
    0,
  );
  const staleWork = signalReports.reduce(
    (sum, report) =>
      sum + (report.stale_issues_count ?? 0) + (report.stale_pull_requests_count ?? 0),
    0,
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-3.5">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
            <h2 className="text-[14px] font-semibold text-foreground">Live Operations Timeline</h2>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Real-time autonomous activity across the company.
          </p>
        </div>
        <Button variant="ghost" size="sm">
          View all
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
      {visible.length > 0 ? (
        <div className="relative px-5 py-5">
          <div className="absolute right-9 top-[34px] left-9 hidden border-t border-dashed border-border/60 md:block" />
          <div className="grid gap-x-3 gap-y-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-6">
            {visible.map((event, index) => (
              <div key={`${event.timestamp}-${index}`} className="relative min-w-0">
                <div className="text-[10px] text-muted-foreground">{timeAgo(event.timestamp)}</div>
                <div className="relative mt-1.5 flex items-center">
                  <span
                    className={cn(
                      "z-10 h-2.5 w-2.5 rounded-full border-2 border-card",
                      event.result === "ok"
                        ? "bg-success shadow-[0_0_8px_hsl(var(--success)/0.5)]"
                        : "bg-danger shadow-[0_0_8px_hsl(var(--danger)/0.5)]",
                    )}
                  />
                </div>
                <div className="mt-2 truncate text-[11px] font-semibold text-foreground">
                  {event.action}
                </div>
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {event.target ?? "BureauOS"}
                </div>
                <div className="mt-1 truncate text-[10px] text-muted-foreground/80">
                  {event.actor}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="px-5 py-5">
          <EmptyState
            title="No live operations yet"
            description="Audit events, intake runs, approvals, GitHub signals, and report generation will stream here."
          />
        </div>
      )}

      {signalReports.length > 0 ? (
        <div className="grid gap-3 border-t border-border/60 px-5 py-4 md:grid-cols-[160px_1fr]">
          <div>
            <div className="flex items-center gap-1.5">
              <GitBranch className="h-3 w-3 text-muted-foreground" />
              <span className="text-[11px] font-semibold text-foreground">GitHub Signals</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
              {failingChecks > 0 ? (
                <span className="flex items-center gap-1 text-danger">
                  <AlertTriangle className="h-3 w-3" />
                  {failingChecks} failing
                </span>
              ) : (
                <span className="text-success">All checks green</span>
              )}
              <span>·</span>
              <span>{staleWork} stale</span>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {signalReports.map((report) => (
              <div
                key={report.id}
                className="rounded-md border border-border/60 bg-surface-subtle/60 p-2.5"
              >
                <div className="truncate text-[11px] font-medium text-foreground">
                  {report.repository ?? "GitHub"}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {report.github_event ?? "sync"}
                  {report.github_action ? ` · ${report.github_action}` : ""}
                </div>
                <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                  <span className="rounded border border-border/60 bg-surface-raised px-1.5 py-0.5 text-muted-foreground">
                    PR {report.pull_requests_count ?? 0}
                  </span>
                  <span className="rounded border border-border/60 bg-surface-raised px-1.5 py-0.5 text-muted-foreground">
                    CI {report.checks_count ?? 0}
                  </span>
                  <span
                    className={cn(
                      "rounded border px-1.5 py-0.5",
                      (report.failing_checks_count ?? 0) > 0
                        ? "border-danger/40 bg-danger-subtle/40 text-danger"
                        : "border-border/60 bg-surface-raised text-muted-foreground",
                    )}
                  >
                    Fail {report.failing_checks_count ?? 0}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
