import type { AgentDeps, AgentRunInput, AgentRunOutput, AgentRuntime } from "../runtime.js";
import { AGENT_INDEX } from "../roles.js";
import { draftAgentArtifact } from "../model-drafting.js";

/**
 * Project Manager agent.
 *
 * Owns project memory, coordinates specialist agents, and consolidates
 * project-level reports. Writes a `run-report` artifact summarizing what
 * happened in the run plus a recommended next action.
 */
export class ProjectManagerAgent implements AgentRuntime {
  public readonly definition = AGENT_INDEX.get("project_manager")!;

  constructor(private readonly deps: AgentDeps) {}

  async execute(input: AgentRunInput): Promise<AgentRunOutput> {
    const briefing = input.context.briefing ?? "(no briefing supplied)";
    const fallbackBody = `# Project Manager Run Report

- Run: ${input.context.runId}
- Project: ${input.context.projectId ?? "(none)"}
- Client: ${input.context.clientId ?? "(none)"}

## Briefing

${briefing}

## Plan

1. Confirm scope against project memory.
2. Identify specialist agents needed: Product, UX, Dev, QA, Security.
3. Dispatch artifacts to each specialist with bounded context packets.
4. Verify outputs before consolidating into the project report.

## Decision Posture

- Defer pricing or scope commitments to the owner.
- Escalate any cross-project dependency to the Supreme Coordinator.

This is a non-LLM stub implementation. BACKLOG Phase 9 will wire prompts
through the provider router.
`;
    const draft = await draftAgentArtifact({
      input,
      definition: this.definition,
      artifactTitle: "Project Manager Run Report",
      outputInstructions:
        "Write a project manager report with scope confirmation, specialist routing, memory boundaries, risks, and next actions.",
      fallbackBody,
    });
    const artifact = await this.deps.artifacts.write({
      type: "run-report",
      createdBy: this.definition.id,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      body: draft.body,
    });
    await this.deps.audit.append({
      actor: this.definition.id,
      action: "agent.project_manager.executed",
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
