import type { AgentDeps, AgentRunInput, AgentRunOutput, AgentRuntime } from "../runtime.js";
import { AGENT_INDEX, type AgentDefinition } from "../roles.js";
import type { ArtifactType } from "../../artifacts/store.js";
import { draftAgentArtifact } from "../model-drafting.js";

/**
 * Builds a concrete agent that writes a single artifact of the given
 * `artifactType` for its role. The body is templated from the role
 * definition: description, responsibilities, outputs, must-not. Real
 * LLM-driven prompts replace this body in BACKLOG Phase 9.
 */
class TemplateAgent implements AgentRuntime {
  public readonly definition: AgentDefinition;

  constructor(
    roleId: string,
    private readonly artifactType: ArtifactType,
    private readonly deps: AgentDeps,
  ) {
    const def = AGENT_INDEX.get(roleId);
    if (!def) throw new Error(`unknown role: ${roleId}`);
    this.definition = def;
  }

  async execute(input: AgentRunInput): Promise<AgentRunOutput> {
    const def = this.definition;
    const templateBody = `# ${def.role}

## Scope

${input.context.scope}

## Briefing

${input.context.briefing ?? "(none)"}

## Responsibilities applied to this run

${def.responsibilities.map((r) => `- ${r}`).join("\n")}

## Expected outputs

${def.outputs.map((r) => `- ${r}`).join("\n")}

## Must not

${def.mustNot.map((r) => `- ${r}`).join("\n")}

(Stub implementation; BACKLOG Phase 9 will wire prompts through the provider router.)
`;
    const draft = await draftAgentArtifact({
      input,
      definition: def,
      artifactTitle: def.role,
      outputInstructions: `Write the ${def.role} artifact for this run. Include applied responsibilities, expected outputs, risks, must-not boundaries, and next actions in Markdown.`,
      templateBody,
    });
    const artifact = await this.deps.artifacts.write({
      type: this.artifactType,
      createdBy: def.id,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      body: draft.body,
    });
    await this.deps.audit.append({
      actor: def.id,
      action: `agent.${def.id}.executed`,
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

/**
 * Map of role id to the artifact type the agent emits.
 * Source of truth: docs/agents.md and templates/.
 */
const ROLE_ARTIFACT: ReadonlyArray<[string, ArtifactType]> = [
  ["supreme_coordinator", "executive-report"],
  ["ux", "design-spec"],
  ["release", "run-report"],
  ["visibility", "brand-brief"],
  ["content", "social-post-brief"],
  ["social", "social-post-brief"],
  ["creative", "creative-brief"],
  ["ads", "ad-campaign-brief"],
  ["marketing", "campaign-brief"],
  ["conversion", "conversion-audit"],
  ["sales", "lead-qualification-report"],
  ["pricing", "pricing-brief"],
  ["proposal", "proposal-brief"],
  ["client_success", "client-account-plan"],
];

export function templateAgents(deps: AgentDeps): AgentRuntime[] {
  return ROLE_ARTIFACT.map(([id, type]) => new TemplateAgent(id, type, deps));
}
