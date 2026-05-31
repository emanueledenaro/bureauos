import { Octokit } from "@octokit/rest";
import type {
  GitHubClient,
  GitHubCheckRunRef,
  GitHubClientOptions,
  GitHubIssueRef,
  GitHubPullRequestRef,
  GitHubRepositoryRef,
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

  async createRepository(input: {
    owner: string;
    name: string;
    ownerType: "user" | "org";
    private: boolean;
    description?: string;
    autoInit?: boolean;
  }): Promise<GitHubRepositoryRef> {
    const payload: { name: string; private: boolean; description?: string; auto_init?: boolean } = {
      name: input.name,
      private: input.private,
    };
    if (input.description !== undefined) payload.description = input.description;
    if (input.autoInit !== undefined) payload.auto_init = input.autoInit;
    const r =
      input.ownerType === "org"
        ? await this.octokit.repos.createInOrg({ org: input.owner, ...payload })
        : await this.octokit.repos.createForAuthenticatedUser(payload);
    return mapRepository(r.data as unknown as RawRepository);
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
    // Paginate: `listForRepo` returns issues *and* PRs, and PRs are filtered
    // out below — a single 100-item page would silently drop real issues on an
    // active repo (SER-228).
    const data = (await this.octokit.paginate(this.octokit.issues.listForRepo, {
      owner,
      repo,
      state: filter.state ?? "open",
      per_page: 100,
    })) as unknown as RawIssue[];
    return data.filter((i) => !i.pull_request).map((i) => mapIssue(owner, repo, i));
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
    // Paginate so a repo with >100 labels yields a complete existing-name set
    // and ensureLabels does not retry creating labels that already exist (SER-228).
    const existing = (await this.octokit.paginate(this.octokit.issues.listLabelsForRepo, {
      owner,
      repo,
      per_page: 100,
    })) as Array<{ name: string }>;
    const existingNames = new Set(existing.map((l) => l.name));
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
    // Paginate so stale-PR detection sees every open PR on an active repo,
    // not just the first 100 (SER-228).
    const data = (await this.octokit.paginate(this.octokit.pulls.list, {
      owner,
      repo,
      state: filter.state ?? "open",
      per_page: 100,
    })) as unknown as RawPull[];
    return data.map((p) => mapPullRequest(owner, repo, p));
  }

  async listCheckRunsForRef(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<readonly GitHubCheckRunRef[]> {
    // Paginate the check runs for the ref (octokit.paginate flattens the
    // check_runs envelope across pages) so none are dropped past 100 (SER-228).
    const data = (await this.octokit.paginate(this.octokit.checks.listForRef, {
      owner,
      repo,
      ref,
      per_page: 100,
    })) as unknown as RawCheckRun[];
    return data.map((c) => mapCheckRun(owner, repo, c));
  }

  async createPullRequest(
    owner: string,
    repo: string,
    input: { title: string; body: string; head: string; base: string; draft?: boolean },
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
  updated_at?: string | null;
  pull_request?: unknown;
}

interface RawRepository {
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
  default_branch?: string | null;
  created_at?: string | null;
  owner?: { login?: string | null } | null;
}

interface RawPull {
  number: number;
  title: string;
  html_url: string;
  state: string;
  head: { ref: string; sha?: string };
  base: { ref: string };
  merged_at?: string | null;
  updated_at?: string | null;
}

interface RawCheckRun {
  id: number;
  name: string;
  html_url?: string | null;
  details_url?: string | null;
  status: string;
  conclusion?: string | null;
  head_sha: string;
  started_at?: string | null;
  completed_at?: string | null;
}

function mapRepository(raw: RawRepository): GitHubRepositoryRef {
  const [fallbackOwner, fallbackRepo] = raw.full_name.split("/") as [string, string];
  return {
    owner: raw.owner?.login ?? fallbackOwner,
    repo: raw.name || fallbackRepo,
    fullName: raw.full_name,
    url: raw.html_url,
    private: raw.private,
    defaultBranch: raw.default_branch ?? "",
    createdAt: raw.created_at ?? "",
  };
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
    updatedAt: raw.updated_at ?? "",
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
    headSha: raw.head.sha ?? "",
    base: raw.base.ref,
    state: raw.merged_at ? "merged" : raw.state === "closed" ? "closed" : "open",
    updatedAt: raw.updated_at ?? "",
  };
}

function mapCheckRun(owner: string, repo: string, raw: RawCheckRun): GitHubCheckRunRef {
  return {
    owner,
    repo,
    id: raw.id,
    name: raw.name,
    url: raw.html_url ?? raw.details_url ?? "",
    status: mapCheckStatus(raw.status),
    conclusion: mapCheckConclusion(raw.conclusion),
    headSha: raw.head_sha,
    startedAt: raw.started_at ?? "",
    completedAt: raw.completed_at ?? "",
  };
}

function mapCheckStatus(status: string): GitHubCheckRunRef["status"] {
  switch (status) {
    case "queued":
    case "in_progress":
    case "completed":
    case "waiting":
    case "requested":
    case "pending":
      return status;
    default:
      return "pending";
  }
}

function mapCheckConclusion(
  conclusion: string | null | undefined,
): GitHubCheckRunRef["conclusion"] {
  switch (conclusion) {
    case "success":
    case "failure":
    case "neutral":
    case "cancelled":
    case "skipped":
    case "timed_out":
    case "action_required":
    case "startup_failure":
    case "stale":
      return conclusion;
    default:
      return null;
  }
}
