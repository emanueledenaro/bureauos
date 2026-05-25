import { Megaphone, ShieldCheck, Sparkles } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { EmptyState } from "../components/dashboard/EmptyState";
import { Badge } from "../components/ui/badge";
import { formatLabel, timeAgo } from "../lib/format";
import type { DashboardState } from "../lib/types";

export function GrowthView({ state }: { state: DashboardState }) {
  const growthArtifacts = state.artifacts.filter((artifact) =>
    ["social-post-brief", "ad-campaign-brief", "creative-brief", "campaign-brief"].includes(
      artifact.type,
    ),
  );
  const growthMemory = state.growthMemory;
  const configuredMemory =
    growthMemory?.sections.filter((section) => section.status === "configured").length ?? 0;

  return (
    <SectionShell
      title="Growth"
      description="Draft-first marketing, content, social, and ads assets."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricTile
          label="Growth artifacts"
          value={String(growthArtifacts.length)}
          detail="Draft assets"
          icon={Sparkles}
          tone="info"
        />
        <MetricTile
          label="Opportunities"
          value={String(state.opportunities.length)}
          detail="Commercial pipeline"
          icon={Megaphone}
          tone="success"
        />
        <MetricTile
          label="Approvals"
          value={String(state.approvals.length)}
          detail="External action gates"
          icon={ShieldCheck}
          tone={state.approvals.length > 0 ? "warning" : "success"}
        />
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-semibold text-foreground">Growth Memory</h3>
          <span className="text-[10px] text-muted-foreground">
            {growthMemory?.ready ? "Ready" : "Incomplete"} · {configuredMemory}/3 sections
          </span>
        </div>
        <div className="mt-2 grid gap-3 md:grid-cols-3">
          {(growthMemory?.sections ?? []).map((section) => (
            <div
              key={section.id}
              className="flex flex-col gap-3 rounded-lg border border-border/70 bg-surface-subtle/60 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-[12px] font-semibold text-foreground">{section.title}</div>
                <Badge variant={section.status === "configured" ? "success" : "muted"}>
                  {formatLabel(section.status)}
                </Badge>
              </div>
              <div className="font-mono text-[10px] text-muted-foreground">{section.path}</div>
              <p className="line-clamp-4 text-[11px] leading-relaxed text-foreground/80">
                {section.preview || "No memory configured yet."}
              </p>
            </div>
          ))}
          {!growthMemory ? (
            <div className="md:col-span-3">
              <EmptyState
                title="Growth memory unavailable"
                description="The Operating Room is waiting for the local API growth memory endpoint."
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-5">
        <h3 className="text-[12px] font-semibold text-foreground">Recent draft assets</h3>
        <div className="mt-2 grid gap-3 md:grid-cols-3">
          {growthArtifacts.slice(0, 6).map((artifact) => (
            <div
              key={artifact.id}
              className="rounded-lg border border-border/70 bg-surface-subtle/60 p-4"
            >
              <div className="text-[12px] font-semibold text-foreground">
                {formatLabel(artifact.type)}
              </div>
              <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                {artifact.id}
              </div>
              <div className="mt-3 text-[10px] text-muted-foreground">
                {artifact.created ? timeAgo(artifact.created) : "created"}
              </div>
            </div>
          ))}
          {growthArtifacts.length === 0 ? (
            <div className="md:col-span-3">
              <EmptyState
                title="No growth drafts yet"
                description="Social, ads, and creative drafts are generated from intake and reports."
              />
            </div>
          ) : null}
        </div>
      </div>
    </SectionShell>
  );
}
