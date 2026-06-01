import {
  defaultProjectTestRunnerFactory,
  type AgentDeps,
  type AgentRunInput,
  type AgentRunOutput,
  type AgentRuntime,
} from "../runtime.js";
import { AGENT_INDEX } from "../roles.js";
import type { ArtifactRecord } from "../../artifacts/store.js";
import type { ProjectTestRunnerResult } from "../../execution/project-test-runner.js";
import { draftAgentArtifact } from "../model-drafting.js";
import { blockedByInvalidHandoff, validateRequiredHandoff } from "../handoff.js";

export type QaAcceptanceStatus = "pass" | "fail" | "unknown";

export interface QaSourceArtifact {
  record: ArtifactRecord;
  body: string;
}

export interface QaAcceptanceCheck {
  criterion: string;
  status: QaAcceptanceStatus;
  evidence: string;
  recommendation: string;
}

export interface QaVerificationAnalysis {
  readiness: "ready_for_review" | "blocked";
  checks: QaAcceptanceCheck[];
  blockers: string[];
  sourceArtifacts: QaSourceArtifact[];
}

interface EvidenceSignal {
  status: Exclude<QaAcceptanceStatus, "unknown">;
  text: string;
  source: string;
}

const STOP_WORDS = new Set([
  "and",
  "are",
  "con",
  "del",
  "della",
  "delle",
  "gli",
  "has",
  "have",
  "per",
  "the",
  "una",
  "uno",
  "with",
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function signalMatchesCriterion(signalText: string, criterion: string): boolean {
  const normalizedSignal = normalize(signalText);
  const normalizedCriterion = normalize(criterion);
  if (!normalizedSignal || !normalizedCriterion) return false;
  if (
    normalizedSignal.includes(normalizedCriterion) ||
    normalizedCriterion.includes(normalizedSignal)
  ) {
    return true;
  }

  const criterionTokens = meaningfulTokens(criterion);
  if (criterionTokens.length === 0) return false;
  const signalTokens = new Set(meaningfulTokens(signalText));
  const overlap = criterionTokens.filter((token) => signalTokens.has(token)).length;
  return overlap / criterionTokens.length >= 0.65;
}

function stripBullet(line: string): string {
  return line
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/^\[[ xX]\]\s+/, "")
    .trim();
}

export function extractAcceptanceCriteria(text: string): string[] {
  const criteria: string[] = [];
  let collecting = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/acceptance criteria/i.test(line)) {
      collecting = true;
      continue;
    }
    if (!collecting || !line) continue;
    if (/^#{1,6}\s+/.test(line)) {
      collecting = /acceptance criteria/i.test(line);
      continue;
    }
    if (/^[A-Z][A-Za-z ]{2,}:$/.test(line)) {
      collecting = false;
      continue;
    }
    if (/^(?:[-*]|\d+\.)\s+/.test(line)) {
      const criterion = stripBullet(line);
      if (criterion) criteria.push(criterion);
    }
  }
  return Array.from(new Set(criteria));
}

function collectEvidenceSignals(source: string, text: string): EvidenceSignal[] {
  const signals: EvidenceSignal[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const failed =
      /^(?:[-*]\s*)?(?:fail|failed|failing|verification failed|not verified):\s*(.+)$/i.exec(line);
    if (failed?.[1]) {
      signals.push({ status: "fail", text: failed[1].trim(), source });
      continue;
    }

    const passed = /^(?:[-*]\s*)?(?:pass|passed|verified|verification passed):\s*(.+)$/i.exec(line);
    if (passed?.[1]) {
      signals.push({ status: "pass", text: passed[1].trim(), source });
      continue;
    }

    const checked = /^[-*]\s+\[x\]\s+(.+)$/i.exec(line);
    if (checked?.[1]) {
      signals.push({ status: "pass", text: checked[1].trim(), source });
      continue;
    }

    const unchecked = /^[-*]\s+\[\s\]\s+(.+)$/i.exec(line);
    if (unchecked?.[1]) {
      signals.push({ status: "fail", text: unchecked[1].trim(), source });
    }
  }
  return signals;
}

function analyzeCriterion(
  criterion: string,
  signals: readonly EvidenceSignal[],
): QaAcceptanceCheck {
  const matching = signals.filter((signal) => signalMatchesCriterion(signal.text, criterion));
  const failing = matching.find((signal) => signal.status === "fail");
  if (failing) {
    return {
      criterion,
      status: "fail",
      evidence: `${failing.source}: ${failing.text}`,
      recommendation: "Resolve the failing acceptance evidence before requesting review.",
    };
  }

  const passing = matching.find((signal) => signal.status === "pass");
  if (passing) {
    return {
      criterion,
      status: "pass",
      evidence: `${passing.source}: ${passing.text}`,
      recommendation: "No QA blocker for this criterion.",
    };
  }

  return {
    criterion,
    status: "unknown",
    evidence: "No matching pass/fail evidence found in briefing or run artifacts.",
    recommendation: "Attach explicit verification evidence for this acceptance criterion.",
  };
}

export function analyzeQaVerification(
  input: AgentRunInput,
  sourceArtifacts: readonly QaSourceArtifact[],
): QaVerificationAnalysis {
  const scopeCriteria = extractAcceptanceCriteria(input.context.scope);
  const briefingCriteria = extractAcceptanceCriteria(input.context.briefing ?? "");
  const artifactCriteria = sourceArtifacts.flatMap((artifact) =>
    extractAcceptanceCriteria(artifact.body),
  );
  const directCriteria = Array.from(new Set([...scopeCriteria, ...briefingCriteria]));
  const criteria =
    directCriteria.length > 0 ? directCriteria : Array.from(new Set(artifactCriteria));

  const signals = [
    ...collectEvidenceSignals("briefing", input.context.briefing ?? ""),
    ...sourceArtifacts.flatMap((artifact) =>
      collectEvidenceSignals(`${artifact.record.type}:${artifact.record.id}`, artifact.body),
    ),
  ];

  const checks = criteria.map((criterion) => analyzeCriterion(criterion, signals));
  const blockers =
    checks.length === 0
      ? ["missing acceptance criteria"]
      : checks
          .filter((check) => check.status !== "pass")
          .map((check) =>
            check.status === "fail"
              ? `failed acceptance criterion: ${check.criterion}`
              : `missing evidence for acceptance criterion: ${check.criterion}`,
          );

  return {
    readiness: blockers.length === 0 ? "ready_for_review" : "blocked",
    checks,
    blockers,
    sourceArtifacts: [...sourceArtifacts],
  };
}

function statusSummary(checks: readonly QaAcceptanceCheck[]): Record<QaAcceptanceStatus, number> {
  return checks.reduce<Record<QaAcceptanceStatus, number>>(
    (summary, check) => {
      summary[check.status] += 1;
      return summary;
    },
    { pass: 0, fail: 0, unknown: 0 },
  );
}

function sourceArtifactMarkdown(artifacts: readonly QaSourceArtifact[]): string {
  if (artifacts.length === 0) return "- No prior run artifacts were available to QA.";
  return artifacts.map((artifact) => `- ${artifact.record.type}: ${artifact.record.id}`).join("\n");
}

function checksMarkdown(checks: readonly QaAcceptanceCheck[]): string {
  if (checks.length === 0) return "- No acceptance criteria found.";
  return checks
    .map(
      (check, index) => `### Criterion ${index + 1}

- Status: ${check.status}
- Criterion: ${check.criterion}
- Evidence: ${check.evidence}
- Recommendation: ${check.recommendation}`,
    )
    .join("\n\n");
}

function reportBody(input: AgentRunInput, analysis: QaVerificationAnalysis): string {
  const summary = statusSummary(analysis.checks);
  return `# QA Verification Report

## Scope

${input.context.scope}

## Produced Artifacts Reviewed

${sourceArtifactMarkdown(analysis.sourceArtifacts)}

## Acceptance Criteria Verification

${checksMarkdown(analysis.checks)}

## Summary

- Pass: ${summary.pass}
- Fail: ${summary.fail}
- Unknown: ${summary.unknown}
- Readiness: ${analysis.readiness}

## Ready-For-Review Gate

${
  analysis.blockers.length === 0
    ? "Ready-for-review is allowed by QA evidence."
    : `Ready-for-review is blocked:\n\n${analysis.blockers.map((blocker) => `- ${blocker}`).join("\n")}`
}
`;
}

/**
 * QA agent.
 *
 * Verifies acceptance criteria against explicit briefing and artifact
 * evidence before allowing ready-for-review.
 */
export class QaAgent implements AgentRuntime {
  public readonly definition = AGENT_INDEX.get("qa")!;

  constructor(private readonly deps: AgentDeps) {}

  async execute(input: AgentRunInput): Promise<AgentRunOutput> {
    const handoff = await validateRequiredHandoff(input, this.deps, this.definition.id);
    if (!handoff.ok) return blockedByInvalidHandoff(handoff);

    const sourceArtifacts = await Promise.all(
      (await this.deps.artifacts.list({ run_id: input.context.runId })).map(async (record) => ({
        record,
        body: (await this.deps.artifacts.read(record.id))?.body ?? "",
      })),
    );
    const analysis = analyzeQaVerification(input, sourceArtifacts);
    const summary = statusSummary(analysis.checks);
    // The deterministic acceptance verification drives readiness, blockers, and
    // metadata. The provider, when configured, only enriches the narrative; with
    // no provider the body is the deterministic report, unchanged.
    const draft = await draftAgentArtifact({
      input,
      definition: this.definition,
      artifactTitle: "QA Verification Report",
      outputInstructions:
        "Explain the acceptance-criteria verification, the supporting evidence, and the ready-for-review gate. Do not mark work ready unless the evidence supports it.",
      templateBody: reportBody(input, analysis),
    });
    const artifact = await this.deps.artifacts.write({
      type: "test-plan",
      createdBy: this.definition.id,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      metadata: {
        qa_readiness: analysis.readiness,
        acceptance_criteria_total: analysis.checks.length,
        acceptance_pass_count: summary.pass,
        acceptance_fail_count: summary.fail,
        acceptance_unknown_count: summary.unknown,
        source_artifact_ids: analysis.sourceArtifacts.map((artifact) => artifact.record.id),
      },
      body: draft.body,
    });
    await this.deps.audit.append({
      actor: this.definition.id,
      action: "agent.qa.executed",
      target: input.context.runId,
      artifact_id: artifact.id,
      ...(draft.capability ? { capability: draft.capability } : {}),
      ...(draft.error ? { error: draft.error } : {}),
      result: analysis.readiness === "ready_for_review" ? "ok" : "error",
    });

    // When the dispatch provisioned a code worktree (SER-243), QA runs the
    // project's REAL test suite against the code the development agent wrote and
    // gates the handoff on the result (SER-240). With no worktree (non-code
    // runs) the deterministic acceptance path below is unchanged.
    const testGate = await this.runProjectTests(input);

    const decisions = [`qa:${analysis.readiness}`];
    if (testGate) decisions.push(`qa:tests_${testGate.result.status}`);

    const artifactIds = [artifact.id];
    if (testGate) artifactIds.push(testGate.result.artifact.id);

    const blockers = [...analysis.blockers, ...(testGate?.blockers ?? [])];
    const ok = analysis.readiness === "ready_for_review" && (testGate?.passed ?? true);

    return {
      ok,
      artifactIds,
      decisions,
      blockers,
      notes: qaNotes(analysis, testGate),
    };
  }

  /**
   * Runs the project's real test suite in the development worktree and maps the
   * runner result onto the ready-for-review gate. Returns `undefined` when no
   * code worktree is supplied, leaving today's acceptance-only path unchanged.
   */
  private async runProjectTests(input: AgentRunInput): Promise<TestGate | undefined> {
    const workspaceRoot = input.context.codeWorkspaceRoot;
    if (!workspaceRoot) return undefined;

    const factory = this.deps.projectTestRunnerFactory ?? defaultProjectTestRunnerFactory;
    const runner = factory(workspaceRoot, {
      artifacts: this.deps.artifacts,
      audit: this.deps.audit,
    });
    const result = await runner.run({
      runId: input.context.runId,
      createdBy: this.definition.id,
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
    });

    const passed = result.status === "passed";
    const blockers = passed ? [] : [testGateBlocker(result)];
    await this.deps.audit.append({
      actor: this.definition.id,
      action: "agent.qa.tests_gated",
      target: input.context.runId,
      artifact_id: result.artifact.id,
      result: passed ? "ok" : "error",
    });
    return { result, passed, blockers };
  }
}

interface TestGate {
  result: ProjectTestRunnerResult;
  passed: boolean;
  blockers: string[];
}

function testGateBlocker(result: ProjectTestRunnerResult): string {
  if (result.status === "blocked") {
    return result.reason ?? "no project test command configured or discovered";
  }
  return "project tests failed";
}

function qaNotes(analysis: QaVerificationAnalysis, testGate: TestGate | undefined): string {
  const acceptanceNote =
    analysis.readiness === "ready_for_review"
      ? "qa verification passed all acceptance criteria"
      : `qa verification blocked ready-for-review with ${analysis.blockers.length} blocker(s)`;
  if (!testGate) return acceptanceNote;
  const testNote = testGate.passed
    ? "project tests passed"
    : `project tests gate blocked ready-for-review (${testGate.result.status})`;
  return `${acceptanceNote}; ${testNote}`;
}
