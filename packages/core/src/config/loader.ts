import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { load as parseYaml } from "js-yaml";
import { BureauConfigSchema, type BureauConfig } from "./schema.js";

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    cause?: unknown,
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "ConfigError";
  }
}

/**
 * Load and validate a `bureauos.yaml` file.
 *
 * - Missing optional fields are filled with safe defaults.
 * - Unknown top-level fields are accepted but ignored (warned in stderr).
 * - Type errors throw a `ConfigError` with a path pointing to the offending file.
 */
export async function loadConfig(filePath: string): Promise<BureauConfig> {
  const absolute = resolve(filePath);
  let raw: string;
  try {
    raw = await readFile(absolute, "utf8");
  } catch (cause) {
    throw new ConfigError(`failed to read config at ${absolute}`, absolute, cause);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (cause) {
    throw new ConfigError(`failed to parse YAML at ${absolute}`, absolute, cause);
  }

  const result = BureauConfigSchema.safeParse(parsed ?? {});
  if (!result.success) {
    throw new ConfigError(
      `invalid config at ${absolute}: ${result.error.message}`,
      absolute,
      result.error,
    );
  }
  return result.data;
}

/**
 * Build a default config for a given preset, without reading from disk.
 */
export function defaultConfig(preset: BureauConfig["setup"]["preset"]): BureauConfig {
  return BureauConfigSchema.parse({
    organization: { name: "Untitled BureauOS Workspace" },
    setup: { preset },
  });
}
