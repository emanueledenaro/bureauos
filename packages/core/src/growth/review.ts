import { ArtifactStore, type ArtifactRecord, type ArtifactType } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { ClientIntelligenceService } from "../clients/intelligence.js";
import { workspacePaths } from "../paths.js";
import { OpportunityRegistry } from "../registries/opportunity.js";
import { GrowthMemoryService } from "./memory.js";

export interface GrowthReviewInput {
  runId?: string;
  now?: Date;
  recentDays?: number;
}

export interface GrowthReviewResult {
  generated_at: string;
  report: ArtifactRecord;
  memory_ready: boolean;
  missing_sections: string[];
  recent_content_count: number;
  pipeline_value: number;
  follow_ups_due: number;
  recommendations: string[];
}

export interface GrowthReviewDeps {
  growthMemory?: GrowthMemoryService;
  clientIntelligence?: ClientIntelligenceService;
  opportunities?: OpportunityRegistry;
  artifacts?: ArtifactStore;
  audit?: AuditLog;
}

const GROWTH_ARTIFACT_TYPES = new Set<ArtifactType>([
  "brand-brief",
  "offer-brief",
  "campaign-brief",
  "conversion-audit",
  "social-post-brief",
  "creative-brief",
  "ad-campaign-brief",
  "lead-qualification-report",
  "proposal-brief",
  "pricing-brief",
]);

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function dateMs(value: string): number | undefined {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function recommendations(args: {
  memoryReady: boolean;
  missingSections: readonly string[];
  recentContentCount: number;
  pipelineValue: number;
  stalledOpportunities: number;
  followUpsDue: number;
}): string[] {
  const out: string[] = [];
  if (!args.memoryReady) {
    out.push(`Complete growth memory: ${args.missingSections.join(", ")}.`);
  }
  if (args.recentContentCount === 0) {
    out.push("Draft the next proof-safe social/content brief before the pipeline goes cold.");
  }
  if (args.pipelineValue === 0) {
    out.push("Create or import a qualified revenue opportunity.");
  } else {
    out.push("Prioritize the highest-value open opportunity for proposal or follow-up.");
  }
  if (args.stalledOpportunities > 0) {
    out.push(`Review ${args.stalledOpportunities} stalled opportunity item(s).`);
  }
  if (args.followUpsDue > 0) {
    out.push(`Prepare owner-reviewed follow-ups for ${args.followUpsDue} client account(s).`);
  }
  if (out.length === 0) out.push("Keep weekly visibility cadence and monitor conversion signals.");
  return out;
}

function reportBody(args: {
  generatedAt: string;
  memoryReady: boolean;
  missingSections: readonly string[];
  recentDays: number;
  recentContent: readonly ArtifactRecord[];
  pipelineValue: number;
  openOpportunities: number;
  stalledOpportunities: number;
  followUpsDue: number;
  recommendations: readonly string[];
}): string {
  return `# Growth Review

Generated: ${args.generatedAt}

## Growth Memory

- Ready: ${args.memoryReady ? "yes" : "no"}
- Missing sections: ${args.missingSections.length ? args.missingSections.join(", ") : "(none)"}

## Revenue Signals

- Open pipeline: ${money(args.pipelineValue)}
- Open opportunities: ${args.openOpportunities}
- Stalled opportunities: ${args.stalledOpportunities}
- Client follow-ups due: ${args.followUpsDue}

## Content Cadence

- Recent growth artifacts in last ${args.recentDays} day(s): ${args.recentContent.length}

${
  args.recentContent.length === 0
    ? "- No recent growth artifacts."
    : args.recentContent
        .slice(0, 10)
        .map((artifact) => `- ${artifact.type}: ${artifact.id} (${artifact.status})`)
        .join("\n")
}

## Recommended Next Moves

${args.recommendations.map((item) => `- ${item}`).join("\n")}

## Approval Boundary

- Safe autonomous work: draft posts, campaign briefs, proposals, pricing notes, account plans, and conversion audits.
- Do not publish public content, send client messages, change prices, launch paid ads, change budgets, or make claims without owner approval or explicit policy.
`;
}

export class GrowthReviewService {
  private readonly growthMemory: GrowthMemoryService;
  private readonly clientIntelligence: ClientIntelligenceService;
  private readonly opportunities: OpportunityRegistry;
  private readonly artifacts: ArtifactStore;
  private readonly audit: AuditLog;

  constructor(
    public readonly workspaceRoot: string,
    deps: GrowthReviewDeps = {},
  ) {
    this.growthMemory = deps.growthMemory ?? new GrowthMemoryService(workspaceRoot);
    this.clientIntelligence = deps.clientIntelligence ?? new ClientIntelligenceService(workspaceRoot);
    this.opportunities = deps.opportunities ?? new OpportunityRegistry(workspaceRoot);
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
  }

  async generate(input: GrowthReviewInput = {}): Promise<GrowthReviewResult> {
    const now = input.now ?? new Date();
    const generatedAt = now.toISOString();
    const recentDays = input.recentDays ?? 7;
    const cutoff = now.getTime() - recentDays * 24 * 60 * 60 * 1000;
    const [memory, clientSummary, opportunities, artifacts] = await Promise.all([
      this.growthMemory.get(),
      this.clientIntelligence.summarize(now),
      this.opportunities.list(),
      this.artifacts.list(),
    ]);
    const openOpportunities = opportunities.filter(
      (opportunity) => !["won", "lost"].includes(opportunity.status),
    );
    const stalledOpportunities = opportunities.filter(
      (opportunity) => opportunity.status === "stalled",
    );
    const recentContent = artifacts.filter((artifact) => {
      if (!GROWTH_ARTIFACT_TYPES.has(artifact.type)) return false;
      const created = dateMs(artifact.created);
      return created !== undefined && created >= cutoff;
    });
    const pipelineValue = openOpportunities.reduce(
      (sum, opportunity) => sum + (opportunity.expected_value || 0),
      0,
    );
    const nextMoves = recommendations({
      memoryReady: memory.ready,
      missingSections: memory.missing_sections,
      recentContentCount: recentContent.length,
      pipelineValue,
      stalledOpportunities: stalledOpportunities.length,
      followUpsDue: clientSummary.totals.follow_ups_due,
    });
    const report = await this.artifacts.write({
      type: "growth-review",
      createdBy: "supreme_coordinator",
      ...(input.runId ? { runId: input.runId } : {}),
      status: "submitted",
      metadata: {
        generated_at: generatedAt,
        memory_ready: memory.ready,
        missing_sections: memory.missing_sections,
        recent_days: recentDays,
        recent_content_count: recentContent.length,
        pipeline_value: pipelineValue,
        open_opportunities: openOpportunities.length,
        stalled_opportunities: stalledOpportunities.length,
        follow_ups_due: clientSummary.totals.follow_ups_due,
      },
      body: reportBody({
        generatedAt,
        memoryReady: memory.ready,
        missingSections: memory.missing_sections,
        recentDays,
        recentContent,
        pipelineValue,
        openOpportunities: openOpportunities.length,
        stalledOpportunities: stalledOpportunities.length,
        followUpsDue: clientSummary.totals.follow_ups_due,
        recommendations: nextMoves,
      }),
    });
    await this.audit.append({
      actor: "supreme_coordinator",
      action: "growth.review.generated",
      target: "growth",
      artifact_id: report.id,
      result: "ok",
    });

    return {
      generated_at: generatedAt,
      report,
      memory_ready: memory.ready,
      missing_sections: memory.missing_sections,
      recent_content_count: recentContent.length,
      pipeline_value: pipelineValue,
      follow_ups_due: clientSummary.totals.follow_ups_due,
      recommendations: nextMoves,
    };
  }
}
