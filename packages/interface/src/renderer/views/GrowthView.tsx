import { Megaphone, ShieldCheck, Sparkles, Target, WandSparkles } from "lucide-react";
import { SectionShell } from "../components/dashboard/SectionShell";
import { MetricTile } from "../components/dashboard/MetricTile";
import { EmptyState } from "../components/dashboard/EmptyState";
import { ActionBanner } from "../components/dashboard/ActionBanner";
import { BaseCard, BaseCardHeader } from "../components/dashboard/BaseCard";
import { KpiBar } from "../components/dashboard/KpiBar";
import { ViewToolbar } from "../components/dashboard/ViewToolbar";
import { OperationalFocus } from "../components/dashboard/OperationalFocus";
import { Badge } from "../components/ui/badge";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { formatLabel, timeAgo } from "../lib/format";
import type { GrowthContentPipelineResult } from "../lib/api";
import type { DashboardState } from "../lib/types";

export function GrowthView({
  state,
  onGenerateContent,
}: {
  state: DashboardState;
  onGenerateContent: () => Promise<GrowthContentPipelineResult>;
}) {
  const generate = useAsyncAction(onGenerateContent);
  const growthArtifacts = state.artifacts.filter((artifact) =>
    ["social-post-brief", "ad-campaign-brief", "creative-brief", "campaign-brief"].includes(
      artifact.type,
    ),
  );
  const growthMemory = state.growthMemory;
  const configuredMemory =
    growthMemory?.sections.filter((section) => section.status === "configured").length ?? 0;
  const latestGrowthArtifact = growthArtifacts[0];
  const growthFocusTone = !growthMemory
    ? "neutral"
    : growthMemory.ready
      ? growthArtifacts.length > 0
        ? "success"
        : "info"
      : "warning";
  const growthFocusTitle = !growthMemory
    ? "Connect growth memory"
    : growthMemory.ready
      ? growthArtifacts.length > 0
        ? `Review latest ${formatLabel(latestGrowthArtifact.type)}`
        : "Generate the first draft-only growth asset"
      : `Complete ${growthMemory.missing_sections.map(formatLabel).join(", ")}`;
  const growthFocusDetail = !growthMemory
    ? "The local API has not returned growth memory yet, so draft generation has no verified brand, offer, or channel source."
    : growthMemory.ready
      ? growthArtifacts.length > 0
        ? "Draft assets exist locally. Review the newest artifact before any public publishing or spend decision."
        : "Brand, offers, and channels are configured. BOS can draft content locally without touching publishing or ad spend."
      : "Campaign work should wait until missing growth memory is written, otherwise drafts will be weak and hard to approve.";

  return (
    <SectionShell
      title="Growth"
      description="Draft-first marketing, content, social, and ads assets."
      action={
        <ViewToolbar
          primary={{
            label: "Generate drafts",
            icon: WandSparkles,
            onClick: () => void generate.run(),
            busy: generate.busy,
            busyLabel: "Generating",
          }}
        />
      }
    >
      {generate.error ? (
        <ActionBanner
          tone="danger"
          title="Content generation failed"
          detail={generate.error}
          onDismiss={generate.reset}
          className="mb-3"
        />
      ) : null}
      {generate.result ? (
        <ActionBanner
          tone="success"
          title={`${generate.result.drafts.length} drafts generated · report ${generate.result.report.id}`}
          detail="Drafts were created locally; external publishing stays gated."
          onDismiss={generate.reset}
          className="mb-3"
        />
      ) : null}

      <OperationalFocus
        className="mb-section"
        tone={growthFocusTone}
        icon={Target}
        title={growthFocusTitle}
        detail={growthFocusDetail}
        signals={[
          `${configuredMemory}/3 memory`,
          `${growthArtifacts.length} drafts`,
          `${state.approvals.length} approvals`,
        ]}
      />

      <KpiBar>
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
      </KpiBar>

      <div className="mt-section">
        <div className="flex items-center justify-between">
          <h3 className="text-section-title">Growth Memory</h3>
          <span className="text-meta">
            {growthMemory?.ready ? "Ready" : "Incomplete"} · {configuredMemory}/3 sections
          </span>
        </div>
        <div className="mt-2 grid gap-3 md:grid-cols-3">
          {(growthMemory?.sections ?? []).map((section) => (
            <BaseCard key={section.id} className="gap-3">
              <BaseCardHeader title={section.title}>
                <Badge variant={section.status === "configured" ? "success" : "muted"}>
                  {formatLabel(section.status)}
                </Badge>
              </BaseCardHeader>
              <div className="text-meta font-mono">{section.path}</div>
              <p className="text-body-secondary line-clamp-4 leading-relaxed text-foreground/80">
                {section.preview || "No memory configured yet."}
              </p>
            </BaseCard>
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

      <div className="mt-section">
        <h3 className="text-section-title">Recent draft assets</h3>
        <div className="mt-2 grid gap-3 md:grid-cols-3">
          {growthArtifacts.slice(0, 6).map((artifact) => (
            <BaseCard key={artifact.id} variant="interactive" className="gap-2">
              <BaseCardHeader title={formatLabel(artifact.type)} />
              <div className="text-meta truncate font-mono">{artifact.id}</div>
              <div className="text-meta">
                {artifact.created ? timeAgo(artifact.created) : "created"}
              </div>
            </BaseCard>
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
