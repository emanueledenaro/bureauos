import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { PolicyEngine } from "../policy/engine.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { DevelopmentBranchService } from "./development-branch.js";
import { GitDevelopmentBranchClient } from "./git-development-branch-client.js";

const run = promisify(execFile);

async function currentBranch(dir: string): Promise<string> {
  const { stdout } = await run("git", ["branch", "--show-current"], { cwd: dir });
  return stdout.trim();
}

describe("GitDevelopmentBranchClient (real git, SER-239)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-branch-"));
    await run("git", ["init", "-q"], { cwd: dir });
    await run("git", ["config", "user.email", "ci@bureauos.test"], { cwd: dir });
    await run("git", ["config", "user.name", "BureauOS CI"], { cwd: dir });
    await run("git", ["commit", "-q", "--allow-empty", "-m", "baseline"], { cwd: dir });
  }, 30_000);

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a real branch and detects existence", async () => {
    const client = new GitDevelopmentBranchClient(dir);
    expect(await client.branchExists("bureauos/feature-x")).toBe(false);
    await client.createBranch({ branchName: "bureauos/feature-x", force: false });
    expect(await client.branchExists("bureauos/feature-x")).toBe(true);
    expect(await currentBranch(dir)).toBe("bureauos/feature-x");
  }, 30_000);

  it("refuses an unsafe baseRef (option injection or range/traversal)", async () => {
    const client = new GitDevelopmentBranchClient(dir);
    for (const baseRef of ["--upload-pack=evil", "main..evil", "../escape"]) {
      await expect(
        client.createBranch({ branchName: "bureauos/x", baseRef, force: false }),
      ).rejects.toThrow(/unsafe baseRef/);
    }
  });

  it("DevelopmentBranchService creates a real branch end-to-end when policy allows", async () => {
    const config = defaultConfig("freelancer");
    config.autonomy.create_branches = true;
    const policy = new PolicyEngine(config, new ApprovalRegistry(dir));
    const service = new DevelopmentBranchService(dir, {
      policy,
      branchClient: new GitDevelopmentBranchClient(dir),
    });

    const result = await service.create({ runId: "run_branch_test", scope: "build the thing" });

    expect(result.status).toBe("created");
    expect(result.branchName).toMatch(/^bureauos\//);
    // The branch really exists in git.
    const { stdout } = await run("git", ["branch", "--list", result.branchName], { cwd: dir });
    expect(stdout).toContain(result.branchName);
  }, 30_000);
});
