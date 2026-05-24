import type { GenerateTextResult } from "@bureauos/providers";
import type { AgentRunInput } from "./runtime.js";
import type { AgentDefinition } from "./roles.js";
import { MODEL_PROVIDER_CAPABILITY, type AgentModelSelection } from "./provider-routing.js";

export interface AgentDraftResult {
  body: string;
  notes: string;
  decisions: readonly string[];
  blockers: readonly string[];
  capability?: string;
  error?: string;
}

export interface AgentDraftInput {
  input: AgentRunInput;
  definition: AgentDefinition;
  artifactTitle: string;
  outputInstructions: string;
  fallbackBody: string;
}

function selectionFrom(input: AgentRunInput): AgentModelSelection | undefined {
  const value = input.capabilities.get(MODEL_PROVIDER_CAPABILITY);
  if (!value || typeof value !== "object") return undefined;
  const maybe = value as Partial<AgentModelSelection>;
  if (!maybe.provider || typeof maybe.model !== "string") return undefined;
  return maybe as AgentModelSelection;
}

function systemPrompt(definition: AgentDefinition): string {
  return [
    `You are ${definition.role} inside BureauOS, an autonomous AI agency operating system.`,
    "Produce only the requested Markdown artifact body.",
    "Respect the role boundary, the memory boundary, and the must-not list.",
    "Do not claim external actions, publication, client contact, payment changes, merges, or deployments.",
    "",
    "Responsibilities:",
    ...definition.responsibilities.map((item) => `- ${item}`),
    "",
    "Required outputs:",
    ...definition.outputs.map((item) => `- ${item}`),
    "",
    "Must not:",
    ...definition.mustNot.map((item) => `- ${item}`),
  ].join("\n");
}

function userPrompt(args: AgentDraftInput): string {
  return [
    `Artifact: ${args.artifactTitle}`,
    "",
    `Run: ${args.input.context.runId}`,
    `Scope: ${args.input.context.scope}`,
    `Client: ${args.input.context.clientId ?? "(none)"}`,
    `Project: ${args.input.context.projectId ?? "(none)"}`,
    "",
    "Briefing:",
    args.input.context.briefing ?? "(none)",
    "",
    "Output instructions:",
    args.outputInstructions,
  ].join("\n");
}

function withProviderFooter(
  body: string,
  selection: AgentModelSelection,
  result: GenerateTextResult,
): string {
  return `${body.trim()}

## Generation Metadata

- Provider: ${selection.provider.id}
- Model: ${result.model || selection.model}
`;
}

function fallbackBody(body: string, reason?: string): string {
  if (!reason) return body;
  return `${body.trim()}

## Provider Fallback

Model generation was unavailable for this run; BureauOS used the deterministic internal template.
`;
}

export async function draftAgentArtifact(args: AgentDraftInput): Promise<AgentDraftResult> {
  const selection = selectionFrom(args.input);
  if (!selection) {
    return {
      body: args.fallbackBody,
      notes: `${args.definition.role} completed with deterministic template`,
      decisions: [],
      blockers: [],
    };
  }

  try {
    const result = await selection.provider.generateText({
      model: selection.model,
      system: systemPrompt(args.definition),
      prompt: userPrompt(args),
      temperature: 0.2,
      maxTokens: 2200,
    });
    return {
      body: withProviderFooter(result.text, selection, result),
      notes: `${args.definition.role} completed via ${selection.provider.id}`,
      decisions: [
        `Used provider ${selection.provider.id} with model ${result.model || selection.model}.`,
      ],
      blockers: [],
      capability: `model:${selection.provider.id}`,
    };
  } catch {
    return {
      body: fallbackBody(args.fallbackBody, "provider_error"),
      notes: `${args.definition.role} completed with deterministic fallback`,
      decisions: [],
      blockers: [],
      capability: `model:${selection.provider.id}`,
      error: "provider generation failed; deterministic fallback used",
    };
  }
}
