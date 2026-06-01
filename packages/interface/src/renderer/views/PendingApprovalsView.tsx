import { ChevronRight, ShieldCheck } from "lucide-react";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { EmptyState } from "../components/dashboard/EmptyState";
import { timeAgo } from "../lib/format";
import { actionLabel } from "../lib/status-labels";
import type { ApprovalRecord } from "../lib/api";
import { useT } from "../i18n/i18n";

export function PendingApprovalsView({
  approvals,
  onOpen,
}: {
  approvals: ApprovalRecord[];
  onOpen: () => void;
}) {
  const t = useT();
  const visible = approvals.slice(0, 3);
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
          <h2 className="text-[14px] font-semibold text-foreground">
            {t("pendingApprovals.title", "Pending Approvals")}
          </h2>
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
            {approvals.length}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onOpen}>
          {t("pendingApprovals.viewAll", "View all")}
          <ChevronRight className="h-3 w-3" />
        </Button>
      </div>
      <div className="flex flex-1 flex-col">
        {visible.length > 0 ? (
          <div className="divide-y divide-border/60">
            {visible.map((approval) => (
              <div key={approval.id} className="flex flex-col gap-3 px-5 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-foreground">
                      {actionLabel(approval.action, t)}
                    </div>
                    <div className="mt-1 truncate text-[10px] text-muted-foreground">
                      {approval.target}
                    </div>
                    {approval.scope ? (
                      <div className="mt-0.5 truncate text-[10px] text-muted-foreground/80">
                        {approval.scope}
                      </div>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {approval.created ? timeAgo(approval.created) : approval.actor}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" onClick={onOpen}>
                    {t("pendingApprovals.review", "Review")}
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-5">
            <EmptyState
              title={t("pendingApprovals.emptyTitle", "No pending approvals")}
              description={t(
                "pendingApprovals.emptyDescription",
                "External commitments and high-risk actions will appear here before execution.",
              )}
              icon={ShieldCheck}
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-border/60 px-5 py-3 text-[11px] text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        {t("pendingApprovals.autonomousPrefix", "Autonomous mode is handling")}{" "}
        <span className="text-foreground">{Math.max(0, 100 - approvals.length * 5)}%</span>{" "}
        {t("pendingApprovals.autonomousSuffix", "of operations.")}
      </div>
    </Card>
  );
}
