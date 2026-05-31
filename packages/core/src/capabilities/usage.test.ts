import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { defaultConfig } from "../config/loader.js";
import { initWorkspace } from "../init/initializer.js";
import { LocalNotificationCenter } from "../notifications/local.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { CapabilityUseService } from "./usage.js";

describe("CapabilityUseService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-capability-use-"));
    await initWorkspace({ root: dir, organizationName: "Capability Agency", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("allows and audits an assigned low-risk Codex repository read", async () => {
    const result = await new CapabilityUseService(dir, {
      config: defaultConfig("agency"),
    }).check({
      agent: "development",
      capabilityId: "codex",
      action: "read_repo",
      target: "github.com/acme/web",
    });

    expect(result.status).toBe("allowed");
    expect(result.capability.allowed).toBe(true);
    expect(result.policy.action).toBe("observe_signals");
    expect(result.artifact.type).toBe("capability-audit");

    const written = await new ArtifactStore(dir).read(result.artifact.id);
    expect(written?.body).toContain("Capability Use Audit");
    expect(written?.body).toContain("codex");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("capability.use.allowed");
  });

  it("allows Linear issue reads through the observe-signals policy path", async () => {
    const result = await new CapabilityUseService(dir, {
      config: defaultConfig("agency"),
    }).check({
      agent: "project_manager",
      capabilityId: "linear",
      action: "read_issues",
      target: "linear://team/ENG",
    });

    expect(result.status).toBe("allowed");
    expect(result.policy.action).toBe("observe_signals");
    expect(result.artifact.type).toBe("capability-audit");

    const written = await new ArtifactStore(dir).read(result.artifact.id);
    expect(written?.body).toContain("linear");
    expect(written?.body).toContain("read_issues");
  });

  it("maps Linear issue writes to existing issue/comment policy gates", async () => {
    const create = await new CapabilityUseService(dir, {
      config: defaultConfig("agency"),
    }).check({
      agent: "project_manager",
      capabilityId: "linear",
      action: "create_issues",
      target: "linear://team/ENG",
    });

    expect(create.status).toBe("allowed");
    expect(create.policy.action).toBe("create_issues");

    const config = defaultConfig("agency");
    config.autonomy.comment_on_issues = false;
    const comment = await new CapabilityUseService(dir, { config }).check({
      agent: "development",
      capabilityId: "linear",
      action: "comment",
      target: "linear://issue/BOS-42",
    });

    expect(comment.status).toBe("blocked");
    expect(comment.policy.action).toBe("comment_on_issues");
    expect(comment.approval?.action).toBe("comment_on_issues");
  });

  it("emits one local notification for repeated approval-required policy decisions", async () => {
    const config = defaultConfig("agency");
    config.autonomy.comment_on_issues = false;
    const service = new CapabilityUseService(dir, { config });

    const first = await service.check({
      agent: "development",
      capabilityId: "linear",
      action: "comment",
      target: "linear://issue/SER-90",
    });
    const second = await service.check({
      agent: "development",
      capabilityId: "linear",
      action: "comment",
      target: "linear://issue/SER-90",
    });

    expect(first.status).toBe("blocked");
    expect(second.status).toBe("blocked");
    expect(second.approval?.id).toBe(first.approval?.id);

    const notifications = await new LocalNotificationCenter(dir).list();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      type: "approval_needed",
      source_id: first.approval?.id,
      dedupe_key: `approval:${first.approval?.id}`,
    });
  });

  it("blocks agents that are not assigned to a capability", async () => {
    const result = await new CapabilityUseService(dir, {
      config: defaultConfig("agency"),
    }).check({
      agent: "product",
      capabilityId: "codex",
      action: "edit_code",
      target: "github.com/acme/web",
    });

    expect(result.status).toBe("blocked");
    expect(result.capability.reason).toContain("not assigned");
    expect(result.approval).toBeUndefined();

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("capability.use.blocked");
  });

  it("blocks Codex PR work until linked issue and test evidence gates are present", async () => {
    const service = new CapabilityUseService(dir, {
      config: defaultConfig("agency"),
    });

    const blocked = await service.check({
      agent: "development",
      capabilityId: "codex",
      action: "open_pr",
      target: "github.com/acme/web",
    });

    expect(blocked.status).toBe("blocked");
    expect(blocked.missing_gates).toEqual(["tests_required", "linked_issue"]);
    expect(blocked.approval?.action).toBe("open_pull_requests");

    const allowed = await service.check({
      agent: "development",
      capabilityId: "codex",
      action: "open_pr",
      target: "github.com/acme/web",
      linkedIssueNumbers: [42],
      testEvidence: ["pnpm test passed"],
    });

    expect(allowed.status).toBe("allowed");
    expect(allowed.missing_gates).toEqual([]);
  });

  it("blocks merge and production deploy by default with owner-visible approval records", async () => {
    const service = new CapabilityUseService(dir, {
      config: defaultConfig("agency"),
    });

    const merge = await service.check({
      agent: "project_manager",
      capabilityId: "github",
      action: "merge_pr",
      target: "github.com/acme/web/pull/42",
      linkedIssueNumbers: [42],
      testEvidence: ["pnpm test passed"],
    });
    const deploy = await service.check({
      agent: "release",
      capabilityId: "deployment",
      action: "deploy_production",
      target: "vercel://project/acme-web/production",
      linkedIssueNumbers: [42],
      testEvidence: ["pnpm test passed"],
    });

    expect(merge.status).toBe("blocked");
    expect(merge.capability.reason).toContain('action "merge_pr" is disabled');
    expect(merge.policy.action).toBe("merge_pull_requests");
    expect(merge.approval?.action).toBe("merge_pull_requests");
    expect(deploy.status).toBe("blocked");
    expect(deploy.capability.reason).toContain('action "deploy_production" is disabled');
    expect(deploy.policy.action).toBe("deploy_production");
    expect(deploy.approval?.action).toBe("deploy_production");

    const approvals = await new ApprovalRegistry(dir).listPending();
    expect(approvals.map((approval) => approval.action)).toEqual(
      expect.arrayContaining(["merge_pull_requests", "deploy_production"]),
    );
    expect(approvals.map((approval) => approval.target)).toEqual(
      expect.arrayContaining([
        "github.com/acme/web/pull/42",
        "vercel://project/acme-web/production",
      ]),
    );

    const mergeAudit = await new ArtifactStore(dir).read(merge.artifact.id);
    expect(mergeAudit?.body).toContain("Status: blocked");
    expect(mergeAudit?.body).toContain("Policy action: merge_pull_requests");
    expect(mergeAudit?.body).toContain(`Approval: ${merge.approval!.id}`);

    const deployAudit = await new ArtifactStore(dir).read(deploy.artifact.id);
    expect(deployAudit?.body).toContain("Status: blocked");
    expect(deployAudit?.body).toContain("Policy action: deploy_production");
    expect(deployAudit?.body).toContain(`Approval: ${deploy.approval!.id}`);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("capability.use.blocked");
    expect(audit).toContain("github.merge_pr");
    expect(audit).toContain("deployment.deploy_production");
  });

  it("allows merge and production deploy only with explicit capability config and approved gates", async () => {
    const config = defaultConfig("agency");
    config.capabilities.github = {
      actions: { merge_pr: true },
      allowed_agents: ["project_manager"],
      required_approvals: ["merge_approval"],
    };
    config.capabilities.deployment = {
      actions: { deploy_production: true },
      allowed_agents: ["release"],
      required_approvals: ["production_deploy"],
    };
    const approvals = new ApprovalRegistry(dir);
    const mergeApproval = await approvals.request({
      action: "merge_pull_requests",
      actor: "owner",
      target: "github.com/acme/web/pull/42",
      // Capability approvals must carry the precise operation scope
      // `${capabilityId}.${action}` (or "*") to match (SER-180).
      scope: "github.merge_pr",
      oneOff: true,
    });
    const deployApproval = await approvals.request({
      action: "deploy_production",
      actor: "owner",
      target: "vercel://project/acme-web/production",
      scope: "deployment.deploy_production",
      oneOff: true,
    });
    await approvals.resolve(mergeApproval.id, "approved", "owner", "SER-66 merge fixture");
    await approvals.resolve(deployApproval.id, "approved", "owner", "SER-66 deploy fixture");

    const service = new CapabilityUseService(dir, { config, approvals });
    const merge = await service.check({
      agent: "project_manager",
      capabilityId: "github",
      action: "merge_pr",
      target: "github.com/acme/web/pull/42",
      linkedIssueNumbers: [42],
      testEvidence: ["pnpm test passed"],
    });
    const deploy = await service.check({
      agent: "release",
      capabilityId: "deployment",
      action: "deploy_production",
      target: "vercel://project/acme-web/production",
      linkedIssueNumbers: [42],
      testEvidence: ["pnpm test passed"],
    });

    expect(merge.status).toBe("allowed");
    expect(merge.policy.action).toBe("merge_pull_requests");
    expect(merge.policy.approval_id).toBe(mergeApproval.id);
    expect(deploy.status).toBe("allowed");
    expect(deploy.policy.action).toBe("deploy_production");
    expect(deploy.policy.approval_id).toBe(deployApproval.id);

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("capability.use.allowed");
    expect(audit).toContain("github.merge_pr");
    expect(audit).toContain("deployment.deploy_production");
    expect(audit).not.toContain("production deploy executed");
  });

  it("records changed-file counts in capability audit artifacts", async () => {
    const result = await new CapabilityUseService(dir, {
      config: defaultConfig("agency"),
    }).check({
      agent: "development",
      capabilityId: "codex",
      action: "edit_code",
      target: "github.com/acme/web",
      linkedIssueNumbers: [42],
      testEvidence: ["pnpm test passed"],
      changedFiles: ["packages/core/src/a.ts", "packages/core/src/b.ts"],
    });

    expect(result.status).toBe("allowed");
    expect(result.missing_gates).toEqual([]);

    const written = await new ArtifactStore(dir).read(result.artifact.id);
    expect(written?.record.changed_file_count).toBe(2);
    expect(written?.record.changed_file_limit).toBe(8);
    expect(written?.record.changed_file_limit_exceeded).toBe(false);
    expect(written?.body).toContain("Changed files: 2 / 8");
    expect(written?.body).toContain("packages/core/src/a.ts");
  });

  it("blocks Codex code edits when changed files exceed the configured limit", async () => {
    const config = defaultConfig("agency");
    config.limits.max_files_changed_without_human_review = 2;

    const result = await new CapabilityUseService(dir, { config }).check({
      agent: "development",
      capabilityId: "codex",
      action: "edit_code",
      target: "github.com/acme/web",
      linkedIssueNumbers: [42],
      testEvidence: ["pnpm test passed"],
      changedFiles: ["packages/core/src/a.ts", "packages/core/src/b.ts", "packages/core/src/c.ts"],
    });

    expect(result.status).toBe("blocked");
    expect(result.missing_gates).toEqual(["changed_file_limit"]);
    expect(result.policy.reason).toBe("changed file count 3 exceeds limit 2");
    expect(result.approval?.action).toBe("push_commits");

    const written = await new ArtifactStore(dir).read(result.artifact.id);
    expect(written?.record.changed_file_count).toBe(3);
    expect(written?.record.changed_file_limit).toBe(2);
    expect(written?.record.changed_file_limit_exceeded).toBe(true);
    expect(written?.body).toContain("Missing gates: changed_file_limit");

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("capability.use.blocked");
  });

  it("requests policy approval when the mapped policy action is disabled", async () => {
    const config = defaultConfig("agency");
    config.autonomy.open_pull_requests = false;

    const result = await new CapabilityUseService(dir, {
      config,
    }).check({
      agent: "development",
      capabilityId: "codex",
      action: "open_pr",
      target: "github.com/acme/web",
      linkedIssueNumbers: [42],
      testEvidence: ["pnpm test passed"],
    });

    expect(result.status).toBe("blocked");
    expect(result.policy.outcome).toBe("require_approval");
    expect(result.approval?.action).toBe("open_pull_requests");

    const approvals = await new ApprovalRegistry(dir).listPending();
    expect(approvals.map((approval) => approval.action)).toContain("open_pull_requests");
  });

  it("blocks a payment-review-gated capability until an approval is granted (SER-181)", async () => {
    const config = defaultConfig("agency");
    config.growth_autonomy.change_pricing = true;
    config.limits.require_security_review_for_payment_changes = true;
    const approvals = new ApprovalRegistry(dir);
    const service = new CapabilityUseService(dir, { config, approvals });

    // codex.read_repo is an assigned, allowed capability; the policyAction
    // override points policy at the payment action so the security_review gate
    // applies.
    const blocked = await service.check({
      agent: "development",
      capabilityId: "codex",
      action: "read_repo",
      policyAction: "change_pricing",
      target: "pricing://acme",
    });
    expect(blocked.status).toBe("blocked");
    expect(blocked.missing_gates).toContain("security_review");
    expect(blocked.approval?.id).toBeTruthy();

    // Grant the requested approval; the gate is now satisfied and use proceeds.
    await approvals.resolve(blocked.approval!.id, "approved", "owner", "reviewed");
    const allowed = await service.check({
      agent: "development",
      capabilityId: "codex",
      action: "read_repo",
      policyAction: "change_pricing",
      target: "pricing://acme",
    });
    expect(allowed.status).toBe("allowed");
    expect(allowed.missing_gates).not.toContain("security_review");
  });
});
