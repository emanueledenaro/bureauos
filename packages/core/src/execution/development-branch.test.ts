import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { AuditLog } from "../audit/log.js";
import { PolicyEngine } from "../policy/engine.js";
import {
  DevelopmentBranchService,
  branchNameForDevelopmentRun,
  type DevelopmentBranchClient,
  type DevelopmentBranchCreateRequest,
} from "./development-branch.js";

class RecordingBranchClient implements DevelopmentBranchClient {
  readonly branches = new Set<string>();
  readonly created: DevelopmentBranchCreateRequest[] = [];

  async branchExists(branchName: string): Promise<boolean> {
    return this.branches.has(branchName);
  }

  async createBranch(input: DevelopmentBranchCreateRequest): Promise<void> {
    this.created.push(input);
    this.branches.add(input.branchName);
  }
}

describe("DevelopmentBranchService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-development-branch-"));
    await initWorkspace({ root: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("builds deterministic branch names from Linear issue or run identity", () => {
    expect(
      branchNameForDevelopmentRun({
        runId: "run_deadbeef",
        linearIssueIdentifier: "SER-23",
        scope: "Implement branch creation per development run",
      }),
    ).toBe("bureauos/ser-23-implement-branch-creation-per-development-run");

    expect(
      branchNameForDevelopmentRun({
        runId: "run_deadbeef",
        scope: "Implement branch creation per development run",
      }),
    ).toBe("bureauos/run-deadbeef-implement-branch-creation-per-development-run");
  });

  it("creates an audited branch after policy allows create_branches", async () => {
    const branchClient = new RecordingBranchClient();
    const config = defaultConfig("agency");
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const policy = new PolicyEngine(config, new ApprovalRegistry(dir));
    const service = new DevelopmentBranchService(dir, { audit, policy, branchClient });

    const result = await service.create({
      actor: "development",
      runId: "run_deadbeef",
      linearIssueIdentifier: "SER-23",
      scope: "Implement branch creation per development run",
      baseRef: "main",
    });

    expect(result.status).toBe("created");
    expect(result.branchName).toBe("bureauos/ser-23-implement-branch-creation-per-development-run");
    expect(result.safety).toEqual({ force: false, historyRewrite: false });
    expect(branchClient.created).toEqual([
      {
        branchName: "bureauos/ser-23-implement-branch-creation-per-development-run",
        baseRef: "main",
        force: false,
      },
    ]);

    const auditLog = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(auditLog).toContain("development.branch.created");
    expect(auditLog).toContain("bureauos/ser-23-implement-branch-creation-per-development-run");
  });

  it("uses a deterministic run suffix when the Linear branch already exists", async () => {
    const branchClient = new RecordingBranchClient();
    branchClient.branches.add("bureauos/ser-23-implement-branch-creation-per-development-run");
    const config = defaultConfig("agency");
    const policy = new PolicyEngine(config, new ApprovalRegistry(dir));
    const service = new DevelopmentBranchService(dir, { policy, branchClient });

    const result = await service.create({
      runId: "run_deadbeef",
      linearIssueIdentifier: "SER-23",
      scope: "Implement branch creation per development run",
    });

    expect(result.status).toBe("created");
    expect(result.attemptedBranchNames).toEqual([
      "bureauos/ser-23-implement-branch-creation-per-development-run",
      "bureauos/ser-23-implement-branch-creation-per-development-run-run-deadbeef",
    ]);
    expect(branchClient.created[0]?.branchName).toBe(
      "bureauos/ser-23-implement-branch-creation-per-development-run-run-deadbeef",
    );
  });

  it("blocks deterministically when every safe branch candidate already exists", async () => {
    const branchClient = new RecordingBranchClient();
    branchClient.branches.add("bureauos/ser-23-implement-branch-creation-per-development-run");
    branchClient.branches.add(
      "bureauos/ser-23-implement-branch-creation-per-development-run-run-deadbeef",
    );
    const config = defaultConfig("agency");
    const audit = new AuditLog(workspacePaths(dir).auditLog);
    const policy = new PolicyEngine(config, new ApprovalRegistry(dir));
    const service = new DevelopmentBranchService(dir, { audit, policy, branchClient });

    const result = await service.create({
      runId: "run_deadbeef",
      linearIssueIdentifier: "SER-23",
      scope: "Implement branch creation per development run",
    });

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe(
      "branch already exists: bureauos/ser-23-implement-branch-creation-per-development-run-run-deadbeef",
    );
    expect(result.policy.required_gates).toEqual(["branch_conflict_review"]);
    expect(branchClient.created).toEqual([]);

    const auditLog = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(auditLog).toContain("development.branch.blocked");
  });

  it("blocks branch creation when policy requires owner approval", async () => {
    const branchClient = new RecordingBranchClient();
    const config = defaultConfig("agency");
    config.autonomy.create_branches = false;
    const policy = new PolicyEngine(config, new ApprovalRegistry(dir));
    const service = new DevelopmentBranchService(dir, { policy, branchClient });

    const result = await service.create({
      actor: "development",
      runId: "run_deadbeef",
      scope: "Implement branch creation per development run",
    });

    expect(result.status).toBe("blocked");
    expect(result.policy.outcome).toBe("require_approval");
    expect(branchClient.created).toEqual([]);
  });
});
