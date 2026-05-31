import type { ArtifactRecord, ArtifactStore, WriteArtifactInput } from "../artifacts/store.js";
import type { AuditLog } from "../audit/log.js";
import type { PolicyEngine } from "../policy/engine.js";
import { AGENT_INDEX, type AgentDefinition } from "./roles.js";

/**
 * Agent runtime base.
 *
 * Provides the contract every concrete agent uses to consume context, perform
 * its responsibility, and write artifacts. Concrete agent implementations
 * land in Phase 9; for now this base lets the run engine call into a unified
 * surface and lets tests stand in `StubAgent` for any role.
 */

export interface AgentContext {
  runId: string;
  scope: string;
  workspaceRoot?: string;
  /**
   * Isolated working directory where a code-executing agent (the development
   * agent's Codex runtime) should edit and test real code — the run's per-run
   * git worktree, when the dispatch provisioned one (SER-243). Falls back to
   * `workspaceRoot` when absent. Keeps real code edits off the `.bureauos`
   * agency workspace and isolated from other concurrent runs.
   */
  codeWorkspaceRoot?: string;
  clientId?: string;
  projectId?: string;
  /**
   * The work item (Linear/GitHub issue) tracking this run, when one is linked.
   * Satisfies the `linked_issue` capability gate for code work (SER-242).
   */
  linkedWorkItem?: { type: string; identifier: string };
  briefing?: string;
  handoffArtifactId?: string;
}

export interface AgentRunInput {
  context: AgentContext;
  capabilities: ReadonlyMap<string, unknown>;
}

export interface AgentRunOutput {
  ok: boolean;
  artifactIds: readonly string[];
  decisions: readonly string[];
  blockers: readonly string[];
  notes: string;
}

export interface AgentCapabilityCheckInput {
  agent: string;
  capabilityId: string;
  action: string;
  target?: string;
  policyAction?: string;
  linkedIssueNumbers?: readonly number[];
  /** Identifier of a linked work item (Linear/GitHub) tracking the work (SER-242). */
  linkedWorkItemId?: string;
  testEvidence?: readonly string[];
  changedFiles?: readonly string[];
}

export interface AgentCapabilityCheckResult {
  status: "allowed" | "blocked";
  artifact?: ArtifactRecord;
  target?: string;
  missing_gates?: readonly string[];
  policy?: { reason: string };
  capability?: { reason: string };
}

export interface AgentCapabilityChecker {
  check(input: AgentCapabilityCheckInput): Promise<AgentCapabilityCheckResult>;
}

export interface AgentRuntime {
  readonly definition: AgentDefinition;
  execute(input: AgentRunInput): Promise<AgentRunOutput>;
}

export interface AgentDeps {
  artifacts: ArtifactStore;
  audit: AuditLog;
  policy: PolicyEngine;
  capabilityUse?: AgentCapabilityChecker;
}

/**
 * Stub agent that records intent as an artifact. Used by the run engine when
 * a real agent runtime is not configured for a role. Every concrete agent in
 * Phase 9 replaces this for its own role.
 */
export class StubAgent implements AgentRuntime {
  constructor(
    public readonly definition: AgentDefinition,
    private readonly deps: AgentDeps,
  ) {}

  async execute(input: AgentRunInput): Promise<AgentRunOutput> {
    const artifactInput: WriteArtifactInput = {
      type: "run-report",
      createdBy: this.definition.id,
      body: `# ${this.definition.role} stub\n\nScope: ${input.context.scope}\n\nThis run produced no real output: the ${this.definition.id} agent runtime is not yet implemented.\n\nBACKLOG Phase 9.`,
      runId: input.context.runId,
      ...(input.context.clientId !== undefined ? { clientId: input.context.clientId } : {}),
      ...(input.context.projectId !== undefined ? { projectId: input.context.projectId } : {}),
    };
    const record: ArtifactRecord = await this.deps.artifacts.write(artifactInput);
    await this.deps.audit.append({
      actor: this.definition.id,
      action: "agent.stub_execute",
      target: input.context.runId,
      artifact_id: record.id,
      result: "ok",
    });
    return {
      ok: true,
      artifactIds: [record.id],
      decisions: [],
      blockers: [],
      notes: `${this.definition.role} stub completed`,
    };
  }
}

/**
 * Resolve an `AgentRuntime` for a given role id, building a `StubAgent`
 * when no concrete runtime has been registered. Concrete runtimes land in
 * Phase 9; the registry is the seam.
 */
export class AgentRegistry {
  private readonly runtimes = new Map<string, AgentRuntime>();

  constructor(private readonly deps: AgentDeps) {}

  register(runtime: AgentRuntime): void {
    this.runtimes.set(runtime.definition.id, runtime);
  }

  get(roleId: string): AgentRuntime {
    const existing = this.runtimes.get(roleId);
    if (existing) return existing;
    const definition = AGENT_INDEX.get(roleId);
    if (!definition) {
      throw new Error(`unknown agent role: ${roleId}`);
    }
    const stub = new StubAgent(definition, this.deps);
    this.runtimes.set(roleId, stub);
    return stub;
  }

  list(): readonly AgentRuntime[] {
    return [...this.runtimes.values()];
  }
}
