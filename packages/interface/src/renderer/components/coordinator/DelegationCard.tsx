import { ArrowRight, GitBranch } from "lucide-react";
import { BaseCard } from "../dashboard/BaseCard";
import { Button } from "../ui/button";
import { StatusPill } from "../dashboard/StatusPill";
import { toDelegationView } from "../../lib/delegation-view";
import { formatLabel } from "../../lib/format";
import type { CoordinatorIntakeResult } from "../../lib/api";
import { useT } from "../../i18n/i18n";

export function DelegationCard({ result }: { result: CoordinatorIntakeResult }) {
  const t = useT();
  const view = toDelegationView(result);
  return (
    <BaseCard padding="compact" className="mt-2 w-full max-w-md gap-2 bg-surface-raised">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-eyebrow">{t("delegation.title", "Delegated work")}</div>
          <div className="text-card-title mt-1 truncate">{view.projectName}</div>
        </div>
        <StatusPill value={formatLabel(view.runStatus)} tone={view.runTone} className="shrink-0" />
      </div>
      <div className="text-meta flex items-center gap-1.5 font-mono">
        <GitBranch className="h-3 w-3" />
        <span className="truncate">{view.runId}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label={t("delegation.client", "Client")} value={view.clientName} />
        <Stat label={t("delegation.artifacts", "Artifacts")} value={String(view.artifactCount)} />
        <Stat label={t("delegation.approvals", "Approvals")} value={String(view.approvalCount)} />
      </div>
      {view.nextAction ? (
        <div className="text-body-secondary rounded-md border border-border/60 bg-surface-subtle p-2 text-foreground">
          {view.nextAction}
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm">
          {t("delegation.openOpportunity", "Open opportunity")}
          <ArrowRight className="h-3 w-3" />
        </Button>
      </div>
    </BaseCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-eyebrow">{label}</div>
      <div className="text-body-secondary mt-0.5 truncate font-medium text-foreground">{value}</div>
    </div>
  );
}
