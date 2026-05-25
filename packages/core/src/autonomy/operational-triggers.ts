import { ArtifactStore, type ArtifactRecord, type ArtifactType } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { ClientAccountPlanService } from "../clients/account-plans.js";
import { GrowthContentPipelineService } from "../growth/content-pipeline.js";
import type { PolicyDecision, PolicyEngine } from "../policy/engine.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";
import { ProjectHealthReviewService } from "./project-health.js";
import { dispatchRun, type CoordinatorDeps } from "../runs/coordinator.js";
import { RunEngine, type RunRecord, type RunType } from "../runs/engine.js";

export type OperationalSignalTriggerKind =
  | "blocked_project_age"
  | "blocked_run_age"
  | "unanswered_client_message_age"
  | "empty_content_pipeline";

export interface OperationalSignalThresholds {
  blockedProjectDays: number;
  blockedRunDays: number;
  unansweredClientMessageDays: number;
  emptyContentPipelineDays: number;
}

export interface OperationalSignalTriggerInput {
  now?: Date;
  thresholds?: Partial<OperationalSignalThresholds>;
}

export interface TriggeredOperationalRun {
  kind: OperationalSignalTriggerKind;
  triggerSource: string;
  run: RunRecord;
  artifactIds: string[];
}

export interface SkippedOperationalSignal {
  kind: OperationalSignalTriggerKind;
  triggerSource: string;
  reason: "duplicate" | "policy_blocked";
}

export interface OperationalSignalTriggerResult {
  triggered: TriggeredOperationalRun[];
  skipped: SkippedOperationalSignal[];
  report?: ArtifactRecord;
}

export interface OperationalSignalTriggerDeps {
  runs: RunEngine;
  audit: AuditLog;
  policy: PolicyEngine;
  artifacts?: ArtifactStore;
  clients?: ClientRegistry;
  projects?: ProjectRegistry;
  coordinator?: CoordinatorDeps;
}

interface Candidate {
  kind: OperationalSignalTriggerKind;
  action: string;
  capability: string;
  runType: RunType;
  triggerSource: string;
  scope: string;
  briefing: string;
  projectId?: string;
  clientId?: string;
}

const DEFAULT_THRESHOLDS: OperationalSignalThresholds = {
  blockedProjectDays: 2,
  blockedRunDays: 2,
  unansweredClientMessageDays: 2,
  emptyContentPipelineDays: 7,
};

const CONTENT_PIPELINE_ARTIFACT_TYPES = new Set<ArtifactType>([
  "brand-brief",
  "offer-brief",
  "campaign-brief",
  "social-post-brief",
  "creative-brief",
  "ad-campaign-brief",
  "conversion-audit",
]);

function policyResult(
  decision: PolicyDecision,
): "allow" | "deny" | "escalate" | "require_approval" {
  if (decision.outcome === "allow") return "allow";
  if (decision.outcome === "deny") return "deny";
  if (decision.outcome === "escalate") return "escalate";
  return "require_approval";
}

function dateMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function daysAgo(now: Date, days: number): number {
  return now.getTime() - days * 24 * 60 * 60 * 1000;
}

function isOlderThan(value: string | undefined, cutoffMs: number): boolean {
  const timestamp = dateMs(value);
  return timestamp !== undefined && timestamp <= cutoffMs;
}

function latestTimestamp(records: readonly ArtifactRecord[]): string | undefined {
  return records
    .map((record) => record.created)
    .filter((created) => dateMs(created) !== undefined)
    .sort()
    .at(-1);
}

function blockedProjectCandidate(project: ProjectRecord): Candidate {
  return {
    kind: "blocked_project_age",
    action: "start_triage_runs",
    capability: "bureauos.project_blocked",
    runType: "health_check",
    triggerSource: `bureauos.project_blocked:${project.id}:${project.updated}`,
    scope: `Unblock project "${project.name}"`,
    projectId: project.id,
    clientId: project.client_id,
    briefing: [
      `Project: ${project.name}`,
      `Project ID: ${project.id}`,
      `Client ID: ${project.client_id}`,
      `Status: ${project.status}`,
      `Updated: ${project.updated}`,
      `Repository: ${project.repository || "(none)"}`,
      `Stack: ${project.stack || "(unspecified)"}`,
      "",
      "Goal: identify the blocker, produce a recovery plan, and escalate only the decisions that require the owner.",
    ].join("\n"),
  };
}

function blockedRunCandidate(run: RunRecord): Candidate {
  return {
    kind: "blocked_run_age",
    action: "start_triage_runs",
    capability: "bureauos.run_blocked",
    runType: "health_check",
    triggerSource: `bureauos.run_blocked:${run.id}:${run.updated}`,
    scope: `Review blocked run ${run.id}: ${run.scope}`,
    projectId: run.project_id || undefined,
    clientId: run.client_id || undefined,
    briefing: [
      `Blocked run: ${run.id}`,
      `Run type: ${run.type}`,
      `Scope: ${run.scope}`,
      `Project ID: ${run.project_id || "(none)"}`,
      `Client ID: ${run.client_id || "(none)"}`,
      `Updated: ${run.updated}`,
      "",
      "Goal: isolate why the run is blocked, create a next-action report, and request owner input only when policy requires it.",
    ].join("\n"),
  };
}

function unansweredClientCandidate(client: ClientRecord): Candidate {
  return {
    kind: "unanswered_client_message_age",
    action: "draft_replies",
    capability: "bureauos.client_follow_up",
    runType: "client_success",
    triggerSource: `bureauos.client_unanswered:${client.id}:${client.last_client_message_at}`,
    scope: `Prepare follow-up draft for ${client.name}`,
    clientId: client.id,
    briefing: [
      `Client: ${client.name}`,
      `Client ID: ${client.id}`,
      `Status: ${client.status}`,
      `Industry: ${client.industry}`,
      `Last client message: ${client.last_client_message_at}`,
      `Last owner response: ${client.last_owner_response_at || "(none recorded)"}`,
      `Next follow-up: ${client.next_follow_up_at || "(none recorded)"}`,
      "",
      "Goal: draft a safe client-success response or next action. Do not send the client message unless owner policy explicitly allows it.",
    ].join("\n"),
  };
}

function emptyContentPipelineCandidate(args: {
  now: Date;
  thresholdDays: number;
  latestGrowthArtifactCreated?: string;
}): Candidate {
  const since = new Date(daysAgo(args.now, args.thresholdDays)).toISOString();
  return {
    kind: "empty_content_pipeline",
    action: "draft_content",
    capability: "bureauos.content_pipeline",
    runType: "content",
    triggerSource: `bureauos.content_pipeline_empty:${args.latestGrowthArtifactCreated ?? "none"}:${args.thresholdDays}d`,
    scope: "Rebuild empty growth content pipeline",
    briefing: [
      `No growth/content artifacts found since ${since}.`,
      `Latest growth artifact: ${args.latestGrowthArtifactCreated ?? "(none)"}`,
      "",
      "Goal: create safe draft-only visibility assets for BureauOS or active client work. Public posting and paid ads remain approval-gated.",
    ].join("\n"),
  };
}

function hasUnansweredClientMessage(client: ClientRecord, cutoffMs: number): boolean {
  const messageAt = dateMs(client.last_client_message_at);
  if (messageAt === undefined || messageAt > cutoffMs) return false;
  const responseAt = dateMs(client.last_owner_response_at);
  return responseAt === undefined || responseAt < messageAt;
}

function shouldConsiderBlockedRun(run: RunRecord, cutoffMs: number): boolean {
  if (run.status !== "blocked") return false;
  if (run.trigger_type === "threshold") return false;
  if (run.trigger_source.startsWith("bureauos.")) return false;
  return isOlderThan(run.updated, cutoffMs);
}

function reportBody(now: Date, candidates: readonly Candidate[]): string {
  return `# Operational Signal Report

Generated: ${now.toISOString()}

## Signals

${candidates
  .map((candidate) => {
    return `- ${candidate.kind}: ${candidate.scope}
  - Trigger: ${candidate.triggerSource}
  - Capability: ${candidate.capability}
  - Action: ${candidate.action}`;
  })
  .join("\n")}
`;
}

function uniqueIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

export class OperationalSignalTriggerService {
  private readonly artifacts: ArtifactStore;
  private readonly clients: ClientRegistry;
  private readonly projects: ProjectRegistry;

  constructor(
    private readonly workspaceRoot: string,
    private readonly deps: OperationalSignalTriggerDeps,
  ) {
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.clients = deps.clients ?? new ClientRegistry(workspaceRoot);
    this.projects = deps.projects ?? new ProjectRegistry(workspaceRoot);
  }

  async scan(input: OperationalSignalTriggerInput = {}): Promise<OperationalSignalTriggerResult> {
    const now = input.now ?? new Date();
    const thresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) };
    const [projects, clients, artifacts, runs] = await Promise.all([
      this.projects.list(),
      this.clients.list(),
      this.artifacts.list(),
      this.deps.runs.list(),
    ]);
    const knownSources = new Set(runs.map((run) => run.trigger_source));
    const blockedProjectCutoff = daysAgo(now, thresholds.blockedProjectDays);
    const blockedRunCutoff = daysAgo(now, thresholds.blockedRunDays);
    const unansweredClientCutoff = daysAgo(now, thresholds.unansweredClientMessageDays);
    const contentCutoff = daysAgo(now, thresholds.emptyContentPipelineDays);
    const growthArtifacts = artifacts.filter((artifact) =>
      CONTENT_PIPELINE_ARTIFACT_TYPES.has(artifact.type),
    );
    const recentGrowthArtifacts = growthArtifacts.filter((artifact) => {
      const created = dateMs(artifact.created);
      return created !== undefined && created > contentCutoff;
    });

    const candidates: Candidate[] = [
      ...projects
        .filter(
          (project) =>
            project.status === "blocked" && isOlderThan(project.updated, blockedProjectCutoff),
        )
        .map(blockedProjectCandidate),
      ...runs
        .filter((run) => shouldConsiderBlockedRun(run, blockedRunCutoff))
        .map(blockedRunCandidate),
      ...clients
        .filter((client) => {
          return (
            (client.status === "active" || client.status === "lead") &&
            hasUnansweredClientMessage(client, unansweredClientCutoff)
          );
        })
        .map(unansweredClientCandidate),
      ...(recentGrowthArtifacts.length === 0
        ? [
            emptyContentPipelineCandidate({
              now,
              thresholdDays: thresholds.emptyContentPipelineDays,
              latestGrowthArtifactCreated: latestTimestamp(growthArtifacts),
            }),
          ]
        : []),
    ];

    const actionable = candidates.filter((candidate) => !knownSources.has(candidate.triggerSource));
    const report =
      actionable.length > 0
        ? await this.artifacts.write({
            type: "operational-signal-report",
            createdBy: "supreme_coordinator",
            body: reportBody(now, actionable),
            status: "submitted",
            metadata: {
              generated_at: now.toISOString(),
              signal_count: actionable.length,
            },
          })
        : undefined;

    const triggered: TriggeredOperationalRun[] = [];
    const skipped: SkippedOperationalSignal[] = [];

    for (const candidate of candidates) {
      if (knownSources.has(candidate.triggerSource)) {
        skipped.push({
          kind: candidate.kind,
          triggerSource: candidate.triggerSource,
          reason: "duplicate",
        });
        continue;
      }

      const decision = await this.deps.policy.evaluate({
        action: candidate.action,
        actor: "supreme_coordinator",
        target: candidate.triggerSource,
        capability: candidate.capability,
      });
      if (!decision.allowed) {
        skipped.push({
          kind: candidate.kind,
          triggerSource: candidate.triggerSource,
          reason: "policy_blocked",
        });
        await this.deps.audit.append({
          actor: "supreme_coordinator",
          action: "operational.signal_trigger.blocked",
          target: candidate.triggerSource,
          capability: candidate.capability,
          policy_result: policyResult(decision),
          ...(report ? { artifact_id: report.id } : {}),
          result: "ok",
        });
        continue;
      }

      const run = await this.deps.runs.start({
        type: candidate.runType,
        triggerType: "threshold",
        triggerSource: candidate.triggerSource,
        scope: candidate.scope,
        ...(candidate.projectId ? { projectId: candidate.projectId } : {}),
        ...(candidate.clientId ? { clientId: candidate.clientId } : {}),
      });
      if (report) await this.deps.runs.attachArtifacts(run.id, [report.id]);
      knownSources.add(candidate.triggerSource);

      let fulfillmentArtifactIds: string[] = [];
      try {
        fulfillmentArtifactIds = await this.fulfillCandidate(candidate, run, now);
        if (fulfillmentArtifactIds.length > 0) {
          await this.deps.runs.attachArtifacts(run.id, fulfillmentArtifactIds);
          await this.deps.audit.append({
            actor: "supreme_coordinator",
            action: "operational.signal_trigger.fulfilled",
            target: run.id,
            capability: candidate.capability,
            artifact_id: fulfillmentArtifactIds[0],
            result: "ok",
          });
        }
      } catch (error) {
        await this.deps.audit.append({
          actor: "supreme_coordinator",
          action: "operational.signal_trigger.fulfillment_failed",
          target: run.id,
          capability: candidate.capability,
          error: error instanceof Error ? error.message : String(error),
          result: "error",
        });
      }

      triggered.push({
        kind: candidate.kind,
        triggerSource: candidate.triggerSource,
        run,
        artifactIds: fulfillmentArtifactIds,
      });
      await this.deps.audit.append({
        actor: "supreme_coordinator",
        action: "operational.signal_trigger.run_started",
        target: run.id,
        capability: candidate.capability,
        ...(report ? { artifact_id: report.id } : {}),
        result: "ok",
      });

      if (this.deps.coordinator && run.status !== "needs_human") {
        const contextArtifactIds = uniqueIds([
          ...(report ? [report.id] : []),
          ...fulfillmentArtifactIds,
        ]);
        await dispatchRun(this.deps.coordinator, {
          workspaceRoot: this.workspaceRoot,
          run,
          scope: candidate.scope,
          briefing: candidate.briefing,
          ...(contextArtifactIds.length > 0 ? { contextArtifactIds } : {}),
        });
      }
    }

    return { triggered, skipped, ...(report ? { report } : {}) };
  }

  private async fulfillCandidate(
    candidate: Candidate,
    run: RunRecord,
    now: Date,
  ): Promise<string[]> {
    switch (candidate.kind) {
      case "empty_content_pipeline": {
        const result = await new GrowthContentPipelineService(this.workspaceRoot, {
          artifacts: this.artifacts,
          audit: this.deps.audit,
        }).generate({
          runId: run.id,
          now,
          maxDrafts: 4,
          focus: "Autonomous empty content pipeline recovery",
        });
        return [result.report.id, ...result.drafts.map((draft) => draft.artifact.id)];
      }
      case "unanswered_client_message_age": {
        if (!candidate.clientId) return [];
        const result = await new ClientAccountPlanService(this.workspaceRoot, {
          artifacts: this.artifacts,
          audit: this.deps.audit,
        }).generate({
          runId: run.id,
          clientId: candidate.clientId,
          now,
        });
        return result.plans.map((plan) => plan.id);
      }
      case "blocked_project_age":
      case "blocked_run_age": {
        if (!candidate.projectId) return [];
        const result = await new ProjectHealthReviewService(this.workspaceRoot, {
          artifacts: this.artifacts,
          audit: this.deps.audit,
          runs: this.deps.runs,
        }).generate({
          runId: run.id,
          projectId: candidate.projectId,
          now,
        });
        return [result.report.id];
      }
    }
  }
}
