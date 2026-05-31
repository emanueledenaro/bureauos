import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Bound every git spawn: a hung git (fs lock, hook/credential prompt) must not hang the caller. */
export const GIT_TIMEOUT_MS = 30_000;
export const GIT_MAX_BUFFER = 1024 * 1024;

export interface RunGitOptions {
  cwd?: string;
  timeoutMs?: number;
  maxBuffer?: number;
}

/**
 * Run a git subcommand non-shell (`execFile`, so each token is a separate
 * argument — no shell string is ever built, no shell-injection surface),
 * bounded by a timeout and an output cap. Rejects on a non-zero exit, like
 * `execFile`. Shared by every git-backed execution service so the safety
 * envelope (no shell, bounded) lives in exactly one place.
 */
export async function runGit(
  args: readonly string[],
  options: RunGitOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync("git", [...args], {
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
    maxBuffer: options.maxBuffer ?? GIT_MAX_BUFFER,
  });
  return { stdout: stdout.toString(), stderr: stderr.toString() };
}

/**
 * Whether a caller-influenced ref/start-point is safe to pass to git. Positive
 * allow-list (not just "doesn't start with -"): only ref/SHA-shaped tokens, no
 * leading dash (option injection) and no `..` (range / traversal).
 */
export function isSafeRef(ref: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(ref) && !ref.startsWith("-") && !ref.includes("..");
}

/**
 * Whether a project slug is safe to use in a filesystem path and a branch name:
 * lowercase alphanumerics plus dashes, never leading with a dash. Slugs come
 * from the project registry (already slugified), but this is defence in depth
 * before a slug reaches `git` or a path join.
 */
export function isSafeSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(slug);
}

/**
 * Whether a remote URL is safe to pass to `git remote add/set-url` as a
 * positional argument: no leading dash (option injection) and one of the
 * recognised remote forms (https/http/ssh/git@/file/absolute path). The project
 * remote comes from the linked repository, but this is defence in depth before
 * it reaches git.
 */
export function isSafeRemote(remote: string): boolean {
  return (
    !remote.startsWith("-") && /^(https:\/\/|http:\/\/|ssh:\/\/|git@|file:\/\/|\/)/.test(remote)
  );
}
