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
  });

  it("loads a full preset choice", async () => {
    const path = join(dir, "bureauos.yaml");
    await writeFile(
      path,
      `organization:\n  name: "Acme"\nsetup:\n  preset: "startup"\n`,
      "utf8",
    );
    const config = await loadConfig(path);
    expect(config.setup.preset).toBe("startup");
  });

  it("throws ConfigError when the file does not exist", async () => {
    await expect(loadConfig(join(dir, "missing.yaml"))).rejects.toBeInstanceOf(
      ConfigError,
    );
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
    await writeFile(
      path,
      `autonomy:\n  merge_pull_requests: "yes"\n`,
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
