import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  DevelopmentBranchClient,
  DevelopmentBranchCreateRequest,
} from "./development-branch.js";

const run = promisify(execFile);

/** Bound every git spawn: a hung git (fs lock, hook/credential prompt) must not hang the caller. */
const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 1024 * 1024;

/**
 * Whether a caller-supplied `baseRef` is safe to pass to git as a start-point.
 * Positive allow-list (not just "doesn't start with -"): only ref/SHA-shaped
 * tokens, no leading dash (option injection) and no `..` (range / traversal).
 */
function isSafeRef(ref: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(ref) && !ref.startsWith("-") && !ref.includes("..");
}

/**
 * Concrete git-backed {@link DevelopmentBranchClient}: lets the development run
 * land its real edits on an isolated branch (SER-239).
 *
 * Safety:
 * - git is invoked via `execFile` (`shell: false`) with each token as a
 *   separate argument — no shell string is ever constructed, so there is no
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

  private gitOptions() {
    return { cwd: this.workspaceRoot, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER };
  }

  async branchExists(branchName: string): Promise<boolean> {
    try {
      await run(
        "git",
        ["rev-parse", "--verify", "--quiet", `refs/heads/${branchName}`],
        this.gitOptions(),
      );
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
    await run("git", args, this.gitOptions());
  }
}
