import { GitBranch } from "lucide-react";
import { BaseCard } from "../dashboard/BaseCard";
import { StatusPill } from "../dashboard/StatusPill";
import { runTone } from "../../lib/tone";
import { formatLabel } from "../../lib/format";
import type { LiveDelegation } from "../../lib/live-delegation";
import { useT } from "../../i18n/i18n";

export function LiveDelegationCard({ delegation }: { delegation: LiveDelegation }) {
  const t = useT();
  if (!delegation.active) return null;
  return (
    <BaseCard padding="compact" className="mt-2 w-full max-w-md gap-2 bg-surface-raised">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-eyebrow">{t("delegation.live", "Delegating…")}</div>
          <div className="text-card-title mt-1 truncate">
            {delegation.label ?? t("delegation.title", "Delegated work")}
          </div>
        </div>
        {delegation.status ? (
          <StatusPill
            value={formatLabel(delegation.status)}
            tone={runTone(delegation.status)}
            className="shrink-0"
          />
        ) : null}
      </div>
      {delegation.runId ? (
        <div className="text-meta flex items-center gap-1.5 font-mono">
          <GitBranch className="h-3 w-3" />
          <span className="truncate">{delegation.runId}</span>
        </div>
      ) : null}
      <div className="text-meta">
        {t("delegation.artifacts", "Artifacts")}: {delegation.artifactCount}
      </div>
    </BaseCard>
  );
}
