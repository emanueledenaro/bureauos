import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildConfiguredProviderRouter,
  type ProviderEnv,
  type ProviderRouter,
} from "@bureauos/providers";
import { configureAgentProviderRouting } from "../agents/provider-routing.js";
import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import type { BureauConfig } from "../config/schema.js";
import { defaultConfig } from "../config/loader.js";
import { workspacePaths } from "../paths.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalRegistry, type ApprovalRecord } from "../registries/approval.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import {
  ProjectRegistry,
  type ProjectOwnershipRecord,
  type ProjectRecord,
} from "../registries/project.js";
import { dispatchRun, pipelineForRunType, type DispatchOutput } from "../runs/coordinator.js";
import { RunEngine, type RunRecord, type RunType } from "../runs/engine.js";
import { AGENT_INDEX, type AgentDefinition } from "../agents/roles.js";
import { agentHandoffBody, agentHandoffMetadata } from "../agents/handoff.js";

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
  ownership: ProjectOwnershipRecord;
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
  providerRouter?: ProviderRouter;
  providerEnv?: ProviderEnv;
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

function expectedArtifactTypes(roleId: string): string[] {
  switch (roleId) {
    case "project_manager":
      return ["run-report"];
    case "product":
      return ["feature-spec"];
    case "ux":
      return ["design-spec"];
    case "development":
      return ["technical-plan"];
    case "qa":
      return ["test-plan"];
    case "security":
      return ["security-review"];
    case "reviewer":
      return ["pr-review"];
    default:
      return ["run-report"];
  }
}

function handoffAcceptanceChecks(role: AgentDefinition, run: RunRecord): string[] {
  return [
    `${role.role} confirms the handoff target matches ${role.id}.`,
    `${role.role} uses only the dispatch packet, listed inputs, and scoped memory for run ${run.id}.`,
    `${role.role} produces or explicitly blocks the expected output artifacts.`,
    "External actions, client contact, publishing, billing, merge, deploy, and destructive work remain policy-gated.",
  ];
}

function packetBody(args: {
  project: ProjectRecord;
  client?: ClientRecord;
  run: RunRecord;
  pipeline: readonly string[];
  sourceArtifacts: readonly ArtifactRecord[];
  approvals: readonly ApprovalRecord[];
  ownership: ProjectOwnershipRecord;
  briefing: string;
  paths: ReturnType<typeof workspacePaths>;
}): string {
  const { project, client, run, pipeline, sourceArtifacts, approvals, ownership, briefing, paths } =
    args;
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

## Project Manager Ownership

- Manager agent: ${ownership.manager_agent_id}
- Manager role: ${ownership.manager_role}
- Team: ${ownership.team_id}
- Ownership status: ${ownership.status}
- Escalation: ${ownership.escalation_agent_id}
- Assigned agents: ${ownership.assigned_agents.join(", ")}

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
  private readonly providerRouter?: ProviderRouter;
  private readonly providerEnv: ProviderEnv;

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
    this.providerRouter = deps.providerRouter;
    this.providerEnv = deps.providerEnv ?? process.env;
    this.runs =
      deps.runs ??
      new RunEngine(workspaceRoot, {
        audit: this.audit,
        artifacts: this.artifacts,
        policy: this.policy,
        recordDecisions: this.config.memory.write_decision_records,
      });
  }

  async dispatch(input: ProjectDispatchInput): Promise<ProjectDispatchResult> {
    const project = await this.projects.get(input.projectSlug);
    if (!project) throw new Error(`project not found: ${input.projectSlug}`);
    const ownership = await this.projects.getOwnership(project.slug);
    if (!ownership) throw new Error(`project ownership not found: ${project.slug}`);

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
      createdBy: ownership.manager_agent_id,
      ...(client ? { clientId: client.id } : {}),
      projectId: project.id,
    });

    const sourceArtifacts = await this.artifacts.list({ project_id: project.id });
    const pendingApprovals = pendingProjectApprovals(await this.approvals.listPending(), project);
    const pipeline = pipelineForRunType(run.type);
    const paths = workspacePaths(this.workspaceRoot);
    const packet = await this.artifacts.write({
      type: "project-dispatch-packet",
      createdBy: ownership.manager_agent_id,
      runId: run.id,
      projectId: project.id,
      ...(client ? { clientId: client.id } : {}),
      metadata: {
        roles: [...pipeline],
        manager_agent_id: ownership.manager_agent_id,
        team_id: ownership.team_id,
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
        ownership,
        briefing,
        paths,
      }),
    });

    const handoffs: AgentHandoff[] = [];
    for (const roleId of pipeline) {
      const role = AGENT_INDEX.get(roleId);
      if (!role) continue;
      const handoffContract = {
        sourceAgentId: ownership.manager_agent_id,
        targetAgentId: roleId,
        runId: run.id,
        scope,
        projectId: project.id,
        ...(client ? { clientId: client.id } : {}),
        dispatchPacketId: packet.id,
        inputArtifactIds: [packet.id, ...sourceArtifacts.map((artifact) => artifact.id)],
        expectedOutputTypes: expectedArtifactTypes(roleId),
        acceptanceChecks: handoffAcceptanceChecks(role, run),
        blockers: pendingApprovals.map(
          (approval) => `${approval.action}: ${approval.id} (${approval.scope})`,
        ),
      };
      handoffs.push({
        role: roleId,
        artifact: await this.artifacts.write({
          type: "agent-handoff",
          createdBy: ownership.manager_agent_id,
          runId: run.id,
          projectId: project.id,
          ...(client ? { clientId: client.id } : {}),
          metadata: {
            role: roleId,
            dispatch_packet: packet.id,
            manager_agent_id: ownership.manager_agent_id,
            team_id: ownership.team_id,
            source_artifacts: sourceArtifacts.map((artifact) => artifact.id),
            ...agentHandoffMetadata(handoffContract),
          },
          body: agentHandoffBody({
            contract: handoffContract,
            targetRole: role,
            sourceArtifacts,
          }),
        }),
      });
    }

    const contextArtifactIdsByRole: Record<string, readonly string[]> = {};
    for (const handoff of handoffs) {
      contextArtifactIdsByRole[handoff.role] = [handoff.artifact.id];
    }

    const providerRouter = await this.agentProviderRouter(pipeline);
    const dispatch = await dispatchRun(
      {
        audit: this.audit,
        artifacts: this.artifacts,
        policy: this.policy,
        config: this.config,
        ...(providerRouter ? { providerRouter } : {}),
      },
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

    // Truthfully reflect specialist failures. Now that dispatch steps carry
    // `ok`/`blockers`, a blocking specialist must not be reported as a clean
    // completion: record an `error` audit, write a project RISKS.md entry, and
    // surface blockers in the summary/next_actions.
    const blockedSteps = dispatch.steps.filter((step) => !step.ok);
    const blockers = blockedSteps.flatMap((step) =>
      step.blockers.length > 0
        ? step.blockers.map((blocker) => `${step.role}: ${blocker}`)
        : [`${step.role}: ${step.notes}`],
    );
    const dispatchResult: "ok" | "error" = blockedSteps.length > 0 ? "error" : "ok";

    await appendFile(
      join(paths.projectsDir, project.slug, "RUNS.md"),
      `\n\n## Dispatch ${run.id}\n\n- Type: ${run.type}\n- Project Manager: ${ownership.manager_agent_id}\n- Team: ${ownership.team_id}\n- Packet: ${packet.id}\n- Pipeline: ${pipeline.join(", ")}\n- Handoffs: ${handoffs.map((handoff) => handoff.artifact.id).join(", ")}\n- Outputs: ${producedArtifactIds.join(", ")}\n- Result: ${dispatchResult === "error" ? "blocked" : "completed"}\n${dispatchResult === "error" ? `- Blockers: ${blockers.join("; ")}\n` : ""}`,
      "utf8",
    );

    if (blockedSteps.length > 0) {
      await appendFile(
        join(paths.projectsDir, project.slug, "RISKS.md"),
        `\n\n## Dispatch ${run.id} blocked\n\n- Run: ${run.id}\n- Type: ${run.type}\n- Project Manager: ${ownership.manager_agent_id}\n- Blocked roles: ${blockedSteps.map((step) => step.role).join(", ")}\n- Blockers: ${blockers.join("; ")}\n`,
        "utf8",
      );
    }

    await this.audit.append({
      actor: ownership.manager_agent_id,
      action: blockedSteps.length > 0 ? "project.dispatch.blocked" : "project.dispatch.completed",
      target: project.id,
      artifact_id: packet.id,
      ...(blockers.length > 0 ? { error: blockers.join("; ") } : {}),
      result: dispatchResult,
    });

    const summary =
      blockedSteps.length > 0
        ? `Dispatched ${project.name} to ${pipeline.length} roles; ${blockedSteps.length} blocked (${blockedSteps
            .map((step) => step.role)
            .join(", ")}). Owner resolution required before delivery.`
        : `Dispatched ${project.name} to ${pipeline.length} roles with ${handoffs.length} handoff packets.`;
    const nextActions =
      blockedSteps.length > 0
        ? [
            `Resolve specialist blockers before delivery: ${blockers.join("; ")}.`,
            "Review the project RISKS.md entry for the blocked dispatch.",
            "Re-dispatch once blockers are cleared, or escalate for owner intervention.",
          ]
        : [
            "Review specialist artifacts before creating dev-ready GitHub issues.",
            "Resolve pending approval gates before external commitments.",
            "Use the dispatch packet as the project-scoped context source for follow-up runs.",
          ];

    return {
      summary,
      next_actions: nextActions,
      project,
      ownership,
      ...(client ? { client } : {}),
      run: updatedRun,
      pipeline,
      packet,
      handoffs,
      dispatch,
      artifacts: [packet, ...handoffs.map((handoff) => handoff.artifact)],
    };
  }

  private async agentProviderRouter(
    pipeline: readonly string[],
  ): Promise<ProviderRouter | undefined> {
    if (this.providerRouter) {
      configureAgentProviderRouting(this.providerRouter, this.config, pipeline);
      return this.providerRouter;
    }

    const configured = await buildConfiguredProviderRouter(
      this.workspaceRoot,
      this.providerEnv,
      this.config,
    );
    if (configured.credentials.length === 0) return undefined;
    configureAgentProviderRouting(configured.router, this.config, pipeline);
    return configured.router;
  }
}
