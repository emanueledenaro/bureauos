import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "./git.js";
import { ProjectWorkspaceService } from "./project-workspace.js";

const TIMEOUT_MS = 30_000;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function headBranch(cwd: string): Promise<string> {
  return (await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd })).stdout.trim();
}

async function branchExists(repo: string, branch: string): Promise<boolean> {
  try {
    await runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repo });
    return true;
  } catch {
    return false;
  }
}

async function commitFile(cwd: string, name: string, body: string): Promise<void> {
  await writeFile(join(cwd, name), body, "utf8");
  await runGit(["add", name], { cwd });
  await runGit(["-c", "user.email=t@t.test", "-c", "user.name=T", "commit", "-m", `add ${name}`], {
    cwd,
  });
}

async function trackedFiles(repo: string, ref: string): Promise<string[]> {
  const out = (await runGit(["ls-tree", "-r", "--name-only", ref], { cwd: repo })).stdout.trim();
  return out ? out.split("\n") : [];
}

describe("ProjectWorkspaceService (SER-243)", () => {
  let root: string;
  let service: ProjectWorkspaceService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "bureauos-project-workspace-"));
    service = new ProjectWorkspaceService(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it(
    "creates a usable per-project repo with a committed main branch (idempotent)",
    async () => {
      const repo = await service.ensureRepo("pizzeria-aurora");
      expect(repo).toBe(join(root, "workspaces", "pizzeria-aurora"));
      expect(await exists(join(repo, ".git"))).toBe(true);
      expect(await headBranch(repo)).toBe("main");
      // Exactly one (empty) base commit.
      const count = (await runGit(["rev-list", "--count", "HEAD"], { cwd: repo })).stdout.trim();
      expect(count).toBe("1");

      // Second call is a no-op: same repo, still one commit, not re-initialised.
      await commitFile(repo, "marker.txt", "x");
      const again = await service.ensureRepo("pizzeria-aurora");
      expect(again).toBe(repo);
      expect((await runGit(["rev-list", "--count", "HEAD"], { cwd: repo })).stdout.trim()).toBe(
        "2",
      );
    },
    TIMEOUT_MS,
  );

  it(
    "gives a run an isolated worktree on its own branch",
    async () => {
      const { branch, path } = await service.acquireRunWorktree("acme-app", "run_a1");
      expect(branch).toBe("bureauos/acme-app/run_a1");
      expect(path).toBe(join(root, "workspaces", ".worktrees", "acme-app", "run_a1"));
      expect(await exists(path)).toBe(true);
      expect(await headBranch(path)).toBe(branch);
    },
    TIMEOUT_MS,
  );

  it(
    "isolates two concurrent runs on the same project — no collision, main untouched",
    async () => {
      const repo = await service.ensureRepo("acme-app");
      const a = await service.acquireRunWorktree("acme-app", "run_a");
      const b = await service.acquireRunWorktree("acme-app", "run_b");

      expect(a.path).not.toBe(b.path);
      expect(a.branch).not.toBe(b.branch);

      // Each run commits its own file in its own worktree, in parallel.
      await Promise.all([
        commitFile(a.path, "a.txt", "from run a"),
        commitFile(b.path, "b.txt", "from run b"),
      ]);

      // Each branch sees only its own work; neither leaked into the other.
      expect(await trackedFiles(repo, a.branch)).toEqual(["a.txt"]);
      expect(await trackedFiles(repo, b.branch)).toEqual(["b.txt"]);
      // The shared base branch is untouched by either run.
      expect(await trackedFiles(repo, "main")).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    "releases a worktree but keeps its branch for later review/PR",
    async () => {
      const repo = await service.ensureRepo("acme-app");
      const { branch, path } = await service.acquireRunWorktree("acme-app", "run_keep");
      await commitFile(path, "feature.txt", "work");

      await service.releaseRunWorktree("acme-app", "run_keep");
      expect(await exists(path)).toBe(false);
      expect(await branchExists(repo, branch)).toBe(true);

      // Releasing again (or when never created) is a safe no-op.
      await expect(service.releaseRunWorktree("acme-app", "run_keep")).resolves.toBeUndefined();
      await expect(service.releaseRunWorktree("acme-app", "never")).resolves.toBeUndefined();
    },
    TIMEOUT_MS,
  );

  it(
    "re-acquires a released run's branch at its tip (retry/resume)",
    async () => {
      const repo = await service.ensureRepo("acme-app");
      const first = await service.acquireRunWorktree("acme-app", "run_r");
      await commitFile(first.path, "wip.txt", "in progress");
      await service.releaseRunWorktree("acme-app", "run_r");

      // Re-acquiring the same run reattaches its surviving branch (not a fresh
      // one), so the prior commit is still there.
      const second = await service.acquireRunWorktree("acme-app", "run_r");
      expect(second.branch).toBe(first.branch);
      expect(await exists(second.path)).toBe(true);
      expect(await trackedFiles(repo, second.branch)).toEqual(["wip.txt"]);
    },
    TIMEOUT_MS,
  );

  it(
    "commits the run's work onto its branch, then is a no-op when nothing changed",
    async () => {
      const repo = await service.ensureRepo("acme-app");
      const { branch, path } = await service.acquireRunWorktree("acme-app", "run_c");
      await writeFile(join(path, "feature.ts"), "// built by the dev agent\n", "utf8");

      const committed = await service.commitRunWork("acme-app", "run_c", "feat: booking page");
      expect(committed.committed).toBe(true);
      expect(committed.branch).toBe(branch);
      expect(committed.sha).toMatch(/^[0-9a-f]{40}$/);
      // The edit is now on the run branch (visible from the repo, not just the worktree).
      expect(await trackedFiles(repo, branch)).toEqual(["feature.ts"]);

      // Nothing else changed -> a second commit is a no-op.
      const again = await service.commitRunWork("acme-app", "run_c", "feat: nothing new");
      expect(again.committed).toBe(false);
      expect(again.sha).toBeUndefined();
    },
    TIMEOUT_MS,
  );

  it(
    "sets the project remote and pushes a run branch to it",
    async () => {
      // A local bare repo stands in for the project's remote (real git, no network).
      const remote = join(root, "remote.git");
      await runGit(["init", "--bare", remote]);

      await service.ensureRepo("acme-app");
      const { branch, path } = await service.acquireRunWorktree("acme-app", "run_push");
      await writeFile(join(path, "f.txt"), "work", "utf8");
      const commit = await service.commitRunWork("acme-app", "run_push", "feat: work");

      await service.setProjectRemote("acme-app", remote);
      const pushed = await service.pushRunBranch("acme-app", "run_push");
      expect(pushed).toBe(branch);

      // The branch (with its commit) now exists in the remote at the same SHA.
      const remoteSha = (
        await runGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: remote })
      ).stdout.trim();
      expect(remoteSha).toBe(commit.sha);

      // setProjectRemote is idempotent (updates the URL when origin already exists).
      const otherRemote = join(root, "remote2.git");
      await runGit(["init", "--bare", otherRemote]);
      await expect(service.setProjectRemote("acme-app", otherRemote)).resolves.toBeUndefined();
    },
    TIMEOUT_MS,
  );

  it("refuses unsafe remote urls (option injection + git transport RCE vectors)", async () => {
    await service.ensureRepo("acme-app");
    for (const bad of ["--upload-pack=evil", "ext::sh -c whoami", "fd::17", "host:path/repo"]) {
      await expect(service.setProjectRemote("acme-app", bad)).rejects.toThrow(/unsafe remote/);
    }
  });

  it("refuses unsafe slugs, run ids, and base refs", async () => {
    expect(() => service.repoPath("../escape")).toThrow(/unsafe project slug/);
    expect(() => service.branchForRun("ok", "../bad")).toThrow(/unsafe run id/);
    await expect(service.acquireRunWorktree("ok", "run_x", "--exec=evil")).rejects.toThrow(
      /unsafe baseRef/,
    );
  });
});
