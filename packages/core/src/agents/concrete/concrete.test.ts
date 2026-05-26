import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  RuntimeAdapter,
  RuntimeContext,
  RuntimeResult,
  RuntimeTask,
} from "@bureauos/providers";
import { ArtifactStore } from "../../artifacts/store.js";
import { AuditLog } from "../../audit/log.js";
import { defaultConfig } from "../../config/loader.js";
import { PolicyEngine } from "../../policy/engine.js";
import { ApprovalRegistry } from "../../registries/approval.js";
import { initWorkspace } from "../../init/initializer.js";
import { workspacePaths } from "../../paths.js";
import type { AgentCapabilityCheckInput } from "../runtime.js";
import { DevelopmentAgent } from "./development.js";
import { buildDefaultAgentRegistry } from "./index.js";
import { QaAgent } from "./qa.js";
import { ReviewerAgent } from "./reviewer.js";
import { SecurityAgent } from "./security.js";

class FakeRuntime implements RuntimeAdapter {
  public readonly id = "codex-test";
  public readonly type = "codex" as const;
  public prepared?: RuntimeContext;
  public executed?: RuntimeTask;

  constructor(private readonly result: RuntimeResult) {}

  canExecute(capability: string): boolean {
    return ["edit_code", "run_tests"].includes(capability);
  }

  async prepare(context: RuntimeContext): Promise<void> {
    this.prepared = context;
  }

  async execute(task: RuntimeTask): Promise<RuntimeResult> {
    this.executed = task;
    return this.result;
  }
}

describe("concrete agents", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-concrete-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("each concrete agent writes the artifact type that matches its role", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const registry = buildDefaultAgentRegistry({ artifacts, audit, policy });

    const expectedArtifactTypes: Record<string, string> = {
      project_manager: "run-report",
      product: "feature-spec",
      development: "technical-plan",
      qa: "test-plan",
      security: "security-review",
      compliance: "compliance-review",
      reviewer: "pr-review",
    };

    for (const [roleId, expectedType] of Object.entries(expectedArtifactTypes)) {
      const agent = registry.get(roleId);
      const context =
        roleId === "qa"
          ? {
              runId: `run_test_${roleId}`,
              scope: "Acceptance criteria:\n- smoke test passes",
              briefing: "PASS: smoke test passes",
            }
          : { runId: `run_test_${roleId}`, scope: "smoke test" };
      const out = await agent.execute({
        context,
        capabilities: new Map(),
      });
      expect(out.ok).toBe(true);
      expect(out.artifactIds.length).toBe(1);
      const written = await artifacts.read(out.artifactIds[0]!);
      expect(written?.record.type).toBe(expectedType);
      expect(written?.record.created_by).toBe(roleId);
    }
  });

  it("every templated agent role writes its signature artifact", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const registry = buildDefaultAgentRegistry({ artifacts, audit, policy });

    const templated: Record<string, string> = {
      supreme_coordinator: "executive-report",
      ux: "design-spec",
      release: "run-report",
      visibility: "brand-brief",
      content: "social-post-brief",
      social: "social-post-brief",
      creative: "creative-brief",
      ads: "ad-campaign-brief",
      marketing: "campaign-brief",
      conversion: "conversion-audit",
      sales: "lead-qualification-report",
      pricing: "pricing-brief",
      proposal: "proposal-brief",
      client_success: "client-account-plan",
    };

    for (const [roleId, expectedType] of Object.entries(templated)) {
      const agent = registry.get(roleId);
      expect(agent.definition.id).toBe(roleId);
      const out = await agent.execute({
        context: { runId: `run_${roleId}`, scope: "stub run" },
        capabilities: new Map(),
      });
      expect(out.ok).toBe(true);
      expect(out.artifactIds.length).toBe(1);
      const written = await artifacts.read(out.artifactIds[0]!);
      expect(written?.record.type).toBe(expectedType);
      expect(written?.record.created_by).toBe(roleId);
    }
  });

  it("makes development template-only fallback explicit when no runtime is supplied", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const agent = new DevelopmentAgent({ artifacts, audit, policy });

    const out = await agent.execute({
      context: { runId: "run_dev", scope: "implement runtime work" },
      capabilities: new Map(),
    });

    expect(out.ok).toBe(true);
    expect(out.artifactIds.length).toBe(1);
    expect(out.decisions).toContain("template_only_fallback");
    expect(out.notes).toContain("template-only fallback");
    const written = await artifacts.read(out.artifactIds[0]!);
    expect(written?.body).toContain("Template-only fallback");
  });

  it("blocks concrete agents when the handoff contract targets another agent", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const handoff = await artifacts.write({
      type: "agent-handoff",
      createdBy: "project_manager",
      runId: "run_wrong_target",
      metadata: {
        source_agent_id: "project_manager",
        target_agent_id: "reviewer",
        run_id: "run_wrong_target",
        scope: "QA should not consume this reviewer packet",
        input_artifact_ids: ["art_packet"],
        expected_output_types: ["pr-review"],
        acceptance_checks: ["Reviewer produces a PR review or blocker."],
      },
      body: "# Agent Handoff",
    });
    const agent = new QaAgent({ artifacts, audit, policy });

    const out = await agent.execute({
      context: {
        runId: "run_wrong_target",
        scope: "Acceptance criteria:\n- handoff target is enforced",
        handoffArtifactId: handoff.id,
      },
      capabilities: new Map(),
    });

    expect(out.ok).toBe(false);
    expect(out.decisions).toContain("handoff:invalid");
    expect(out.blockers).toContain("wrong target_agent_id: expected qa, got reviewer");
    const validation = await artifacts.read(out.artifactIds[0]!);
    expect(validation?.record.type).toBe("agent-handoff-validation");
    expect(validation?.body).toContain("Expected agent: qa");
  });

  it("executes development runtime when codex gates allow", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const gateChecks: AgentCapabilityCheckInput[] = [];
    const runtime = new FakeRuntime({
      ok: true,
      artifacts: ["runtime_artifact"],
      evidence: "pnpm test passed",
      changedFiles: ["packages/core/src/example.ts"],
      commands: ["pnpm test"],
    });
    const agent = new DevelopmentAgent({
      artifacts,
      audit,
      policy,
      capabilityUse: {
        async check(input) {
          gateChecks.push(input);
          const artifact = await artifacts.write({
            type: "capability-audit",
            createdBy: input.agent,
            runId: "run_dev",
            body: `# Gate ${input.action}\n\nAllowed.`,
          });
          return { status: "allowed", artifact };
        },
      },
    });

    const out = await agent.execute({
      context: {
        workspaceRoot: dir,
        runId: "run_dev",
        scope: "implement runtime work",
        projectId: "project_1",
      },
      capabilities: new Map([["codex", runtime]]),
    });

    expect(out.ok).toBe(true);
    expect(gateChecks.map((check) => check.action)).toEqual(["edit_code", "run_tests"]);
    expect(runtime.prepared).toMatchObject({ workspaceRoot: dir, runId: "run_dev" });
    expect(runtime.executed).toMatchObject({
      capability: "edit_code",
      intent: "development_agent_execution",
      scope: "implement runtime work",
    });
    expect(out.artifactIds).toContain("runtime_artifact");
    expect(out.decisions).toContain("runtime_execution");

    const records = await Promise.all(
      out.artifactIds
        .filter((id) => id !== "runtime_artifact")
        .map((id) => artifacts.read(id).then((doc) => doc?.record.type)),
    );
    expect(records).toContain("technical-plan");
    expect(records).toContain("capability-audit");
    expect(records).toContain("run-report");
    expect(records).toContain("test-evidence-report");
    const log = await readAudit(dir);
    expect(log).toContain("agent.development.runtime_executed");
  });

  it("blocks development runtime before execution when capability gates fail", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const runtime = new FakeRuntime({ ok: true, artifacts: [] });
    const agent = new DevelopmentAgent({
      artifacts,
      audit,
      policy,
      capabilityUse: {
        async check(input) {
          const artifact = await artifacts.write({
            type: "capability-audit",
            createdBy: input.agent,
            runId: "run_dev",
            body: `# Gate ${input.action}\n\nBlocked.`,
          });
          return {
            status: "blocked",
            artifact,
            policy: { reason: "missing linked issue" },
          };
        },
      },
    });

    const out = await agent.execute({
      context: { workspaceRoot: dir, runId: "run_dev", scope: "implement runtime work" },
      capabilities: new Map([["codex", runtime]]),
    });

    expect(out.ok).toBe(false);
    expect(out.blockers).toEqual(["missing linked issue"]);
    expect(runtime.executed).toBeUndefined();
    expect(out.decisions).toContain("runtime_blocked");
    const log = await readAudit(dir);
    expect(log).toContain("agent.development.runtime_blocked");
  });

  it("verifies QA acceptance criteria with produced artifact evidence", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    await artifacts.write({
      type: "feature-spec",
      createdBy: "product",
      runId: "run_qa_pass",
      body: [
        "# Feature Spec",
        "",
        "## Acceptance Criteria",
        "",
        "- Coordinator chat hides prompts and thoughts from user-facing replies.",
        "- QA blocks ready-for-review when evidence is missing.",
      ].join("\n"),
    });
    await artifacts.write({
      type: "test-evidence-report",
      createdBy: "development",
      runId: "run_qa_pass",
      body: [
        "# Test Evidence",
        "",
        "PASS: Coordinator chat hides prompts and thoughts from user-facing replies.",
        "PASS: QA blocks ready-for-review when evidence is missing.",
      ].join("\n"),
    });
    const agent = new QaAgent({ artifacts, audit, policy });

    const out = await agent.execute({
      context: {
        runId: "run_qa_pass",
        scope: [
          "SER-31: Wire QA Agent",
          "",
          "Acceptance criteria:",
          "- Coordinator chat hides prompts and thoughts from user-facing replies.",
          "- QA blocks ready-for-review when evidence is missing.",
        ].join("\n"),
      },
      capabilities: new Map(),
    });

    expect(out.ok).toBe(true);
    expect(out.decisions).toContain("qa:ready_for_review");
    expect(out.blockers).toEqual([]);
    const written = await artifacts.read(out.artifactIds[0]!);
    expect(written?.record.type).toBe("test-plan");
    expect(written?.record.qa_readiness).toBe("ready_for_review");
    expect(written?.record.acceptance_pass_count).toBe(2);
    expect(written?.record.acceptance_fail_count).toBe(0);
    expect(written?.record.acceptance_unknown_count).toBe(0);
    expect(written?.record.source_artifact_ids).toHaveLength(2);
    expect(written?.body).toContain("QA Verification Report");
    expect(written?.body).toContain("Produced Artifacts Reviewed");
    expect(written?.body).toContain("Status: pass");
    expect(written?.body).toContain("Ready-for-review is allowed by QA evidence.");
  });

  it("blocks QA readiness when acceptance evidence fails or is missing", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    await artifacts.write({
      type: "test-evidence-report",
      createdBy: "development",
      runId: "run_qa_fail",
      body: ["# Test Evidence", "", "FAIL: Missing evidence blocks ready-for-review status."].join(
        "\n",
      ),
    });
    const agent = new QaAgent({ artifacts, audit, policy });

    const out = await agent.execute({
      context: {
        runId: "run_qa_fail",
        scope: [
          "Acceptance criteria:",
          "- Missing evidence blocks ready-for-review status.",
          "- QA writes verification report with pass/fail/unknown items.",
        ].join("\n"),
      },
      capabilities: new Map(),
    });

    expect(out.ok).toBe(false);
    expect(out.decisions).toContain("qa:blocked");
    expect(out.blockers).toEqual([
      "failed acceptance criterion: Missing evidence blocks ready-for-review status.",
      "missing evidence for acceptance criterion: QA writes verification report with pass/fail/unknown items.",
    ]);
    const written = await artifacts.read(out.artifactIds[0]!);
    expect(written?.record.qa_readiness).toBe("blocked");
    expect(written?.record.acceptance_pass_count).toBe(0);
    expect(written?.record.acceptance_fail_count).toBe(1);
    expect(written?.record.acceptance_unknown_count).toBe(1);
    expect(written?.body).toContain("Status: fail");
    expect(written?.body).toContain("Status: unknown");
    expect(written?.body).toContain("Ready-for-review is blocked");
  });

  it("flags auth payment and secrets paths in security review", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    await artifacts.write({
      type: "technical-plan",
      createdBy: "development",
      runId: "run_security_sensitive",
      body: [
        "# Runtime Diff",
        "",
        "Changed files:",
        "- packages/core/src/auth/oauth-callback.ts",
        "- packages/core/src/payments/stripe-webhook.ts",
        "- packages/core/src/config/secrets.ts",
      ].join("\n"),
    });
    const agent = new SecurityAgent({ artifacts, audit, policy });

    const out = await agent.execute({
      context: {
        runId: "run_security_sensitive",
        scope: "Review security-sensitive runtime changes before PR readiness.",
      },
      capabilities: new Map(),
    });

    expect(out.ok).toBe(false);
    expect(out.decisions).toContain("security:blocked");
    expect(out.blockers).toEqual([
      "unresolved high security finding in packages/core/src/auth/oauth-callback.ts: auth",
      "unresolved high security finding in packages/core/src/payments/stripe-webhook.ts: payment",
      "unresolved critical security finding in packages/core/src/config/secrets.ts: secret",
    ]);

    const written = await artifacts.read(out.artifactIds[0]!);
    expect(written?.record.type).toBe("security-review");
    expect(written?.record.risk_level).toBe("critical");
    expect(written?.record.finding_count).toBe(3);
    expect(written?.record.unresolved_high_risk_count).toBe(3);
    expect(written?.record.finding_severities).toEqual(["high", "high", "critical"]);
    expect(written?.record.source_artifact_ids).toHaveLength(1);
    expect(written?.body).toContain("Severity: critical");
    expect(written?.body).toContain("Category: secret");
    expect(written?.body).toContain("Required mitigation:");
    expect(written?.body).toContain("PR ready status is blocked");
  });

  it("allows security readiness when sensitive findings are mitigated", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const agent = new SecurityAgent({ artifacts, audit, policy });

    const out = await agent.execute({
      context: {
        runId: "run_security_mitigated",
        scope: "Review auth change.",
        briefing: [
          "Changed files:",
          "- packages/core/src/auth/session.ts",
          "SECURITY PASS: auth packages/core/src/auth/session.ts has denial-path tests.",
        ].join("\n"),
      },
      capabilities: new Map(),
    });

    expect(out.ok).toBe(true);
    expect(out.decisions).toContain("security:high_risk_ready");
    expect(out.blockers).toEqual([]);
    const written = await artifacts.read(out.artifactIds[0]!);
    expect(written?.record.risk_level).toBe("high");
    expect(written?.record.finding_count).toBe(1);
    expect(written?.record.unresolved_high_risk_count).toBe(0);
    expect(written?.body).toContain("Status: mitigated");
    expect(written?.body).toContain("PR ready status is allowed");
  });

  it("writes structured reviewer findings from diff and test artifacts", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const agent = new ReviewerAgent({ artifacts, audit, policy });

    const out = await agent.execute({
      context: {
        runId: "run_review",
        scope: "Review PR for auth callback changes",
        briefing: [
          "Changed files:",
          "- packages/core/src/auth/oauth-callback.ts",
          "Test evidence: (none)",
          "Diff note: TODO remove temporary console.log before merge.",
        ].join("\n"),
      },
      capabilities: new Map(),
    });

    expect(out.ok).toBe(false);
    expect(out.decisions).toContain("review:changes_requested");
    expect(out.blockers).toContain(
      "The diff touches sensitive auth, secret, payment, billing, or security surface.",
    );

    const written = await artifacts.read(out.artifactIds[0]!);
    expect(written?.record.type).toBe("pr-review");
    expect(written?.record.finding_count).toBe(3);
    expect(written?.record.finding_severities).toEqual(["medium", "high", "low"]);
    expect(written?.record.comment_capabilities).toEqual(["github.comment", "linear.comment"]);
    expect(written?.body).toContain("Severity: high");
    expect(written?.body).toContain("File/area: packages/core/src/auth/oauth-callback.ts");
    expect(written?.body).toContain("Rationale:");
    expect(written?.body).toContain("Recommendation:");
    expect(written?.body).toContain("github.comment");
    expect(written?.body).toContain("linear.comment");
  });

  it("states residual risks when reviewer finds no issues", async () => {
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const artifacts = new ArtifactStore(dir);
    const policy = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const agent = new ReviewerAgent({ artifacts, audit, policy });

    const out = await agent.execute({
      context: {
        runId: "run_clean_review",
        scope: "Review PR for timeline copy update",
        briefing: [
          "Changed files:",
          "- packages/interface/src/renderer/views/TimelineView.tsx",
          "Test evidence: pnpm --filter @bureauos/interface test passed",
        ].join("\n"),
      },
      capabilities: new Map(),
    });

    expect(out.ok).toBe(true);
    expect(out.decisions).toContain("review:approve_with_residual_risk");
    expect(out.blockers).toEqual([]);
    expect(out.notes).toContain("explicit residual risks");

    const written = await artifacts.read(out.artifactIds[0]!);
    expect(written?.record.finding_count).toBe(0);
    expect(written?.body).toContain("No structured findings");
    expect(written?.body).toContain("Residual Risks");
    expect(written?.body).toContain(
      "Merge and deployment still require separate policy-gated approval",
    );
  });
});

async function readAudit(dir: string): Promise<string> {
  return readFile(workspacePaths(dir).auditLog, "utf8");
}
