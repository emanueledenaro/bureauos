import { describe, expect, it } from "vitest";
import { CapabilityRegistry } from "./registry.js";

describe("CapabilityRegistry", () => {
  it("checks agent and action boundaries for built-in capabilities", () => {
    const registry = CapabilityRegistry.fromConfig();

    expect(
      registry.check({
        capability_id: "codex",
        agent: "development",
        action: "edit_code",
      }),
    ).toMatchObject({
      allowed: true,
      risk_class: "high",
      audit_required: true,
    });

    expect(
      registry.check({
        capability_id: "codex",
        agent: "product",
        action: "edit_code",
      }),
    ).toMatchObject({
      allowed: false,
      reason: 'agent "product" is not assigned to capability "codex"',
    });

    expect(
      registry.check({
        capability_id: "github",
        agent: "development",
        action: "merge_pr",
      }),
    ).toMatchObject({
      allowed: false,
      reason: 'action "merge_pr" is disabled for capability "github"',
    });

    expect(
      registry.check({
        capability_id: "github",
        agent: "security",
        action: "comment",
      }),
    ).toMatchObject({ allowed: true });

    expect(
      registry.check({
        capability_id: "github",
        agent: "compliance",
        action: "comment",
      }),
    ).toMatchObject({ allowed: true });
  });

  it("registers Linear as a policy-gated MCP work-item capability", () => {
    const registry = CapabilityRegistry.fromConfig();

    expect(registry.get("linear")).toMatchObject({
      id: "linear",
      type: "mcp",
      connector: "linear",
      risk_class: "medium",
      audit_required: true,
    });

    expect(
      registry.check({
        capability_id: "linear",
        agent: "project_manager",
        action: "read_issues",
      }),
    ).toMatchObject({ allowed: true });

    expect(
      registry.check({
        capability_id: "linear",
        agent: "ads",
        action: "create_issues",
      }),
    ).toMatchObject({
      allowed: false,
      reason: 'agent "ads" is not assigned to capability "linear"',
    });

    expect(
      registry.check({
        capability_id: "linear",
        agent: "development",
        action: "delete_issue",
      }),
    ).toMatchObject({
      allowed: false,
      reason: 'action "delete_issue" is disabled for capability "linear"',
    });
  });

  it("merges workspace capability config over built-in definitions", () => {
    const registry = CapabilityRegistry.fromConfig({
      github: {
        allowed_agents: ["project_manager"],
        actions: { merge_pr: true },
        required_approvals: ["merge_approval"],
      },
    });

    expect(
      registry.check({
        capability_id: "github",
        agent: "project_manager",
        action: "merge_pr",
      }),
    ).toMatchObject({
      allowed: true,
      required_approvals: ["merge_approval"],
      status: "configured",
    });

    expect(
      registry.check({
        capability_id: "github",
        agent: "development",
        action: "read_issues",
      }),
    ).toMatchObject({ allowed: false });
  });

  it("registers custom capabilities from workspace config", () => {
    const registry = CapabilityRegistry.fromConfig({
      lead_finder: {
        type: "mcp",
        allowed_agents: ["sales"],
        actions: { discover_leads: true },
        risk_class: "medium",
      },
    });

    expect(registry.get("lead_finder")).toMatchObject({
      id: "lead_finder",
      type: "mcp",
      status: "configured",
    });
    expect(
      registry.check({
        capability_id: "lead_finder",
        agent: "sales",
        action: "discover_leads",
      }),
    ).toMatchObject({ allowed: true });
  });
});
