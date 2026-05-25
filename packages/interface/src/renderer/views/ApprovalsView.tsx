import { useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { EmptyState } from "../components/dashboard/EmptyState";
import { ResponsiveTable } from "../components/dashboard/ResponsiveTable";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { approvalTone } from "../lib/tone";
import { formatLabel, timeAgo } from "../lib/format";
import type { DashboardState } from "../lib/types";

const FILTERS: Array<{ id: "pending" | "approved" | "rejected" | "all"; label: string }> = [
  { id: "pending", label: "Pending" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "all", label: "All" },
];

export function ApprovalsView({
  state,
  onResolve,
}: {
  state: DashboardState;
  onResolve: (id: string, status: "approved" | "rejected") => Promise<void>;
}) {
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const allApprovals = [...state.approvals, ...state.resolvedApprovals];
  const visible = allApprovals
    .filter((approval) => filter === "all" || approval.status === filter)
    .sort((a, b) => (b.updated ?? b.created ?? "").localeCompare(a.updated ?? a.created ?? ""));
  const approved = state.resolvedApprovals.filter((approval) => approval.status === "approved");
  const rejected = state.resolvedApprovals.filter((approval) => approval.status === "rejected");

  return (
    <SectionShell
      title="Approvals"
      description="Owner decisions, external action gates, and resolved approval history."
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <MetricTile
          label="Pending"
          value={String(state.approvals.length)}
          detail="Waiting for owner"
          icon={ShieldCheck}
          tone={state.approvals.length > 0 ? "warning" : "success"}
        />
        <MetricTile
          label="Approved"
          value={String(approved.length)}
          detail="Resolved allowed"
          icon={Check}
          tone="success"
        />
        <MetricTile
          label="Rejected"
          value={String(rejected.length)}
          detail="Resolved blocked"
          icon={X}
          tone={rejected.length > 0 ? "danger" : "neutral"}
        />
        <MetricTile
          label="Total"
          value={String(allApprovals.length)}
          detail="Pending and history"
          icon={ShieldCheck}
          tone="neutral"
        />
      </div>

      <div className="mt-5 inline-flex rounded-lg border border-border/70 bg-surface-subtle/60 p-1">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors focus-ring",
              filter === item.id
                ? "bg-surface-raised text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <ResponsiveTable className="mt-4" minWidth={920}>
        <div className="grid grid-cols-[minmax(0,1.4fr)_110px_minmax(0,1fr)_120px_140px_180px] bg-surface-subtle/60 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Action</span>
          <span>Status</span>
          <span>Scope</span>
          <span>Actor</span>
          <span>Updated</span>
          <span />
        </div>
        {visible.map((approval) => (
          <div
            key={approval.id}
            className="grid grid-cols-[minmax(0,1.4fr)_110px_minmax(0,1fr)_120px_140px_180px] items-center gap-3 border-t border-border/60 px-4 py-3 text-[11px]"
          >
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground">
                {formatLabel(approval.action)}
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                {approval.id}
              </div>
            </div>
            <StatusPill value={formatLabel(approval.status)} tone={approvalTone(approval.status)} />
            <div className="min-w-0">
              <div className="truncate text-foreground">{approval.scope}</div>
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {approval.target}
              </div>
            </div>
            <span className="truncate text-muted-foreground">{approval.actor}</span>
            <div className="text-muted-foreground">
              <div>{approval.updated ? timeAgo(approval.updated) : "—"}</div>
              {approval.resolved_by ? (
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground/80">
                  by {approval.resolved_by}
                </div>
              ) : null}
            </div>
            {approval.status === "pending" ? (
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="success"
                  onClick={() => void onResolve(approval.id, "approved")}
                >
                  <Check className="h-3 w-3" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void onResolve(approval.id, "rejected")}
                >
                  <X className="h-3 w-3" />
                  Reject
                </Button>
              </div>
            ) : (
              <span className="truncate text-right text-[10px] text-muted-foreground">
                {approval.reason || approval.resolved_at || "Resolved"}
              </span>
            )}
          </div>
        ))}
        {visible.length === 0 ? (
          <div className="border-t border-border/60 p-5">
            <EmptyState
              title="No approvals in this view"
              description="Policy gates appear here before BureauOS performs sensitive actions."
              icon={ShieldCheck}
            />
          </div>
        ) : null}
      </ResponsiveTable>
    </SectionShell>
  );
}
