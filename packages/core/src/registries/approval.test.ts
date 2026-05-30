import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initWorkspace } from "../init/initializer.js";
import { workspacePaths } from "../paths.js";
import { ApprovalRegistry, inferApprovalRiskLevel } from "./approval.js";

async function approvedOneOff(
  approvals: ApprovalRegistry,
  overrides: Partial<{ action: string; target: string; oneOff: boolean; expiresAt: string }> = {},
) {
  const record = await approvals.request({
    action: overrides.action ?? "deploy_production",
    actor: "owner",
    target: overrides.target ?? "vercel://prod",
    scope: "test",
    oneOff: overrides.oneOff ?? true,
    ...(overrides.expiresAt ? { expiresAt: overrides.expiresAt } : {}),
  });
  await approvals.resolve(record.id, "approved", "owner", "ok");
  return record;
}

describe("ApprovalRegistry consumption", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-approval-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("burns a one-off approval so it no longer matches, and audits the consumption", async () => {
    const approvals = new ApprovalRegistry(dir);
    const record = await approvedOneOff(approvals);

    expect((await approvals.match("deploy_production", "vercel://prod"))?.id).toBe(record.id);

    const consumed = await approvals.consume(record.id);
    expect(consumed?.consumed_at).not.toBe("");

    expect(await approvals.match("deploy_production", "vercel://prod")).toBeUndefined();

    const audit = await readFile(workspacePaths(dir).auditLog, "utf8");
    expect(audit).toContain("approval.consumed");
    expect(audit).toContain(record.id);
  });

  it("is idempotent: consuming an already-consumed approval is a no-op", async () => {
    const approvals = new ApprovalRegistry(dir);
    const record = await approvedOneOff(approvals);

    const first = await approvals.consume(record.id);
    const stamp = first?.consumed_at;
    const second = await approvals.consume(record.id);
    expect(second?.consumed_at).toBe(stamp);
  });

  it("never consumes a standing (non one-off) approval; it keeps matching", async () => {
    const approvals = new ApprovalRegistry(dir);
    const record = await approvedOneOff(approvals, { oneOff: false });

    const result = await approvals.consume(record.id);
    expect(result?.consumed_at).toBe("");
    expect((await approvals.match("deploy_production", "vercel://prod"))?.id).toBe(record.id);
  });

  it("returns undefined when consuming an unknown approval id", async () => {
    const approvals = new ApprovalRegistry(dir);
    expect(await approvals.consume("appr-does-not-exist")).toBeUndefined();
  });

  it("does not match an expired approval", async () => {
    const approvals = new ApprovalRegistry(dir);
    await approvedOneOff(approvals, { expiresAt: "2000-01-01T00:00:00.000Z" });
    expect(await approvals.match("deploy_production", "vercel://prod")).toBeUndefined();
  });

  it("matches a wildcard-target one-off for any target, then burns it", async () => {
    const approvals = new ApprovalRegistry(dir);
    const record = await approvedOneOff(approvals, { target: "*" });

    expect((await approvals.match("deploy_production", "any-target"))?.id).toBe(record.id);
    await approvals.consume(record.id);
    expect(await approvals.match("deploy_production", "any-target")).toBeUndefined();
  });
});

describe("inferApprovalRiskLevel", () => {
  it("classifies explicit-map actions", () => {
    expect(inferApprovalRiskLevel("change_billing")).toBe("critical");
    expect(inferApprovalRiskLevel("merge_pull_requests")).toBe("high");
  });

  it("classifies unknown actions by keyword tier", () => {
    expect(inferApprovalRiskLevel("rotate", "api secret")).toBe("critical");
    expect(inferApprovalRiskLevel("ship", "production deploy")).toBe("critical");
    expect(inferApprovalRiskLevel("notify", "client outreach")).toBe("high");
    expect(inferApprovalRiskLevel("update", "github pull request")).toBe("medium");
    expect(inferApprovalRiskLevel("noop", "internal note")).toBe("low");
  });
});
