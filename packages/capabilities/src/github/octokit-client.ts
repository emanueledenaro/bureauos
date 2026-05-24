import { Octokit } from "@octokit/rest";
import type {
  GitHubClient,
  GitHubClientOptions,
  GitHubIssueRef,
  GitHubPullRequestRef,
} from "./client.js";

/**
 * Octokit-backed GitHub client.
 *
 * Implements the contract from `./client.ts`. Used by the kernel's run engine
 * and CLI once `bureau github connect` has been run.
 */
export class OctokitGitHubClient implements GitHubClient {
  private readonly octokit: Octokit;

  constructor(options: GitHubClientOptions) {
    const opts: ConstructorParameters<typeof Octokit>[0] = { auth: options.token };
    if (options.baseUrl) opts.baseUrl = options.baseUrl;
    this.octokit = new Octokit(opts);
  }

  async readIssue(owner: string, repo: string, number: number): Promise<GitHubIssueRef> {
    const r = await this.octokit.issues.get({ owner, repo, issue_number: number });
    return mapIssue(owner, repo, r.data as unknown as RawIssue);
  }

  async listIssues(
    owner: string,
    repo: string,
    filter: { state?: "open" | "closed" | "all" } = {},
  ): Promise<readonly GitHubIssueRef[]> {
    const r = await this.octokit.issues.listForRepo({
      owner,
      repo,
      state: filter.state ?? "open",
      per_page: 100,
    });
    return (r.data as unknown as RawIssue[]).map((i) => mapIssue(owner, repo, i));
  }

  async createIssue(
    owner: string,
    repo: string,
    input: { title: string; body: string; labels?: readonly string[] },
  ): Promise<GitHubIssueRef> {
    const r = await this.octokit.issues.create({
      owner,
      repo,
      title: input.title,
      body: input.body,
      labels: input.labels ? [...input.labels] : undefined,
    });
    return mapIssue(owner, repo, r.data as unknown as RawIssue);
  }

  async ensureLabels(
    owner: string,
    repo: string,
    labels: readonly { name: string; color?: string; description?: string }[],
  ): Promise<void> {
    const existing = await this.octokit.issues.listLabelsForRepo({ owner, repo, per_page: 100 });
    const existingNames = new Set(existing.data.map((l) => l.name));
    for (const label of labels) {
      if (existingNames.has(label.name)) continue;
      await this.octokit.issues.createLabel({
        owner,
        repo,
        name: label.name,
        color: label.color ?? "ededed",
        description: label.description ?? "",
      });
    }
  }

  async commentOnIssue(owner: string, repo: string, number: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({ owner, repo, issue_number: number, body });
  }

  async readPullRequest(
    owner: string,
    repo: string,
    number: number,
  ): Promise<GitHubPullRequestRef> {
    const r = await this.octokit.pulls.get({ owner, repo, pull_number: number });
    return mapPullRequest(owner, repo, r.data as unknown as RawPull);
  }

  async listPullRequests(
    owner: string,
    repo: string,
    filter: { state?: "open" | "closed" | "all" } = {},
  ): Promise<readonly GitHubPullRequestRef[]> {
    const r = await this.octokit.pulls.list({
      owner,
      repo,
      state: filter.state ?? "open",
      per_page: 100,
    });
    return (r.data as unknown as RawPull[]).map((p) => mapPullRequest(owner, repo, p));
  }

  async createPullRequest(
    owner: string,
    repo: string,
    input: { title: string; body: string; head: string; base: string },
  ): Promise<GitHubPullRequestRef> {
    const r = await this.octokit.pulls.create({ owner, repo, ...input });
    return mapPullRequest(owner, repo, r.data as unknown as RawPull);
  }
}

interface RawIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  labels: Array<string | { name?: string }>;
}

interface RawPull {
  number: number;
  title: string;
  html_url: string;
  state: string;
  head: { ref: string };
  base: { ref: string };
  merged_at?: string | null;
}

function mapIssue(owner: string, repo: string, raw: RawIssue): GitHubIssueRef {
  return {
    owner,
    repo,
    number: raw.number,
    title: raw.title,
    url: raw.html_url,
    state: raw.state === "closed" ? "closed" : "open",
    labels: raw.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
  };
}

function mapPullRequest(owner: string, repo: string, raw: RawPull): GitHubPullRequestRef {
  return {
    owner,
    repo,
    number: raw.number,
    title: raw.title,
    url: raw.html_url,
    head: raw.head.ref,
    base: raw.base.ref,
    state: raw.merged_at ? "merged" : raw.state === "closed" ? "closed" : "open",
  };
}
