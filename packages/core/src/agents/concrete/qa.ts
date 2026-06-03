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

const TEST_DEPENDENT_CRITERION =
  /\b(tests?|testing|coverage|covered|verifiable|verify|verified|verification)\b/i;

/**
 * A criterion is test-dependent when its evidence can only come from running an
 * automated test suite (e.g. "Tests cover at least one happy path and one edge
 * case", "Behavior described in the briefing is implemented and verifiable").
 * Used by the opt-in no-test-infra soft-pass to decide which acceptance
 * criteria may pass WITHOUT test evidence when the project genuinely has no
 * tests to run. Criteria with explicit fail evidence are never soft-passed.
 */
function isTestDependentCriterion(criterion: string): boolean {
  return TEST_DEPENDENT_CRITERION.test(criterion);
}

/**
 * Decide whether the opt-in no-test-infra soft-pass applies, and which
 * acceptance criteria it covers.
 *
 * It applies ONLY when (a) the owner enabled `allow_missing_tests`, (b) a test
 * gate actually ran (a code worktree existed), and (c) the runner returned
 * `blocked` — the genuine "no project test command configured or discovered"
 * case, NOT `failed`. When tests EXIST and FAIL, this returns
 * `{ applies:false }` so the run still blocks. The soft-passed criteria are the
 * test-DEPENDENT ones with no evidence (`unknown`); explicitly failed criteria
 * and non-test criteria are left untouched so they still block.
 */
function noTestInfraSoftPass(
  allowMissingTests: boolean | undefined,
  analysis: QaVerificationAnalysis,
  testGate: TestGate | undefined,
): { applies: boolean; criteria: readonly string[] } {
  if (!allowMissingTests || !testGate || testGate.result.status !== "blocked") {
    return { applies: false, criteria: [] };
  }
  const criteria = analysis.checks
    .filter((check) => check.status === "unknown" && isTestDependentCriterion(check.criterion))
    .map((check) => check.criterion);
  return { applies: true, criteria };
}

/**
 * Acceptance blockers that survive a no-test-infra soft-pass: every blocker
 * except the "missing evidence" lines for the soft-passed test-dependent
 * criteria. Failed criteria and non-test "missing evidence" criteria still
 * block. Mirrors the blocker phrasing produced by {@link analyzeQaVerification}.
 */
function acceptanceBlockersAfterSoftPass(
  analysis: QaVerificationAnalysis,
  softPassedCriteria: readonly string[],
): string[] {
  const softPassed = new Set(softPassedCriteria);
  return analysis.blockers.filter(
    (blocker) => !softPassed.has(blocker.replace(/^missing evidence for acceptance criterion: /, "")),
  );
}

function reportBody(
  input: AgentRunInput,
  analysis: QaVerificationAnalysis,
  softPassedCriteria: readonly string[] = [],
): string {
  const summary = statusSummary(analysis.checks);
  const softPassNote =
    softPassedCriteria.length > 0
      ? `
## No-Test Soft-Pass

This is a static deliverable with NO automated tests for QA to run
(\`runtime.codex.allow_missing_tests\` is enabled). The following test-dependent
acceptance criteria were soft-passed WITHOUT test evidence; manual review is
recommended before relying on them:

${softPassedCriteria.map((criterion) => `- ${criterion}`).join("\n")}
`
      : "";
  return `# QA Verification Report

## Scope

${input.context.scope}

## Produced Artifacts Reviewed

${sourceArtifactMarkdown(analysis.sourceArtifacts)}

## Acceptance Criteria Verification

${checksMarkdown(analysis.checks)}
${softPassNote}
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

    // When the dispatch provisioned a code worktree (SER-243), QA runs the
    // project's REAL test suite against the code the development agent wrote and
    // gates the handoff on the result (SER-240). With no worktree (non-code
    // runs) the deterministic acceptance path below is unchanged. Run it BEFORE
    // writing the artifact so the no-test soft-pass decision (below) can be
    // recorded in the report body.
    const testGate = await this.runProjectTests(input);

    // Opt-in soft-pass for a test-less static deliverable. Applies ONLY when the
    // owner enabled the flag AND the runner returned `blocked` (no test command
    // discovered) — NOT when tests exist and fail. It drops the missing-test
    // gate and the test-dependent "missing evidence" acceptance blockers so the
    // run can complete; everything else still blocks (SER bugfix).
    const softPass = noTestInfraSoftPass(this.deps.allowMissingTests, analysis, testGate);
    const acceptanceBlockers = softPass.applies
      ? acceptanceBlockersAfterSoftPass(analysis, softPass.criteria)
      : analysis.blockers;
    // The test gate is a blocker only when tests ran and were not satisfied AND
    // the soft-pass does not cover this no-test-infra case.
    const testBlockers = softPass.applies ? [] : (testGate?.blockers ?? []);

    // The deterministic acceptance verification drives readiness, blockers, and
    // metadata. The provider, when configured, only enriches the narrative; with
    // no provider the body is the deterministic report, unchanged.
    const draft = await draftAgentArtifact({
      input,
      definition: this.definition,
      artifactTitle: "QA Verification Report",
      outputInstructions:
        "Explain the acceptance-criteria verification, the supporting evidence, and the ready-for-review gate. Do not mark work ready unless the evidence supports it.",
      templateBody: reportBody(input, analysis, softPass.criteria),
    });
    const readyForReview = acceptanceBlockers.length === 0 && testBlockers.length === 0;
    const artifact = await this.deps.artifacts.write({
      type: "test-plan",
      createdBy: this.definition.id,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      metadata: {
        qa_readiness: readyForReview ? "ready_for_review" : "blocked",
        acceptance_criteria_total: analysis.checks.length,
        acceptance_pass_count: summary.pass,
        acceptance_fail_count: summary.fail,
        acceptance_unknown_count: summary.unknown,
        source_artifact_ids: analysis.sourceArtifacts.map((artifact) => artifact.record.id),
        ...(softPass.applies
          ? {
              no_test_soft_pass: true,
              no_test_soft_passed_criteria: [...softPass.criteria],
            }
          : {}),
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
      result: readyForReview ? "ok" : "error",
    });

    // Record the soft-pass as its own traceable audit line so the relaxed gate
    // is always inspectable: which run, which test-dependent criteria passed
    // without test evidence, and that it was driven by the opt-in flag.
    if (softPass.applies) {
      await this.deps.audit.append({
        actor: this.definition.id,
        action: "agent.qa.soft_passed_no_tests",
        target: input.context.runId,
        artifact_id: artifact.id,
        ...(testGate?.result.reason ? { error: testGate.result.reason } : {}),
        result: "ok",
      });
    }

    // Gate-decision audit: a non-passing test result blocks UNLESS the soft-pass
    // covered a no-test-infra case. `passed` -> ok; soft-passed -> ok; otherwise
    // (real failure, or no flag) -> error.
    if (testGate) {
      await this.deps.audit.append({
        actor: this.definition.id,
        action: "agent.qa.tests_gated",
        target: input.context.runId,
        artifact_id: testGate.result.artifact.id,
        result: testGate.passed || softPass.applies ? "ok" : "error",
      });
    }

    const decisions = [`qa:${readyForReview ? "ready_for_review" : "blocked"}`];
    if (testGate) {
      decisions.push(softPass.applies ? "qa:tests_soft_passed_no_tests" : `qa:tests_${testGate.result.status}`);
    }

    const artifactIds = [artifact.id];
    if (testGate) artifactIds.push(testGate.result.artifact.id);

    const blockers = [...acceptanceBlockers, ...testBlockers];
    const ok = readyForReview;

    return {
      ok,
      artifactIds,
      decisions,
      blockers,
      notes: qaNotes(analysis, testGate, softPass.applies),
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
    // The gate-decision audit (`agent.qa.tests_gated`) is appended by the caller
    // (`execute`) instead of here, because whether a non-passing result actually
    // BLOCKS depends on the no-test soft-pass decision, which `execute` owns. The
    // test runner has already appended its own `execution.tests.*` evidence line.
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

function qaNotes(
  analysis: QaVerificationAnalysis,
  testGate: TestGate | undefined,
  softPassed: boolean,
): string {
  const acceptanceNote =
    analysis.readiness === "ready_for_review"
      ? "qa verification passed all acceptance criteria"
      : `qa verification blocked ready-for-review with ${analysis.blockers.length} blocker(s)`;
  if (!testGate) return acceptanceNote;
  if (softPassed) {
    return `${acceptanceNote}; no automated tests for this static deliverable — soft-passed, manual review recommended`;
  }
  const testNote = testGate.passed
    ? "project tests passed"
    : `project tests gate blocked ready-for-review (${testGate.result.status})`;
  return `${acceptanceNote}; ${testNote}`;
}
