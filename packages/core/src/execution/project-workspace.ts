import { access, mkdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { isSafeRef, isSafeSlug, runGit } from "./git.js";

export interface ProjectWorkspaceOptions {
  /**
   * Root under which each project's code repository lives, one directory per
   * project slug. Defaults to `<workspaceRoot>/workspaces` — deliberately
   * outside `.bureauos` so project code and the agency "brain" stay separate
   * (see docs/project-workspaces.md).
   */
  projectsRoot?: string;
}

export interface RunWorktree {
  /** The dedicated per-run branch, `bureauos/<slug>/<runId>`. */
  branch: string;
  /** Absolute path to the isolated working copy the run should edit/test in. */
  path: string;
}

export interface RunCommitResult {
  /** Whether a commit was created (false when the run changed no files). */
  committed: boolean;
  /** The run branch the commit landed on, `bureauos/<slug>/<runId>`. */
  branch: string;
  /** The new commit SHA, when one was created. */
  sha?: string;
}

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function isSafeRunId(runId: string): boolean {
  return RUN_ID_PATTERN.test(runId) && !runId.startsWith("-") && !runId.includes("..");
}

/**
 * Provisions and isolates the place where a development run writes real code
 * (SER-243). Each project gets its own local git repository; each run gets its
 * own `git worktree` on a dedicated branch, so multiple runs on the same project
 * work in parallel without ever fighting over a shared git HEAD.
 *
 * Local-first: repositories are `git init`-ed locally and need no external
 * account. GitHub provisioning (the `origin` remote) and PR delivery are layered
 * on later behind owner-gated policy (SER-241).
 *
 * Safety: every git call goes through the shared {@link runGit} (non-shell,
 * timeout + output cap); slugs, run ids and base refs are allow-list validated
 * before they reach a path join or git, and resolved paths are asserted to stay
 * under the projects root.
 */
export class ProjectWorkspaceService {
  private readonly projectsRoot: string;

  constructor(workspaceRoot: string, options: ProjectWorkspaceOptions = {}) {
    this.projectsRoot = resolve(options.projectsRoot ?? join(resolve(workspaceRoot), "workspaces"));
  }

  /** Absolute path to a project's local git repository. */
  repoPath(slug: string): string {
    return this.confined(this.assertSlug(slug));
  }

  /** The dedicated branch name for a run, `bureauos/<slug>/<runId>`. */
  branchForRun(slug: string, runId: string): string {
    return `bureauos/${this.assertSlug(slug)}/${this.assertRunId(runId)}`;
  }

  /** Absolute path to a run's isolated worktree. */
  worktreePath(slug: string, runId: string): string {
    return this.confined(".worktrees", this.assertSlug(slug), this.assertRunId(runId));
  }

  /**
   * Ensure the project's local repository exists with a committed base branch
   * (`main`), creating it on first use. Idempotent. Returns the repo path.
   */
  async ensureRepo(slug: string): Promise<string> {
    const repo = this.repoPath(slug);
    await mkdir(repo, { recursive: true });
    if (await this.isGitRepo(repo)) return repo;
    await runGit(["init"], { cwd: repo });
    // Normalise the base branch to `main` regardless of the host's
    // `init.defaultBranch`; works on the unborn HEAD before the first commit.
    await runGit(["symbolic-ref", "HEAD", "refs/heads/main"], { cwd: repo });
    // Inline identity so the commit never depends on (or mutates) global git
    // config — CI runners and fresh machines have no user.name/email set.
    await runGit(
      [
        "-c",
        "user.email=bot@bureauos.local",
        "-c",
        "user.name=BureauOS",
        "commit",
        "--allow-empty",
        "-m",
        "chore: initialize project workspace",
      ],
      { cwd: repo },
    );
    return repo;
  }

  /**
   * Add an isolated worktree for a run on a fresh `bureauos/<slug>/<runId>`
   * branch cut from `baseRef` (default `main`). The run edits/tests here without
   * touching any other run's checkout. Ensures the repo first.
   */
  async acquireRunWorktree(slug: string, runId: string, baseRef = "main"): Promise<RunWorktree> {
    if (!isSafeRef(baseRef)) throw new Error(`refusing unsafe baseRef: ${baseRef}`);
    await this.ensureRepo(slug);
    const repo = this.repoPath(slug);
    const branch = this.branchForRun(slug, runId);
    const path = this.worktreePath(slug, runId);
    // `git worktree add` creates the leaf dir but not missing intermediate dirs.
    await mkdir(join(this.projectsRoot, ".worktrees", this.assertSlug(slug)), { recursive: true });
    // A released run keeps its branch, so a re-acquire (retry/resume) must attach
    // the existing branch at its tip rather than re-create it — `git worktree add
    // -b` fatals on an existing branch.
    const args = (await this.branchExists(repo, branch))
      ? ["worktree", "add", path, branch]
      : ["worktree", "add", "-b", branch, path, baseRef];
    await runGit(args, { cwd: repo });
    return { branch, path };
  }

  /**
   * Remove a run's worktree once the run is done. The branch is left behind on
   * purpose so its commits remain available for review and PR. Safe to call when
   * the worktree was never created or is already gone.
   */
  async releaseRunWorktree(slug: string, runId: string): Promise<void> {
    const repo = this.repoPath(slug);
    const path = this.worktreePath(slug, runId);
    try {
      await runGit(["worktree", "remove", "--force", path], { cwd: repo });
    } catch {
      // Already removed / never created: nothing to clean up.
    }
  }

  /**
   * Stage and commit everything the run produced in its worktree onto its
   * branch, so the work persists before the worktree is released and is ready
   * for push/PR delivery (SER-241). A no-op (`committed: false`) when the run
   * changed no files. Local-only — no remote is ever touched here; pushing and
   * opening a PR are separate, policy-gated steps.
   */
  async commitRunWork(slug: string, runId: string, message: string): Promise<RunCommitResult> {
    const cwd = this.worktreePath(slug, runId);
    const branch = this.branchForRun(slug, runId);
    await runGit(["add", "-A"], { cwd });
    if (await this.nothingStaged(cwd)) return { committed: false, branch };
    await runGit(
      ["-c", "user.email=bot@bureauos.local", "-c", "user.name=BureauOS", "commit", "-m", message],
      { cwd },
    );
    const sha = (await runGit(["rev-parse", "HEAD"], { cwd })).stdout.trim();
    return { committed: true, branch, sha };
  }

  private async isGitRepo(repo: string): Promise<boolean> {
    try {
      await access(join(repo, ".git"));
      return true;
    } catch {
      return false;
    }
  }

  private async branchExists(repo: string, branch: string): Promise<boolean> {
    try {
      await runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repo });
      return true;
    } catch {
      // Non-zero exit (with --quiet, no output) means the branch does not exist.
      return false;
    }
  }

  private async nothingStaged(cwd: string): Promise<boolean> {
    try {
      await runGit(["diff", "--cached", "--quiet"], { cwd });
      return true; // exit 0 -> nothing staged
    } catch {
      return false; // exit 1 -> staged changes present
    }
  }

  private assertSlug(slug: string): string {
    if (!isSafeSlug(slug)) throw new Error(`refusing unsafe project slug: ${slug}`);
    return slug;
  }

  private assertRunId(runId: string): string {
    if (!isSafeRunId(runId)) throw new Error(`refusing unsafe run id: ${runId}`);
    return runId;
  }

  /** Join under the projects root and assert the result cannot escape it. */
  private confined(...segments: string[]): string {
    const target = resolve(this.projectsRoot, ...segments);
    const rel = relative(this.projectsRoot, target);
    if (rel.startsWith("..") || rel === "..") {
      throw new Error(`path escapes projects root: ${segments.join("/")}`);
    }
    return target;
  }
}
