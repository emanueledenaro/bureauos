import { ArtifactStore, type ArtifactRecord, type ArtifactType } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import {
  ClientIntelligenceService,
  type ClientIntelligenceItem,
  type ClientIntelligenceSummary,
} from "../clients/intelligence.js";
import {
  requestExternalCommitmentGate,
  type ExternalCommitmentAction,
} from "../compliance/external-commitments.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry, type ApprovalRecord } from "../registries/approval.js";
import { OpportunityRegistry, type OpportunityRecord } from "../registries/opportunity.js";
import { GrowthMemoryService, type GrowthMemorySummary } from "./memory.js";

export type GrowthContentDraftKind = "social" | "campaign" | "creative" | "ads";

export interface GrowthContentPipelineInput {
  runId?: string;
  focus?: string;
  maxDrafts?: number;
  now?: Date;
}

export interface GrowthContentPipelineDraft {
  kind: GrowthContentDraftKind;
  channel: string;
  title: string;
  artifact: ArtifactRecord;
  client_id: string;
  opportunity_id: string;
  approval_required: boolean;
}

export interface GrowthContentPipelineResult {
  generated_at: string;
  memory_ready: boolean;
  missing_sections: string[];
  pipeline_value: number;
  open_opportunities: number;
  drafts: GrowthContentPipelineDraft[];
  compliance_review?: ArtifactRecord;
  approvals: ApprovalRecord[];
  report: ArtifactRecord;
  next_actions: string[];
}

export interface GrowthContentPipelineDeps {
  growthMemory?: GrowthMemoryService;
  clientIntelligence?: ClientIntelligenceService;
  opportunities?: OpportunityRegistry;
  artifacts?: ArtifactStore;
  approvals?: ApprovalRegistry;
  audit?: AuditLog;
}

interface DraftPlan {
  kind: GrowthContentDraftKind;
  type: ArtifactType;
  channel: string;
  title: string;
  body: string;
  clientId?: string;
  opportunityId?: string;
}

interface DraftContext {
  generatedAt: string;
  brand: string;
  offer: string;
  channels: string;
  channel: string;
  opportunity: OpportunityRecord | undefined;
  client: ClientIntelligenceItem | undefined;
  focus: string | undefined;
}

const OPEN_OPPORTUNITY_STATUSES = new Set([
  "intake",
  "qualified",
  "proposal_draft",
  "proposal_sent",
  "stalled",
]);

function clampDraftCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 4;
  return Math.max(1, Math.min(8, Math.trunc(value)));
}

function cleanSection(body: string): string {
  return body
    .replace(/<!-- bureauos:[\s\S]*?-->/g, "")
    .replace(/^# .+$/gm, "")
    .replace(/\(none yet\)/gi, "")
    .trim();
}

function sectionText(memory: GrowthMemorySummary, id: "brand" | "offers" | "channels"): string {
  const section = memory.sections.find((item) => item.id === id);
  return section ? cleanSection(section.body) : "";
}

function oneLine(value: string, fallback: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return fallback;
  return clean.length > 220 ? `${clean.slice(0, 220)}...` : clean;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function primaryChannels(channels: string): string[] {
  const lower = channels.toLowerCase();
  const out: string[] = [];
  if (/\bx\b|twitter/.test(lower)) out.push("X");
  if (lower.includes("linkedin")) out.push("LinkedIn");
  if (lower.includes("github")) out.push("GitHub");
  if (lower.includes("newsletter")) out.push("Newsletter");
  if (lower.includes("blog")) out.push("Blog");
  return out.length ? out : ["Primary owned channel"];
}

function opportunityClient(
  summary: ClientIntelligenceSummary,
  opportunity?: OpportunityRecord,
): ClientIntelligenceItem | undefined {
  if (!opportunity) return undefined;
  return summary.clients.find((item) => item.client.id === opportunity.client_id);
}

function sortOpportunities(opportunities: readonly OpportunityRecord[]): OpportunityRecord[] {
  return [...opportunities]
    .filter((item) => OPEN_OPPORTUNITY_STATUSES.has(item.status))
    .sort((left, right) => {
      return (
        (right.expected_value || 0) - (left.expected_value || 0) ||
        (right.expected_margin || 0) - (left.expected_margin || 0) ||
        (right.updated || right.created || "").localeCompare(left.updated || left.created || "") ||
        left.title.localeCompare(right.title)
      );
    });
}

function approvalBoundary(client?: ClientIntelligenceItem): string {
  const proof = client?.classification.public_proof_allowed ?? "unknown";
  return [
    "- Drafting is autonomous.",
    "- Publishing, paid spend, client contact, final pricing, and public claims require owner approval.",
    proof === "yes"
      ? "- Client proof is marked allowed in memory, but final public use still requires owner review."
      : "- Do not name the client, use logos, use screenshots, or imply client results until proof permission is explicitly recorded.",
  ].join("\n");
}

function contextBlock(args: {
  generatedAt: string;
  brand: string;
  offer: string;
  channels: string;
  opportunity: OpportunityRecord | undefined;
  client: ClientIntelligenceItem | undefined;
  focus: string | undefined;
}): string {
  return `Generated: ${args.generatedAt}

## Source Context

- Brand memory: ${oneLine(args.brand, "not configured")}
- Offer memory: ${oneLine(args.offer, "not configured")}
- Channel memory: ${oneLine(args.channels, "not configured")}
- Focus: ${args.focus ? args.focus : (args.opportunity?.title ?? "general visibility")}
- Opportunity: ${args.opportunity ? `${args.opportunity.title} (${formatMoney(args.opportunity.expected_value || 0)} pipeline)` : "(none)"}
- Client memory: ${args.client ? `${args.client.client.name} (${args.client.risk}, value score ${args.client.value_score.score})` : "(none)"}
`;
}

function socialDraft(args: DraftContext): DraftPlan {
  const angle = args.focus ?? args.opportunity?.title ?? "owner-led AI operating system";
  return {
    kind: "social",
    type: "social-post-brief",
    channel: args.channel,
    title: `Social draft: ${angle}`,
    clientId: args.opportunity?.client_id,
    opportunityId: args.opportunity?.id,
    body: `# Social Post Brief

${contextBlock(args)}

## Draft Angle

Turn the current offer into a proof-safe post about ${angle}.

## Draft Copy

Building an autonomous operating layer should not mean giving up control.

The useful version is simple: one coordinator, persistent memory, clear policy gates, real project/account state, and draft-first growth work that never publishes or spends money without approval.

That is the operating model BureauOS is moving toward.

## Guardrails

${approvalBoundary(args.client)}
`,
  };
}

function campaignDraft(args: DraftContext): DraftPlan {
  const target =
    args.opportunity?.title ?? args.focus ?? "qualified owner-led software service opportunities";
  return {
    kind: "campaign",
    type: "campaign-brief",
    channel: args.channel,
    title: `Campaign brief: ${target}`,
    clientId: args.opportunity?.client_id,
    opportunityId: args.opportunity?.id,
    body: `# Campaign Brief

${contextBlock(args)}

## Objective

Move ${target} toward a qualified proposal or a clearer next commercial step.

## Audience

Owner-led businesses that need delivery, visibility, and operational follow-through without manually coordinating every agent or contractor.

## Message Pillars

- Single owner-facing coordinator.
- Structured company, client, project, revenue, and growth memory.
- Autonomous drafting and monitoring.
- Owner approval before external commitments.

## Channel Plan

- Primary: ${args.channel}
- Supporting channels: ${oneLine(args.channels, "none configured")}

## Guardrails

${approvalBoundary(args.client)}
`,
  };
}

function creativeDraft(args: DraftContext): DraftPlan {
  return {
    kind: "creative",
    type: "creative-brief",
    channel: args.channel,
    title: `Creative brief: ${args.focus ?? args.opportunity?.title ?? "BureauOS operating room"}`,
    clientId: args.opportunity?.client_id,
    opportunityId: args.opportunity?.id,
    body: `# Creative Brief

${contextBlock(args)}

## Visual Direction

Create a minimal dark operating-room visual: portfolio lanes, coordinator chat, approvals, revenue pulse, and agent layer. The design should feel operational, calm, and founder-controlled.

## Asset Rules

- Use generated or first-party BureauOS visuals only.
- Do not use client logos, screenshots, testimonials, locations, or private files unless permission is recorded and owner-approved.
- Keep claims about autonomy precise: draft, monitor, verify, escalate, and ask for approval when policy requires it.

## Guardrails

${approvalBoundary(args.client)}
`,
  };
}

function adsDraft(args: DraftContext): DraftPlan {
  return {
    kind: "ads",
    type: "ad-campaign-brief",
    channel: args.channel,
    title: `Ad campaign draft: ${args.focus ?? args.opportunity?.title ?? "BureauOS offer"}`,
    clientId: args.opportunity?.client_id,
    opportunityId: args.opportunity?.id,
    body: `# Ad Campaign Brief

${contextBlock(args)}

## Campaign Hypothesis

Owner-operators will respond to a practical AAAS operating-room message when it emphasizes control, memory, policy gates, and measurable business follow-through.

## Draft Setup

- Objective: lead generation or retargeting.
- Budget: not approved.
- Landing destination: not selected.
- Primary channel: ${args.channel}
- Offer: ${oneLine(args.offer, "offer not configured")}

## Approval Boundary

This is a draft only. Do not launch, change budgets, contact leads, publish ads, or make public performance claims without owner approval.

${approvalBoundary(args.client)}
`,
  };
}

function blockedReportBody(args: {
  generatedAt: string;
  missingSections: readonly string[];
  pipelineValue: number;
  openOpportunities: number;
  status?: string;
  nextActions?: readonly string[];
}): string {
  const nextActions = args.nextActions ?? [
    "Complete brand, offers, and channels memory.",
    "Then run the content pipeline again to generate draft social, campaign, creative, and ads artifacts.",
  ];
  return `# Content Pipeline Report

Generated: ${args.generatedAt}

## Status

${args.status ?? "Blocked before draft generation because growth memory is incomplete."}

## Missing Memory

${args.missingSections.length ? args.missingSections.map((section) => `- ${section}`).join("\n") : "- (none)"}

## Revenue Context

- Open pipeline: ${formatMoney(args.pipelineValue)}
- Open opportunities: ${args.openOpportunities}

## Next Actions

${nextActions.map((action) => `- ${action}`).join("\n")}

## Approval Boundary

- No content was published.
- No ads were launched.
- No client was contacted.
`;
}

function reportBody(args: {
  generatedAt: string;
  pipelineValue: number;
  openOpportunities: number;
  drafts: readonly GrowthContentPipelineDraft[];
  nextActions: readonly string[];
}): string {
  return `# Content Pipeline Report

Generated: ${args.generatedAt}

## Revenue Context

- Open pipeline: ${formatMoney(args.pipelineValue)}
- Open opportunities: ${args.openOpportunities}

## Drafts Created

${
  args.drafts.length
    ? args.drafts
        .map(
          (draft) => `- ${draft.kind}: ${draft.title} (${draft.channel}) -> ${draft.artifact.id}`,
        )
        .join("\n")
    : "- No drafts created."
}

## Next Actions

${args.nextActions.map((item) => `- ${item}`).join("\n")}

## Approval Boundary

- Drafting completed locally.
- Publishing, paid spend, client contact, final pricing, and external claims remain approval-gated.
`;
}

export class GrowthContentPipelineService {
  private readonly growthMemory: GrowthMemoryService;
  private readonly clientIntelligence: ClientIntelligenceService;
  private readonly opportunities: OpportunityRegistry;
  private readonly artifacts: ArtifactStore;
  private readonly approvals: ApprovalRegistry;
  private readonly audit: AuditLog;

  constructor(
    public readonly workspaceRoot: string,
    deps: GrowthContentPipelineDeps = {},
  ) {
    this.growthMemory = deps.growthMemory ?? new GrowthMemoryService(workspaceRoot);
    this.clientIntelligence =
      deps.clientIntelligence ?? new ClientIntelligenceService(workspaceRoot);
    this.opportunities = deps.opportunities ?? new OpportunityRegistry(workspaceRoot);
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.approvals = deps.approvals ?? new ApprovalRegistry(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
  }

  async generate(input: GrowthContentPipelineInput = {}): Promise<GrowthContentPipelineResult> {
    const generatedAt = (input.now ?? new Date()).toISOString();
    const maxDrafts = clampDraftCount(input.maxDrafts);
    const [memory, clientSummary, opportunities] = await Promise.all([
      this.growthMemory.get(),
      this.clientIntelligence.summarize(input.now ?? new Date()),
      this.opportunities.list(),
    ]);
    const openOpportunities = sortOpportunities(opportunities);
    const pipelineValue = openOpportunities.reduce(
      (sum, opportunity) => sum + (opportunity.expected_value || 0),
      0,
    );

    if (!memory.ready) {
      const nextActions = [
        `Complete growth memory: ${memory.missing_sections.join(", ")}.`,
        "Run the content pipeline again after brand, offer, and channel memory are configured.",
      ];
      const report = await this.artifacts.write({
        type: "content-pipeline-report",
        createdBy: "growth",
        ...(input.runId ? { runId: input.runId } : {}),
        status: "submitted",
        metadata: {
          generated_at: generatedAt,
          memory_ready: false,
          missing_sections: memory.missing_sections,
          pipeline_value: pipelineValue,
          open_opportunities: openOpportunities.length,
          draft_count: 0,
        },
        body: blockedReportBody({
          generatedAt,
          missingSections: memory.missing_sections,
          pipelineValue,
          openOpportunities: openOpportunities.length,
        }),
      });
      await this.audit.append({
        actor: "supreme_coordinator",
        action: "growth.content_pipeline.blocked",
        target: "growth",
        artifact_id: report.id,
        result: "ok",
      });
      return {
        generated_at: generatedAt,
        memory_ready: false,
        missing_sections: memory.missing_sections,
        pipeline_value: pipelineValue,
        open_opportunities: openOpportunities.length,
        drafts: [],
        approvals: [],
        report,
        next_actions: nextActions,
      };
    }

    // Memory is ready but there is nothing in the pipeline to draft for. Return
    // a graceful empty result instead of dereferencing `openOpportunities[0]`
    // (undefined) → `opportunity.client_id` and throwing (SER-231).
    if (openOpportunities.length === 0) {
      const nextActions = [
        "Capture a lead or opportunity (e.g. via coordinator intake), then run the content pipeline again.",
      ];
      const report = await this.artifacts.write({
        type: "content-pipeline-report",
        createdBy: "growth",
        ...(input.runId ? { runId: input.runId } : {}),
        status: "submitted",
        metadata: {
          generated_at: generatedAt,
          memory_ready: true,
          missing_sections: [],
          pipeline_value: pipelineValue,
          open_opportunities: 0,
          draft_count: 0,
        },
        body: blockedReportBody({
          generatedAt,
          missingSections: [],
          pipelineValue,
          openOpportunities: 0,
          status: "No draft generated: growth memory is ready but there are no open opportunities.",
          nextActions,
        }),
      });
      await this.audit.append({
        actor: "supreme_coordinator",
        action: "growth.content_pipeline.blocked",
        target: "growth",
        artifact_id: report.id,
        result: "ok",
      });
      return {
        generated_at: generatedAt,
        memory_ready: true,
        missing_sections: [],
        pipeline_value: pipelineValue,
        open_opportunities: 0,
        drafts: [],
        approvals: [],
        report,
        next_actions: nextActions,
      };
    }

    const brand = sectionText(memory, "brand");
    const offer = sectionText(memory, "offers");
    const channels = sectionText(memory, "channels");
    const channelList = primaryChannels(channels);
    const opportunity = openOpportunities[0];
    const client = opportunityClient(clientSummary, opportunity);
    const common: Omit<DraftContext, "channel"> = {
      generatedAt,
      brand,
      offer,
      channels,
      opportunity,
      client,
      focus: input.focus,
    };
    const plans = [
      socialDraft({ ...common, channel: channelList[0] ?? "Primary owned channel" }),
      campaignDraft({
        ...common,
        channel: channelList[1] ?? channelList[0] ?? "Primary owned channel",
      }),
      creativeDraft({ ...common, channel: "Generated visual" }),
      adsDraft({ ...common, channel: channelList[1] ?? channelList[0] ?? "Primary owned channel" }),
    ].slice(0, maxDrafts);

    const drafts: GrowthContentPipelineDraft[] = [];
    const approvalActions = new Set<ExternalCommitmentAction>();
    for (const plan of plans) {
      if (plan.kind === "social") approvalActions.add("publish_social_posts");
      if (plan.kind === "ads") {
        approvalActions.add("run_paid_ads");
        approvalActions.add("launch_ad_campaigns");
      }
      approvalActions.add("publish_public_content");
      const artifact = await this.artifacts.write({
        type: plan.type,
        createdBy: "growth",
        ...(input.runId ? { runId: input.runId } : {}),
        ...(plan.clientId ? { clientId: plan.clientId } : {}),
        status: "draft",
        metadata: {
          generated_at: generatedAt,
          kind: plan.kind,
          channel: plan.channel,
          title: plan.title,
          approval_required: true,
          ...(plan.opportunityId ? { opportunity_id: plan.opportunityId } : {}),
        },
        body: plan.body,
      });
      drafts.push({
        kind: plan.kind,
        channel: plan.channel,
        title: plan.title,
        artifact,
        client_id: plan.clientId ?? "",
        opportunity_id: plan.opportunityId ?? "",
        approval_required: true,
      });
    }

    const gate =
      drafts.length > 0
        ? await requestExternalCommitmentGate(
            {
              artifacts: this.artifacts,
              approvals: this.approvals,
              audit: this.audit,
            },
            {
              generatedAt,
              source: "growth.content_pipeline",
              target: input.focus ?? opportunity?.id ?? "growth",
              scope: `Publish or launch generated growth drafts${input.focus ? ` for ${input.focus}` : ""}`,
              limit: `Draft count ${drafts.length}; paid spend 0; no client names, logos, public claims, or client contact without separate approval`,
              actions: [...approvalActions],
              sourceArtifactIds: drafts.map((draft) => draft.artifact.id),
              ...(input.runId ? { runId: input.runId } : {}),
              ...(opportunity?.client_id ? { clientId: opportunity.client_id } : {}),
              ...(opportunity?.id ? { opportunityId: opportunity.id } : {}),
            },
          )
        : undefined;

    const nextActions = [
      drafts.length
        ? "Review generated drafts and approve only the assets that should become public."
        : "No drafts were generated; review growth memory and pipeline inputs.",
      opportunity
        ? `Use the highest-value opportunity as commercial context: ${opportunity.title}.`
        : "Create or import a qualified opportunity to anchor future growth drafts.",
      "Keep publishing, ad launch, budget changes, and client contact behind approval gates.",
    ];
    const report = await this.artifacts.write({
      type: "content-pipeline-report",
      createdBy: "growth",
      ...(input.runId ? { runId: input.runId } : {}),
      status: "submitted",
      metadata: {
        generated_at: generatedAt,
        memory_ready: true,
        pipeline_value: pipelineValue,
        open_opportunities: openOpportunities.length,
        draft_count: drafts.length,
        draft_artifacts: drafts.map((draft) => draft.artifact.id),
        ...(gate ? { compliance_review_id: gate.complianceReview.id } : {}),
        ...(gate ? { approval_ids: gate.approvals.map((approval) => approval.id) } : {}),
      },
      body: reportBody({
        generatedAt,
        pipelineValue,
        openOpportunities: openOpportunities.length,
        drafts,
        nextActions,
      }),
    });
    await this.audit.append({
      actor: "supreme_coordinator",
      action: "growth.content_pipeline.generated",
      target: "growth",
      artifact_id: report.id,
      result: "ok",
    });

    return {
      generated_at: generatedAt,
      memory_ready: true,
      missing_sections: [],
      pipeline_value: pipelineValue,
      open_opportunities: openOpportunities.length,
      drafts,
      ...(gate ? { compliance_review: gate.complianceReview } : {}),
      approvals: gate?.approvals ?? [],
      report,
      next_actions: nextActions,
    };
  }
}
