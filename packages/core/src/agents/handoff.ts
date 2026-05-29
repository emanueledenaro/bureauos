import type { ArtifactRecord, ArtifactStore, ArtifactType } from "../artifacts/store.js";
import type { AuditLog } from "../audit/log.js";
import type { FrontMatter } from "../registries/base.js";
import type { AgentDefinition } from "./roles.js";
import type { AgentDeps, AgentRunInput, AgentRunOutput } from "./runtime.js";

export interface AgentHandoffContractInput {
  sourceAgentId: string;
  targetAgentId: string;
  runId: string;
  scope: string;
  projectId?: string;
  clientId?: string;
  dispatchPacketId?: string;
  inputArtifactIds: readonly string[];
  expectedOutputTypes: readonly string[];
  acceptanceChecks: readonly string[];
  blockers?: readonly string[];
  outputArtifactIds?: readonly string[];
}

export interface AgentHandoffContract {
  version: "1";
  sourceAgentId: string;
  targetAgentId: string;
  runId: string;
  scope: string;
  projectId: string;
  clientId: string;
  dispatchPacketId: string;
  inputArtifactIds: string[];
  expectedOutputTypes: string[];
  acceptanceChecks: string[];
  blockers: string[];
  outputArtifactIds: string[];
}

export interface AgentHandoffValidation {
  ok: boolean;
  contract?: AgentHandoffContract;
  artifact?: ArtifactRecord;
  errors: string[];
}

export interface AgentHandoffValidationDeps {
  artifacts: ArtifactStore;
  audit: AuditLog;
}

const REQUIRED_STRING_FIELDS = ["source_agent_id", "target_agent_id", "run_id", "scope"] as const;

const REQUIRED_ARRAY_FIELDS = [
  "input_artifact_ids",
  "expected_output_types",
  "acceptance_checks",
] as const;

function field(record: ArtifactRecord, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function fieldArray(record: ArtifactRecord, key: string): string[] {
  const value = record[key];
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function frontMatterList(values: readonly string[]): string[] {
  return values.map((value) => value.replace(/,/g, ";").trim()).filter(Boolean);
}

function contractErrors(record: ArtifactRecord, expectedAgentId: string): string[] {
  const errors: string[] = [];
  if (record.type !== "agent-handoff") {
    errors.push(`handoff artifact must be type agent-handoff, got ${record.type}`);
  }
  for (const key of REQUIRED_STRING_FIELDS) {
    if (!field(record, key)) errors.push(`missing ${key}`);
  }
  for (const key of REQUIRED_ARRAY_FIELDS) {
    if (fieldArray(record, key).length === 0) errors.push(`missing ${key}`);
  }
  const targetAgentId = field(record, "target_agent_id");
  if (targetAgentId && targetAgentId !== expectedAgentId) {
    errors.push(`wrong target_agent_id: expected ${expectedAgentId}, got ${targetAgentId}`);
  }
  return errors;
}

function parseContract(record: ArtifactRecord): AgentHandoffContract {
  return {
    version: "1",
    sourceAgentId: field(record, "source_agent_id"),
    targetAgentId: field(record, "target_agent_id"),
    runId: field(record, "run_id"),
    scope: field(record, "scope"),
    projectId: field(record, "handoff_project_id") || record.project_id,
    clientId: field(record, "handoff_client_id") || record.client_id,
    dispatchPacketId: field(record, "dispatch_packet_id"),
    inputArtifactIds: fieldArray(record, "input_artifact_ids"),
    expectedOutputTypes: fieldArray(record, "expected_output_types"),
    acceptanceChecks: fieldArray(record, "acceptance_checks"),
    blockers: fieldArray(record, "blockers"),
    outputArtifactIds: fieldArray(record, "output_artifact_ids"),
  };
}

function validationBody(args: {
  handoffArtifactId: string;
  expectedAgentId: string;
  actualTargetAgentId: string;
  errors: readonly string[];
}): string {
  return `# Agent Handoff Validation

## Status

invalid

## Handoff

- Artifact: ${args.handoffArtifactId}
- Expected agent: ${args.expectedAgentId}
- Actual target: ${args.actualTargetAgentId || "(missing)"}

## Problems

${args.errors.map((error) => `- ${error}`).join("\n")}

## Required Fix

- Recreate the handoff with source_agent_id, target_agent_id, scope, input_artifact_ids, expected_output_types, and acceptance_checks.
- Route the handoff only to the target agent named in target_agent_id.
- Keep client/project memory scoped to the run before retrying the agent.
`;
}

export function agentHandoffMetadata(input: AgentHandoffContractInput): FrontMatter {
  return {
    handoff_contract_version: "1",
    source_agent_id: input.sourceAgentId,
    target_agent_id: input.targetAgentId,
    run_id: input.runId,
    scope: input.scope,
    handoff_project_id: input.projectId ?? "",
    handoff_client_id: input.clientId ?? "",
    dispatch_packet_id: input.dispatchPacketId ?? "",
    input_artifact_ids: frontMatterList(input.inputArtifactIds),
    expected_output_types: frontMatterList(input.expectedOutputTypes),
    acceptance_checks: frontMatterList(input.acceptanceChecks),
    blockers: frontMatterList(input.blockers ?? []),
    output_artifact_ids: frontMatterList(input.outputArtifactIds ?? []),
  };
}

export function agentHandoffBody(args: {
  contract: AgentHandoffContractInput;
  targetRole: AgentDefinition;
  sourceArtifacts: readonly ArtifactRecord[];
}): string {
  const { contract, targetRole, sourceArtifacts } = args;
  const inputList =
    contract.inputArtifactIds.length === 0
      ? "- none"
      : contract.inputArtifactIds.map((id) => `- ${id}`).join("\n");
  return `# Agent Handoff: ${targetRole.role}

## Contract

- Source agent: ${contract.sourceAgentId}
- Target agent: ${contract.targetAgentId}
- Run: ${contract.runId}
- Scope: ${contract.scope}
- Dispatch packet: ${contract.dispatchPacketId ?? "(none)"}

## Inputs

${inputList}

## Expected Outputs

${contract.expectedOutputTypes.map((output) => `- ${output}`).join("\n")}

## Acceptance Checks

${contract.acceptanceChecks.map((check) => `- ${check}`).join("\n")}

## Existing Source Artifacts

${
  sourceArtifacts.length === 0
    ? "- No project artifacts found yet."
    : sourceArtifacts.map((artifact) => `- ${artifact.type}: ${artifact.id}`).join("\n")
}

## Current Blockers

${(contract.blockers ?? []).length === 0 ? "- none" : contract.blockers!.map((blocker) => `- ${blocker}`).join("\n")}
`;
}

export async function validateAgentHandoff(
  input: AgentRunInput,
  deps: AgentHandoffValidationDeps,
  expectedAgentId: string,
): Promise<AgentHandoffValidation> {
  const handoffArtifactId = input.context.handoffArtifactId;
  if (!handoffArtifactId) return { ok: true, errors: [] };

  const handoff = await deps.artifacts.read(handoffArtifactId);
  const record = handoff?.record;
  const errors = record
    ? contractErrors(record, expectedAgentId)
    : [`handoff artifact not found: ${handoffArtifactId}`];

  if (record && record.run_id !== input.context.runId) {
    errors.push(`wrong run_id: expected ${input.context.runId}, got ${record.run_id}`);
  }

  if (errors.length === 0 && record) {
    await deps.audit.append({
      actor: expectedAgentId,
      action: "agent.handoff.validated",
      target: input.context.runId,
      artifact_id: record.id,
      result: "ok",
    });
    return { ok: true, contract: parseContract(record), errors: [] };
  }

  const actualTargetAgentId = record ? field(record, "target_agent_id") : "";
  const artifact = await deps.artifacts.write({
    type: "agent-handoff-validation",
    createdBy: expectedAgentId,
    runId: input.context.runId,
    ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
    ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
    metadata: {
      validation_status: "invalid",
      handoff_id: handoffArtifactId,
      expected_agent_id: expectedAgentId,
      actual_target_agent_id: actualTargetAgentId,
      validation_errors: errors,
    },
    body: validationBody({
      handoffArtifactId,
      expectedAgentId,
      actualTargetAgentId,
      errors,
    }),
  });
  await deps.audit.append({
    actor: expectedAgentId,
    action: "agent.handoff.invalid",
    target: input.context.runId,
    artifact_id: artifact.id,
    result: "error",
  });
  return { ok: false, artifact, errors };
}

export async function validateRequiredHandoff(
  input: AgentRunInput,
  deps: AgentDeps,
  expectedAgentId: string,
): Promise<AgentHandoffValidation> {
  return validateAgentHandoff(input, deps, expectedAgentId);
}

export function blockedByInvalidHandoff(validation: AgentHandoffValidation): AgentRunOutput {
  return {
    ok: false,
    artifactIds: validation.artifact ? [validation.artifact.id] : [],
    decisions: ["handoff:invalid"],
    blockers: validation.errors,
    notes: `blocked by invalid handoff contract with ${validation.errors.length} issue(s)`,
  };
}

export function handoffArtifactTypes(contract?: AgentHandoffContract): ArtifactType[] {
  return (contract?.expectedOutputTypes ?? []).filter((item): item is ArtifactType =>
    [
      "feature-spec",
      "design-spec",
      "bug-report",
      "technical-plan",
      "test-plan",
      "test-evidence-report",
      "security-review",
      "pr-review",
      "run-report",
    ].includes(item),
  );
}
