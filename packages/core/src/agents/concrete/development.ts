import type { AgentDeps, AgentRunInput, AgentRunOutput, AgentRuntime } from "../runtime.js";
import { AGENT_INDEX } from "../roles.js";
import { draftAgentArtifact } from "../model-drafting.js";

/**
 * Development agent.
 *
 * Drafts a technical plan artifact. Real code execution arrives in
 * BACKLOG Phase 8 once the Codex runtime is wired and policy approves
 * the action.
 */
export class DevelopmentAgent implements AgentRuntime {
  public readonly definition = AGENT_INDEX.get("development")!;

  constructor(private readonly deps: AgentDeps) {}

  async execute(input: AgentRunInput): Promise<AgentRunOutput> {
    const templateBody = `# Technical Plan

## Mental Model

Implement ${input.context.scope} as a scoped change.

## Files Likely Affected

- (to be detected by inspecting the repository)

## Local Changes

1. Add or update the relevant module.
2. Add tests covering the new behavior.
3. Run the project's test command.

## Risks

- Coupling with adjacent features; mitigated by keeping the diff small.
- Test coverage gaps; QA agent should flag them.

## Rollback Notes

Revert the single commit if the deploy or merge surfaces a regression.

(Stub implementation; code execution arrives with the Codex runtime in
BACKLOG Phase 8.)
`;
    const draft = await draftAgentArtifact({
      input,
      definition: this.definition,
      artifactTitle: "Technical Plan",
      outputInstructions:
        "Write a technical plan with mental model, likely files, local changes, tests, risks, and rollback notes. Do not write code unless explicitly requested by the run.",
      templateBody,
    });
    const artifact = await this.deps.artifacts.write({
      type: "technical-plan",
      createdBy: this.definition.id,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      body: draft.body,
    });
    await this.deps.audit.append({
      actor: this.definition.id,
      action: "agent.development.executed",
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
