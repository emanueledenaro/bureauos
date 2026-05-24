import { AgentRegistry } from "../agents/runtime.js";
import { buildDefaultAgentRegistry } from "../agents/concrete/index.js";
import type { ArtifactStore } from "../artifacts/store.js";
import type { AuditLog } from "../audit/log.js";
import type { PolicyEngine } from "../policy/engine.js";
import { workspacePaths } from "../paths.js";
import { ensureDir, writeDoc, type FrontMatter } from "../registries/base.js";
import { join } from "node:path";
import { newId } from "../ids.js";
import type { RunRecord, RunType } from "./engine.js";

/**
 * Supreme Coordinator dispatch.
 *
 * Given a run brief, this function picks the right set of specialist
 * agents based on the run type and runs them sequentially. The kernel
 * captures every produced artifact id on the run record. The actual
 * model calls are out of scope; the agents here are the concrete
 * stubs from `buildDefaultAgentRegistry`.
 */

export interface CoordinatorDeps {
  artifacts: ArtifactStore;
  audit: AuditLog;
  policy: PolicyEngine;
  registry?: AgentRegistry;
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
}

export interface DispatchOutput {
  runId: string;
  steps: ReadonlyArray<{ role: string; artifactIds: readonly string[]; notes: string }>;
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
    });
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

  const steps: Array<{ role: string; artifactIds: readonly string[]; notes: string }> = [];
  for (const role of pipeline) {
    const agent = registry.get(role);
    const out = await agent.execute({
      context: {
        runId: input.run.id,
        scope: input.scope,
        ...(input.run.project_id ? { projectId: input.run.project_id } : {}),
        ...(input.run.client_id ? { clientId: input.run.client_id } : {}),
        ...(input.briefing ? { briefing: input.briefing } : {}),
      },
      capabilities: new Map(),
    });
    steps.push({ role, artifactIds: out.artifactIds, notes: out.notes });
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
