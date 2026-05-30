import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig, loadConfig, ConfigError } from "./loader.js";

describe("loadConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-config-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads a minimal config and fills defaults", async () => {
    const path = join(dir, "bureauos.yaml");
    await writeFile(path, `organization:\n  name: "Acme"\n`, "utf8");
    const config = await loadConfig(path);
    expect(config.organization.name).toBe("Acme");
    expect(config.setup.preset).toBe("freelancer");
    expect(config.autonomy.merge_pull_requests).toBe(false);
    expect(config.autonomy.level).toBe(2);
    expect(config.growth_autonomy.publish_public_content).toBe(false);
    expect(config.memory.semantic_index).toEqual({
      enabled: false,
      provider: "none",
      index_path: ".bureauos/memory/indexes/semantic",
      min_score: 0.1,
    });
    expect(config.provider).toEqual({});
    expect(config.disabled_providers).toEqual([]);
    expect(config.capabilities).toEqual({});
  });

  it("loads a full preset choice", async () => {
    const path = join(dir, "bureauos.yaml");
    await writeFile(path, `organization:\n  name: "Acme"\nsetup:\n  preset: "startup"\n`, "utf8");
    const config = await loadConfig(path);
    expect(config.setup.preset).toBe("startup");
  });

  it("maps autonomy levels to per-action switches", async () => {
    const path = join(dir, "bureauos.yaml");
    await writeFile(path, `autonomy:\n  level: 0\n`, "utf8");

    const config = await loadConfig(path);

    expect(config.autonomy.level).toBe(0);
    expect(config.autonomy.observe_signals).toBe(true);
    expect(config.autonomy.create_issues).toBe(false);
    expect(config.autonomy.create_branches).toBe(false);
    expect(config.autonomy.merge_pull_requests).toBe(false);
    expect(config.autonomy.deploy_production).toBe(false);
  });

  it("keeps explicit autonomy overrides deterministic on top of a level", async () => {
    const path = join(dir, "bureauos.yaml");
    await writeFile(
      path,
      ["autonomy:", "  level: 0", "  create_issues: true", "  observe_signals: false"].join("\n"),
      "utf8",
    );

    const config = await loadConfig(path);

    expect(config.autonomy.level).toBe(0);
    expect(config.autonomy.create_issues).toBe(true);
    expect(config.autonomy.observe_signals).toBe(false);
    expect(config.autonomy.create_branches).toBe(false);
  });

  it("parses semantic memory index configuration without requiring a provider", async () => {
    const path = join(dir, "bureauos.yaml");
    await writeFile(
      path,
      [
        "memory:",
        "  semantic_index:",
        "    enabled: true",
        "    provider: custom",
        "    index_path: .bureauos/memory/indexes/custom-semantic",
        "    min_score: 0.81",
      ].join("\n"),
      "utf8",
    );

    const config = await loadConfig(path);

    expect(config.memory.semantic_index).toEqual({
      enabled: true,
      provider: "custom",
      index_path: ".bureauos/memory/indexes/custom-semantic",
      min_score: 0.81,
    });
  });

  it("throws ConfigError when the file does not exist", async () => {
    await expect(loadConfig(join(dir, "missing.yaml"))).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError when the YAML is structurally invalid", async () => {
    const path = join(dir, "bureauos.yaml");
    await writeFile(path, `key:\n  bad indent\n bad: structure\n`, "utf8");
    await expect(loadConfig(path)).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError when the YAML top-level is not an object", async () => {
    const path = join(dir, "bureauos.yaml");
    await writeFile(path, `"just a string"\n`, "utf8");
    await expect(loadConfig(path)).rejects.toBeInstanceOf(ConfigError);
  });

  it("throws ConfigError when a field has the wrong type", async () => {
    const path = join(dir, "bureauos.yaml");
    await writeFile(path, `autonomy:\n  merge_pull_requests: "yes"\n`, "utf8");
    await expect(loadConfig(path)).rejects.toBeInstanceOf(ConfigError);
  });

  it("loads capability assignments from bureauos.yaml", async () => {
    const path = join(dir, "bureauos.yaml");
    await writeFile(
      path,
      [
        "capabilities:",
        "  codex:",
        '    type: "runtime"',
        "    allowed_agents:",
        '      - "development"',
        "    actions:",
        "      edit_code: true",
        "      deploy: false",
        '    risk_class: "high"',
        "    audit_required: true",
      ].join("\n"),
      "utf8",
    );

    const config = await loadConfig(path);
    expect(config.capabilities.codex?.type).toBe("runtime");
    expect(config.capabilities.codex?.allowed_agents).toEqual(["development"]);
    expect(config.capabilities.codex?.actions.edit_code).toBe(true);
    expect(config.capabilities.codex?.actions.deploy).toBe(false);
  });

  it("loads OpenCode-style provider connector configuration", async () => {
    const path = join(dir, "bureauos.yaml");
    await writeFile(
      path,
      [
        "provider:",
        "  openai:",
        '    name: "OpenAI Enterprise"',
        "    env:",
        '      - "OPENAI_ENTERPRISE_KEY"',
        "    options:",
        '      defaultModel: "gpt-5-enterprise"',
        "    models:",
        "      gpt-5-enterprise:",
        '        name: "GPT-5 Enterprise"',
        "disabled_providers:",
        '  - "openrouter"',
      ].join("\n"),
      "utf8",
    );

    const config = await loadConfig(path);
    expect(config.provider.openai?.name).toBe("OpenAI Enterprise");
    expect(config.provider.openai?.env).toEqual(["OPENAI_ENTERPRISE_KEY"]);
    expect(config.provider.openai?.models["gpt-5-enterprise"]?.name).toBe("GPT-5 Enterprise");
    expect(config.disabled_providers).toEqual(["openrouter"]);
  });

  it("loads provider model routing controls from bureauos.yaml", async () => {
    const path = join(dir, "bureauos.yaml");
    await writeFile(
      path,
      [
        "provider:",
        "  openai:",
        "    models:",
        "      gpt-4o-mini:",
        "        capabilities:",
        '          - "chat"',
        '          - "low-cost"',
        '        budget_tier: "low"',
        "agents:",
        "  content:",
        "    provider: openai",
        "    model: gpt-4o-mini",
        '    max_budget_tier: "low"',
        "    prefer_low_cost: true",
        "    required_model_capabilities:",
        '      - "chat"',
      ].join("\n"),
      "utf8",
    );

    const config = await loadConfig(path);
    expect(config.provider.openai?.models["gpt-4o-mini"]?.capabilities).toEqual([
      "chat",
      "low-cost",
    ]);
    expect(config.provider.openai?.models["gpt-4o-mini"]?.budget_tier).toBe("low");
    expect(config.agents.content?.max_budget_tier).toBe("low");
    expect(config.agents.content?.prefer_low_cost).toBe(true);
    expect(config.agents.content?.required_model_capabilities).toEqual(["chat"]);
  });

  it("loads the documented example config with typed secondary sections", async () => {
    const example = fileURLToPath(
      new URL("../../../../examples/bureauos.example.yaml", import.meta.url),
    );

    const config = await loadConfig(example);

    expect(config.setup.auto_detect.github_remote).toBe(true);
    expect(config.interface.default_views).toContain("coordinator_chat");
    expect(config.interface.notifications.approval_needed).toBe(true);
    expect(config.supreme_coordinator.memory.search_index).toBe(
      ".bureauos/memory/indexes/memory.sqlite",
    );
    expect(config.triggers.thresholds.blocked_issue_hours).toBe(24);
    expect(config.growth_autonomy.require_action_sensitive_memory_for_approval).toBe(true);
    expect(config.business.primary_objective).toBe("sustainable_owner_profit");
    expect(config.business.metrics.track_client_lifetime_value).toBe(true);
    expect(config.business.policies.require_compliance_review_before_external_commitment).toBe(
      true,
    );
    expect(config.business.require_owner_approval_for).toContain("production_deploy");
    expect(config.open_source.optimize_for).toContain("model_agnostic_integrations");
    expect(config.memory.growth_memory.brand).toBe(".bureauos/memory/BRAND.md");
    expect(config.memory.client_intelligence.profile).toBe("CLIENT.md");
    expect(config.capabilities.mcp?.high_risk_actions_require_policy).toBe(true);
    expect(config.provider.openai?.models["gpt-5.5"]?.budget_tier).toBe("high");
  });

  it("rejects unknown top-level fields instead of silently dropping them", async () => {
    const path = join(dir, "bureauos.yaml");
    await writeFile(
      path,
      ["organization:", '  name: "Acme"', "unknown_policy_section:", "  enabled: true"].join("\n"),
      "utf8",
    );

    await expect(loadConfig(path)).rejects.toBeInstanceOf(ConfigError);
  });

  it("rejects malformed secondary config fields", async () => {
    const path = join(dir, "bureauos.yaml");
    await writeFile(
      path,
      [
        "business:",
        "  metrics:",
        '    track_pipeline_value: "yes"',
        "triggers:",
        "  thresholds:",
        "    stale_pr_hours: 48",
      ].join("\n"),
      "utf8",
    );

    await expect(loadConfig(path)).rejects.toBeInstanceOf(ConfigError);
  });
});

describe("defaultConfig", () => {
  it("returns a valid config for each preset", () => {
    const presets = ["freelancer", "agency", "startup", "operator"] as const;
    for (const p of presets) {
      const c = defaultConfig(p);
      expect(c.setup.preset).toBe(p);
      expect(c.autonomy.observe_signals).toBe(true);
    }
  });
});
