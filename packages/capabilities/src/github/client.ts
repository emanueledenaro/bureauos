/**
 * GitHub capability client (stub).
 *
 * Phase 3 of the BACKLOG. The real Octokit wiring, label management, PR
 * creation, check parsing, and webhook ingestion land in dedicated PRs.
 *
 * This file declares the contract so the kernel and CLI can already type-check
 * against the GitHub adapter and the run engine can refer to GitHub IDs.
 */

export interface GitHubIssueRef {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  labels: readonly string[];
  state: "open" | "closed";
  updatedAt: string;
}

export interface GitHubPullRequestRef {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  head: string;
  headSha: string;
  base: string;
  state: "open" | "closed" | "merged";
  updatedAt: string;
}

export type GitHubCheckRunConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "startup_failure"
  | "stale"
  | null;

export interface GitHubCheckRunRef {
  owner: string;
  repo: string;
  id: number;
  name: string;
  url: string;
  status: "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";
  conclusion: GitHubCheckRunConclusion;
  headSha: string;
  startedAt: string;
  completedAt: string;
}

export interface GitHubClientOptions {
  token: string;
  baseUrl?: string;
}

export interface GitHubClient {
  readIssue(owner: string, repo: string, number: number): Promise<GitHubIssueRef>;
  listIssues(
    owner: string,
    repo: string,
    filter?: { state?: "open" | "closed" | "all" },
  ): Promise<readonly GitHubIssueRef[]>;
  createIssue(
    owner: string,
    repo: string,
    input: { title: string; body: string; labels?: readonly string[] },
  ): Promise<GitHubIssueRef>;
  ensureLabels(
    owner: string,
    repo: string,
    labels: readonly { name: string; color?: string; description?: string }[],
  ): Promise<void>;
  commentOnIssue(owner: string, repo: string, number: number, body: string): Promise<void>;

  readPullRequest(owner: string, repo: string, number: number): Promise<GitHubPullRequestRef>;
  listPullRequests(
    owner: string,
    repo: string,
    filter?: { state?: "open" | "closed" | "all" },
  ): Promise<readonly GitHubPullRequestRef[]>;
  listCheckRunsForRef(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<readonly GitHubCheckRunRef[]>;
  createPullRequest(
    owner: string,
    repo: string,
    input: { title: string; body: string; head: string; base: string; draft?: boolean },
  ): Promise<GitHubPullRequestRef>;
}

/**
 * Stub implementation that throws on every call. Replaced by an Octokit-backed
 * client in Phase 3.
 */
export class StubGitHubClient implements GitHubClient {
  constructor(_options: GitHubClientOptions) {
    // Options accepted for type compatibility with the real client.
  }

  private notWired(): never {
    throw new Error("GitHub client is a stub. BACKLOG Phase 3.");
  }

  async readIssue(): Promise<GitHubIssueRef> {
    return this.notWired();
  }
  async listIssues(): Promise<readonly GitHubIssueRef[]> {
    return this.notWired();
  }
  async createIssue(): Promise<GitHubIssueRef> {
    return this.notWired();
  }
  async ensureLabels(): Promise<void> {
    return this.notWired();
  }
  async commentOnIssue(): Promise<void> {
    return this.notWired();
  }
  async readPullRequest(): Promise<GitHubPullRequestRef> {
    return this.notWired();
  }
  async listPullRequests(): Promise<readonly GitHubPullRequestRef[]> {
    return this.notWired();
  }
  async listCheckRunsForRef(): Promise<readonly GitHubCheckRunRef[]> {
    return this.notWired();
  }
  async createPullRequest(): Promise<GitHubPullRequestRef> {
    return this.notWired();
  }
}
