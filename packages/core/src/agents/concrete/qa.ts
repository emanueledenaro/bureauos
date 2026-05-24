import type { AgentDeps, AgentRunInput, AgentRunOutput, AgentRuntime } from "../runtime.js";
import { AGENT_INDEX } from "../roles.js";
import { draftAgentArtifact } from "../model-drafting.js";

/**
 * QA agent.
 *
 * Drafts a test-plan artifact covering acceptance criteria, regression
 * checks, and unit/integration test recommendations.
 */
export class QaAgent implements AgentRuntime {
  public readonly definition = AGENT_INDEX.get("qa")!;

  constructor(private readonly deps: AgentDeps) {}

  async execute(input: AgentRunInput): Promise<AgentRunOutput> {
    const templateBody = `# Test Plan

## Acceptance Criteria Coverage

- Each acceptance criterion in the feature spec has at least one test.

## Unit Tests

- New functions exposed by the change.
- Boundary conditions and error paths.

## Integration Tests

- End-to-end happy path through the affected feature.
- Cross-component contracts where the change spans modules.

## Manual Checks

- Visual review for UI changes.
- Quick sanity check on adjacent features.

## Regression Checks

- Re-run the project's full test suite.
- Spot-check related features that share state with the change.

(Stub implementation; BACKLOG Phase 9 will wire prompts through the
provider router.)
`;
    const draft = await draftAgentArtifact({
      input,
      definition: this.definition,
      artifactTitle: "Test Plan",
      outputInstructions:
        "Write a QA test plan with acceptance coverage, unit tests, integration tests, manual checks, regression checks, and reproducibility notes.",
      templateBody,
    });
    const artifact = await this.deps.artifacts.write({
      type: "test-plan",
      createdBy: this.definition.id,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      body: draft.body,
    });
    await this.deps.audit.append({
      actor: this.definition.id,
      action: "agent.qa.executed",
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
