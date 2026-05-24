export const VERSION = "0.0.0";

export type { CapabilityDefinition, CapabilityUseRecord, RiskClass } from "./types.js";
export { StubGitHubClient } from "./github/client.js";
export type {
  GitHubClient,
  GitHubClientOptions,
  GitHubIssueRef,
  GitHubPullRequestRef,
} from "./github/client.js";
