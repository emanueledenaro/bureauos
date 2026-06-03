import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { OctokitGitHubClient } from "@bureauos/capabilities";
import {
  buildConfiguredProviderRouter,
  type ProviderEnv,
  type ProviderRouter,
} from "@bureauos/providers";
import { configureAgentProviderRouting } from "../agents/provider-routing.js";
import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { buildDevelopmentExecution } from "../execution/development-execution.js";
import { ProjectWorkspaceService, type RunCommitResult } from "../execution/project-workspace.js";
import type { GitHubPullRequestPublishClient } from "../github/pr-publisher.js";
import type { GitHubRepositoryProvisionClient } from "../github/repository-provisioner.js";
import {
  deliverDispatchedRun,
  type DispatchBranchPusher,
  type DispatchDeliveryResult,
} from "./delivery.js";
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
import type { ProjectTestRunnerFactory } from "../agents/runtime.js";
import {
  ownerBuildSourceWorkItem,
  sourceWorkItemFromTriggerSource,
  type SourceWorkItemInput,
} from "../work-items/source.js";

export interface ProjectDispatchInput {
  projectSlug: string;
  runType?: RunType;
  scope?: string;
  briefing?: string;
  source?: string;
  /**
   * Marks this dispatch as an EXPLICIT owner build (the chat `dispatch_build`
   * path, AB-U5). When true the run is stamped with a recorded `owner_build`
   * work item (derived from the project/opportunity) so the development agent's
   * `linked_issue` gate is satisfied traceably — the explicit owner request is
   * both the authorization and the tracked work item. Left unset for
   * autonomous/scheduler/non-owner dispatches, which therefore still fail-close
   * on `linked_issue` + approval. An explicit `source` work item (e.g.
   * `linear://issue/...`) still takes precedence when supplied.
   */
  ownerBuild?: boolean;
  /**
   * Opportunity the owner build belongs to, when known, recorded in the
   * owner-build work-item id for traceability. Ignored unless `ownerBuild`.
   */
  opportunityId?: string;
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
  /**
   * Outcome of the post-run delivery step (SER-241): pushing the run branch and
   * opening a policy-gated draft PR. Absent when delivery never ran (e.g. a
   * planning run with no worktree).
   */
  delivery?: DispatchDeliveryResult;
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
  /**
   * GitHub client used by the delivery step's PR publisher (SER-241). Inject a
   * fake in tests so no real GitHub account is ever touched. When omitted, a real
   * Octokit client is built ONLY if an owner-provided token is configured
   * (`githubToken` or `GITHUB_TOKEN`); with no token, delivery still pushes to a
   * local remote but cannot open a PR.
   */
  githubPrPublishClient?: GitHubPullRequestPublishClient;
  /**
   * GitHub client used to AUTO-CREATE the project repository when it has none yet,
   * so the owner never makes it by hand. Inject a fake in tests; in production a
   * real Octokit client is built ONLY when an owner-provided token exists. The
   * `create_repositories` policy gate still applies (via the provision service).
   */
  githubRepoProvisionClient?: GitHubRepositoryProvisionClient;
  /** Owner-provided GitHub token; defaults to `GITHUB_TOKEN`. Never used in tests. */
  githubToken?: string;
  /**
   * Owner GitHub account handle that an auto-provisioned repository is created
   * under (the owner's user/org login). Defaults to `GITHUB_OWNER`. When absent,
   * auto-provisioning surfaces a pending owner decision rather than guessing.
   */
  githubOwner?: string;
  /**
   * Factory for the project test runner the QA agent runs in the development
   * worktree (SER-240). Optional fake-injection seam for the end-to-end
   * orchestration proof (SER-242): a test supplies a deterministic passing or
   * failing runner so QA gates on a real result without spawning a subprocess.
   * Omitted in production, where the real {@link ProjectTestRunnerService} runs.
   */
  projectTestRunnerFactory?: ProjectTestRunnerFactory;
  /**
   * Git push surface for the delivery step (SER-241). Defaults to a real
   * {@link ProjectWorkspaceService} that pushes the run branch to the project's
   * linked remote. The end-to-end proof (SER-242) injects a pusher that
   * redirects the push to a local bare repo so no real GitHub account is ever
   * touched — mirroring the delivery unit test's `LocalBareRepoPusher`.
   */
  dispatchBranchPusher?: DispatchBranchPusher;
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

/**
 * Select the pending approvals that belong to a project by **structured fields
 * only** — the approval's `target` (or a `project_id` front-matter field) equal
 * to the project id.
 *
 * The previous implementation also matched `approval.scope.includes(project.name)`.
 * Scope is arbitrary owner free text and project names are frequently prefixes
 * of one another ("CRM" vs "CRM Redesign", "Acme App" vs "Acme App Redesign"),
 * so the substring test leaked one project's approvals into another's dispatch
 * packet and specialist handoffs (SER-179). Genuine project approvals are
 * created with `target: project.id`, so structured matching keeps them.
 */
export function pendingProjectApprovals(
  approvals: readonly ApprovalRecord[],
  project: ProjectRecord,
): ApprovalRecord[] {
  return approvals.filter(
    (approval) => approval.target === project.id || approval["project_id"] === project.id,
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
  private readonly githubPrPublishClient?: GitHubPullRequestPublishClient;
  private readonly githubRepoProvisionClient?: GitHubRepositoryProvisionClient;
  private readonly githubOwner?: string;
  private readonly projectTestRunnerFactory?: ProjectTestRunnerFactory;
  private readonly dispatchBranchPusher?: DispatchBranchPusher;

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
    // Delivery PR client (SER-241): an injected fake in tests, otherwise a real
    // Octokit client ONLY when an owner-provided token exists. With no token the
    // client stays undefined so no network call is ever made by default.
    const githubToken = deps.githubToken ?? this.providerEnv["GITHUB_TOKEN"];
    const octokit = githubToken ? new OctokitGitHubClient({ token: githubToken }) : undefined;
    this.githubPrPublishClient = deps.githubPrPublishClient ?? octokit;
    // Repo auto-provision client: an injected fake in tests, otherwise the same
    // real Octokit client (it also implements createRepository) ONLY when a token
    // exists. The owner handle defaults to GITHUB_OWNER; with no owner, delivery
    // surfaces a pending owner decision rather than guessing an account.
    this.githubRepoProvisionClient = deps.githubRepoProvisionClient ?? octokit;
    this.githubOwner = deps.githubOwner ?? this.providerEnv["GITHUB_OWNER"];
    this.projectTestRunnerFactory = deps.projectTestRunnerFactory;
    this.dispatchBranchPusher = deps.dispatchBranchPusher;
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

    // Resolve the run's tracked work item. An explicit `source` work item (e.g.
    // `linear://issue/SER-242`) always wins. Otherwise, an EXPLICIT owner build
    // (AB-U5) is stamped with a recorded `owner_build` work item derived from the
    // project/opportunity, so the development agent's `linked_issue` gate is
    // satisfied traceably by a recorded reference — never by removing the gate.
    // Autonomous/scheduler dispatches pass neither and still fail-close.
    const explicitSourceWorkItem = input.source
      ? sourceWorkItemFromTriggerSource(input.source)
      : undefined;
    const sourceWorkItem: SourceWorkItemInput | undefined =
      explicitSourceWorkItem ??
      (input.ownerBuild
        ? ownerBuildSourceWorkItem({
            projectId: project.id,
            ...(input.opportunityId ? { opportunityId: input.opportunityId } : {}),
          })
        : undefined);

    const run = await this.runs.start({
      type: runType,
      triggerType: "owner_request",
      triggerSource: input.source ?? "project_dispatch",
      scope,
      createdBy: ownership.manager_agent_id,
      ...(client ? { clientId: client.id } : {}),
      projectId: project.id,
      ...(sourceWorkItem ? { sourceWorkItem } : {}),
    });
    // This service's RunEngine has no dispatcher, so `start()` stub-completes the
    // run immediately. The real pipeline runs below (dispatchRun) for a long time
    // — reflect that lifecycle so progress consumers (the owner build card polling
    // GET /runs) see it running, not instantly "completed". Final status is set
    // after the pipeline finishes.
    await this.runs.patch(run.id, { status: "in_progress" });

    // Traceability for an explicit owner build (AB-U5): record WHAT authorized
    // the code edit (the owner build request + the work item the run carries) as
    // a durable artifact + audit line, so the relaxed `linked_issue` gate is
    // always backed by an inspectable authorization record, not an opaque bypass.
    if (input.ownerBuild && sourceWorkItem) {
      await this.recordOwnerBuildAuthorization({
        project,
        ...(client ? { client } : {}),
        run,
        sourceWorkItem,
        scope,
      });
    }

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
    // The development agent needs a real Codex runtime AND a policy-gated
    // capability checker as a pair, or its edit_code/run_tests gates fail closed
    // (SER-239). Built from config off this service's own policy/approvals/audit
    // so the run/dispatch paths share one construction (see buildDevelopmentExecution).
    const { developmentRuntime, capabilityUse } = await buildDevelopmentExecution(
      this.workspaceRoot,
      this.config,
      {
        artifacts: this.artifacts,
        approvals: this.approvals,
        policy: this.policy,
        audit: this.audit,
        env: this.providerEnv,
      },
    );
    // Provision an isolated git worktree for a code run so the development agent
    // edits real code off the .bureauos workspace and isolated from other runs
    // (SER-243/239). Only when a real runtime will actually run a development
    // step; planning-only runs get no worktree.
    const workspace = new ProjectWorkspaceService(this.workspaceRoot);
    const worktree =
      developmentRuntime && pipeline.includes("development")
        ? await workspace.acquireRunWorktree(project.slug, run.id)
        : undefined;

    let dispatch: DispatchOutput;
    // The run branch's commit (when the run produced one) gates delivery: only a
    // real commit is pushed and opened as a PR (SER-241). Captured from the
    // commit-before-release step below so it survives the worktree teardown.
    let commitResult: RunCommitResult | undefined;
    try {
      dispatch = await dispatchRun(
        {
          audit: this.audit,
          artifacts: this.artifacts,
          policy: this.policy,
          config: this.config,
          ...(providerRouter ? { providerRouter } : {}),
          ...(developmentRuntime ? { developmentRuntime } : {}),
          ...(capabilityUse ? { capabilityUse } : {}),
          ...(this.projectTestRunnerFactory
            ? { projectTestRunnerFactory: this.projectTestRunnerFactory }
            : {}),
        },
        {
          workspaceRoot: this.workspaceRoot,
          run,
          scope,
          briefing: `Project dispatch packet: ${packet.id}\n\n${briefing}`,
          contextArtifactIds: [packet.id],
          contextArtifactIdsByRole,
          ...(worktree ? { codeWorkspaceRoot: worktree.path } : {}),
        },
      );
    } finally {
      if (worktree) {
        try {
          // Persist the run's edits onto its branch before tearing down the
          // worktree — a forced worktree removal would discard uncommitted work.
          // A no-op when the run changed nothing (e.g. blocked on a gate). The
          // branch survives for the gated push/PR delivery (SER-241).
          commitResult = await workspace.commitRunWork(
            project.slug,
            run.id,
            `bureauos(${project.slug}): ${scope}`,
          );
        } catch (error) {
          // Never let a commit failure mask a dispatch error or skip cleanup:
          // audit it and still release the worktree below.
          await this.audit.append({
            actor: "supreme_coordinator",
            action: "project.dispatch.worktree_commit_failed",
            target: run.id,
            error: error instanceof Error ? error.message : String(error),
            result: "error",
          });
        }
        await workspace.releaseRunWorktree(project.slug, run.id);
      }
    }
    const producedArtifactIds = dispatch.steps.flatMap((step) => step.artifactIds);
    await this.runs.attachArtifacts(run.id, [
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

    // Set the run's real terminal status now that the pipeline finished (it was
    // moved to in_progress at dispatch start). A blocking specialist => blocked,
    // otherwise completed. This is what the owner build card reads as "done".
    const finalRun = await this.runs.patch(run.id, {
      status: blockedSteps.length > 0 ? "blocked" : "completed",
    });

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

    // Delivery (SER-241): after a successful, committed code run, push the run
    // branch and open a policy-gated draft PR. Fires only when the run was not
    // blocked, a worktree existed, a commit was produced, and the project has a
    // linked repository; the delivery helper enforces every precondition and the
    // push/PR gates, and never throws for an expected gate/parse failure.
    const delivery = await this.deliverRun({
      project,
      run,
      scope,
      commit: commitResult,
      hadWorktree: Boolean(worktree),
      runOk: blockedSteps.length === 0,
    });

    const summary = this.dispatchSummary({
      project,
      pipeline,
      handoffs,
      blockedSteps,
      delivery,
    });
    const nextActions = this.dispatchNextActions({ blockers, blockedSteps, delivery });

    return {
      summary,
      next_actions: nextActions,
      project,
      ownership,
      ...(client ? { client } : {}),
      run: finalRun,
      pipeline,
      packet,
      handoffs,
      dispatch,
      artifacts: [packet, ...handoffs.map((handoff) => handoff.artifact)],
      ...(delivery ? { delivery } : {}),
    };
  }

  /**
   * Record the authorization for an explicit owner build (AB-U5): a durable
   * artifact plus an audit line stating that the owner's explicit build request
   * is what authorized the development agent to edit code for this run, and which
   * recorded work item the run carries to satisfy `linked_issue`. This keeps the
   * relaxed gate fully traceable — the chain from owner request -> work item ->
   * code edit is inspectable, and the relaxation never applies to a run without
   * this record. Never throws out of the dispatch path.
   */
  private async recordOwnerBuildAuthorization(args: {
    project: ProjectRecord;
    client?: ClientRecord;
    run: RunRecord;
    sourceWorkItem: SourceWorkItemInput;
    scope: string;
  }): Promise<void> {
    const { project, client, run, sourceWorkItem, scope } = args;
    try {
      const artifact = await this.artifacts.write({
        type: "decision-record",
        createdBy: "supreme_coordinator",
        runId: run.id,
        projectId: project.id,
        ...(client ? { clientId: client.id } : {}),
        metadata: {
          authorization: "owner_build_request",
          trigger_type: run.trigger_type,
          source_work_item_type: sourceWorkItem.type,
          source_work_item_id: sourceWorkItem.identifier,
          satisfies_gate: "linked_issue",
          authorizes_capability: "codex.edit_code",
        },
        body: `# Owner Build Authorization

The owner explicitly asked the Coordinator to build this work. That explicit
request is both the authorization for the development agent to edit code in the
run's isolated worktree AND the tracked work item for this run.

- Run: ${run.id}
- Trigger: ${run.trigger_type}
- Project: ${project.name} (${project.id})
- Scope: ${scope}
- Tracked work item: ${sourceWorkItem.type}:${sourceWorkItem.identifier}

## Scope of this authorization

- Satisfies the \`linked_issue\` capability gate via the recorded work item above.
- Authorizes \`codex.edit_code\` (local edits in the run's isolated worktree) ONLY.
- Does NOT authorize push, pull request, merge, deploy, billing, secrets, or any
  client/public action — those remain policy-gated as usual.
`,
      });
      await this.audit.append({
        actor: "supreme_coordinator",
        action: "project.dispatch.owner_build_authorized",
        target: run.id,
        artifact_id: artifact.id,
        capability: "codex.edit_code",
        result: "ok",
      });
    } catch (error) {
      // Traceability recording must never mask or fail the dispatch. Audit the
      // recording failure and continue; the run's `source_work_item_*` (already
      // persisted on the run record) remains the authoritative trace.
      await this.audit.append({
        actor: "supreme_coordinator",
        action: "project.dispatch.owner_build_authorization_failed",
        target: run.id,
        result: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Run the post-run delivery step (SER-241): push the run branch and open a
   * policy-gated draft PR. Returns `undefined` only for the no-delivery
   * preconditions (run blocked / no worktree / no commit) so today's behavior is
   * preserved; otherwise the delivery helper owns the gating and always returns a
   * result (delivered / blocked / skipped).
   */
  private async deliverRun(args: {
    project: ProjectRecord;
    run: RunRecord;
    scope: string;
    commit: RunCommitResult | undefined;
    hadWorktree: boolean;
    runOk: boolean;
  }): Promise<DispatchDeliveryResult | undefined> {
    // No commit / no worktree / blocked -> today's no-delivery behavior, no
    // delivery attempt at all (off-by-default safe).
    if (!args.runOk || !args.hadWorktree || !args.commit?.committed) return undefined;

    return deliverDispatchedRun(
      {
        workspaceRoot: this.workspaceRoot,
        config: this.config,
        workspace: this.dispatchBranchPusher ?? new ProjectWorkspaceService(this.workspaceRoot),
        policy: this.policy,
        audit: this.audit,
        artifacts: this.artifacts,
        projects: this.projects,
        clients: this.clients,
        approvals: this.approvals,
        ...(this.githubPrPublishClient ? { githubClient: this.githubPrPublishClient } : {}),
        ...(this.githubRepoProvisionClient
          ? { githubRepoProvisionClient: this.githubRepoProvisionClient }
          : {}),
        ...(this.githubOwner ? { githubOwner: this.githubOwner } : {}),
      },
      {
        project: args.project,
        run: args.run,
        scope: args.scope,
        commit: args.commit,
        hadWorktree: args.hadWorktree,
        runOk: args.runOk,
        producedArtifacts: await this.artifacts.list({ run_id: args.run.id }),
      },
    );
  }

  private dispatchSummary(args: {
    project: ProjectRecord;
    pipeline: readonly string[];
    handoffs: readonly AgentHandoff[];
    blockedSteps: readonly { role: string }[];
    delivery?: DispatchDeliveryResult;
  }): string {
    const { project, pipeline, handoffs, blockedSteps, delivery } = args;
    if (blockedSteps.length > 0) {
      return `Dispatched ${project.name} to ${pipeline.length} roles; ${blockedSteps.length} blocked (${blockedSteps
        .map((step) => step.role)
        .join(", ")}). Owner resolution required before delivery.`;
    }
    const base = `Dispatched ${project.name} to ${pipeline.length} roles with ${handoffs.length} handoff packets.`;
    if (delivery?.status === "delivered") {
      return `${base} Delivered: opened draft PR ${delivery.pullRequestUrl}.`;
    }
    if (delivery?.status === "blocked") {
      return `${base} Delivery blocked, pending owner decision: ${delivery.reason}.`;
    }
    return base;
  }

  private dispatchNextActions(args: {
    blockers: readonly string[];
    blockedSteps: readonly unknown[];
    delivery?: DispatchDeliveryResult;
  }): string[] {
    const { blockers, blockedSteps, delivery } = args;
    if (blockedSteps.length > 0) {
      return [
        `Resolve specialist blockers before delivery: ${blockers.join("; ")}.`,
        "Review the project RISKS.md entry for the blocked dispatch.",
        "Re-dispatch once blockers are cleared, or escalate for owner intervention.",
      ];
    }
    if (delivery?.status === "delivered") {
      return [
        `Review the draft PR before merge: ${delivery.pullRequestUrl}.`,
        "Merge and production deploy remain separate approval-gated actions.",
        "Use the dispatch packet as the project-scoped context source for follow-up runs.",
      ];
    }
    if (delivery?.status === "blocked") {
      return [
        `Resolve the delivery gate to push/open the PR: ${delivery.reason}.`,
        ...(delivery.approvalId
          ? [`Approve or reject pending owner decision ${delivery.approvalId}.`]
          : []),
        "The run's work is committed on its branch and preserved for delivery once unblocked.",
      ];
    }
    return [
      "Review specialist artifacts before creating dev-ready GitHub issues.",
      "Resolve pending approval gates before external commitments.",
      "Use the dispatch packet as the project-scoped context source for follow-up runs.",
    ];
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
