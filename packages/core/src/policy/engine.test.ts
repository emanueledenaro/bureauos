import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { ApprovalRegistry } from "../registries/approval.js";
import { initWorkspace } from "../init/initializer.js";
import { PolicyEngine } from "./engine.js";

describe("PolicyEngine", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-policy-"));
    await initWorkspace({ root: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("allows actions enabled by autonomy defaults", async () => {
    const engine = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const d = await engine.evaluate({ action: "create_issues", actor: "supreme_coordinator" });
    expect(d.allowed).toBe(true);
    expect(d.outcome).toBe("allow");
  });

  it("requires approval for actions disabled by autonomy defaults", async () => {
    const engine = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const d = await engine.evaluate({
      action: "merge_pull_requests",
      actor: "supreme_coordinator",
    });
    expect(d.allowed).toBe(false);
    expect(d.outcome).toBe("require_approval");
  });

  it("blocks growth actions that are disabled by default", async () => {
    const engine = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const d = await engine.evaluate({ action: "publish_public_content", actor: "social" });
    expect(d.allowed).toBe(false);
    expect(d.outcome).toBe("require_approval");
  });

  it("allows routine internal work but gates serious-risk actions", async () => {
    const engine = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));

    await expect(
      engine.evaluate({ action: "create_internal_reports", actor: "supreme_coordinator" }),
    ).resolves.toMatchObject({ allowed: true, outcome: "allow" });
    await expect(
      engine.evaluate({ action: "draft_proposals", actor: "supreme_coordinator" }),
    ).resolves.toMatchObject({ allowed: true, outcome: "allow" });

    await expect(
      engine.evaluate({ action: "send_final_proposals", actor: "supreme_coordinator" }),
    ).resolves.toMatchObject({ allowed: false, outcome: "require_approval" });
    await expect(
      engine.evaluate({ action: "change_billing", actor: "supreme_coordinator" }),
    ).resolves.toMatchObject({ allowed: false, outcome: "escalate" });
    await expect(
      engine.evaluate({ action: "delete_data", actor: "supreme_coordinator" }),
    ).resolves.toMatchObject({ allowed: false, outcome: "escalate" });
  });

  it("escalates unknown actions for policy definition", async () => {
    const engine = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const d = await engine.evaluate({ action: "summon_dragons", actor: "supreme_coordinator" });
    expect(d.allowed).toBe(false);
    expect(d.outcome).toBe("escalate");
  });

  it("allows a previously disabled action when a matching approval exists", async () => {
    const approvals = new ApprovalRegistry(dir);
    const a = await approvals.request({
      action: "publish_public_content",
      actor: "owner",
      target: "post_42",
      scope: "one-off",
      oneOff: true,
    });
    await approvals.resolve(a.id, "approved", "owner", "go");
    const engine = new PolicyEngine(defaultConfig("freelancer"), approvals);
    const d = await engine.evaluate({
      action: "publish_public_content",
      actor: "social",
      target: "post_42",
    });
    expect(d.allowed).toBe(true);
    expect(d.outcome).toBe("allow");
    expect(d.approval_id).toBe(a.id);
  });
});
