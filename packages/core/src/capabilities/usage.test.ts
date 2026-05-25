import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../artifacts/store.js";
import { defaultConfig } from "../config/loader.js";
import { initWorkspace } from "../init/initializer.js";
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
});
