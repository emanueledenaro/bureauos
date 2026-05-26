import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { ApprovalRegistry, type ApprovalRecord } from "../registries/approval.js";

export type ExternalCommitmentAction =
  | "send_client_messages"
  | "publish_public_content"
  | "publish_social_posts"
  | "run_paid_ads"
  | "launch_ad_campaigns"
  | "change_pricing"
  | "send_final_proposals"
  | "change_billing"
  | "deploy_production";

export interface ExternalCommitmentGateInput {
  generatedAt: string;
  source: string;
  target: string;
  scope: string;
  limit: string;
  actions: readonly ExternalCommitmentAction[];
  sourceArtifactIds?: readonly string[];
  runId?: string;
  clientId?: string;
  projectId?: string;
  opportunityId?: string;
  expiresAt?: string;
}

export interface ExternalCommitmentGateResult {
  complianceReview: ArtifactRecord;
  approvals: ApprovalRecord[];
}

export interface ExternalCommitmentGateDeps {
  artifacts: ArtifactStore;
  approvals: ApprovalRegistry;
  audit: AuditLog;
}

function defaultExpiry(generatedAt: string): string {
  const date = new Date(generatedAt);
  const base = Number.isFinite(date.getTime()) ? date : new Date();
  return new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

function uniqueActions(actions: readonly ExternalCommitmentAction[]): ExternalCommitmentAction[] {
  return Array.from(new Set(actions));
}

function complianceBody(args: ExternalCommitmentGateInput): string {
  return `# Compliance Review

Generated: ${args.generatedAt}

## External Commitment Gate

- Source: ${args.source}
- Target: ${args.target}
- Scope: ${args.scope}
- Limit: ${args.limit}
- Expires: ${args.expiresAt ?? defaultExpiry(args.generatedAt)}

## Required Approval Actions

${uniqueActions(args.actions)
  .map((action) => `- ${action}`)
  .join("\n")}

## Source Artifacts

${args.sourceArtifactIds?.length ? args.sourceArtifactIds.map((id) => `- ${id}`).join("\n") : "- (none)"}

## Boundary

- Drafting, qualification, and internal review may continue locally.
- Client sends, public publishing, paid spend, billing, final pricing, proposal delivery, production promises, and external claims remain blocked until the matching owner approval is approved.
`;
}

function approvalBody(args: ExternalCommitmentGateInput & { action: ExternalCommitmentAction }) {
  return `# External Commitment Approval

- Action: ${args.action}
- Source: ${args.source}
- Target: ${args.target}
- Scope: ${args.scope}
- Limit: ${args.limit}
- Expires: ${args.expiresAt ?? defaultExpiry(args.generatedAt)}
${args.sourceArtifactIds?.length ? `- Source artifacts: ${args.sourceArtifactIds.join(", ")}\n` : ""}
Approve only if this exact external commitment is allowed within the stated source, scope, limit, and expiry.
`;
}

export async function requestExternalCommitmentGate(
  deps: ExternalCommitmentGateDeps,
  input: ExternalCommitmentGateInput,
): Promise<ExternalCommitmentGateResult> {
  const actions = uniqueActions(input.actions);
  const expiresAt = input.expiresAt ?? defaultExpiry(input.generatedAt);
  const gateInput = { ...input, actions, expiresAt };
  const complianceReview = await deps.artifacts.write({
    type: "compliance-review",
    createdBy: "compliance",
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.clientId ? { clientId: input.clientId } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    status: "submitted",
    metadata: {
      generated_at: input.generatedAt,
      source: input.source,
      target: input.target,
      scope: input.scope,
      limit: input.limit,
      expires_at: expiresAt,
      commitment_actions: actions,
      source_artifacts: [...(input.sourceArtifactIds ?? [])],
      ...(input.opportunityId ? { opportunity_id: input.opportunityId } : {}),
      approval_required: true,
    },
    body: complianceBody(gateInput),
  });

  const approvals: ApprovalRecord[] = [];
  for (const action of actions) {
    const approval = await deps.approvals.request({
      action,
      actor: "supreme_coordinator",
      target: input.target,
      scope: input.scope,
      source: `${input.source}:${complianceReview.id}`,
      limit: input.limit,
      runId: input.runId,
      expiresAt,
      body: approvalBody({ ...gateInput, action }),
    });
    approvals.push(approval);
    await deps.audit.append({
      actor: "supreme_coordinator",
      action: "external_commitment.approval_requested",
      target: input.target,
      approval_id: approval.id,
      artifact_id: complianceReview.id,
      result: "ok",
    });
  }

  return { complianceReview, approvals };
}
