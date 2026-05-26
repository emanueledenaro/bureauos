import { CapabilityUseService, type CapabilityUseResult } from "../capabilities/usage.js";
import type { BureauConfig } from "../config/schema.js";
import {
  linearIssueToRunScope,
  type LinearIssueRunScope,
  type LinearIssueScopeInput,
} from "./work-scope.js";

export interface LinearIssueListInput {
  teamKey?: string;
  projectId?: string;
  state?: string;
  query?: string;
  limit?: number;
}

export interface LinearIssueAdapter {
  readIssue(identifier: string): Promise<LinearIssueScopeInput | undefined>;
  listIssues(input: LinearIssueListInput): Promise<readonly LinearIssueScopeInput[]>;
}

export interface LinearIssueReaderDeps {
  config: BureauConfig;
  capabilities?: CapabilityUseService;
  adapter: LinearIssueAdapter;
}

export interface LinearIssueReadInput {
  identifier: string;
  agent?: string;
}

export interface LinearIssueReadResult {
  status: "ready" | "needs_clarification" | "blocked" | "not_found";
  target: string;
  capability: CapabilityUseResult;
  issue?: LinearIssueScopeInput;
  scope?: LinearIssueRunScope;
}

export interface LinearIssueListResult {
  status: "listed" | "blocked";
  target: string;
  capability: CapabilityUseResult;
  issues: LinearIssueScopeInput[];
  scopes: LinearIssueRunScope[];
}

function normalizedIdentifier(identifier: string): string {
  return identifier.trim().toUpperCase();
}

function normalizeIssue(issue: LinearIssueScopeInput): LinearIssueScopeInput {
  return {
    ...issue,
    identifier: normalizedIdentifier(issue.identifier),
    labels: [...issue.labels],
  };
}

function listTarget(input: LinearIssueListInput): string {
  const params = new URLSearchParams();
  if (input.teamKey) params.set("team", input.teamKey);
  if (input.projectId) params.set("project", input.projectId);
  if (input.state) params.set("state", input.state);
  if (input.query) params.set("query", input.query);
  if (typeof input.limit === "number") params.set("limit", String(input.limit));
  const query = params.toString();
  return query ? `linear://issues?${query}` : "linear://issues";
}

export class LinearIssueReaderService {
  private readonly capabilities: CapabilityUseService;
  private readonly adapter: LinearIssueAdapter;

  constructor(
    private readonly workspaceRoot: string,
    deps: LinearIssueReaderDeps,
  ) {
    this.capabilities = deps.capabilities ?? new CapabilityUseService(workspaceRoot, deps);
    this.adapter = deps.adapter;
  }

  async readIssue(input: LinearIssueReadInput): Promise<LinearIssueReadResult> {
    const identifier = normalizedIdentifier(input.identifier);
    const target = `linear://issue/${identifier}`;
    const capability = await this.checkRead(input.agent ?? "project_manager", target);
    if (capability.status !== "allowed") {
      return { status: "blocked", target, capability };
    }

    const issue = await this.adapter.readIssue(identifier);
    if (!issue) {
      return { status: "not_found", target, capability };
    }

    const normalizedIssue = normalizeIssue(issue);
    const scope = linearIssueToRunScope(normalizedIssue);
    return {
      status: scope.readiness,
      target,
      capability,
      issue: normalizedIssue,
      scope,
    };
  }

  async listIssues(
    input: LinearIssueListInput & { agent?: string } = {},
  ): Promise<LinearIssueListResult> {
    const { agent, ...listInput } = input;
    const target = listTarget(listInput);
    const capability = await this.checkRead(agent ?? "project_manager", target);
    if (capability.status !== "allowed") {
      return { status: "blocked", target, capability, issues: [], scopes: [] };
    }

    const issues = (await this.adapter.listIssues(listInput)).map(normalizeIssue);
    return {
      status: "listed",
      target,
      capability,
      issues,
      scopes: issues.map(linearIssueToRunScope),
    };
  }

  private checkRead(agent: string, target: string): Promise<CapabilityUseResult> {
    return this.capabilities.check({
      agent,
      capabilityId: "linear",
      action: "read_issues",
      target,
    });
  }
}
