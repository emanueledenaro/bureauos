import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { AuditLog } from "../audit/log.js";
import { CapabilityUseService, type CapabilityUseResult } from "../capabilities/usage.js";
import type { BureauConfig } from "../config/schema.js";
import { workspacePaths } from "../paths.js";
import { linearIssueSourceWorkItem } from "../work-items/source.js";

export interface LinearIssueActionExternalResult {
  id?: string;
  url?: string;
  status?: string;
}

export interface LinearIssueCommentAdapterInput {
  identifier: string;
  body: string;
}

export interface LinearIssueUpdateAdapterInput {
  identifier: string;
  title?: string;
  description?: string;
  labels?: readonly string[];
}

export interface LinearIssueStateAdapterInput {
  identifier: string;
  state: string;
}

export interface LinearIssueActionAdapter {
  commentIssue(input: LinearIssueCommentAdapterInput): Promise<LinearIssueActionExternalResult>;
  updateIssue(input: LinearIssueUpdateAdapterInput): Promise<LinearIssueActionExternalResult>;
  setIssueState(input: LinearIssueStateAdapterInput): Promise<LinearIssueActionExternalResult>;
}

export interface LinearIssueActionDeps {
  config: BureauConfig;
  capabilities?: CapabilityUseService;
  artifacts?: ArtifactStore;
  audit?: AuditLog;
  adapter: LinearIssueActionAdapter;
}

export interface LinearIssueActionBaseInput {
  identifier: string;
  agent?: string;
  issueUrl?: string;
  runId?: string;
}

export interface LinearIssueCommentInput extends LinearIssueActionBaseInput {
  body: string;
}

export interface LinearIssueUpdateInput extends LinearIssueActionBaseInput {
  title?: string;
  description?: string;
  labels?: readonly string[];
}

export interface LinearIssueStateInput extends LinearIssueActionBaseInput {
  state: string;
}

export interface LinearIssueActionResult {
  status: "completed" | "blocked";
  action: "comment" | "update_issues" | "set_issue_state";
  target: string;
  capability: CapabilityUseResult;
  artifact?: ArtifactRecord;
  externalResult?: LinearIssueActionExternalResult;
}

function normalizedIdentifier(identifier: string): string {
  return identifier.trim().toUpperCase();
}

function actionBody(args: {
  action: LinearIssueActionResult["action"];
  actor: string;
  target: string;
  capabilityArtifactId: string;
  externalResult: LinearIssueActionExternalResult;
  summary: string;
}): string {
  return `# Linear Issue Action

## Request

- Actor: ${args.actor}
- Action: ${args.action}
- Target: ${args.target}
- Capability audit artifact: ${args.capabilityArtifactId}

## External Result

- ID: ${args.externalResult.id ?? "(none)"}
- URL: ${args.externalResult.url ?? "(none)"}
- Status: ${args.externalResult.status ?? "(not reported)"}

## Summary

${args.summary}

## Execution Boundary

This artifact records a completed Linear issue action after BureauOS policy and capability checks. The host adapter performed the external MCP call; BureauOS keeps the local evidence and audit trail.
`;
}

export class LinearIssueActionService {
  private readonly capabilities: CapabilityUseService;
  private readonly artifacts: ArtifactStore;
  private readonly audit: AuditLog;
  private readonly adapter: LinearIssueActionAdapter;

  constructor(
    private readonly workspaceRoot: string,
    deps: LinearIssueActionDeps,
  ) {
    this.capabilities = deps.capabilities ?? new CapabilityUseService(workspaceRoot, deps);
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.adapter = deps.adapter;
  }

  async comment(input: LinearIssueCommentInput): Promise<LinearIssueActionResult> {
    const identifier = normalizedIdentifier(input.identifier);
    return this.runAction({
      input: { ...input, identifier },
      action: "comment",
      auditAction: "linear.issue.comment",
      summary: input.body,
      execute: () => this.adapter.commentIssue({ identifier, body: input.body }),
    });
  }

  async updateIssue(input: LinearIssueUpdateInput): Promise<LinearIssueActionResult> {
    const identifier = normalizedIdentifier(input.identifier);
    const patch = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.labels !== undefined ? { labels: [...input.labels] } : {}),
    };
    return this.runAction({
      input: { ...input, identifier },
      action: "update_issues",
      auditAction: "linear.issue.update",
      summary: `Updated fields: ${Object.keys(patch).join(", ") || "(none)"}`,
      execute: () => this.adapter.updateIssue({ identifier, ...patch }),
    });
  }

  async setIssueState(input: LinearIssueStateInput): Promise<LinearIssueActionResult> {
    const identifier = normalizedIdentifier(input.identifier);
    return this.runAction({
      input: { ...input, identifier },
      action: "set_issue_state",
      auditAction: "linear.issue.set_state",
      summary: `State: ${input.state}`,
      execute: () => this.adapter.setIssueState({ identifier, state: input.state }),
    });
  }

  private async runAction(args: {
    input: LinearIssueActionBaseInput;
    action: LinearIssueActionResult["action"];
    auditAction: string;
    summary: string;
    execute: () => Promise<LinearIssueActionExternalResult>;
  }): Promise<LinearIssueActionResult> {
    const actor = args.input.agent ?? "project_manager";
    const target = `linear://issue/${args.input.identifier}`;
    const capability = await this.capabilities.check({
      agent: actor,
      capabilityId: "linear",
      action: args.action,
      target,
    });

    if (capability.status !== "allowed") {
      return { status: "blocked", action: args.action, target, capability };
    }

    const externalResult = await args.execute();
    const artifact = await this.artifacts.write({
      type: "linear-issue-action-report",
      createdBy: actor,
      ...(args.input.runId ? { runId: args.input.runId } : {}),
      sourceWorkItem: linearIssueSourceWorkItem(args.input.identifier, args.input.issueUrl),
      metadata: {
        linear_identifier: args.input.identifier,
        linear_url: args.input.issueUrl ?? "",
        linear_action: args.action,
        target,
        capability_artifact_id: capability.artifact.id,
        external_result_id: externalResult.id ?? "",
        external_result_url: externalResult.url ?? "",
        external_result_status: externalResult.status ?? "",
      },
      body: actionBody({
        action: args.action,
        actor,
        target,
        capabilityArtifactId: capability.artifact.id,
        externalResult,
        summary: args.summary,
      }),
    });

    await this.audit.append({
      actor,
      action: args.auditAction,
      target,
      capability: `linear.${args.action}`,
      artifact_id: artifact.id,
      policy_result: "allow",
      result: "ok",
    });

    return {
      status: "completed",
      action: args.action,
      target,
      capability,
      artifact,
      externalResult,
    };
  }
}
