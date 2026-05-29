import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CapabilityUseService } from "../capabilities/usage.js";
import { defaultConfig } from "../config/loader.js";
import { initWorkspace } from "../init/initializer.js";
import { PolicyExplainService } from "./explain.js";

describe("PolicyExplainService", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-policy-explain-"));
    await initWorkspace({ root: dir, organizationName: "Policy Explain QA", preset: "agency" });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("explains allowed, denied, and approval-required capability decisions", async () => {
    const service = new CapabilityUseService(dir, { config: defaultConfig("agency") });
    await service.check({
      agent: "development",
      capabilityId: "codex",
      action: "read_repo",
      target: "github.com/acme/web?api_key=sk-secret123456",
    });
    await service.check({
      agent: "product",
      capabilityId: "codex",
      action: "edit_code",
      target: "github.com/acme/web",
    });
    await service.check({
      agent: "development",
      capabilityId: "codex",
      action: "open_pr",
      target: "github.com/acme/web/pull/42",
    });

    const result = await new PolicyExplainService(dir).list({ limit: 10 });

    expect(result.counts.allow).toBe(1);
    expect(result.counts.deny).toBe(1);
    expect(result.counts.require_approval).toBe(1);
    expect(result.decisions.map((decision) => decision.outcome)).toEqual(
      expect.arrayContaining(["allow", "deny", "require_approval"]),
    );
    expect(result.decisions.some((decision) => decision.target.includes("sk-secret"))).toBe(false);
    expect(result.decisions).toContainEqual(
      expect.objectContaining({
        outcome: "deny",
        matched_rule: "autonomy.push_commits",
        risk_class: "high",
      }),
    );
    expect(result.decisions).toContainEqual(
      expect.objectContaining({
        outcome: "require_approval",
        approval_required: true,
        required_gates: ["tests_required", "linked_issue"],
        missing_gates: ["tests_required", "linked_issue"],
      }),
    );
  });
});
