import type { AgentDeps, AgentRunInput, AgentRunOutput, AgentRuntime } from "../runtime.js";
import { AGENT_INDEX } from "../roles.js";
import { blockedByInvalidHandoff, validateRequiredHandoff } from "../handoff.js";

export type ReviewFindingSeverity = "low" | "medium" | "high" | "critical";

export interface ReviewFinding {
  severity: ReviewFindingSeverity;
  fileOrArea: string;
  rationale: string;
  recommendation: string;
}

export interface ReviewAnalysis {
  findings: ReviewFinding[];
  residualRisks: string[];
  recommendation: "approve_with_residual_risk" | "changes_requested";
}

const SENSITIVE_PATH = /\b(auth|oauth|token|secret|credential|payment|billing|security)\b/i;

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function changedFiles(text: string): string[] {
  return lines(text)
    .map((line) => {
      const changed = /(?:changed file|file|path):\s*([^\s,]+)/i.exec(line);
      if (changed?.[1]) return changed[1];
      const bullet = /^[-*]\s+([^\s]+\.(?:ts|tsx|js|jsx|py|md|yml|yaml|json))\b/i.exec(line);
      return bullet?.[1] ?? "";
    })
    .filter(Boolean);
}

function hasTestEvidence(text: string): boolean {
  const lower = text.toLowerCase();
  if (/(test evidence|tests?|verification):\s*(\(none\)|none|missing|not run|failed)/i.test(text)) {
    return false;
  }
  return /\b(test evidence|tests passed|pnpm test|vitest|playwright|verification passed)\b/i.test(
    lower,
  );
}

export function analyzeReviewInput(input: AgentRunInput): ReviewAnalysis {
  const combined = `${input.context.scope}\n${input.context.briefing ?? ""}`;
  const files = changedFiles(combined);
  const findings: ReviewFinding[] = [];

  if (files.length > 0 && !hasTestEvidence(combined)) {
    findings.push({
      severity: "medium",
      fileOrArea: "verification",
      rationale: "No passing test or verification evidence was provided with the review packet.",
      recommendation:
        "Attach focused test output or mark the work blocked before requesting PR readiness.",
    });
  }

  const sensitive = files.find((file) => SENSITIVE_PATH.test(file));
  if (sensitive) {
    findings.push({
      severity: "high",
      fileOrArea: sensitive,
      rationale: "The diff touches sensitive auth, secret, payment, billing, or security surface.",
      recommendation:
        "Require security review evidence and owner-visible approval before treating the PR as ready.",
    });
  }

  if (/console\.log\s*\(|debugger\b|TODO\b/i.test(combined)) {
    findings.push({
      severity: "low",
      fileOrArea: "diff hygiene",
      rationale: "The review packet contains debug or unfinished-work markers.",
      recommendation: "Remove debug statements or convert TODOs into tracked follow-up issues.",
    });
  }

  return {
    findings,
    residualRisks:
      findings.length === 0
        ? [
            "Review is limited to the supplied scope, diff summary, and test artifacts.",
            "Live external services, production data, and deployed behavior were not inspected by this reviewer.",
            "Merge and deployment still require separate policy-gated approval.",
          ]
        : [
            "Additional issues may exist outside the supplied diff and artifacts.",
            "Passing tests alone should not override unresolved findings.",
          ],
    recommendation: findings.length === 0 ? "approve_with_residual_risk" : "changes_requested",
  };
}

function findingsMarkdown(findings: readonly ReviewFinding[]): string {
  if (findings.length === 0) return "- No structured findings.";
  return findings
    .map(
      (finding, index) => `### Finding ${index + 1}

- Severity: ${finding.severity}
- File/area: ${finding.fileOrArea}
- Rationale: ${finding.rationale}
- Recommendation: ${finding.recommendation}`,
    )
    .join("\n\n");
}

function body(input: AgentRunInput, analysis: ReviewAnalysis): string {
  return `# PR Review

## Scope

${input.context.scope}

## Structured Findings

${findingsMarkdown(analysis.findings)}

## Residual Risks

${analysis.residualRisks.map((risk) => `- ${risk}`).join("\n")}

## Recommendation

${analysis.recommendation}

## Comment Boundary

This report can be posted to GitHub or Linear only through policy-gated comment capabilities such as \`github.comment\` or \`linear.comment\`. It is not a merge, deploy, or external publication approval.
`;
}

export class ReviewerAgent implements AgentRuntime {
  public readonly definition = AGENT_INDEX.get("reviewer")!;

  constructor(private readonly deps: AgentDeps) {}

  async execute(input: AgentRunInput): Promise<AgentRunOutput> {
    const handoff = await validateRequiredHandoff(input, this.deps, this.definition.id);
    if (!handoff.ok) return blockedByInvalidHandoff(handoff);

    const analysis = analyzeReviewInput(input);
    const artifact = await this.deps.artifacts.write({
      type: "pr-review",
      createdBy: this.definition.id,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      metadata: {
        finding_count: analysis.findings.length,
        finding_severities: analysis.findings.map((finding) => finding.severity),
        recommendation: analysis.recommendation,
        comment_capabilities: ["github.comment", "linear.comment"],
      },
      body: body(input, analysis),
    });
    await this.deps.audit.append({
      actor: this.definition.id,
      action: "agent.reviewer.executed",
      target: input.context.runId,
      artifact_id: artifact.id,
      result: "ok",
    });
    return {
      ok: analysis.findings.every((finding) => finding.severity === "low"),
      artifactIds: [artifact.id],
      decisions: [`review:${analysis.recommendation}`],
      blockers: analysis.findings
        .filter((finding) => finding.severity === "high" || finding.severity === "critical")
        .map((finding) => finding.rationale),
      notes:
        analysis.findings.length === 0
          ? "review completed with explicit residual risks"
          : `review completed with ${analysis.findings.length} structured finding(s)`,
    };
  }
}
