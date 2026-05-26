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
  intakePlan: LinearIssueIntakePlan;
  externalIssue: LinearIssueScopeInput;
  sourceWorkItem: SourceWorkItemInput;
}

const BLOCKED_OPERATIONS = ["merge", "deploy", "delete data", "billing", "secret"] as const;
const MAX_ACCEPTANCE_CRITERIA = 10;
const MAX_DESCRIPTION_WORDS = 700;

export type IntakeRiskLevel = "low" | "medium" | "high";

export interface LinearIssueAgentAssignment {
  agent: "product" | "project_manager" | "development" | "qa" | "security" | "reviewer";
  status: "ready" | "blocked";
  responsibility: string;
}

export interface LinearIssueIntakePlan {
  productAcceptanceCriteria: string[];
  productClarificationRequests: string[];
  projectManagerTaskPlan: string[];
  dependencies: string[];
  agentAssignments: LinearIssueAgentAssignment[];
  riskLevel: IntakeRiskLevel;
  riskReasons: string[];
}

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

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function ambiguousScope(input: LinearIssueScopeInput, criteria: readonly string[]): string[] {
  const text = `${input.title}\n${input.description}`.toLowerCase();
  const blockers: string[] = [];
  if (
    /\b(make|improve|fix|upgrade)\b.{0,24}\b(everything|all|whole thing|better|stuff|things)\b/.test(
      text,
    )
  ) {
    blockers.push("ambiguous scope needs product clarification");
  }
  if (
    criteria.some((criterion) => /\b(tbd|etc|and so on|whatever|everything)\b/i.test(criterion))
  ) {
    blockers.push("acceptance criteria contain ambiguous placeholder language");
  }
  return blockers;
}

function oversizedScope(input: LinearIssueScopeInput, criteria: readonly string[]): string[] {
  const blockers: string[] = [];
  if (criteria.length > MAX_ACCEPTANCE_CRITERIA) {
    blockers.push(`oversized issue scope: ${criteria.length} acceptance criteria`);
  }
  const words = wordCount(`${input.title}\n${input.description}`);
  if (words > MAX_DESCRIPTION_WORDS) {
    blockers.push(`oversized issue scope: ${words} words`);
  }
  return blockers;
}

function blockedOperations(text: string): string[] {
  const lower = text.toLowerCase();
  return BLOCKED_OPERATIONS.filter((operation) => lower.includes(operation));
}

function riskLevel(blockers: readonly string[], criteria: readonly string[]): IntakeRiskLevel {
  if (
    blockers.some(
      (blocker) =>
        blocker.includes("blocked operation") ||
        blocker.includes("oversized") ||
        blocker.includes("secret") ||
        blocker.includes("billing"),
    )
  ) {
    return "high";
  }
  if (blockers.length > 0 || criteria.length > 6) return "medium";
  return "low";
}

function productClarifications(blockers: readonly string[]): string[] {
  const questions: string[] = [];
  if (blockers.includes("missing acceptance criteria")) {
    questions.push("Provide concrete acceptance criteria before development starts.");
  }
  if (blockers.some((blocker) => blocker.includes("ambiguous"))) {
    questions.push(
      "Narrow the scope to one deliverable, one user outcome, and explicit non-goals.",
    );
  }
  if (blockers.some((blocker) => blocker.includes("oversized"))) {
    questions.push("Split the issue into smaller tickets before assigning development.");
  }
  if (blockers.some((blocker) => blocker.includes("blocked operation"))) {
    questions.push(
      "Move merge, deploy, billing, secrets, or destructive operations behind approval gates.",
    );
  }
  return questions;
}

function dependencies(blockers: readonly string[], criteria: readonly string[]): string[] {
  return [
    ...(criteria.length ? ["Product acceptance criteria are explicit."] : []),
    ...(blockers.length
      ? ["Owner or Product resolves clarification blockers before delivery."]
      : ["Project Manager confirms task boundaries and dependencies."]),
    "Development receives a linked issue, scoped handoff, and test expectations.",
    "QA receives acceptance criteria and evidence expectations before review.",
  ];
}

function taskPlan(ready: boolean): string[] {
  if (!ready) {
    return [
      "Product requests clarification and rewrites acceptance criteria.",
      "Project Manager splits or bounds the issue before specialist dispatch.",
      "Coordinator waits for clarified scope before development execution.",
    ];
  }
  return [
    "Product confirms acceptance criteria and non-goals.",
    "Project Manager creates role handoffs and dependency order.",
    "Development implements only the scoped behavior.",
    "QA verifies each acceptance criterion with explicit evidence.",
    "Security and Reviewer validate risk, tests, and PR readiness.",
  ];
}

function agentAssignments(args: {
  ready: boolean;
  riskLevel: IntakeRiskLevel;
}): LinearIssueAgentAssignment[] {
  const deliveryStatus = args.ready ? "ready" : "blocked";
  return [
    {
      agent: "product",
      status: args.ready ? "ready" : "blocked",
      responsibility: args.ready
        ? "Confirm acceptance criteria and non-goals."
        : "Request missing or narrower acceptance criteria.",
    },
    {
      agent: "project_manager",
      status: args.ready ? "ready" : "blocked",
      responsibility: args.ready
        ? "Create bounded task plan, dependencies, and role handoffs."
        : "Hold dispatch until clarification blockers are resolved.",
    },
    {
      agent: "development",
      status: deliveryStatus,
      responsibility: "Implement scoped code only after Product and PM planning is ready.",
    },
    {
      agent: "qa",
      status: deliveryStatus,
      responsibility: "Verify every acceptance criterion with explicit evidence.",
    },
    {
      agent: "security",
      status: deliveryStatus,
      responsibility: "Review sensitive or high-risk surfaces before PR readiness.",
    },
    {
      agent: "reviewer",
      status: deliveryStatus,
      responsibility: "Review scope, tests, residual risk, and PR readiness.",
    },
  ];
}

function intakePlan(args: {
  criteria: readonly string[];
  blockers: readonly string[];
}): LinearIssueIntakePlan {
  const ready = args.blockers.length === 0;
  const risk = riskLevel(args.blockers, args.criteria);
  return {
    productAcceptanceCriteria: [...args.criteria],
    productClarificationRequests: productClarifications(args.blockers),
    projectManagerTaskPlan: taskPlan(ready),
    dependencies: dependencies(args.blockers, args.criteria),
    agentAssignments: agentAssignments({ ready, riskLevel: risk }),
    riskLevel: risk,
    riskReasons:
      args.blockers.length > 0
        ? [...args.blockers]
        : args.criteria.length > 6
          ? ["larger than usual acceptance surface"]
          : ["bounded issue with explicit acceptance criteria"],
  };
}

export function linearIssueToRunScope(input: LinearIssueScopeInput): LinearIssueRunScope {
  const criteria = acceptanceCriteria(input.description);
  const blocked = blockedOperations(`${input.title}\n${input.description}`).map(
    (operation) => `contains blocked operation: ${operation}`,
  );
  const blockers = [
    ...(criteria.length === 0 ? ["missing acceptance criteria"] : []),
    ...ambiguousScope(input, criteria),
    ...oversizedScope(input, criteria),
    ...blocked,
  ];
  const plan = intakePlan({ criteria, blockers });

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
    intakePlan: plan,
    externalIssue: input,
    sourceWorkItem: linearIssueSourceWorkItem(input.identifier, input.url),
  };
}
