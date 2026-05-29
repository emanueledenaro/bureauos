import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { ClientIntelligenceService, type ClientIntelligenceItem } from "../clients/intelligence.js";
import { requestExternalCommitmentGate } from "../compliance/external-commitments.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry, type ApprovalRecord } from "../registries/approval.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import {
  OpportunityRegistry,
  type OpportunityRecord,
  type OpportunityStatus,
} from "../registries/opportunity.js";

export type RevenuePipelineFit = "high" | "medium" | "low";
export type RevenuePipelineStage = "needs_qualification" | "qualified" | "proposal_ready";

export interface RevenuePipelineInput {
  opportunityId?: string;
  maxOpportunities?: number;
  runId?: string;
  now?: Date;
}

export interface RevenuePipelineItem {
  opportunity: OpportunityRecord;
  client?: ClientRecord;
  score: number;
  fit: RevenuePipelineFit;
  stage: RevenuePipelineStage;
  reasons: string[];
  risks: string[];
  next_action: string;
  artifacts: ArtifactRecord[];
  approvals: ApprovalRecord[];
}

export interface RevenuePipelineResult {
  generated_at: string;
  report: ArtifactRecord;
  pipeline_value: number;
  open_opportunities: number;
  qualified_count: number;
  proposal_ready_count: number;
  items: RevenuePipelineItem[];
  next_actions: string[];
}

export interface RevenuePipelineDeps {
  clients?: ClientRegistry;
  clientIntelligence?: ClientIntelligenceService;
  opportunities?: OpportunityRegistry;
  artifacts?: ArtifactStore;
  approvals?: ApprovalRegistry;
  audit?: AuditLog;
}

interface Evaluation {
  score: number;
  fit: RevenuePipelineFit;
  stage: RevenuePipelineStage;
  reasons: string[];
  risks: string[];
  nextAction: string;
  patch: Partial<Omit<OpportunityRecord, "id" | "created">>;
}

const OPEN_STATUSES = new Set<OpportunityStatus>([
  "intake",
  "qualified",
  "proposal_draft",
  "proposal_sent",
  "stalled",
]);

function clampMax(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(20, Math.trunc(value)));
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function sortOpportunities(items: readonly OpportunityRecord[]): OpportunityRecord[] {
  return [...items]
    .filter((item) => OPEN_STATUSES.has(item.status))
    .sort((left, right) => {
      return (
        (right.expected_value || 0) - (left.expected_value || 0) ||
        (right.expected_margin || 0) - (left.expected_margin || 0) ||
        (right.updated || right.created || "").localeCompare(left.updated || left.created || "") ||
        left.title.localeCompare(right.title)
      );
    });
}

function clientFor(
  opportunity: OpportunityRecord,
  clients: readonly ClientRecord[],
): ClientRecord | undefined {
  return clients.find((client) => client.id === opportunity.client_id);
}

function intelligenceFor(
  opportunity: OpportunityRecord,
  intelligence: readonly ClientIntelligenceItem[],
): ClientIntelligenceItem | undefined {
  return intelligence.find((item) => item.client.id === opportunity.client_id);
}

function riskText(value: string): string {
  return value.replace(/_/g, " ");
}

function evaluateOpportunity(args: {
  opportunity: OpportunityRecord;
  client?: ClientRecord;
  intelligence?: ClientIntelligenceItem;
}): Evaluation {
  const { opportunity, client, intelligence } = args;
  const reasons: string[] = [];
  const risks: string[] = [];
  let score = 0;

  if (opportunity.expected_value >= 10_000) {
    score += 25;
    reasons.push("high expected value");
  } else if (opportunity.expected_value >= 3_000) {
    score += 18;
    reasons.push("meaningful expected value");
  } else if (opportunity.expected_value > 0) {
    score += 10;
    reasons.push("some expected value recorded");
  } else {
    risks.push("missing expected value");
  }

  if (opportunity.expected_margin >= 50) {
    score += 20;
    reasons.push("strong expected margin");
  } else if (opportunity.expected_margin >= 30) {
    score += 15;
    reasons.push("acceptable expected margin");
  } else if (opportunity.expected_margin > 0) {
    score += 8;
    risks.push("thin expected margin");
  } else {
    risks.push("missing expected margin");
  }

  if (client?.status === "active") {
    score += 15;
    reasons.push("active client account");
  } else if (client?.status === "lead") {
    score += 8;
    reasons.push("lead profile exists");
  } else if (!client) {
    risks.push("client profile missing");
  }

  if (intelligence) {
    score += Math.min(20, Math.round(intelligence.value_score.score / 5));
    if (intelligence.risk === "blocked") risks.push("client delivery risk is blocked");
    if (intelligence.risk === "follow_up_due") risks.push("client follow-up is due");
    if (intelligence.revenue.open_opportunities > 1) {
      reasons.push("account has multiple opportunities");
    }
  }

  switch (opportunity.status) {
    case "proposal_sent":
      score += 20;
      reasons.push("proposal already sent");
      break;
    case "proposal_draft":
      score += 18;
      reasons.push("proposal draft already started");
      break;
    case "qualified":
      score += 15;
      reasons.push("already qualified");
      break;
    case "intake":
      score += 8;
      reasons.push("fresh intake");
      break;
    case "stalled":
      score -= 10;
      risks.push("opportunity is stalled");
      break;
    case "won":
    case "lost":
      break;
  }

  if (opportunity.source) reasons.push(`source: ${opportunity.source}`);
  score = Math.max(0, Math.min(100, Math.round(score)));

  const fit: RevenuePipelineFit = score >= 65 ? "high" : score >= 45 ? "medium" : "low";
  const stage: RevenuePipelineStage =
    fit === "high" ? "proposal_ready" : fit === "medium" ? "qualified" : "needs_qualification";

  const nextAction =
    stage === "proposal_ready"
      ? "Review pricing and proposal drafts; approve client_send before any external contact."
      : stage === "qualified"
        ? "Complete missing scope, budget, timeline, and decision-maker assumptions."
        : "Collect budget, urgency, pain, and fit signals before proposal work.";

  const patch: Partial<Omit<OpportunityRecord, "id" | "created">> = {
    status:
      stage === "proposal_ready"
        ? "proposal_draft"
        : stage === "qualified"
          ? "qualified"
          : opportunity.status === "stalled"
            ? "stalled"
            : "intake",
    qualification_status: stage === "needs_qualification" ? "needs_more_context" : "qualified",
    proposal_status: stage === "proposal_ready" ? "draft_ready" : "draft_required",
    pricing_status: stage === "proposal_ready" ? "draft_ready" : "pending",
    next_action: nextAction,
  };

  return { score, fit, stage, reasons, risks, nextAction, patch };
}

function leadQualificationBody(args: {
  generatedAt: string;
  opportunity: OpportunityRecord;
  client?: ClientRecord;
  evaluation: Evaluation;
}): string {
  return `# Lead Qualification Report

Generated: ${args.generatedAt}

## Lead

- Name: ${args.opportunity.title}
- Source: ${args.opportunity.source || "unknown"}
- Company: ${args.client?.name ?? "unknown"}
- Status: ${args.evaluation.stage}

## Fit

- Score: ${args.evaluation.score}/100
- Fit: ${args.evaluation.fit}
- Budget signal: ${args.opportunity.expected_value > 0 ? money(args.opportunity.expected_value) : "unknown"}
- Margin signal: ${args.opportunity.expected_margin > 0 ? `${args.opportunity.expected_margin}%` : "unknown"}

## Reasons

${args.evaluation.reasons.map((item) => `- ${item}`).join("\n") || "- No positive signals recorded yet."}

## Risks

${args.evaluation.risks.map((item) => `- ${riskText(item)}`).join("\n") || "- No major risks detected from current memory."}

## Recommended Next Action

${args.evaluation.nextAction}

## External Contact Policy

- Contact allowed: no
- Owner approval required: yes
`;
}

function pricingBriefBody(args: {
  generatedAt: string;
  opportunity: OpportunityRecord;
  client?: ClientRecord;
  evaluation: Evaluation;
}): string {
  const value = args.opportunity.expected_value || 0;
  const deposit = value > 0 ? Math.round(value * 0.4) : 0;
  return `# Pricing Brief

Generated: ${args.generatedAt}

## Opportunity

- Client: ${args.client?.name ?? "unknown"}
- Project: ${args.opportunity.title}
- Offer: ${args.opportunity.source || "owner-led software service"}

## Pricing Model

- Fixed price: ${value > 0 ? money(value) : "not enough data"}
- Retainer: not recommended until scope is clearer
- Hourly/day rate: fallback only
- Hybrid: optional support retainer after delivery

## Cost / Margin Notes

- Expected margin: ${args.opportunity.expected_margin || "unknown"}%
- Fit: ${args.evaluation.fit}
- Score: ${args.evaluation.score}/100

## Assumptions

- Scope still requires owner review.
- Delivery team capacity and timeline are not externally committed.
- Price is a draft and cannot be sent without approval.

## Risks

${args.evaluation.risks.map((item) => `- ${riskText(item)}`).join("\n") || "- No pricing risks detected from current memory."}

## Payment Structure

- Deposit: ${deposit > 0 ? money(deposit) : "to define"}
- Milestones: discovery/signoff, build review, launch
- Final payment: before production launch or handoff
- Retainer: optional after delivery

## Recommendation

${args.evaluation.nextAction}

## Approval

- Owner approval required: yes
- Client contact allowed: no
`;
}

function proposalBriefBody(args: {
  generatedAt: string;
  opportunity: OpportunityRecord;
  client?: ClientRecord;
  evaluation: Evaluation;
}): string {
  return `# Proposal Brief

Generated: ${args.generatedAt}

## Client

${args.client?.name ?? "Unknown client"}

## Problem

${args.opportunity.title}

## Proposed Solution

Prepare a scoped software delivery offer connected to the current business outcome and the client's recorded constraints.

## Scope

Included:

- Discovery and requirement confirmation.
- Design and implementation plan.
- Build, QA, review, and launch support.

Excluded:

- External publishing, paid media, production deployment, or client commitments before approval.
- Undefined integrations or scope not recorded in memory.

## Pricing Notes

- Draft value: ${args.opportunity.expected_value > 0 ? money(args.opportunity.expected_value) : "not enough data"}
- Expected margin: ${args.opportunity.expected_margin || "unknown"}%

## Open Questions

${args.evaluation.risks.map((item) => `- Resolve ${riskText(item)}.`).join("\n") || "- Confirm final scope, timeline, and buyer approval path."}

## Approval Status

- Ready to send: no
- Owner approval required: yes
- Client contact allowed: no
`;
}

function conversionAuditBody(args: {
  generatedAt: string;
  opportunity?: OpportunityRecord;
  client?: ClientRecord;
  evaluation?: Evaluation;
}): string {
  return `# Conversion Audit

Generated: ${args.generatedAt}

## Funnel

- Source: ${args.opportunity?.source ?? "unknown"}
- Landing destination: not recorded
- Offer: ${args.opportunity?.title ?? "no qualified opportunity"}
- CTA: owner-approved discovery or qualification step

## Current Path

\`\`\`text
Attention -> Lead Capture -> Qualification -> Proposal -> Close
\`\`\`

## Friction

${
  args.evaluation?.risks.length
    ? args.evaluation.risks.map((item) => `- ${riskText(item)}`).join("\n")
    : "- No qualified opportunity is currently available."
}

## Recommended Changes

- Capture budget, urgency, decision-maker, and timeline fields.
- Keep proposal sending behind owner approval.
- Use draft-only follow-up assets until client contact is approved.

## Measurement

- Primary metric: qualified opportunities
- Secondary metric: proposal-ready opportunities
- Baseline: ${args.opportunity ? "current opportunity memory" : "empty pipeline"}

## Policy Notes

- Pricing change required: no
- Public copy change required: no
- Owner approval required: yes for external contact
`;
}

function reportBody(args: {
  generatedAt: string;
  pipelineValue: number;
  openOpportunities: number;
  qualifiedCount: number;
  proposalReadyCount: number;
  items: readonly RevenuePipelineItem[];
  nextActions: readonly string[];
}): string {
  return `# Revenue Pipeline Report

Generated: ${args.generatedAt}

## Pipeline

- Open pipeline: ${money(args.pipelineValue)}
- Open opportunities: ${args.openOpportunities}
- Qualified: ${args.qualifiedCount}
- Proposal ready: ${args.proposalReadyCount}

## Opportunities

${
  args.items.length
    ? args.items
        .map((item) => {
          return `- ${item.opportunity.title}: ${item.fit}, score ${item.score}, ${item.stage}, next ${item.next_action}`;
        })
        .join("\n")
    : "- No open opportunities found."
}

## Next Actions

${args.nextActions.map((item) => `- ${item}`).join("\n")}

## Approval Boundary

- Qualification and drafting are local autonomous work.
- Client send, final price, proposal delivery, billing changes, public claims, and production commitments require owner approval.
`;
}

export class RevenuePipelineService {
  private readonly clients: ClientRegistry;
  private readonly clientIntelligence: ClientIntelligenceService;
  private readonly opportunities: OpportunityRegistry;
  private readonly artifacts: ArtifactStore;
  private readonly approvals: ApprovalRegistry;
  private readonly audit: AuditLog;

  constructor(
    public readonly workspaceRoot: string,
    deps: RevenuePipelineDeps = {},
  ) {
    this.clients = deps.clients ?? new ClientRegistry(workspaceRoot);
    this.clientIntelligence =
      deps.clientIntelligence ?? new ClientIntelligenceService(workspaceRoot);
    this.opportunities = deps.opportunities ?? new OpportunityRegistry(workspaceRoot);
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.approvals = deps.approvals ?? new ApprovalRegistry(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
  }

  async generate(input: RevenuePipelineInput = {}): Promise<RevenuePipelineResult> {
    const generatedAt = (input.now ?? new Date()).toISOString();
    const maxOpportunities = clampMax(input.maxOpportunities);
    const [clients, intelligence, allOpportunities] = await Promise.all([
      this.clients.list(),
      this.clientIntelligence.summarize(input.now ?? new Date()),
      this.opportunities.list(),
    ]);
    const open = sortOpportunities(allOpportunities);
    const selected = input.opportunityId
      ? open.filter((opportunity) => opportunity.id === input.opportunityId)
      : open.slice(0, maxOpportunities);
    const pipelineValue = open.reduce(
      (sum, opportunity) => sum + (opportunity.expected_value || 0),
      0,
    );

    const items: RevenuePipelineItem[] = [];
    for (const opportunity of selected) {
      const client = clientFor(opportunity, clients);
      const clientSignal = intelligenceFor(opportunity, intelligence.clients);
      const evaluation = evaluateOpportunity({
        opportunity,
        ...(client ? { client } : {}),
        ...(clientSignal ? { intelligence: clientSignal } : {}),
      });
      const updated = await this.opportunities.update(opportunity.id, evaluation.patch);
      const artifacts: ArtifactRecord[] = [];
      const approvals: ApprovalRecord[] = [];
      const common = {
        generatedAt,
        opportunity: updated,
        ...(client ? { client } : {}),
        evaluation,
      };
      artifacts.push(
        await this.artifacts.write({
          type: "lead-qualification-report",
          createdBy: "sales",
          ...(input.runId ? { runId: input.runId } : {}),
          ...(client ? { clientId: client.id } : {}),
          status: "submitted",
          metadata: {
            generated_at: generatedAt,
            opportunity_id: updated.id,
            score: evaluation.score,
            fit: evaluation.fit,
            stage: evaluation.stage,
            approval_required: true,
            reasons: evaluation.reasons,
            risks: evaluation.risks,
          },
          body: leadQualificationBody(common),
        }),
      );

      if (evaluation.stage === "proposal_ready") {
        const commitmentDrafts: ArtifactRecord[] = [];
        artifacts.push(
          ...(await Promise.all([
            this.artifacts.write({
              type: "pricing-brief",
              createdBy: "pricing",
              ...(input.runId ? { runId: input.runId } : {}),
              ...(client ? { clientId: client.id } : {}),
              status: "draft",
              metadata: {
                generated_at: generatedAt,
                opportunity_id: updated.id,
                score: evaluation.score,
                fit: evaluation.fit,
                approval_required: true,
              },
              body: pricingBriefBody(common),
            }),
            this.artifacts.write({
              type: "proposal-brief",
              createdBy: "proposal",
              ...(input.runId ? { runId: input.runId } : {}),
              ...(client ? { clientId: client.id } : {}),
              status: "draft",
              metadata: {
                generated_at: generatedAt,
                opportunity_id: updated.id,
                score: evaluation.score,
                fit: evaluation.fit,
                approval_required: true,
              },
              body: proposalBriefBody(common),
            }),
          ])),
        );
        commitmentDrafts.push(...artifacts.filter((artifact) => artifact.type.endsWith("-brief")));
        const gate = await requestExternalCommitmentGate(
          {
            artifacts: this.artifacts,
            approvals: this.approvals,
            audit: this.audit,
          },
          {
            generatedAt,
            source: "revenue.pipeline",
            target: updated.id,
            scope: `Send final proposal and pricing for ${updated.title}`,
            limit: `Draft value ${updated.expected_value > 0 ? money(updated.expected_value) : "not enough data"}; final price, scope, client send, and billing remain blocked`,
            actions: ["change_pricing", "send_final_proposals", "send_client_messages"],
            sourceArtifactIds: commitmentDrafts.map((artifact) => artifact.id),
            ...(input.runId ? { runId: input.runId } : {}),
            ...(client ? { clientId: client.id } : {}),
            opportunityId: updated.id,
          },
        );
        artifacts.push(gate.complianceReview);
        approvals.push(...gate.approvals);
      }

      if (evaluation.stage !== "proposal_ready") {
        artifacts.push(
          await this.artifacts.write({
            type: "conversion-audit",
            createdBy: "conversion",
            ...(input.runId ? { runId: input.runId } : {}),
            ...(client ? { clientId: client.id } : {}),
            status: "submitted",
            metadata: {
              generated_at: generatedAt,
              opportunity_id: updated.id,
              score: evaluation.score,
              fit: evaluation.fit,
              stage: evaluation.stage,
            },
            body: conversionAuditBody(common),
          }),
        );
      }

      items.push({
        opportunity: updated,
        ...(client ? { client } : {}),
        score: evaluation.score,
        fit: evaluation.fit,
        stage: evaluation.stage,
        reasons: evaluation.reasons,
        risks: evaluation.risks,
        next_action: evaluation.nextAction,
        artifacts,
        approvals,
      });
    }

    if (items.length === 0) {
      await this.artifacts.write({
        type: "conversion-audit",
        createdBy: "conversion",
        ...(input.runId ? { runId: input.runId } : {}),
        status: "submitted",
        metadata: {
          generated_at: generatedAt,
          open_opportunities: 0,
          pipeline_value: 0,
          stage: "needs_qualification",
        },
        body: conversionAuditBody({ generatedAt }),
      });
    }

    const qualifiedCount = items.filter((item) => item.stage !== "needs_qualification").length;
    const proposalReadyCount = items.filter((item) => item.stage === "proposal_ready").length;
    const nextActions = [
      proposalReadyCount > 0
        ? "Review proposal-ready pricing/proposal drafts and approve only the ones that should be sent."
        : "Move the strongest lead to proposal-ready by filling budget, margin, urgency, and scope.",
      qualifiedCount < items.length
        ? "Collect missing qualification data before allowing proposal work."
        : "Keep proposal delivery and final pricing behind owner approval.",
      items.length === 0
        ? "Create or import qualified opportunities from owner intake, GitHub signals, or growth campaigns."
        : "Refresh revenue pipeline after the next client/account signal.",
    ];
    const report = await this.artifacts.write({
      type: "revenue-pipeline-report",
      createdBy: "sales",
      ...(input.runId ? { runId: input.runId } : {}),
      status: "submitted",
      metadata: {
        generated_at: generatedAt,
        pipeline_value: pipelineValue,
        open_opportunities: open.length,
        qualified_count: qualifiedCount,
        proposal_ready_count: proposalReadyCount,
        opportunity_count: items.length,
      },
      body: reportBody({
        generatedAt,
        pipelineValue,
        openOpportunities: open.length,
        qualifiedCount,
        proposalReadyCount,
        items,
        nextActions,
      }),
    });
    await this.audit.append({
      actor: "supreme_coordinator",
      action: "revenue.pipeline.generated",
      target: "revenue",
      artifact_id: report.id,
      result: "ok",
    });

    return {
      generated_at: generatedAt,
      report,
      pipeline_value: pipelineValue,
      open_opportunities: open.length,
      qualified_count: qualifiedCount,
      proposal_ready_count: proposalReadyCount,
      items,
      next_actions: nextActions,
    };
  }
}
