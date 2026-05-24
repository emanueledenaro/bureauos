import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import type { BureauConfig } from "../config/schema.js";
import { defaultConfig } from "../config/loader.js";
import { workspacePaths } from "../paths.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalRegistry, type ApprovalRecord } from "../registries/approval.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";
import { dispatchRun, pipelineForRunType, type DispatchOutput } from "../runs/coordinator.js";
import { RunEngine, type RunRecord, type RunType } from "../runs/engine.js";
import { AGENT_INDEX, type AgentDefinition } from "../agents/roles.js";

export interface ProjectDispatchInput {
  projectSlug: string;
  runType?: RunType;
  scope?: string;
  briefing?: string;
  source?: string;
}

export interface AgentHandoff {
  role: string;
  artifact: ArtifactRecord;
}

export interface ProjectDispatchResult {
  summary: string;
  next_actions: string[];
  project: ProjectRecord;
  client?: ClientRecord;
  run: RunRecord;
  pipeline: readonly string[];
  packet: ArtifactRecord;
  handoffs: AgentHandoff[];
  dispatch: DispatchOutput;
  artifacts: ArtifactRecord[];
}

export interface ProjectDispatchDeps {
  config?: BureauConfig;
  clients?: ClientRegistry;
  projects?: ProjectRegistry;
  approvals?: ApprovalRegistry;
  artifacts?: ArtifactStore;
  audit?: AuditLog;
  policy?: PolicyEngine;
  runs?: RunEngine;
}

function artifactList(items: readonly ArtifactRecord[]): string {
  if (items.length === 0) return "- No project artifacts found yet.";
  return items
    .map((artifact) => `- ${artifact.type}: ${artifact.id} (${artifact.status})`)
    .join("\n");
}

function approvalList(items: readonly ApprovalRecord[]): string {
  if (items.length === 0) return "- No pending project approvals.";
  return items
    .map((approval) => `- ${approval.action}: ${approval.id} (${approval.scope})`)
    .join("\n");
}

function roleLine(roleId: string): string {
  const role = AGENT_INDEX.get(roleId);
  return role ? `${role.role} (${role.id})` : roleId;
}

function packetBody(args: {
  project: ProjectRecord;
  client?: ClientRecord;
  run: RunRecord;
  pipeline: readonly string[];
  sourceArtifacts: readonly ArtifactRecord[];
  approvals: readonly ApprovalRecord[];
  briefing: string;
  paths: ReturnType<typeof workspacePaths>;
}): string {
  const { project, client, run, pipeline, sourceArtifacts, approvals, briefing, paths } = args;
  const projectDir = join(paths.projectsDir, project.slug);
  const clientDir = client ? join(paths.clientsDir, client.slug) : "";
  return `# Project Dispatch Packet

## Mission

${briefing}

## Run

- Run: ${run.id}
- Type: ${run.type}
- Scope: ${run.scope}
- Trigger: ${run.trigger_type} (${run.trigger_source})

## Client Context

- Client: ${client?.name ?? project.client_id}
- Client status: ${client?.status ?? "unknown"}
- Industry: ${client?.industry ?? "unknown"}
- Allowed client memory: ${clientDir || "(none)"}

## Project Context

- Project: ${project.name}
- Project id: ${project.id}
- Status: ${project.status}
- Stack: ${project.stack || "tbd"}
- Repository: ${project.repository || "not connected"}
- Allowed project memory: ${projectDir}

## Pipeline

${pipeline.map((role, index) => `${index + 1}. ${roleLine(role)}`).join("\n")}

## Source Artifacts

${artifactList(sourceArtifacts)}

## Pending Approval Gates

${approvalList(approvals)}

## Memory Boundary

Specialist agents may use only the project memory, linked client memory, run context, and source artifacts listed in this packet. Cross-client memory requires escalation to the Supreme Coordinator.

## Operating Rules

- Draft internal artifacts autonomously.
- Do not contact the client.
- Do not publish public content.
- Do not change price, budget, production data, secrets, or legal commitments.
- Escalate blockers, missing assets, unclear scope, or policy conflicts.
`;
}

function handoffBody(args: {
  role: AgentDefinition;
  project: ProjectRecord;
  client?: ClientRecord;
  run: RunRecord;
  packet: ArtifactRecord;
  sourceArtifacts: readonly ArtifactRecord[];
  briefing: string;
}): string {
  const { role, project, client, run, packet, sourceArtifacts, briefing } = args;
  return `# Agent Handoff: ${role.role}

## Assignment

${briefing}

## Scope

- Run: ${run.id}
- Project: ${project.name} (${project.id})
- Client: ${client?.name ?? project.client_id}
- Dispatch packet: ${packet.id}

## Required Outputs

${role.outputs.map((output) => `- ${output}`).join("\n")}

## Responsibilities

${role.responsibilities.map((item) => `- ${item}`).join("\n")}

## Source Artifacts

${artifactList(sourceArtifacts)}

## Must Not

${role.mustNot.map((item) => `- ${item}`).join("\n")}

## Escalation

Escalate to Project Manager when scope, data, repository state, policy, approval, or delivery risk is unclear.
`;
}

function pendingProjectApprovals(
  approvals: readonly ApprovalRecord[],
  project: ProjectRecord,
): ApprovalRecord[] {
  return approvals.filter(
    (approval) => approval.target === project.id || approval.scope.includes(project.name),
  );
}

export class ProjectDispatchService {
  private readonly config: BureauConfig;
  private readonly clients: ClientRegistry;
  private readonly projects: ProjectRegistry;
  private readonly approvals: ApprovalRegistry;
  private readonly artifacts: ArtifactStore;
  private readonly audit: AuditLog;
  private readonly policy: PolicyEngine;
  private readonly runs: RunEngine;

  constructor(
    private readonly workspaceRoot: string,
    deps: ProjectDispatchDeps = {},
  ) {
    this.config = deps.config ?? defaultConfig("freelancer");
    this.clients = deps.clients ?? new ClientRegistry(workspaceRoot);
    this.projects = deps.projects ?? new ProjectRegistry(workspaceRoot);
    this.approvals = deps.approvals ?? new ApprovalRegistry(workspaceRoot);
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.policy = deps.policy ?? new PolicyEngine(this.config, this.approvals);
    this.runs =
      deps.runs ??
      new RunEngine(workspaceRoot, {
        audit: this.audit,
        artifacts: this.artifacts,
        policy: this.policy,
      });
  }

  async dispatch(input: ProjectDispatchInput): Promise<ProjectDispatchResult> {
    const project = await this.projects.get(input.projectSlug);
    if (!project) throw new Error(`project not found: ${input.projectSlug}`);

    const allClients = await this.clients.list();
    const client = allClients.find((item) => item.id === project.client_id);
    const runType = input.runType ?? "planning";
    const scope = input.scope?.trim() || `Dispatch ${runType} work for ${project.name}`;
    const briefing =
      input.briefing?.trim() ||
      `Coordinate ${project.name} through ${runType} work using project-scoped memory.`;

    const run = await this.runs.start({
      type: runType,
      triggerType: "owner_request",
      triggerSource: input.source ?? "project_dispatch",
      scope,
      createdBy: "project_manager",
      ...(client ? { clientId: client.id } : {}),
      projectId: project.id,
    });

    const sourceArtifacts = await this.artifacts.list({ project_id: project.id });
    const pendingApprovals = pendingProjectApprovals(await this.approvals.listPending(), project);
    const pipeline = pipelineForRunType(run.type);
    const paths = workspacePaths(this.workspaceRoot);
    const packet = await this.artifacts.write({
      type: "project-dispatch-packet",
      createdBy: "project_manager",
      runId: run.id,
      projectId: project.id,
      ...(client ? { clientId: client.id } : {}),
      metadata: {
        roles: [...pipeline],
        source_artifacts: sourceArtifacts.map((artifact) => artifact.id),
        pending_approvals: pendingApprovals.map((approval) => approval.id),
      },
      body: packetBody({
        project,
        client,
        run,
        pipeline,
        sourceArtifacts,
        approvals: pendingApprovals,
        briefing,
        paths,
      }),
    });

    const handoffs: AgentHandoff[] = [];
    for (const roleId of pipeline) {
      const role = AGENT_INDEX.get(roleId);
      if (!role) continue;
      handoffs.push({
        role: roleId,
        artifact: await this.artifacts.write({
          type: "agent-handoff",
          createdBy: "project_manager",
          runId: run.id,
          projectId: project.id,
          ...(client ? { clientId: client.id } : {}),
          metadata: {
            role: roleId,
            dispatch_packet: packet.id,
            source_artifacts: sourceArtifacts.map((artifact) => artifact.id),
          },
          body: handoffBody({
            role,
            project,
            client,
            run,
            packet,
            sourceArtifacts,
            briefing,
          }),
        }),
      });
    }

    const contextArtifactIdsByRole: Record<string, readonly string[]> = {};
    for (const handoff of handoffs) {
      contextArtifactIdsByRole[handoff.role] = [handoff.artifact.id];
    }

    const dispatch = await dispatchRun(
      { audit: this.audit, artifacts: this.artifacts, policy: this.policy },
      {
        workspaceRoot: this.workspaceRoot,
        run,
        scope,
        briefing: `Project dispatch packet: ${packet.id}\n\n${briefing}`,
        contextArtifactIds: [packet.id],
        contextArtifactIdsByRole,
      },
    );
    const producedArtifactIds = dispatch.steps.flatMap((step) => step.artifactIds);
    const updatedRun = await this.runs.attachArtifacts(run.id, [
      packet.id,
      ...handoffs.map((handoff) => handoff.artifact.id),
      dispatch.briefingArtifactId,
      ...producedArtifactIds,
    ]);

    await appendFile(
      join(paths.projectsDir, project.slug, "RUNS.md"),
      `\n\n## Dispatch ${run.id}\n\n- Type: ${run.type}\n- Packet: ${packet.id}\n- Pipeline: ${pipeline.join(", ")}\n- Handoffs: ${handoffs.map((handoff) => handoff.artifact.id).join(", ")}\n- Outputs: ${producedArtifactIds.join(", ")}\n`,
      "utf8",
    );
    await this.audit.append({
      actor: "project_manager",
      action: "project.dispatch.completed",
      target: project.id,
      artifact_id: packet.id,
      result: "ok",
    });

    return {
      summary: `Dispatched ${project.name} to ${pipeline.length} roles with ${handoffs.length} handoff packets.`,
      next_actions: [
        "Review specialist artifacts before creating dev-ready GitHub issues.",
        "Resolve pending approval gates before external commitments.",
        "Use the dispatch packet as the project-scoped context source for follow-up runs.",
      ],
      project,
      ...(client ? { client } : {}),
      run: updatedRun,
      pipeline,
      packet,
      handoffs,
      dispatch,
      artifacts: [packet, ...handoffs.map((handoff) => handoff.artifact)],
    };
  }
}
