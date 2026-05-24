import type { AgentDeps, AgentRunInput, AgentRunOutput, AgentRuntime } from "../runtime.js";
import { AGENT_INDEX } from "../roles.js";
import { draftAgentArtifact } from "../model-drafting.js";

/**
 * Product agent.
 *
 * Turns the run briefing into a feature-spec artifact with user story,
 * acceptance criteria, scope, non-goals, and open questions.
 */
export class ProductAgent implements AgentRuntime {
  public readonly definition = AGENT_INDEX.get("product")!;

  constructor(private readonly deps: AgentDeps) {}

  async execute(input: AgentRunInput): Promise<AgentRunOutput> {
    const briefing = input.context.briefing ?? input.context.scope;
    const fallbackBody = `# Feature Spec

## Title

${input.context.scope}

## Background

${briefing}

## User Story

As an owner, I want this work delivered so that the agency keeps revenue
and delivery moving.

## Acceptance Criteria

- Behavior described in the briefing is implemented and verifiable.
- Tests cover at least one happy path and one edge case.
- The change is scoped to a single concern.

## Scope

- Only what the briefing names.

## Non-Goals

- Anything not in the briefing. Carve out separate runs for adjacent work.

## Open Questions

- Are there client constraints not mentioned in the briefing?
- Is delivery capacity available before the agreed timeline?

(Stub implementation; BACKLOG Phase 9 will wire model calls.)
`;
    const draft = await draftAgentArtifact({
      input,
      definition: this.definition,
      artifactTitle: "Feature Spec",
      outputInstructions:
        "Write a product feature spec with background, user story, BDD-style acceptance criteria, scope, non-goals, and open questions.",
      fallbackBody,
    });
    const artifact = await this.deps.artifacts.write({
      type: "feature-spec",
      createdBy: this.definition.id,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      body: draft.body,
    });
    await this.deps.audit.append({
      actor: this.definition.id,
      action: "agent.product.executed",
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
