import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(config.growth_autonomy.publish_public_content).toBe(false);
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
