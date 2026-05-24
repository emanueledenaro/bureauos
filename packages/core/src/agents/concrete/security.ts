import type { AgentDeps, AgentRunInput, AgentRunOutput, AgentRuntime } from "../runtime.js";
import { AGENT_INDEX } from "../roles.js";
import { draftAgentArtifact } from "../model-drafting.js";

/**
 * Security agent.
 *
 * Drafts a security-review artifact for risk-sensitive runs.
 */
export class SecurityAgent implements AgentRuntime {
  public readonly definition = AGENT_INDEX.get("security")!;

  constructor(private readonly deps: AgentDeps) {}

  async execute(input: AgentRunInput): Promise<AgentRunOutput> {
    const fallbackBody = `# Security Review

## Risk Level

low (stub default)

## Attack Surface

- Inputs accepted by the change.
- Storage paths touched.
- Auth and authorization boundaries crossed.

## Findings

(none in this stub)

## Required Mitigations

- Validate every external input.
- Avoid logging secrets.
- Confirm no auth bypass.

## Approval Recommendation

- Approve when findings are addressed and tests cover the relevant cases.
- Block on any high-risk finding until mitigated.

(Stub implementation; BACKLOG Phase 9 will wire model-driven analysis.)
`;
    const draft = await draftAgentArtifact({
      input,
      definition: this.definition,
      artifactTitle: "Security Review",
      outputInstructions:
        "Write a security review with risk level, attack surface, findings, mitigations, approval recommendation, and evidence gaps.",
      fallbackBody,
    });
    const artifact = await this.deps.artifacts.write({
      type: "security-review",
      createdBy: this.definition.id,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      body: draft.body,
    });
    await this.deps.audit.append({
      actor: this.definition.id,
      action: "agent.security.executed",
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
