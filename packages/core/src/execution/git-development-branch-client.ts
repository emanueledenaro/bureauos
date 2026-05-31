import { isSafeRef, runGit } from "./git.js";
import type {
  DevelopmentBranchClient,
  DevelopmentBranchCreateRequest,
} from "./development-branch.js";

/**
 * Concrete git-backed {@link DevelopmentBranchClient}: lets the development run
 * land its real edits on an isolated branch (SER-239).
 *
 * Safety (all provided by the shared {@link runGit} / {@link isSafeRef} helpers):
 * - git is invoked via `execFile` (`shell: false`) with each token as a separate
 *   argument — no shell string is ever constructed, so there is no
 *   shell-injection surface.
 * - branch names always come from `branchNameForDevelopmentRun` (slugified to
 *   `[a-z0-9-/]`, never leading `-`), so they cannot be parsed as flags.
 * - the one caller-influenced value, `baseRef`, must pass {@link isSafeRef}
 *   (positive allow-list) before spawning, as defence in depth.
 * - every spawn is bounded by a timeout + output cap so a hung git cannot hang
 *   the caller.
 * - subcommands are fixed (`rev-parse` / `checkout -b`); it never forces or
 *   rewrites history.
 */
export class GitDevelopmentBranchClient implements DevelopmentBranchClient {
  constructor(private readonly workspaceRoot: string) {}

  async branchExists(branchName: string): Promise<boolean> {
    try {
      await runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branchName}`], {
        cwd: this.workspaceRoot,
      });
      return true;
    } catch {
      // Non-zero exit (with --quiet, no output) means the ref does not exist.
      return false;
    }
  }

  async createBranch(input: DevelopmentBranchCreateRequest): Promise<void> {
    if (input.baseRef !== undefined && !isSafeRef(input.baseRef)) {
      throw new Error(`refusing unsafe baseRef: ${input.baseRef}`);
    }
    const args = ["checkout", "-b", input.branchName];
    if (input.baseRef) args.push(input.baseRef);
    await runGit(args, { cwd: this.workspaceRoot });
  }
}
