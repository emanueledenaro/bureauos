import type { ArtifactRecord } from "../../artifacts/store.js";
import type { AgentDeps, AgentRunInput, AgentRunOutput, AgentRuntime } from "../runtime.js";
import { AGENT_INDEX } from "../roles.js";
import { blockedByInvalidHandoff, validateRequiredHandoff } from "../handoff.js";

export type SecurityRiskLevel = "low" | "medium" | "high" | "critical";
export type SecurityFindingStatus = "unresolved" | "mitigated";

export interface SecuritySourceArtifact {
  record: ArtifactRecord;
  body: string;
}

export interface SecurityFinding {
  severity: SecurityRiskLevel;
  status: SecurityFindingStatus;
  category: "auth" | "payment" | "secret" | "data_exposure" | "production";
  fileOrArea: string;
  rationale: string;
  requiredMitigation: string;
  evidence: string;
}

export interface SecurityAnalysis {
  riskLevel: SecurityRiskLevel;
  findings: SecurityFinding[];
  blockers: string[];
  reviewedFiles: string[];
  sourceArtifacts: SecuritySourceArtifact[];
}

const RISK_ORDER: Record<SecurityRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const SECURITY_CATEGORIES: Array<{
  category: SecurityFinding["category"];
  severity: SecurityRiskLevel;
  pattern: RegExp;
  rationale: string;
  mitigation: string;
}> = [
  {
    category: "secret",
    severity: "critical",
    pattern:
      /\b(secret|secrets|credential|credentials|token|tokens|api[-_]?key|apikey|keychain|\.env)\b/i,
    rationale: "The change touches secret, credential, token, or environment handling.",
    mitigation:
      "Prove secrets are never logged or committed, remain encrypted or delegated to the credential store, and include rotation guidance.",
  },
  {
    category: "payment",
    severity: "high",
    pattern:
      /\b(stripe|payment|payments|billing|checkout|invoice|subscription|price|pricing|webhook)\b/i,
    rationale: "The change touches payment, billing, price, or webhook behavior.",
    mitigation:
      "Attach payment/webhook tests, idempotency checks, permission checks, and owner-visible approval for billing mutations.",
  },
  {
    category: "auth",
    severity: "high",
    pattern: /\b(auth|oauth|login|session|jwt|permission|permissions|rbac|acl|authorization)\b/i,
    rationale:
      "The change touches authentication, session, permission, or authorization boundaries.",
    mitigation:
      "Attach authz/authn regression tests, denial-path coverage, and evidence that no bypass or privilege escalation was introduced.",
  },
  {
    category: "production",
    severity: "high",
    pattern: /\b(production|deploy|deployment|release|migration|schema|database|destructive)\b/i,
    rationale:
      "The change touches production, deployment, migration, schema, or destructive-operation risk.",
    mitigation:
      "Attach rollback notes, dry-run or migration evidence, and keep deploy/merge behind explicit policy approval.",
  },
  {
    category: "data_exposure",
    severity: "medium",
    pattern:
      /\b(pii|personal|privacy|email|phone|address|customer|client|profile|export|public|memory)\b/i,
    rationale: "The change touches client, customer, personal, public, or memory data surfaces.",
    mitigation:
      "Attach redaction, access-control, and data-minimization evidence before treating the change as externally safe.",
  },
];

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function changedFiles(text: string): string[] {
  return Array.from(
    new Set(
      lines(text)
        .map((line) => {
          const labelled = /(?:changed file|file|path):\s*([^\s,]+)/i.exec(line);
          if (labelled?.[1]) return labelled[1];
          const bullet = /^[-*]\s+([^\s]+\.(?:ts|tsx|js|jsx|py|md|yml|yaml|json|sql|env))\b/i.exec(
            line,
          );
          return bullet?.[1] ?? "";
        })
        .filter(Boolean),
    ),
  );
}

function secretMaterialEvidence(text: string): string[] {
  return lines(text).filter((line) =>
    /\b(sk-[A-Za-z0-9_-]{8,}|password\s*=|api[_-]?key\s*=|secret\s*=|token\s*=)/i.test(line),
  );
}

function mitigationMatched(
  text: string,
  category: SecurityFinding["category"],
  file: string,
): boolean {
  const safeCategory = category.replace("_", "[-_ ]?");
  const escapedFile = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:security pass|mitigated|mitigation verified):.*(?:${safeCategory}|${escapedFile})`,
    "i",
  ).test(text);
}

function maxRisk(findings: readonly SecurityFinding[]): SecurityRiskLevel {
  return findings.reduce<SecurityRiskLevel>(
    (current, finding) =>
      RISK_ORDER[finding.severity] > RISK_ORDER[current] ? finding.severity : current,
    "low",
  );
}

function findingForFile(
  file: string,
  category: (typeof SECURITY_CATEGORIES)[number],
  text: string,
): SecurityFinding {
  return {
    severity: category.severity,
    status: mitigationMatched(text, category.category, file) ? "mitigated" : "unresolved",
    category: category.category,
    fileOrArea: file,
    rationale: category.rationale,
    requiredMitigation: category.mitigation,
    evidence: `Sensitive path match: ${file}`,
  };
}

export function analyzeSecurityInput(
  input: AgentRunInput,
  sourceArtifacts: readonly SecuritySourceArtifact[] = [],
): SecurityAnalysis {
  const combined = [
    input.context.scope,
    input.context.briefing ?? "",
    ...sourceArtifacts.map((artifact) => artifact.body),
  ].join("\n");
  const files = changedFiles(combined);
  const findings: SecurityFinding[] = [];

  for (const file of files) {
    for (const category of SECURITY_CATEGORIES) {
      if (category.pattern.test(file)) {
        findings.push(findingForFile(file, category, combined));
      }
    }
  }

  for (const evidence of secretMaterialEvidence(combined)) {
    findings.push({
      severity: "critical",
      status: mitigationMatched(combined, "secret", "inline secret material")
        ? "mitigated"
        : "unresolved",
      category: "secret",
      fileOrArea: "inline secret material",
      rationale: "The review packet appears to contain secret-looking material.",
      requiredMitigation:
        "Remove the secret from artifacts/logs, rotate it if real, and store future credentials through the provider auth store.",
      evidence,
    });
  }

  const blockers = findings
    .filter(
      (finding) =>
        finding.status === "unresolved" &&
        (finding.severity === "high" || finding.severity === "critical"),
    )
    .map(
      (finding) =>
        `unresolved ${finding.severity} security finding in ${finding.fileOrArea}: ${finding.category}`,
    );

  return {
    riskLevel: maxRisk(findings),
    findings,
    blockers,
    reviewedFiles: files,
    sourceArtifacts: [...sourceArtifacts],
  };
}

function sourceArtifactMarkdown(artifacts: readonly SecuritySourceArtifact[]): string {
  if (artifacts.length === 0) return "- No prior run artifacts were available to security review.";
  return artifacts.map((artifact) => `- ${artifact.record.type}: ${artifact.record.id}`).join("\n");
}

function reviewedFilesMarkdown(files: readonly string[]): string {
  if (files.length === 0) return "- No changed files were supplied in the review packet.";
  return files.map((file) => `- ${file}`).join("\n");
}

function findingsMarkdown(findings: readonly SecurityFinding[]): string {
  if (findings.length === 0) return "- No structured security findings.";
  return findings
    .map(
      (finding, index) => `### Finding ${index + 1}

- Severity: ${finding.severity}
- Status: ${finding.status}
- Category: ${finding.category}
- File/area: ${finding.fileOrArea}
- Rationale: ${finding.rationale}
- Evidence: ${finding.evidence}
- Required mitigation: ${finding.requiredMitigation}`,
    )
    .join("\n\n");
}

function reportBody(input: AgentRunInput, analysis: SecurityAnalysis): string {
  return `# Security Review

## Scope

${input.context.scope}

## Risk Level

${analysis.riskLevel}

## Produced Artifacts Reviewed

${sourceArtifactMarkdown(analysis.sourceArtifacts)}

## Changed Files Reviewed

${reviewedFilesMarkdown(analysis.reviewedFiles)}

## Structured Findings

${findingsMarkdown(analysis.findings)}

## PR Ready Gate

${
  analysis.blockers.length === 0
    ? "PR ready status is allowed by security review with the residual risk shown above."
    : `PR ready status is blocked:\n\n${analysis.blockers.map((blocker) => `- ${blocker}`).join("\n")}`
}

## Policy Boundary

This review does not approve merge, deploy, billing mutation, secret rotation, or production changes. Those remain separate policy-gated actions.
`;
}

/**
 * Security agent.
 *
 * Reviews risk-sensitive work and blocks PR readiness when high or critical
 * findings do not have explicit mitigation evidence.
 */
export class SecurityAgent implements AgentRuntime {
  public readonly definition = AGENT_INDEX.get("security")!;

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
    const analysis = analyzeSecurityInput(input, sourceArtifacts);
    const unresolvedHighRisk = analysis.findings.filter(
      (finding) =>
        finding.status === "unresolved" &&
        (finding.severity === "high" || finding.severity === "critical"),
    );
    const artifact = await this.deps.artifacts.write({
      type: "security-review",
      createdBy: this.definition.id,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      metadata: {
        risk_level: analysis.riskLevel,
        finding_count: analysis.findings.length,
        finding_severities: analysis.findings.map((finding) => finding.severity),
        unresolved_high_risk_count: unresolvedHighRisk.length,
        reviewed_files: analysis.reviewedFiles,
        source_artifact_ids: analysis.sourceArtifacts.map((artifact) => artifact.record.id),
      },
      body: reportBody(input, analysis),
    });
    await this.deps.audit.append({
      actor: this.definition.id,
      action: "agent.security.executed",
      target: input.context.runId,
      artifact_id: artifact.id,
      result: analysis.blockers.length === 0 ? "ok" : "error",
    });
    return {
      ok: analysis.blockers.length === 0,
      artifactIds: [artifact.id],
      decisions: [
        analysis.blockers.length === 0
          ? `security:${analysis.riskLevel}_risk_ready`
          : "security:blocked",
      ],
      blockers: analysis.blockers,
      notes:
        analysis.blockers.length === 0
          ? `security review completed with ${analysis.findings.length} finding(s)`
          : `security review blocked PR readiness with ${analysis.blockers.length} blocker(s)`,
    };
  }
}
