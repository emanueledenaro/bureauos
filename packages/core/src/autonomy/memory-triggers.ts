import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import {
  ClientIntelligenceService,
  type ClientIntelligenceItem,
} from "../clients/intelligence.js";
import { ClientSuccessStatusService } from "../clients/success-status.js";
import type { PolicyDecision, PolicyEngine } from "../policy/engine.js";
import { dispatchRun, type CoordinatorDeps } from "../runs/coordinator.js";
import { RunEngine, type RunRecord, type RunType } from "../runs/engine.js";

export type MemoryTriggerKind = "client_follow_up_due";

export interface MemoryTriggerInput {
  now?: Date;
}

export interface TriggeredMemoryRun {
  kind: MemoryTriggerKind;
  triggerSource: string;
  run: RunRecord;
  artifactIds: string[];
}

export interface SkippedMemoryTrigger {
  kind: MemoryTriggerKind;
  triggerSource: string;
  reason: "duplicate" | "policy_blocked";
}

export interface MemoryTriggerResult {
  triggered: TriggeredMemoryRun[];
  skipped: SkippedMemoryTrigger[];
}

export interface MemoryTriggerDeps {
  runs: RunEngine;
  audit: AuditLog;
  policy: PolicyEngine;
  artifacts?: ArtifactStore;
  intelligence?: ClientIntelligenceService;
  coordinator?: CoordinatorDeps;
}

interface Candidate {
  kind: MemoryTriggerKind;
  action: string;
  capability: string;
  runType: RunType;
  triggerSource: string;
  scope: string;
  briefing: string;
  client: ClientIntelligenceItem;
}

function policyResult(
  decision: PolicyDecision,
): "allow" | "deny" | "escalate" | "require_approval" {
  if (decision.outcome === "allow") return "allow";
  if (decision.outcome === "deny") return "deny";
  if (decision.outcome === "escalate") return "escalate";
  return "require_approval";
}

function followUpCandidate(item: ClientIntelligenceItem): Candidate {
  return {
    kind: "client_follow_up_due",
    action: "draft_replies",
    capability: "bureauos.client_follow_up",
    runType: "client_success",
    triggerSource: `bureauos.memory_due:client_follow_up:${item.client.id}:${item.relationship.next_follow_up_at}`,
    scope: `Prepare due client follow-up for ${item.client.name}`,
    client: item,
    briefing: [
      `Client: ${item.client.name}`,
      `Client ID: ${item.client.id}`,
      `Status: ${item.client.status}`,
      `Risk: ${item.risk}`,
      `Next follow-up due: ${item.relationship.next_follow_up_at}`,
      `Last client message: ${item.relationship.last_client_message_at || "(none recorded)"}`,
      `Last owner response: ${item.relationship.last_owner_response_at || "(none recorded)"}`,
      `Open pipeline: ${item.revenue.pipeline_value}`,
      `Blocked projects: ${item.delivery.blocked_projects}`,
      "",
      "Goal: prepare an internal client-success status report and a safe draft follow-up. Do not send the message without owner approval.",
    ].join("\n"),
  };
}

function shouldTriggerFollowUp(item: ClientIntelligenceItem): boolean {
  return (
    (item.client.status === "active" || item.client.status === "lead") &&
    item.relationship.follow_up_due &&
    Boolean(item.relationship.next_follow_up_at)
  );
}

export class MemoryTriggerService {
  private readonly artifacts: ArtifactStore;
  private readonly intelligence: ClientIntelligenceService;

  constructor(
    private readonly workspaceRoot: string,
    private readonly deps: MemoryTriggerDeps,
  ) {
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.intelligence = deps.intelligence ?? new ClientIntelligenceService(workspaceRoot);
  }

  async scan(input: MemoryTriggerInput = {}): Promise<MemoryTriggerResult> {
    const now = input.now ?? new Date();
    const [summary, runs] = await Promise.all([
      this.intelligence.summarize(now),
      this.deps.runs.list(),
    ]);
    const knownSources = new Set(runs.map((run) => run.trigger_source));
    const candidates = summary.clients.filter(shouldTriggerFollowUp).map(followUpCandidate);
    const triggered: TriggeredMemoryRun[] = [];
    const skipped: SkippedMemoryTrigger[] = [];

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
          action: "memory.trigger.blocked",
          target: candidate.triggerSource,
          capability: candidate.capability,
          policy_result: policyResult(decision),
          result: "ok",
        });
        continue;
      }

      const run = await this.deps.runs.start({
        type: candidate.runType,
        triggerType: "memory_due",
        triggerSource: candidate.triggerSource,
        scope: candidate.scope,
        clientId: candidate.client.client.id,
      });
      knownSources.add(candidate.triggerSource);

      let artifactIds: string[] = [];
      try {
        const result = await new ClientSuccessStatusService(this.workspaceRoot, {
          intelligence: this.intelligence,
          artifacts: this.artifacts,
          audit: this.deps.audit,
        }).generate({
          runId: run.id,
          clientId: candidate.client.client.id,
          now,
        });
        artifactIds = result.reports.map((report: ArtifactRecord) => report.id);
        if (artifactIds.length > 0) {
          await this.deps.runs.attachArtifacts(run.id, artifactIds);
          await this.deps.audit.append({
            actor: "supreme_coordinator",
            action: "memory.trigger.fulfilled",
            target: run.id,
            capability: candidate.capability,
            artifact_id: artifactIds[0],
            result: "ok",
          });
        }
      } catch (error) {
        await this.deps.audit.append({
          actor: "supreme_coordinator",
          action: "memory.trigger.fulfillment_failed",
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
        artifactIds,
      });
      await this.deps.audit.append({
        actor: "supreme_coordinator",
        action: "memory.trigger.run_started",
        target: run.id,
        capability: candidate.capability,
        result: "ok",
      });

      if (this.deps.coordinator && run.status !== "needs_human") {
        await dispatchRun(this.deps.coordinator, {
          workspaceRoot: this.workspaceRoot,
          run,
          scope: candidate.scope,
          briefing: candidate.briefing,
          ...(artifactIds.length > 0 ? { contextArtifactIds: artifactIds } : {}),
        });
      }
    }

    return { triggered, skipped };
  }
}
