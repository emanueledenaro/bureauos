import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  DevelopmentBranchClient,
  DevelopmentBranchCreateRequest,
} from "./development-branch.js";

const run = promisify(execFile);

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
 * - an optional `baseRef` is the one caller-influenced value; a ref that looks
 *   like a flag (leading `-`) is rejected before spawning, as defence in depth.
 * - subcommands are fixed (`rev-parse` / `checkout -b`); it never forces or
 *   rewrites history.
 */
export class GitDevelopmentBranchClient implements DevelopmentBranchClient {
  constructor(private readonly workspaceRoot: string) {}

  async branchExists(branchName: string): Promise<boolean> {
    try {
      await run("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branchName}`], {
        cwd: this.workspaceRoot,
      });
      return true;
    } catch {
      // Non-zero exit (with --quiet, no output) means the ref does not exist.
      return false;
    }
  }

  async createBranch(input: DevelopmentBranchCreateRequest): Promise<void> {
    if (input.baseRef !== undefined && input.baseRef.startsWith("-")) {
      throw new Error(`refusing baseRef that looks like a flag: ${input.baseRef}`);
    }
    const args = ["checkout", "-b", input.branchName];
    if (input.baseRef) args.push(input.baseRef);
    await run("git", args, { cwd: this.workspaceRoot });
  }
}
