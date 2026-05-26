import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Database,
  FileText,
  GitBranch,
  KeyRound,
  MessageSquare,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/dashboard/EmptyState";
import { cn } from "../lib/utils";
import { timeAgo } from "../lib/format";
import type { ArtifactRecord, AuditEvent } from "../lib/api";

export type TimelineEventIcon =
  | "activity"
  | "approval"
  | "audit"
  | "chat"
  | "github"
  | "memory"
  | "policy"
  | "provider"
  | "report";

export type TimelineEventTone = "success" | "danger" | "warning" | "info" | "neutral";

export interface TimelineEventPresentation {
  icon: TimelineEventIcon;
  label: string;
  tone: TimelineEventTone;
}

const timelineIcons: Record<TimelineEventIcon, LucideIcon> = {
  activity: Activity,
  approval: CheckCircle2,
  audit: FileText,
  chat: MessageSquare,
  github: GitBranch,
  memory: Database,
  policy: ShieldCheck,
  provider: KeyRound,
  report: FileText,
};

const toneClasses: Record<TimelineEventTone, string> = {
  success:
    "border-success/40 bg-success-subtle text-success shadow-[0_0_10px_hsl(var(--success)/0.3)]",
  danger: "border-danger/40 bg-danger-subtle text-danger shadow-[0_0_10px_hsl(var(--danger)/0.3)]",
  warning:
    "border-warning/40 bg-warning-subtle text-warning shadow-[0_0_10px_hsl(var(--warning)/0.28)]",
  info: "border-info/40 bg-info-subtle text-info shadow-[0_0_10px_hsl(var(--info)/0.24)]",
  neutral: "border-border/70 bg-surface-raised text-muted-foreground",
};

export function timelineEventPresentation(event: AuditEvent): TimelineEventPresentation {
  const action = event.action.toLowerCase();
  const target = (event.target ?? "").toLowerCase();
  const descriptor = `${action} ${target}`;

  if (event.result !== "ok") {
    return { icon: "audit", label: "Attention needed", tone: "danger" };
  }
  if (descriptor.includes("approval")) {
    return { icon: "approval", label: "Approval", tone: "warning" };
  }
  if (descriptor.includes("policy")) {
    return { icon: "policy", label: "Policy", tone: "warning" };
  }
  if (
    descriptor.includes("github") ||
    descriptor.includes("pull") ||
    descriptor.includes("issue")
  ) {
    return { icon: "github", label: "GitHub", tone: "info" };
  }
  if (descriptor.includes("memory")) {
    return { icon: "memory", label: "Memory", tone: "success" };
  }
  if (descriptor.includes("provider") || descriptor.includes("auth")) {
    return { icon: "provider", label: "Provider", tone: "info" };
  }
  if (
    descriptor.includes("coordinator") ||
    descriptor.includes("chat") ||
    descriptor.includes("message")
  ) {
    return { icon: "chat", label: "Coordinator", tone: "success" };
  }
  if (descriptor.includes("report") || descriptor.includes("artifact")) {
    return { icon: "report", label: "Report", tone: "neutral" };
  }
  return { icon: "activity", label: "Activity", tone: "neutral" };
}

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
            {visible.map((event, index) => {
              const presentation = timelineEventPresentation(event);
              const Icon = timelineIcons[presentation.icon];
              return (
                <div key={`${event.timestamp}-${index}`} className="relative min-w-0">
                  <div className="text-[10px] text-muted-foreground">
                    {timeAgo(event.timestamp)}
                  </div>
                  <div className="relative mt-1.5 flex h-6 items-center">
                    <span
                      className={cn(
                        "z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                        toneClasses[presentation.tone],
                      )}
                      aria-label={presentation.label}
                    >
                      <Icon className="h-3 w-3" aria-hidden="true" />
                    </span>
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
              );
            })}
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
