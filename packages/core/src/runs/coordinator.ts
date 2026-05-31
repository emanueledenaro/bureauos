import { AgentRegistry } from "../agents/runtime.js";
import { buildDefaultAgentRegistry } from "../agents/concrete/index.js";
import { MODEL_PROVIDER_CAPABILITY, selectAgentModel } from "../agents/provider-routing.js";
import type { AgentCapabilityChecker } from "../agents/runtime.js";
import type { ArtifactStore } from "../artifacts/store.js";
import type { AuditLog } from "../audit/log.js";
import type { BureauConfig } from "../config/schema.js";
import type { PolicyEngine } from "../policy/engine.js";
import { workspacePaths } from "../paths.js";
import { ensureDir, writeDoc, type FrontMatter } from "../registries/base.js";
import { join } from "node:path";
import { newId } from "../ids.js";
import type { RunDispatcher, RunRecord, RunType } from "./engine.js";
import type { ProviderRouter, RuntimeAdapter } from "@bureauos/providers";
import {
  MEMORY_BOUNDARY_CAPABILITY,
  MEMORY_CAPABILITY,
  MemoryBoundaryService,
} from "../memory/isolation.js";

/**
 * Supreme Coordinator dispatch.
 *
 * Given a run brief, this function picks the right set of specialist
 * agents based on the run type and runs them sequentially. The kernel
 * captures every produced artifact id on the run record. When a configured
 * provider router is supplied, agents receive a model capability; otherwise
 * they fall back to deterministic local templates.
 */

export interface CoordinatorDeps {
  artifacts: ArtifactStore;
  audit: AuditLog;
  policy: PolicyEngine;
  config?: BureauConfig;
  providerRouter?: ProviderRouter;
  capabilityUse?: AgentCapabilityChecker;
  developmentRuntime?: RuntimeAdapter;
  registry?: AgentRegistry;
  memory?: MemoryBoundaryService;
}

const PIPELINES: Record<RunType, readonly string[]> = {
  feature: ["product", "ux", "development", "qa", "security", "reviewer"],
  bug: ["qa", "development", "reviewer"],
  review: ["reviewer", "qa", "security"],
  release: ["release", "qa", "security"],
  planning: ["project_manager", "product"],
  retrospective: ["project_manager"],
  visibility: ["visibility", "content"],
  content: ["content", "social", "compliance"],
  campaign: ["marketing", "creative", "compliance"],
  conversion: ["conversion", "marketing"],
  sales: ["sales", "pricing", "compliance"],
  social: ["social", "creative", "compliance"],
  creative: ["creative", "visibility"],
  ads: ["ads", "compliance"],
  compliance: ["compliance"],
  client_success: ["client_success", "compliance"],
  intake: ["sales", "product", "pricing", "compliance"],
  health_check: ["project_manager"],
};

export function pipelineForRunType(type: RunType): readonly string[] {
  return PIPELINES[type] ?? ["supreme_coordinator"];
}

export interface DispatchInput {
  workspaceRoot: string;
  run: RunRecord;
  scope: string;
  briefing?: string;
  contextArtifactIds?: readonly string[];
  contextArtifactIdsByRole?: Readonly<Record<string, readonly string[]>>;
  /**
   * Isolated working directory (the run's git worktree, SER-243) the development
   * agent should edit/test real code in. Threaded only to the development role's
   * context; other agents are unaffected.
   */
  codeWorkspaceRoot?: string;
}

export interface DispatchStep {
  role: string;
  ok: boolean;
  artifactIds: readonly string[];
  blockers: readonly string[];
  notes: string;
}

export interface DispatchOutput {
  runId: string;
  steps: ReadonlyArray<DispatchStep>;
  briefingArtifactId: string;
}

interface BriefingFrontMatter extends FrontMatter {
  id: string;
  run_id: string;
  pipeline: string;
  created: string;
}

export async function dispatchRun(
  deps: CoordinatorDeps,
  input: DispatchInput,
): Promise<DispatchOutput> {
  const registry =
    deps.registry ??
    buildDefaultAgentRegistry({
      artifacts: deps.artifacts,
      audit: deps.audit,
      policy: deps.policy,
      ...(deps.capabilityUse ? { capabilityUse: deps.capabilityUse } : {}),
    });
  const memory = deps.memory ?? new MemoryBoundaryService(input.workspaceRoot);
  const pipeline = pipelineForRunType(input.run.type);
  const briefingId = newId("brief");
  const briefingPath = join(workspacePaths(input.workspaceRoot).artifactsDir, `${briefingId}.md`);
  await ensureDir(workspacePaths(input.workspaceRoot).artifactsDir);
  const briefingFront: BriefingFrontMatter = {
    id: briefingId,
    run_id: input.run.id,
    pipeline: pipeline.join(","),
    created: new Date().toISOString(),
  };
  const briefingBody = `# Run Briefing

- Run: ${input.run.id}
- Type: ${input.run.type}
- Scope: ${input.scope}

## Pipeline

${pipeline.map((r, i) => `${i + 1}. ${r}`).join("\n")}

## Briefing

${input.briefing ?? "(none supplied)"}
`;
  await writeDoc(briefingPath, briefingFront, briefingBody);
  await deps.audit.append({
    actor: "supreme_coordinator",
    action: "coordinator.briefing_written",
    target: input.run.id,
    artifact_id: briefingId,
    result: "ok",
  });

  const steps: DispatchStep[] = [];
  for (const role of pipeline) {
    const agent = registry.get(role);
    const roleContextArtifactIds = Array.from(
      new Set([
        briefingId,
        ...(input.contextArtifactIds ?? []),
        ...(input.contextArtifactIdsByRole?.[role] ?? []),
      ]),
    );
    const boundary = await memory.forAgent({
      agent: agent.definition,
      run: input.run,
      contextArtifactIds: roleContextArtifactIds,
    });
    await deps.audit.append({
      actor: agent.definition.id,
      action: "memory.boundary.applied",
      target: input.run.id,
      capability: MEMORY_CAPABILITY,
      result: "ok",
    });
    const modelSelection =
      deps.providerRouter && deps.config
        ? await selectAgentModel(deps.providerRouter, deps.config, role)
        : undefined;
    if (modelSelection) {
      await deps.audit.append({
        actor: agent.definition.id,
        action: "model.provider.selected",
        target: input.run.id,
        capability: `model:${modelSelection.provider.id}`,
        result: "ok",
      });
    }
    const out = await agent.execute({
      context: {
        workspaceRoot: input.workspaceRoot,
        runId: input.run.id,
        scope: input.scope,
        ...(role === "development" && input.codeWorkspaceRoot
          ? { codeWorkspaceRoot: input.codeWorkspaceRoot }
          : {}),
        ...(role === "development" && input.run.source_work_item_id
          ? {
              linkedWorkItem: {
                type: input.run.source_work_item_type,
                identifier: input.run.source_work_item_id,
              },
            }
          : {}),
        ...(input.contextArtifactIdsByRole?.[role]?.[0]
          ? { handoffArtifactId: input.contextArtifactIdsByRole[role][0] }
          : {}),
        ...(input.run.project_id ? { projectId: input.run.project_id } : {}),
        ...(input.run.client_id ? { clientId: input.run.client_id } : {}),
        ...(input.briefing ? { briefing: input.briefing } : {}),
      },
      capabilities: new Map<string, unknown>([
        [MEMORY_CAPABILITY, boundary.store],
        [MEMORY_BOUNDARY_CAPABILITY, boundary],
        ...(deps.developmentRuntime && role === "development"
          ? ([["codex", deps.developmentRuntime]] as const)
          : []),
        ...(modelSelection ? ([[MODEL_PROVIDER_CAPABILITY, modelSelection]] as const) : []),
      ]),
    });
    steps.push({
      role,
      ok: out.ok,
      artifactIds: out.artifactIds,
      blockers: out.blockers,
      notes: out.notes,
    });
    await deps.audit.append({
      actor: "supreme_coordinator",
      action: "coordinator.step_completed",
      target: input.run.id,
      capability: role,
      result: out.ok ? "ok" : "error",
    });
  }

  return { runId: input.run.id, steps, briefingArtifactId: briefingId };
}

export function createCoordinatorRunDispatcher(deps: CoordinatorDeps): RunDispatcher {
  return async ({ workspaceRoot, run, startInput }) => {
    const output = await dispatchRun(deps, {
      workspaceRoot,
      run,
      scope: startInput.scope,
      briefing: startInput.scope,
    });
    const stepArtifactIds = output.steps.flatMap((step) => step.artifactIds);
    const pipeline = output.steps.map((step) => step.role);

    // Truthfully propagate specialist failures. Concrete agents legitimately
    // return `ok:false` with blockers (e.g. blocked development runtime, QA not
    // ready for review, security findings). When any step blocks, surface a
    // non-completed terminal status with aggregated blockers so RunEngine
    // transitions the run to `blocked` (populating `dispatch_blockers`) and the
    // AutonomousRetryService can pick it up. The happy path (all steps ok) still
    // completes.
    const failedSteps = output.steps.filter((step) => !step.ok);
    const blockers = failedSteps.flatMap((step) =>
      step.blockers.length > 0
        ? step.blockers.map((blocker) => `${step.role}: ${blocker}`)
        : [`${step.role}: ${step.notes}`],
    );

    return {
      status: failedSteps.length > 0 ? "blocked" : "completed",
      artifactIds: [output.briefingArtifactId, ...stepArtifactIds],
      decisions: output.steps.map((step) => `${step.role}: ${step.notes}`),
      ...(blockers.length > 0 ? { blockers } : {}),
      metadata: {
        dispatch_mode: "coordinator",
        dispatch_briefing_artifact_id: output.briefingArtifactId,
        dispatch_pipeline: pipeline,
      },
    };
  };
}
