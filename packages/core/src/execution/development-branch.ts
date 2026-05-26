import { slugify } from "../ids.js";
import { workspacePaths } from "../paths.js";
import { AuditLog } from "../audit/log.js";
import { PolicyEngine, type PolicyDecision, type PolicyOutcome } from "../policy/engine.js";

export interface DevelopmentBranchClient {
  branchExists(branchName: string): Promise<boolean>;
  createBranch(input: DevelopmentBranchCreateRequest): Promise<void>;
}

export interface DevelopmentBranchCreateRequest {
  branchName: string;
  baseRef?: string;
  force: false;
}

export interface DevelopmentBranchInput {
  runId: string;
  scope: string;
  actor?: string;
  linearIssueIdentifier?: string;
  baseRef?: string;
}

export interface DevelopmentBranchSafety {
  force: false;
  historyRewrite: false;
}

export interface DevelopmentBranchResult {
  status: "created" | "blocked";
  branchName: string;
  attemptedBranchNames: string[];
  policy: PolicyDecision;
  safety: DevelopmentBranchSafety;
  reason?: string;
  baseRef?: string;
}

export interface DevelopmentBranchServiceDeps {
  audit?: AuditLog;
  policy: PolicyEngine;
  branchClient: DevelopmentBranchClient;
}

const BRANCH_PREFIX = "bureauos";
const MAX_SLUG_LENGTH = 56;
const MAX_RUN_SUFFIX_LENGTH = 16;

function auditPolicyResult(
  outcome: PolicyOutcome,
): "allow" | "deny" | "require_approval" | "escalate" {
  if (outcome === "allow") return "allow";
  if (outcome === "deny") return "deny";
  if (outcome === "escalate") return "escalate";
  return "require_approval";
}

function shortSlug(input: string, max = MAX_SLUG_LENGTH): string {
  return slugify(input)
    .slice(0, max)
    .replace(/^-+|-+$/g, "");
}

function shortRunId(runId: string): string {
  return shortSlug(runId, MAX_RUN_SUFFIX_LENGTH);
}

export function branchNameForDevelopmentRun(input: DevelopmentBranchInput): string {
  const identity = shortSlug(input.linearIssueIdentifier ?? input.runId);
  const scope = shortSlug(input.scope);
  const suffix = scope ? `${identity}-${scope}` : identity;
  return `${BRANCH_PREFIX}/${suffix}`;
}

function branchNameWithRunSuffix(branchName: string, runId: string): string {
  return `${branchName}-${shortRunId(runId)}`;
}

const SAFETY: DevelopmentBranchSafety = {
  force: false,
  historyRewrite: false,
};

export class DevelopmentBranchService {
  private readonly audit: AuditLog;
  private readonly policy: PolicyEngine;
  private readonly branchClient: DevelopmentBranchClient;

  constructor(
    private readonly workspaceRoot: string,
    deps: DevelopmentBranchServiceDeps,
  ) {
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.policy = deps.policy;
    this.branchClient = deps.branchClient;
  }

  async create(input: DevelopmentBranchInput): Promise<DevelopmentBranchResult> {
    const actor = input.actor ?? "development";
    const preferredBranchName = branchNameForDevelopmentRun(input);
    const policy = await this.policy.evaluate({
      action: "create_branches",
      actor,
      target: preferredBranchName,
      capability: "git.create_branch",
      riskClass: "medium",
    });

    if (!policy.allowed) {
      await this.audit.append({
        actor,
        action: "development.branch.blocked",
        target: preferredBranchName,
        capability: "git.create_branch",
        policy_result: auditPolicyResult(policy.outcome),
        result: "ok",
      });
      return {
        status: "blocked",
        branchName: preferredBranchName,
        attemptedBranchNames: [preferredBranchName],
        policy,
        safety: SAFETY,
        reason: policy.reason,
        ...(input.baseRef ? { baseRef: input.baseRef } : {}),
      };
    }

    const candidates = await this.candidateBranchNames(input, preferredBranchName);
    const branchName = candidates.at(-1) ?? preferredBranchName;
    if (await this.branchClient.branchExists(branchName)) {
      const reason = `branch already exists: ${branchName}`;
      await this.audit.append({
        actor,
        action: "development.branch.blocked",
        target: branchName,
        capability: "git.create_branch",
        policy_result: "allow",
        result: "ok",
      });
      return {
        status: "blocked",
        branchName,
        attemptedBranchNames: candidates,
        policy: {
          ...policy,
          allowed: false,
          outcome: "require_approval",
          reason,
          required_gates: ["branch_conflict_review"],
        },
        safety: SAFETY,
        reason,
        ...(input.baseRef ? { baseRef: input.baseRef } : {}),
      };
    }

    await this.branchClient.createBranch({
      branchName,
      ...(input.baseRef ? { baseRef: input.baseRef } : {}),
      force: false,
    });

    await this.audit.append({
      actor,
      action: "development.branch.created",
      target: branchName,
      capability: "git.create_branch",
      policy_result: "allow",
      result: "ok",
    });

    return {
      status: "created",
      branchName,
      attemptedBranchNames: candidates,
      policy,
      safety: SAFETY,
      ...(input.baseRef ? { baseRef: input.baseRef } : {}),
    };
  }

  private async candidateBranchNames(
    input: DevelopmentBranchInput,
    preferredBranchName: string,
  ): Promise<string[]> {
    const candidates = [preferredBranchName];
    if (!(await this.branchClient.branchExists(preferredBranchName))) return candidates;
    const conflictBranchName = branchNameWithRunSuffix(preferredBranchName, input.runId);
    if (!candidates.includes(conflictBranchName)) candidates.push(conflictBranchName);
    return candidates;
  }
}
