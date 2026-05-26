import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Database,
  FileText,
  GitBranch,
  KeyRound,
  MessageSquare,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/dashboard/EmptyState";
import { StatusPill } from "../components/dashboard/StatusPill";
import { cn } from "../lib/utils";
import { formatLabel, timeAgo } from "../lib/format";
import { runTone, type Tone } from "../lib/tone";
import type { ArtifactRecord, AuditEvent, RunRecord } from "../lib/api";

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

export type RunRiskLevel = "low" | "medium" | "high" | "critical";

const riskTone: Record<RunRiskLevel, Tone> = {
  low: "success",
  medium: "info",
  high: "warning",
  critical: "danger",
};

export function runRiskLevel(run: RunRecord): RunRiskLevel {
  if (run.status === "failed") return "critical";
  if (run.status === "blocked" || run.status === "needs_human") return "high";
  if (["planning", "dispatching", "in_progress", "verifying"].includes(run.status)) {
    return "medium";
  }
  return "low";
}

export function runSourceIssue(run: RunRecord): string {
  if (run.source_work_item_type === "linear_issue" && run.source_work_item_id) {
    return run.source_work_item_id;
  }
  if (run.linear_identifier) return run.linear_identifier;
  const source = run.trigger_source ?? "";
  const linear = /linear:\/\/issue\/([A-Z]+-\d+)/i.exec(source);
  if (linear?.[1]) return linear[1].toUpperCase();
  return "No linked issue";
}

export function runBlockingReason(run: RunRecord): string | undefined {
  const blockers = Array.isArray(run.blockers) ? run.blockers.join(", ") : run.blockers;
  return (
    run.blocking_reason ||
    blockers ||
    run.dispatch_error ||
    run.error ||
    (run.status === "needs_human" ? "Owner approval or decision required." : undefined)
  );
}

export function runNextAction(run: RunRecord): string {
  if (run.next_action) return run.next_action;
  if (run.status === "failed") {
    return "Review the failure evidence and retry only after the blocker is clear.";
  }
  if (run.status === "blocked") return "Resolve the blocker before dispatching more work.";
  if (run.status === "needs_human") return "Review the required approval or decision.";
  return "No blocking action required.";
}

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
  runs,
}: {
  events: AuditEvent[];
  artifacts: ArtifactRecord[];
  runs: RunRecord[];
}) {
  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => (b.created ?? "").localeCompare(a.created ?? "")),
    [runs],
  );
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>(sortedRuns[0]?.id);
  useEffect(() => {
    if (!sortedRuns.length) {
      setSelectedRunId(undefined);
      return;
    }
    if (!selectedRunId || !sortedRuns.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(sortedRuns[0]?.id);
    }
  }, [selectedRunId, sortedRuns]);
  const selectedRun = sortedRuns.find((run) => run.id === selectedRunId) ?? sortedRuns[0];
  const selectedRunEvents = selectedRun
    ? [...events]
        .filter((event) => event.target === selectedRun.id)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    : [];
  const selectedRunArtifacts = selectedRun
    ? artifacts
        .filter(
          (artifact) =>
            artifact.run_id === selectedRun.id || selectedRun.artifacts?.includes(artifact.id),
        )
        .sort((a, b) => (a.created ?? "").localeCompare(b.created ?? ""))
    : [];
  const selectedRunRisk = selectedRun ? runRiskLevel(selectedRun) : "low";
  const selectedRunBlocker = selectedRun ? runBlockingReason(selectedRun) : undefined;
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
    <div className="grid gap-4">
      <Card className="overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-3.5">
          <div>
            <div className="flex items-center gap-2">
              <CircleDot className="h-3.5 w-3.5 text-muted-foreground" />
              <h2 className="text-[14px] font-semibold text-foreground">Run Timeline</h2>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Request, agent work, policy events, artifacts, and outcome for each run.
            </p>
          </div>
          <div className="hidden items-center gap-2 text-[11px] text-muted-foreground sm:flex">
            <Clock3 className="h-3.5 w-3.5" />
            {sortedRuns.length} runs
          </div>
        </div>

        {sortedRuns.length > 0 && selectedRun ? (
          <div className="grid gap-0 lg:grid-cols-[minmax(280px,360px)_1fr]">
            <div className="border-b border-border/60 lg:border-r lg:border-b-0">
              <div className="grid grid-cols-[74px_minmax(0,1fr)_74px] border-b border-border/60 px-4 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                <span>Status</span>
                <span>Run</span>
                <span className="text-right">Risk</span>
              </div>
              <div className="max-h-[420px] overflow-y-auto">
                {sortedRuns.slice(0, 12).map((run) => {
                  const risk = runRiskLevel(run);
                  return (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => setSelectedRunId(run.id)}
                      className={cn(
                        "grid w-full grid-cols-[74px_minmax(0,1fr)_74px] items-start gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-surface-subtle",
                        selectedRun.id === run.id ? "bg-surface-subtle" : "bg-transparent",
                      )}
                    >
                      <StatusPill value={formatLabel(run.status)} tone={runTone(run.status)} />
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-semibold text-foreground">
                          {formatLabel(run.type)}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {run.scope}
                        </span>
                        <span className="mt-1 block truncate text-[10px] text-muted-foreground/80">
                          {run.created_by ?? "supreme_coordinator"} · {runSourceIssue(run)}
                        </span>
                      </span>
                      <span className="flex justify-end">
                        <StatusPill value={risk} tone={riskTone[risk]} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-w-0 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      value={formatLabel(selectedRun.status)}
                      tone={runTone(selectedRun.status)}
                    />
                    <StatusPill
                      value={`${selectedRunRisk} risk`}
                      tone={riskTone[selectedRunRisk]}
                    />
                  </div>
                  <h3 className="mt-2 truncate text-[15px] font-semibold text-foreground">
                    {selectedRun.scope}
                  </h3>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>Owner: {selectedRun.created_by ?? "supreme_coordinator"}</span>
                    <span>Source issue: {runSourceIssue(selectedRun)}</span>
                    <span>Created: {timeAgo(selectedRun.created)}</span>
                    {selectedRun.completed ? (
                      <span>Completed: {timeAgo(selectedRun.completed)}</span>
                    ) : null}
                  </div>
                </div>
              </div>

              {selectedRunBlocker ? (
                <div className="mt-4 rounded-md border border-warning/40 bg-warning-subtle/30 p-3">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-warning">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Blocking reason
                  </div>
                  <div className="mt-1 text-[11px] text-foreground">{selectedRunBlocker}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Next: {runNextAction(selectedRun)}
                  </div>
                </div>
              ) : null}

              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div>
                  <div className="text-[11px] font-semibold uppercase text-muted-foreground">
                    Ordered events
                  </div>
                  <div className="mt-2 divide-y divide-border/60 rounded-md border border-border/60">
                    {selectedRunEvents.length > 0 ? (
                      selectedRunEvents.map((event) => (
                        <div
                          key={`${event.timestamp}:${event.action}`}
                          className="grid grid-cols-[72px_minmax(0,1fr)_60px] gap-2 px-3 py-2 text-[11px]"
                        >
                          <span className="text-muted-foreground">{timeAgo(event.timestamp)}</span>
                          <span className="truncate text-foreground">{event.action}</span>
                          <span className="truncate text-right text-muted-foreground">
                            {event.result}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="px-3 py-3 text-[11px] text-muted-foreground">
                        No run-scoped audit events yet.
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase text-muted-foreground">
                    Artifacts
                  </div>
                  <div className="mt-2 divide-y divide-border/60 rounded-md border border-border/60">
                    {selectedRunArtifacts.length > 0 ? (
                      selectedRunArtifacts.map((artifact) => (
                        <div
                          key={artifact.id}
                          className="grid grid-cols-[minmax(0,1fr)_88px] gap-2 px-3 py-2 text-[11px]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">
                              {formatLabel(artifact.type)}
                            </span>
                            <span className="block truncate text-muted-foreground">
                              {artifact.id}
                            </span>
                          </span>
                          <span className="flex justify-end">
                            <StatusPill
                              value={formatLabel(artifact.status)}
                              tone={artifact.status === "superseded" ? "warning" : "neutral"}
                            />
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="px-3 py-3 text-[11px] text-muted-foreground">
                        No artifacts attached to this run.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-5 py-5">
            <EmptyState
              title="No runs yet"
              description="Run intake, dispatch, verification, blockers, and artifacts will appear here."
            />
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-3.5">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <h2 className="text-[14px] font-semibold text-foreground">
                Live Operations Timeline
              </h2>
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
    </div>
  );
}
