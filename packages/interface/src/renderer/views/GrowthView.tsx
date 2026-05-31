import {
  ClipboardCheck,
  FileText,
  Megaphone,
  ShieldCheck,
  Sparkles,
  Target,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
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
import { sortNewest } from "../lib/builders";
import { formatLabel, timeAgo } from "../lib/format";
import type { ArtifactRecord, GrowthContentPipelineResult, GrowthReviewResult } from "../lib/api";
import type { DashboardState } from "../lib/types";

const GROWTH_DRAFT_TYPES = new Set([
  "social-post-brief",
  "ad-campaign-brief",
  "creative-brief",
  "campaign-brief",
]);

export function GrowthView({
  state,
  onGenerateContent,
  onGenerateReview,
}: {
  state: DashboardState;
  onGenerateContent: () => Promise<GrowthContentPipelineResult>;
  onGenerateReview: () => Promise<GrowthReviewResult>;
}) {
  const generate = useAsyncAction(onGenerateContent);
  const review = useAsyncAction(onGenerateReview);
  const growthArtifacts = sortNewest(
    state.artifacts.filter((artifact) => GROWTH_DRAFT_TYPES.has(artifact.type)),
  );
  const contentReports = sortNewest(
    state.artifacts.filter((artifact) => artifact.type === "content-pipeline-report"),
  );
  const growthReviews = sortNewest(
    state.artifacts.filter((artifact) => artifact.type === "growth-review"),
  );
  const pendingApprovals = sortNewest(state.approvals);
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
          secondary={[
            {
              label: "Run review",
              icon: ClipboardCheck,
              onClick: () => void review.run(),
              busy: review.busy,
              busyLabel: "Reviewing",
            },
          ]}
        />
      }
    >
      {/*
        Render the four action banners inside one always-present container so a
        banner toggling on after "Generate drafts"/"Run review" only mutates
        this subtree, never reordering the major sections (OperationalFocus,
        KpiBar, ...) that follow it. Each banner is stably keyed. This isolates
        the post-action result render that produced a stray insertBefore
        reconciliation error in this view (SER-216). The empty container has no
        layout box of its own, so spacing is unchanged. */}
      <div>
        {generate.error ? (
          <ActionBanner
            key="generate-error"
            tone="danger"
            title="Content generation failed"
            detail={generate.error}
            onDismiss={generate.reset}
            className="mb-3"
          />
        ) : null}
        {generate.result ? (
          <ActionBanner
            key="generate-result"
            tone="success"
            title={`${generate.result.drafts.length} drafts generated · report ${generate.result.report.id}`}
            detail="Drafts were created locally; external publishing stays gated."
            onDismiss={generate.reset}
            className="mb-3"
          />
        ) : null}
        {review.error ? (
          <ActionBanner
            key="review-error"
            tone="danger"
            title="Growth review failed"
            detail={review.error}
            onDismiss={review.reset}
            className="mb-3"
          />
        ) : null}
        {review.result ? (
          <ActionBanner
            key="review-result"
            tone="success"
            title={`Growth review generated · ${review.result.report.id}`}
            detail={review.result.recommendations[0] ?? "Review is ready locally."}
            onDismiss={review.reset}
            className="mb-3"
          />
        ) : null}
      </div>

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
        <SectionHeading
          title="Growth service coverage"
          meta={`${contentReports.length + growthReviews.length} service reports`}
        />
        <div className="mt-2 grid items-stretch gap-3 lg:grid-cols-4">
          <ServiceCard
            icon={Target}
            title="Memory sections"
            status={`${configuredMemory}/3 configured`}
            badge={growthMemory?.ready ? "Ready" : "Setup needed"}
            detail={
              growthMemory?.ready
                ? "Brand, offers, and channels are available for draft generation."
                : `Missing ${
                    growthMemory?.missing_sections.map(formatLabel).join(", ") || "growth memory"
                  }.`
            }
            artifacts={(growthMemory?.sections ?? []).map((section) => ({
              id: section.path,
              type: section.status,
            }))}
          />
          <ServiceCard
            icon={FileText}
            title="Content pipeline"
            status={`${growthArtifacts.length} draft artifacts`}
            badge={contentReports[0]?.id ?? "No report yet"}
            detail="Social, campaign, creative, and ads briefs stay draft-only until policy allows external action."
            artifacts={[...contentReports.slice(0, 1), ...growthArtifacts.slice(0, 3)]}
          />
          <ServiceCard
            icon={ClipboardCheck}
            title="Growth review"
            status={`${growthReviews.length} review reports`}
            badge={growthReviews[0]?.id ?? "Run review"}
            detail="Weekly review checks memory readiness, recent content, pipeline, and follow-up pressure."
            artifacts={growthReviews.slice(0, 4)}
          />
          <ServiceCard
            icon={ShieldCheck}
            title="Approval gates"
            status={`${pendingApprovals.length} pending gates`}
            badge={pendingApprovals.length ? "Owner gate" : "Clear"}
            detail="Publishing, paid spend, public claims, final proposals, and pricing changes remain gated."
            artifacts={pendingApprovals.slice(0, 4).map((approval) => ({
              id: approval.id,
              type: approval.action,
              created: approval.created,
            }))}
          />
        </div>
      </div>

      <div className="mt-section">
        <SectionHeading
          title="Growth Memory"
          meta={`${growthMemory?.ready ? "Ready" : "Incomplete"} · ${configuredMemory}/3 sections`}
        />
        <div className="mt-2 grid items-stretch gap-3 md:grid-cols-3">
          {(growthMemory?.sections ?? []).map((section) => (
            <BaseCard key={section.id} className="h-full gap-3">
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
        <SectionHeading title="Recent draft assets" meta={`${growthArtifacts.length} total`} />
        <div className="mt-2 grid items-stretch gap-3 md:grid-cols-3">
          {growthArtifacts.slice(0, 6).map((artifact) => (
            <BaseCard key={artifact.id} className="h-full gap-2">
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

function SectionHeading({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex min-h-8 min-w-0 flex-wrap items-end justify-between gap-2">
      <h3 className="text-section-title">{title}</h3>
      {meta ? <span className="text-meta truncate">{meta}</span> : null}
    </div>
  );
}

function ServiceCard({
  icon: Icon,
  title,
  status,
  badge,
  detail,
  artifacts,
}: {
  icon: LucideIcon;
  title: string;
  status: string;
  badge: string;
  detail: string;
  artifacts: Array<Pick<ArtifactRecord, "id" | "type" | "created">>;
}) {
  return (
    <BaseCard className="h-full gap-3">
      <BaseCardHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border/60 bg-background/45 text-muted-foreground">
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="truncate">{title}</span>
          </span>
        }
        subtitle={status}
      >
        <Badge variant="muted" className="max-w-[150px] truncate">
          {badge}
        </Badge>
      </BaseCardHeader>
      <p className="text-body-secondary line-clamp-3 text-foreground/80">{detail}</p>
      <div className="mt-auto space-y-1 border-t border-border/60 pt-3">
        {artifacts.length > 0 ? (
          artifacts.slice(0, 4).map((artifact) => (
            <div
              key={artifact.id}
              className="flex min-w-0 items-center justify-between gap-3 text-meta"
            >
              <span className="min-w-0 truncate font-mono">{artifact.id}</span>
              <span className="shrink-0">{formatLabel(artifact.type)}</span>
            </div>
          ))
        ) : (
          <div className="text-meta">No local artifacts yet.</div>
        )}
      </div>
    </BaseCard>
  );
}
