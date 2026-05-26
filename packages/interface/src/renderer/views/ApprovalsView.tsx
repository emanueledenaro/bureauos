import { useState } from "react";
import { AlertTriangle, Check, ShieldCheck, X } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { StatusPill } from "../components/dashboard/StatusPill";
import { KpiBar } from "../components/dashboard/KpiBar";
import { DataTable, type DataTableColumn } from "../components/dashboard/DataTable";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Textarea } from "../components/ui/textarea";
import {
  approvalRequiresDecisionNote,
  approvalRiskLevel,
  approvalRiskTone,
  groupApprovalsByRunAndRisk,
  isStaleApprovalError,
} from "../lib/approvals";
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
  onResolve: (id: string, status: "approved" | "rejected", reason?: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [decision, setDecision] = useState<
    { approval: ApprovalRecord; status: "approved" | "rejected" } | undefined
  >();
  const [decisionNote, setDecisionNote] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const allApprovals = [...state.approvals, ...state.resolvedApprovals];
  const pendingGroups = groupApprovalsByRunAndRisk(state.approvals, state.runs);
  const visible = allApprovals
    .filter((approval) => filter === "all" || approval.status === filter)
    .sort((a, b) => (b.updated ?? b.created ?? "").localeCompare(a.updated ?? a.created ?? ""));
  const approved = state.resolvedApprovals.filter((approval) => approval.status === "approved");
  const rejected = state.resolvedApprovals.filter((approval) => approval.status === "rejected");
  const decisionRisk = decision ? approvalRiskLevel(decision.approval) : "low";
  const decisionRequiresNote = decision ? approvalRequiresDecisionNote(decision.approval) : false;

  const openDecision = (approval: ApprovalRecord, status: "approved" | "rejected"): void => {
    setDecision({ approval, status });
    setDecisionNote("");
    setDecisionError("");
  };

  const closeDecision = (): void => {
    setDecision(undefined);
    setDecisionNote("");
    setDecisionError("");
    setSubmitting(false);
  };

  const submitDecision = async (): Promise<void> => {
    if (!decision) return;
    const note = decisionNote.trim();
    if (decisionRequiresNote && !note) {
      setDecisionError("Decision note required for high-risk approval.");
      return;
    }
    setSubmitting(true);
    setDecisionError("");
    try {
      await onResolve(decision.approval.id, decision.status, note);
      closeDecision();
    } catch (error) {
      setDecisionError(
        isStaleApprovalError(error)
          ? "Approval already resolved. Queue refreshed."
          : error instanceof Error
            ? error.message
            : "Approval decision failed.",
      );
      setSubmitting(false);
    }
  };

  const decisionButtons = (approval: ApprovalRecord) => (
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="success" onClick={() => openDecision(approval, "approved")}>
        <Check className="h-3 w-3" />
        Approve
      </Button>
      <Button size="sm" variant="outline" onClick={() => openDecision(approval, "rejected")}>
        <X className="h-3 w-3" />
        Reject
      </Button>
    </div>
  );

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
      width: "140px",
      render: (approval) => (
        <div className="flex flex-col gap-1">
          <StatusPill value={formatLabel(approval.status)} tone={approvalTone(approval.status)} />
          <StatusPill
            value={approvalRiskLevel(approval)}
            tone={approvalRiskTone(approvalRiskLevel(approval))}
          />
        </div>
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
          {approval.source || approval.limit ? (
            <div className="text-meta mt-0.5 truncate text-muted-foreground/80">
              {approval.source ? `Source: ${approval.source}` : ""}
              {approval.source && approval.limit ? " · " : ""}
              {approval.limit ? `Limit: ${approval.limit}` : ""}
            </div>
          ) : null}
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
          decisionButtons(approval)
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

      <div className="mt-section grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[13px] font-semibold text-foreground">Pending Inbox</h3>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {state.approvals.length} pending decisions
          </span>
        </div>
        {pendingGroups.length > 0 ? (
          pendingGroups.map((group) => (
            <div
              key={group.runKey}
              className="overflow-hidden rounded-md border border-border/70 bg-surface-subtle/30"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-semibold text-foreground">
                    {group.label}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                    {group.runId ?? group.runKey}
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {group.riskGroups.map((riskGroup) => (
                    <StatusPill
                      key={riskGroup.risk}
                      value={`${riskGroup.risk} ${riskGroup.approvals.length}`}
                      tone={approvalRiskTone(riskGroup.risk)}
                    />
                  ))}
                </div>
              </div>
              {group.riskGroups.map((riskGroup) => (
                <div key={riskGroup.risk} className="border-t border-border/60">
                  <div className="flex items-center justify-between gap-2 bg-surface-raised/50 px-4 py-2">
                    <StatusPill
                      value={`${riskGroup.risk} risk`}
                      tone={approvalRiskTone(riskGroup.risk)}
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {riskGroup.approvals.length} gate
                      {riskGroup.approvals.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="divide-y divide-border/60">
                    {riskGroup.approvals.map((approval) => (
                      <div
                        key={approval.id}
                        className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_220px]"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-[12px] font-semibold text-foreground">
                              {formatLabel(approval.action)}
                            </span>
                            {approvalRequiresDecisionNote(approval) ? (
                              <span className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning-subtle/30 px-1.5 py-0.5 text-[10px] text-warning">
                                <AlertTriangle className="h-3 w-3" />
                                note required
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 truncate text-[11px] text-muted-foreground">
                            {approval.scope}
                          </div>
                          <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80">
                            {approval.id} · {approval.target}
                          </div>
                          {approval.source || approval.limit || approval.expires_at ? (
                            <div className="mt-1 grid gap-0.5 text-[10px] text-muted-foreground/80">
                              {approval.source ? <div>Source: {approval.source}</div> : null}
                              {approval.limit ? <div>Limit: {approval.limit}</div> : null}
                              {approval.expires_at ? (
                                <div>Expires {approval.expires_at.slice(0, 10)}</div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        <div className="flex items-center justify-start gap-2 lg:justify-end">
                          {decisionButtons(approval)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))
        ) : (
          <div className="rounded-md border border-border/70 bg-surface-subtle/30 px-4 py-6 text-center text-[12px] text-muted-foreground">
            No serious owner decisions pending.
          </div>
        )}
      </div>

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

      <Dialog open={Boolean(decision)} onOpenChange={(open) => !open && closeDecision()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {decision?.status === "approved" ? "Approve" : "Reject"}{" "}
              {decision ? formatLabel(decision.approval.action) : "approval"}
            </DialogTitle>
            <DialogDescription>
              {decision?.approval.scope ?? "Owner decision"} · {decisionRisk} risk
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <label className="text-[11px] font-semibold text-muted-foreground">
              Decision note {decisionRequiresNote ? "(required)" : "(optional)"}
            </label>
            <Textarea
              value={decisionNote}
              onChange={(event) => {
                setDecisionNote(event.target.value);
                if (decisionError) setDecisionError("");
              }}
              placeholder={
                decisionRequiresNote
                  ? "Why is this high-risk action approved or denied?"
                  : "Add context for the audit trail"
              }
              disabled={submitting}
            />
            {decisionError ? <div className="text-[11px] text-danger">{decisionError}</div> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDecision} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant={decision?.status === "approved" ? "success" : "destructive"}
              onClick={() => void submitDecision()}
              disabled={submitting || (decisionRequiresNote && !decisionNote.trim())}
            >
              {decision?.status === "approved" ? (
                <Check className="h-3 w-3" />
              ) : (
                <X className="h-3 w-3" />
              )}
              {submitting ? "Saving" : decision?.status === "approved" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionShell>
  );
}
