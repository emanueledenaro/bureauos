import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/loader.js";
import { BureauConfigSchema } from "../config/schema.js";
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
    expect(d.matched_rule).toBe("autonomy.create_issues");
    expect(d.approval_required).toBe(false);
  });

  it("requires approval for actions disabled by autonomy defaults", async () => {
    const engine = new PolicyEngine(defaultConfig("freelancer"), new ApprovalRegistry(dir));
    const d = await engine.evaluate({
      action: "merge_pull_requests",
      actor: "supreme_coordinator",
    });
    expect(d.allowed).toBe(false);
    expect(d.outcome).toBe("require_approval");
    expect(d.matched_rule).toBe("autonomy.merge_pull_requests");
    expect(d.approval_required).toBe(true);
  });

  it("enforces autonomy level boundaries for issue, branch, merge, and deploy work", async () => {
    const level0 = BureauConfigSchema.parse({ autonomy: { level: 0 } });
    const readOnly = new PolicyEngine(level0, new ApprovalRegistry(dir));
    await expect(
      readOnly.evaluate({ action: "create_issues", actor: "supreme_coordinator" }),
    ).resolves.toMatchObject({ allowed: false, outcome: "require_approval" });

    const level1 = BureauConfigSchema.parse({ autonomy: { level: 1 } });
    const issueOnly = new PolicyEngine(level1, new ApprovalRegistry(dir));
    await expect(
      issueOnly.evaluate({ action: "create_issues", actor: "supreme_coordinator" }),
    ).resolves.toMatchObject({ allowed: true, outcome: "allow" });
    await expect(
      issueOnly.evaluate({ action: "create_branches", actor: "supreme_coordinator" }),
    ).resolves.toMatchObject({ allowed: false, outcome: "require_approval" });

    const level4 = BureauConfigSchema.parse({ autonomy: { level: 4 } });
    const merge = await new PolicyEngine(level4, new ApprovalRegistry(dir)).evaluate({
      action: "merge_pull_requests",
      actor: "supreme_coordinator",
    });
    expect(merge).toMatchObject({ allowed: true, outcome: "allow" });
    expect(merge.required_gates).toContain("passing_checks");

    const level5 = BureauConfigSchema.parse({ autonomy: { level: 5 } });
    const deploy = await new PolicyEngine(level5, new ApprovalRegistry(dir)).evaluate({
      action: "deploy_production",
      actor: "supreme_coordinator",
    });
    expect(deploy).toMatchObject({ allowed: true, outcome: "allow" });
    expect(deploy.required_gates).toContain("release_readiness_review");
  });

  it("keeps client contact, public publishing, and paid spend approval-gated by default", async () => {
    const config = BureauConfigSchema.parse({ autonomy: { level: 5 } });
    const engine = new PolicyEngine(config, new ApprovalRegistry(dir));

    await expect(
      engine.evaluate({ action: "contact_clients_directly", actor: "supreme_coordinator" }),
    ).resolves.toMatchObject({ allowed: false, outcome: "require_approval" });
    await expect(
      engine.evaluate({ action: "publish_public_content", actor: "growth" }),
    ).resolves.toMatchObject({ allowed: false, outcome: "require_approval" });
    await expect(engine.evaluate({ action: "run_paid_ads", actor: "ads" })).resolves.toMatchObject({
      allowed: false,
      outcome: "require_approval",
    });
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
    expect(d.matched_rule).toBe("policy.unknown_action");
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

  it("does not let a capability-scoped approval authorize a different operation (SER-180)", async () => {
    const approvals = new ApprovalRegistry(dir);
    const a = await approvals.request({
      action: "change_billing",
      actor: "owner",
      target: "stripe://acct/acme",
      // stripe.refund_payment and stripe.change_price both collapse to
      // change_billing; the approval is for the refund only.
      scope: "stripe.refund_payment",
      oneOff: false,
    });
    await approvals.resolve(a.id, "approved", "owner", "refund ok");
    const engine = new PolicyEngine(defaultConfig("freelancer"), approvals);

    const refund = await engine.evaluate({
      action: "change_billing",
      actor: "supreme_coordinator",
      target: "stripe://acct/acme",
      capability: "stripe.refund_payment",
    });
    expect(refund.allowed).toBe(true);
    expect(refund.approval_id).toBe(a.id);

    const priceChange = await engine.evaluate({
      action: "change_billing",
      actor: "supreme_coordinator",
      target: "stripe://acct/acme",
      capability: "stripe.change_price",
    });
    expect(priceChange.allowed).toBe(false);
    expect(priceChange.approval_required).toBe(true);
    expect(priceChange.approval_id).toBeUndefined();
  });

  it("consumes a one-off approval after it authorizes one action; a second evaluation re-escalates", async () => {
    const approvals = new ApprovalRegistry(dir);
    const a = await approvals.request({
      action: "publish_public_content",
      actor: "owner",
      target: "post_99",
      scope: "one-off",
      oneOff: true,
    });
    await approvals.resolve(a.id, "approved", "owner", "go once");
    const engine = new PolicyEngine(defaultConfig("freelancer"), approvals);

    const first = await engine.evaluate({
      action: "publish_public_content",
      actor: "social",
      target: "post_99",
    });
    expect(first.allowed).toBe(true);
    expect(first.approval_id).toBe(a.id);

    const second = await engine.evaluate({
      action: "publish_public_content",
      actor: "social",
      target: "post_99",
    });
    expect(second.allowed).toBe(false);
    expect(second.outcome).toBe("require_approval");

    const resolved = await approvals.listResolved();
    expect(resolved.find((r) => r.id === a.id)?.consumed_at).not.toBe("");
  });

  it("keeps a standing (non one-off) approval valid across repeated evaluations", async () => {
    const approvals = new ApprovalRegistry(dir);
    const a = await approvals.request({
      action: "publish_public_content",
      actor: "owner",
      target: "post_77",
      scope: "standing",
      oneOff: false,
    });
    await approvals.resolve(a.id, "approved", "owner", "standing grant");
    const engine = new PolicyEngine(defaultConfig("freelancer"), approvals);

    const first = await engine.evaluate({
      action: "publish_public_content",
      actor: "social",
      target: "post_77",
    });
    const second = await engine.evaluate({
      action: "publish_public_content",
      actor: "social",
      target: "post_77",
    });
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.approval_id).toBe(a.id);
  });

  it("ignores one-off approvals for growth actions when allow_one_off_owner_approval is false (SER-182)", async () => {
    const approvals = new ApprovalRegistry(dir);
    const oneOff = await approvals.request({
      action: "publish_public_content",
      actor: "owner",
      target: "post_x",
      scope: "one-off",
      oneOff: true,
    });
    await approvals.resolve(oneOff.id, "approved", "owner", "go");

    const config = defaultConfig("freelancer");
    config.growth_autonomy.allow_one_off_owner_approval = false;
    const engine = new PolicyEngine(config, approvals);

    // With the control disabled, a one-off approval no longer authorizes the
    // growth action — it stays gated (previously it was honored, fail-open).
    const blocked = await engine.evaluate({
      action: "publish_public_content",
      actor: "social",
      target: "post_x",
    });
    expect(blocked.allowed).toBe(false);
    expect(blocked.approval_id).toBeUndefined();

    // A standing/recurring approval still authorizes.
    const standing = await approvals.request({
      action: "publish_public_content",
      actor: "owner",
      target: "post_x",
      scope: "standing",
      oneOff: false,
    });
    await approvals.resolve(standing.id, "approved", "owner", "standing grant");
    const allowed = await engine.evaluate({
      action: "publish_public_content",
      actor: "social",
      target: "post_x",
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.approval_id).toBe(standing.id);
  });

  it("does not consume a one-off approval during a preview evaluation", async () => {
    const approvals = new ApprovalRegistry(dir);
    const a = await approvals.request({
      action: "publish_public_content",
      actor: "owner",
      target: "post_55",
      scope: "one-off",
      oneOff: true,
    });
    await approvals.resolve(a.id, "approved", "owner", "inspect");
    const engine = new PolicyEngine(defaultConfig("freelancer"), approvals);

    const preview1 = await engine.evaluate({
      action: "publish_public_content",
      actor: "social",
      target: "post_55",
      preview: true,
    });
    const preview2 = await engine.evaluate({
      action: "publish_public_content",
      actor: "social",
      target: "post_55",
      preview: true,
    });
    expect(preview1.allowed).toBe(true);
    expect(preview2.allowed).toBe(true);

    // A real (non-preview) evaluation still has the one-off available, then burns it.
    const real = await engine.evaluate({
      action: "publish_public_content",
      actor: "social",
      target: "post_55",
    });
    expect(real.allowed).toBe(true);
    const after = await engine.evaluate({
      action: "publish_public_content",
      actor: "social",
      target: "post_55",
    });
    expect(after.allowed).toBe(false);
  });

  describe("owner-configured safety gates (SER-181)", () => {
    it("adds a security_review gate for auth_policy_change only when the flag is on", async () => {
      const on = defaultConfig("freelancer");
      on.limits.require_security_review_for_auth_changes = true;
      const onDecision = await new PolicyEngine(on, new ApprovalRegistry(dir)).evaluate({
        action: "auth_policy_change",
        actor: "security",
      });
      expect(onDecision.outcome).toBe("escalate");
      expect(onDecision.required_gates).toContain("security_review");

      const off = defaultConfig("freelancer");
      off.limits.require_security_review_for_auth_changes = false;
      const offDecision = await new PolicyEngine(off, new ApprovalRegistry(dir)).evaluate({
        action: "auth_policy_change",
        actor: "security",
      });
      expect(offDecision.required_gates).not.toContain("security_review");
      expect(offDecision.required_gates).toContain("human_approval");
    });

    it("adds a security_review gate for enabled payment actions only when the flag is on", async () => {
      const on = defaultConfig("freelancer");
      on.growth_autonomy.change_pricing = true;
      on.limits.require_security_review_for_payment_changes = true;
      const onDecision = await new PolicyEngine(on, new ApprovalRegistry(dir)).evaluate({
        action: "change_pricing",
        actor: "revenue",
      });
      expect(onDecision.allowed).toBe(true);
      expect(onDecision.required_gates).toContain("security_review");

      const off = defaultConfig("freelancer");
      off.growth_autonomy.change_pricing = true;
      off.limits.require_security_review_for_payment_changes = false;
      const offDecision = await new PolicyEngine(off, new ApprovalRegistry(dir)).evaluate({
        action: "change_pricing",
        actor: "revenue",
      });
      expect(offDecision.required_gates).not.toContain("security_review");
    });

    it("adds a human_review gate for destructive actions only when the flag is on", async () => {
      const on = defaultConfig("freelancer");
      on.limits.require_human_for_destructive_actions = true;
      const onDecision = await new PolicyEngine(on, new ApprovalRegistry(dir)).evaluate({
        action: "delete_data",
        actor: "development",
      });
      expect(onDecision.outcome).toBe("escalate");
      expect(onDecision.required_gates).toContain("human_review");

      const off = defaultConfig("freelancer");
      off.limits.require_human_for_destructive_actions = false;
      const offDecision = await new PolicyEngine(off, new ApprovalRegistry(dir)).evaluate({
        action: "delete_data",
        actor: "development",
      });
      expect(offDecision.required_gates).not.toContain("human_review");
    });
  });
});
