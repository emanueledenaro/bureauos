import type { AgentDeps, AgentRunInput, AgentRunOutput, AgentRuntime } from "../runtime.js";
import { AGENT_INDEX } from "../roles.js";

/**
 * Security agent.
 *
 * Drafts a security-review artifact for risk-sensitive runs.
 */
export class SecurityAgent implements AgentRuntime {
  public readonly definition = AGENT_INDEX.get("security")!;

  constructor(private readonly deps: AgentDeps) {}

  async execute(input: AgentRunInput): Promise<AgentRunOutput> {
    const body = `# Security Review

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
    const artifact = await this.deps.artifacts.write({
      type: "security-review",
      createdBy: this.definition.id,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      body,
    });
    await this.deps.audit.append({
      actor: this.definition.id,
      action: "agent.security.executed",
      target: input.context.runId,
      artifact_id: artifact.id,
      result: "ok",
    });
    return {
      ok: true,
      artifactIds: [artifact.id],
      decisions: [],
      blockers: [],
      notes: "Security review drafted (stub)",
    };
  }
}
