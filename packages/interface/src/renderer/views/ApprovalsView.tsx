import { useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { KpiBar } from "../components/dashboard/KpiBar";
import { DataTable, type DataTableColumn } from "../components/dashboard/DataTable";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { approvalTone } from "../lib/tone";
import { formatLabel, timeAgo } from "../lib/format";
import type { ApprovalRecord } from "../lib/api";
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

  const columns: DataTableColumn<ApprovalRecord>[] = [
    {
      id: "action",
      header: "Action",
      width: "minmax(0,1.4fr)",
      render: (approval) => (
        <div className="min-w-0">
          <div className="text-body truncate font-medium text-foreground">
            {formatLabel(approval.action)}
          </div>
          <div className="text-meta mt-0.5 truncate font-mono">{approval.id}</div>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      width: "110px",
      render: (approval) => (
        <StatusPill value={formatLabel(approval.status)} tone={approvalTone(approval.status)} />
      ),
    },
    {
      id: "scope",
      header: "Scope",
      width: "minmax(0,1fr)",
      render: (approval) => (
        <div className="min-w-0">
          <div className="text-body truncate text-foreground">{approval.scope}</div>
          <div className="text-meta mt-0.5 truncate">{approval.target}</div>
        </div>
      ),
    },
    {
      id: "actor",
      header: "Actor",
      width: "120px",
      render: (approval) => <span className="text-meta truncate">{approval.actor}</span>,
    },
    {
      id: "updated",
      header: "Updated",
      width: "140px",
      render: (approval) => (
        <div className="text-meta">
          <div>{approval.updated ? timeAgo(approval.updated) : "—"}</div>
          {approval.resolved_by ? (
            <div className="text-meta mt-0.5 truncate text-muted-foreground/80">
              by {approval.resolved_by}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      width: "180px",
      align: "end",
      hideOnMobile: true,
      render: (approval) =>
        approval.status === "pending" ? (
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
          <span className="text-meta truncate text-right">
            {approval.reason || approval.resolved_at || "Resolved"}
          </span>
        ),
    },
  ];

  return (
    <SectionShell
      title="Approvals"
      description="Owner decisions, external action gates, and resolved approval history."
    >
      <KpiBar columns={4}>
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
      </KpiBar>

      <div className="mt-section inline-flex rounded-lg border border-border bg-surface-subtle p-1">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-body font-medium transition-colors focus-ring",
              filter === item.id
                ? "bg-surface-raised text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <DataTable
        className="mt-3"
        columns={columns}
        rows={visible}
        rowKey={(approval) => approval.id}
        mobileFallback="cards"
        minWidth={920}
        emptyState={{
          title: "No approvals in this view",
          description: "Policy gates appear here before BureauOS performs sensitive actions.",
        }}
      />
    </SectionShell>
  );
}
