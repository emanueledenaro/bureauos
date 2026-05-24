export const VERSION = "0.0.0";

export type { CapabilityDefinition, CapabilityUseRecord, RiskClass } from "./types.js";
export { StubGitHubClient } from "./github/client.js";
export { OctokitGitHubClient } from "./github/octokit-client.js";
export type {
  GitHubClient,
  GitHubClientOptions,
  GitHubIssueRef,
  GitHubPullRequestRef,
} from "./github/client.js";

export const GITHUB_LABEL_TAXONOMY: ReadonlyArray<{ name: string; color: string; description: string }> = [
  { name: "type:feature", color: "0e8a16", description: "New feature or capability" },
  { name: "type:bug", color: "d73a4a", description: "Bug or regression" },
  { name: "type:refactor", color: "fbca04", description: "Refactor without behavior change" },
  { name: "type:docs", color: "0075ca", description: "Documentation" },
  { name: "type:chore", color: "ededed", description: "Chore / housekeeping" },
  { name: "type:release", color: "5319e7", description: "Release work" },
  { name: "stage:intake", color: "ededed", description: "Newly opened" },
  { name: "stage:product-ready", color: "c5def5", description: "Spec ready" },
  { name: "stage:design-ready", color: "c5def5", description: "Design ready" },
  { name: "stage:dev-ready", color: "0e8a16", description: "Ready for implementation" },
  { name: "stage:in-progress", color: "fbca04", description: "Being worked on" },
  { name: "stage:review", color: "5319e7", description: "Under review" },
  { name: "stage:qa", color: "5319e7", description: "QA verification" },
  { name: "stage:blocked", color: "d73a4a", description: "Blocked" },
  { name: "stage:done", color: "0e8a16", description: "Done" },
  { name: "risk:low", color: "0e8a16", description: "Low risk" },
  { name: "risk:medium", color: "fbca04", description: "Medium risk" },
  { name: "risk:high", color: "d73a4a", description: "High risk" },
  { name: "risk:critical", color: "b60205", description: "Critical risk" },
  { name: "needs:human", color: "f9d0c4", description: "Needs human attention" },
  { name: "needs:tests", color: "f9d0c4", description: "Needs tests" },
  { name: "needs:security", color: "f9d0c4", description: "Needs security review" },
  { name: "needs:decision", color: "f9d0c4", description: "Needs a decision" },
  { name: "autonomy:read-only", color: "ededed", description: "Read-only autonomy" },
  { name: "autonomy:issue-only", color: "ededed", description: "Issue/comment autonomy" },
  { name: "autonomy:pr-allowed", color: "0e8a16", description: "PR autonomy" },
  { name: "autonomy:merge-allowed", color: "5319e7", description: "Merge autonomy" },
  { name: "autonomy:deploy-allowed", color: "b60205", description: "Deploy autonomy" },
];
