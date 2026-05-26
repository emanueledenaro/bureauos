import type { RunTriggerType, RunType } from "../runs/engine.js";
import { linearIssueSourceWorkItem, type SourceWorkItemInput } from "../work-items/source.js";

export interface LinearIssueScopeInput {
  identifier: string;
  title: string;
  description: string;
  url: string;
  labels: readonly string[];
  projectId: string;
  teamKey: string;
}

export interface LinearIssueRunScope {
  readiness: "ready" | "needs_clarification";
  runType: RunType;
  triggerType: RunTriggerType;
  triggerSource: string;
  scope: string;
  acceptanceCriteria: string[];
  blockers: string[];
  externalIssue: LinearIssueScopeInput;
  sourceWorkItem: SourceWorkItemInput;
}

const BLOCKED_OPERATIONS = ["merge", "deploy", "delete data", "billing", "secret"] as const;

function runTypeFor(labels: readonly string[]): RunType {
  const normalized = labels.map((label) => label.toLowerCase());
  if (normalized.includes("bug")) return "bug";
  if (normalized.includes("test")) return "review";
  if (normalized.includes("docs")) return "planning";
  return "feature";
}

function acceptanceCriteria(description: string): string[] {
  const lines = description.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => /acceptance criteria/i.test(line));
  if (markerIndex === -1) return [];
  return lines
    .slice(markerIndex + 1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("-") || line.startsWith("*"))
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function blockedOperations(text: string): string[] {
  const lower = text.toLowerCase();
  return BLOCKED_OPERATIONS.filter((operation) => lower.includes(operation));
}

export function linearIssueToRunScope(input: LinearIssueScopeInput): LinearIssueRunScope {
  const criteria = acceptanceCriteria(input.description);
  const blocked = blockedOperations(`${input.title}\n${input.description}`).map(
    (operation) => `contains blocked operation: ${operation}`,
  );
  const blockers = [...(criteria.length === 0 ? ["missing acceptance criteria"] : []), ...blocked];

  return {
    readiness: blockers.length === 0 ? "ready" : "needs_clarification",
    runType: runTypeFor(input.labels),
    triggerType: "external_signal",
    triggerSource: `linear://issue/${input.identifier}`,
    scope: `${input.identifier}: ${input.title}\n\nAcceptance criteria:\n${criteria
      .map((item) => `- ${item}`)
      .join("\n")}`,
    acceptanceCriteria: criteria,
    blockers,
    externalIssue: input,
    sourceWorkItem: linearIssueSourceWorkItem(input.identifier, input.url),
  };
}
