import type { AgentDeps, AgentRunInput, AgentRunOutput, AgentRuntime } from "../runtime.js";
import { AGENT_INDEX } from "../roles.js";
import { draftAgentArtifact } from "../model-drafting.js";

/**
 * Compliance agent.
 *
 * Drafts a compliance-review artifact for any run that touches client
 * commitments, public claims, ad spend, payments, or production.
 */
export class ComplianceAgent implements AgentRuntime {
  public readonly definition = AGENT_INDEX.get("compliance")!;

  constructor(private readonly deps: AgentDeps) {}

  async execute(input: AgentRunInput): Promise<AgentRunOutput> {
    const templateBody = `# Compliance Review

## Legal / Contract Risk

- Inspect any binding language in the artifacts.
- Require owner approval for prices, timelines, scope commitments.

## Privacy / Data Risk

- Identify personal data handled.
- Confirm storage policy and retention.

## Financial Risk

- Flag ad spend, refunds, billing changes.

## Public Claim Risk

- Match the claim to delivery evidence on file.
- Block testimonials/logos without explicit client permission.

## Required Approvals

- Owner approval before external commitment.
- Client permission before public proof use.

(Stub implementation; BACKLOG Phase 9 will wire model-driven analysis.)
`;
    const draft = await draftAgentArtifact({
      input,
      definition: this.definition,
      artifactTitle: "Compliance Review",
      outputInstructions:
        "Write a compliance review covering legal, privacy, financial, public-claim, and approval risks. Keep external actions blocked unless policy allows them.",
      templateBody,
    });
    const artifact = await this.deps.artifacts.write({
      type: "compliance-review",
      createdBy: this.definition.id,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      body: draft.body,
    });
    await this.deps.audit.append({
      actor: this.definition.id,
      action: "agent.compliance.executed",
      target: input.context.runId,
      artifact_id: artifact.id,
      ...(draft.capability ? { capability: draft.capability } : {}),
      ...(draft.error ? { error: draft.error } : {}),
      result: "ok",
    });
    return {
      ok: true,
      artifactIds: [artifact.id],
      decisions: draft.decisions,
      blockers: draft.blockers,
      notes: draft.notes,
    };
  }
}
