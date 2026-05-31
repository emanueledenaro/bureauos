import type { RuntimeAdapter, RuntimeResult } from "@bureauos/providers";
import type {
  AgentCapabilityCheckResult,
  AgentDeps,
  AgentRunInput,
  AgentRunOutput,
  AgentRuntime,
} from "../runtime.js";
import { AGENT_INDEX } from "../roles.js";
import { draftAgentArtifact } from "../model-drafting.js";
import { blockedByInvalidHandoff, validateRequiredHandoff } from "../handoff.js";

const CODEX_RUNTIME_KEYS = ["codex", "codex_runtime"] as const;

/**
 * Development agent.
 *
 * Drafts a technical plan artifact and, when the host supplies a policy-gated
 * Codex runtime capability, executes scoped code/test work through that
 * boundary.
 */
export class DevelopmentAgent implements AgentRuntime {
  public readonly definition = AGENT_INDEX.get("development")!;

  constructor(private readonly deps: AgentDeps) {}

  async execute(input: AgentRunInput): Promise<AgentRunOutput> {
    const handoff = await validateRequiredHandoff(input, this.deps, this.definition.id);
    if (!handoff.ok) return blockedByInvalidHandoff(handoff);

    const templateBody = `# Technical Plan

## Mental Model

Implement ${input.context.scope} as a scoped change.

## Files Likely Affected

- (to be detected by inspecting the repository)

## Local Changes

1. Add or update the relevant module.
2. Add tests covering the new behavior.
3. Run the project's test command.

## Risks

- Coupling with adjacent features; mitigated by keeping the diff small.
- Test coverage gaps; QA agent should flag them.

## Rollback Notes

Revert the single commit if the deploy or merge surfaces a regression.

## Execution Mode

Template-only fallback. No runtime execution has been performed unless a
policy-gated Codex runtime capability is supplied to this agent.
`;
    const draft = await draftAgentArtifact({
      input,
      definition: this.definition,
      artifactTitle: "Technical Plan",
      outputInstructions:
        "Write a technical plan with mental model, likely files, local changes, tests, risks, and rollback notes. Do not write code unless explicitly requested by the run.",
      templateBody,
    });
    const artifact = await this.deps.artifacts.write({
      type: "technical-plan",
      createdBy: this.definition.id,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      body: draft.body,
    });
    await this.deps.audit.append({
      actor: this.definition.id,
      action: "agent.development.executed",
      target: input.context.runId,
      artifact_id: artifact.id,
      ...(draft.capability ? { capability: draft.capability } : {}),
      ...(draft.error ? { error: draft.error } : {}),
      result: "ok",
    });

    const runtime = developmentRuntime(input.capabilities);
    if (!runtime) {
      await this.deps.audit.append({
        actor: this.definition.id,
        action: "agent.development.template_only",
        target: input.context.runId,
        artifact_id: artifact.id,
        result: "ok",
      });
      return {
        ok: true,
        artifactIds: [artifact.id],
        decisions: [...draft.decisions, "template_only_fallback"],
        blockers: draft.blockers,
        notes: `${draft.notes}; template-only fallback (no Codex runtime capability supplied)`,
      };
    }

    const capabilityArtifacts: string[] = [];
    const editGate = await this.checkGate(input, "edit_code");
    if (editGate.artifactId) capabilityArtifacts.push(editGate.artifactId);
    if (!editGate.allowed) {
      return this.blockRuntime(input, {
        planArtifactId: artifact.id,
        capabilityArtifactIds: capabilityArtifacts,
        decisions: draft.decisions,
        reason: editGate.reason,
      });
    }

    const testGate = await this.checkGate(input, "run_tests");
    if (testGate.artifactId) capabilityArtifacts.push(testGate.artifactId);
    if (!testGate.allowed) {
      return this.blockRuntime(input, {
        planArtifactId: artifact.id,
        capabilityArtifactIds: capabilityArtifacts,
        decisions: draft.decisions,
        reason: testGate.reason,
      });
    }

    // Edit/test real code in the run's isolated worktree when the dispatch
    // provisioned one (SER-243); otherwise fall back to the workspace root.
    const codeWorkspaceRoot = input.context.codeWorkspaceRoot ?? input.context.workspaceRoot;
    if (!codeWorkspaceRoot) {
      return this.blockRuntime(input, {
        planArtifactId: artifact.id,
        capabilityArtifactIds: capabilityArtifacts,
        decisions: draft.decisions,
        reason: "workspaceRoot is required for development runtime execution",
      });
    }

    let runtimeResult: RuntimeResult;
    try {
      await runtime.prepare({
        workspaceRoot: codeWorkspaceRoot,
        runId: input.context.runId,
        ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
        ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      });
      runtimeResult = await runtime.execute({
        capability: "edit_code",
        intent: "development_agent_execution",
        scope: input.context.scope,
        inputs: {
          ...(input.context.briefing ? { briefing: input.context.briefing } : {}),
          ...(input.context.projectId ? { projectId: input.context.projectId } : {}),
          ...(input.context.clientId ? { clientId: input.context.clientId } : {}),
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return this.blockRuntime(input, {
        planArtifactId: artifact.id,
        capabilityArtifactIds: capabilityArtifacts,
        decisions: draft.decisions,
        reason,
      });
    }

    const executionArtifact = await this.deps.artifacts.write({
      type: "run-report",
      createdBy: this.definition.id,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      metadata: {
        runtime_id: runtime.id,
        runtime_type: runtime.type,
        runtime_ok: runtimeResult.ok,
        runtime_blocked: runtimeResult.blocked ?? false,
        changed_files: [...(runtimeResult.changedFiles ?? [])],
        commands: [...(runtimeResult.commands ?? [])],
      },
      body: runtimeExecutionBody(input, runtime, runtimeResult),
    });
    const testArtifact = await this.deps.artifacts.write({
      type: "test-evidence-report",
      createdBy: this.definition.id,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      metadata: {
        runtime_id: runtime.id,
        runtime_ok: runtimeResult.ok,
        commands: [...(runtimeResult.commands ?? [])],
      },
      body: runtimeTestBody(input, runtimeResult),
    });
    await this.deps.audit.append({
      actor: this.definition.id,
      action: runtimeResult.ok
        ? "agent.development.runtime_executed"
        : "agent.development.runtime_blocked",
      target: input.context.runId,
      artifact_id: executionArtifact.id,
      capability: "codex.edit_code",
      ...(runtimeResult.error ? { error: runtimeResult.error } : {}),
      result: runtimeResult.ok ? "ok" : "error",
    });

    const blockers = runtimeResult.ok
      ? draft.blockers
      : [
          ...draft.blockers,
          ...(runtimeResult.blockers ?? []),
          ...(runtimeResult.error ? [runtimeResult.error] : []),
        ];
    const runtimeArtifactIds = [...(runtimeResult.artifacts ?? [])];
    return {
      ok: runtimeResult.ok,
      artifactIds: [
        artifact.id,
        ...capabilityArtifacts,
        ...runtimeArtifactIds,
        executionArtifact.id,
        testArtifact.id,
      ],
      decisions: [...draft.decisions, runtimeResult.ok ? "runtime_execution" : "runtime_blocked"],
      blockers,
      notes: runtimeResult.ok
        ? "Development runtime execution completed with diff and test evidence."
        : "Development runtime execution did not complete; blockers were written as artifacts.",
    };
  }

  private async checkGate(
    input: AgentRunInput,
    action: "edit_code" | "run_tests",
  ): Promise<{ allowed: boolean; reason: string; artifactId?: string }> {
    if (!this.deps.capabilityUse) {
      return {
        allowed: false,
        reason: "capability checker is required for development runtime execution",
      };
    }
    const result: AgentCapabilityCheckResult = await this.deps.capabilityUse.check({
      agent: this.definition.id,
      capabilityId: "codex",
      action,
      target: input.context.projectId ?? input.context.runId,
    });
    if (result.status === "allowed") {
      return { allowed: true, reason: "", artifactId: result.artifact?.id };
    }
    return {
      allowed: false,
      reason: gateReason(result),
      artifactId: result.artifact?.id,
    };
  }

  private async blockRuntime(
    input: AgentRunInput,
    args: {
      planArtifactId: string;
      capabilityArtifactIds: readonly string[];
      decisions: readonly string[];
      reason: string;
    },
  ): Promise<AgentRunOutput> {
    const artifact = await this.deps.artifacts.write({
      type: "run-report",
      createdBy: this.definition.id,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
      metadata: {
        runtime_ok: false,
        runtime_blocked: true,
        blocker: args.reason,
      },
      body: `# Development Runtime Blocked

Scope: ${input.context.scope}

Reason: ${args.reason}

The technical plan artifact was written, but no runtime edit/test execution was performed.
`,
    });
    await this.deps.audit.append({
      actor: this.definition.id,
      action: "agent.development.runtime_blocked",
      target: input.context.runId,
      artifact_id: artifact.id,
      capability: "codex.edit_code",
      error: args.reason,
      result: "error",
    });
    return {
      ok: false,
      artifactIds: [args.planArtifactId, ...args.capabilityArtifactIds, artifact.id],
      decisions: [...args.decisions, "runtime_blocked"],
      blockers: [args.reason],
      notes: "Development runtime execution blocked before code or test actions.",
    };
  }
}

function developmentRuntime(
  capabilities: ReadonlyMap<string, unknown>,
): RuntimeAdapter | undefined {
  for (const key of CODEX_RUNTIME_KEYS) {
    const candidate = capabilities.get(key);
    if (isRuntimeAdapter(candidate)) return candidate;
  }
  return undefined;
}

function isRuntimeAdapter(value: unknown): value is RuntimeAdapter {
  if (!value || typeof value !== "object") return false;
  const runtime = value as Partial<RuntimeAdapter>;
  return (
    typeof runtime.id === "string" &&
    typeof runtime.type === "string" &&
    typeof runtime.canExecute === "function" &&
    typeof runtime.prepare === "function" &&
    typeof runtime.execute === "function"
  );
}

function gateReason(result: AgentCapabilityCheckResult): string {
  return (
    result.policy?.reason ??
    result.capability?.reason ??
    (result.missing_gates?.length
      ? `missing required capability gate(s): ${result.missing_gates.join(", ")}`
      : "capability gate blocked development runtime execution")
  );
}

function runtimeExecutionBody(
  input: AgentRunInput,
  runtime: RuntimeAdapter,
  result: RuntimeResult,
): string {
  return `# Development Runtime Execution

Scope: ${input.context.scope}

## Runtime

- Runtime: ${runtime.id} (${runtime.type})
- Status: ${result.ok ? "completed" : result.blocked ? "blocked" : "failed"}
- Error: ${result.error ?? "(none)"}

## Diff Evidence

- Changed files: ${result.changedFiles?.length ? result.changedFiles.join(", ") : "(none)"}
- Runtime artifacts: ${result.artifacts.length ? result.artifacts.join(", ") : "(none)"}

## Test Evidence

- Evidence: ${result.evidence ?? "(none)"}
- Commands: ${result.commands?.length ? result.commands.join(", ") : "(none)"}

## Blockers

${result.blockers?.length ? result.blockers.map((blocker) => `- ${blocker}`).join("\n") : "- (none)"}
`;
}

function runtimeTestBody(input: AgentRunInput, result: RuntimeResult): string {
  return `# Development Test Evidence

Scope: ${input.context.scope}

- Runtime status: ${result.ok ? "passed" : result.blocked ? "blocked" : "failed"}
- Evidence: ${result.evidence ?? "(none)"}
- Commands: ${result.commands?.length ? result.commands.join(", ") : "(none)"}
- Error: ${result.error ?? "(none)"}
`;
}
