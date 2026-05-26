import { ArtifactStore, type ArtifactRecord } from "../artifacts/store.js";
import { CapabilityUseService, type CapabilityUseResult } from "../capabilities/usage.js";
import type { BureauConfig } from "../config/schema.js";
import {
  linearIssueToRunScope,
  type LinearIssueRunScope,
  type LinearIssueScopeInput,
} from "./work-scope.js";

export interface LinearIssueIngestionInput {
  issue: LinearIssueScopeInput;
  agent?: string;
  projectId?: string;
  clientId?: string;
  runId?: string;
}

export interface LinearIssueIngestionResult {
  status: "ready" | "needs_clarification" | "blocked";
  capability: CapabilityUseResult;
  scope?: LinearIssueRunScope;
  artifact?: ArtifactRecord;
}

export interface LinearIssueIngestionDeps {
  config: BureauConfig;
  capabilities?: CapabilityUseService;
  artifacts?: ArtifactStore;
}

function artifactBody(scope: LinearIssueRunScope): string {
  return `# Linear Issue Scope

## Source

- Issue: ${scope.externalIssue.identifier}
- Title: ${scope.externalIssue.title}
- URL: ${scope.externalIssue.url}
- Team: ${scope.externalIssue.teamKey}
- Linear project: ${scope.externalIssue.projectId}
- Readiness: ${scope.readiness}

## Run Mapping

- Type: ${scope.runType}
- Trigger: ${scope.triggerType}
- Source: ${scope.triggerSource}

## Acceptance Criteria

${scope.acceptanceCriteria.length ? scope.acceptanceCriteria.map((item) => `- ${item}`).join("\n") : "- (none)"}

## Blockers

${scope.blockers.length ? scope.blockers.map((item) => `- ${item}`).join("\n") : "- (none)"}

## Execution Boundary

This artifact describes Linear issue scope only. Code execution, branch creation, tests, comments, and pull requests require separate capability and policy checks.
`;
}

export class LinearIssueIngestionService {
  private readonly capabilities: CapabilityUseService;
  private readonly artifacts: ArtifactStore;

  constructor(
    private readonly workspaceRoot: string,
    deps: LinearIssueIngestionDeps,
  ) {
    this.capabilities = deps.capabilities ?? new CapabilityUseService(workspaceRoot, deps);
    this.artifacts = deps.artifacts ?? new ArtifactStore(workspaceRoot);
  }

  async ingest(input: LinearIssueIngestionInput): Promise<LinearIssueIngestionResult> {
    const capability = await this.capabilities.check({
      agent: input.agent ?? "project_manager",
      capabilityId: "linear",
      action: "read_issues",
      target: `linear://issue/${input.issue.identifier}`,
    });

    if (capability.status !== "allowed") {
      return { status: "blocked", capability };
    }

    const scope = linearIssueToRunScope(input.issue);
    const artifact = await this.artifacts.write({
      type: "project-dispatch-packet",
      createdBy: input.agent ?? "project_manager",
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.clientId ? { clientId: input.clientId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      metadata: {
        linear_identifier: input.issue.identifier,
        linear_url: input.issue.url,
        readiness: scope.readiness,
      },
      body: artifactBody(scope),
    });

    return { status: scope.readiness, capability, scope, artifact };
  }
}
