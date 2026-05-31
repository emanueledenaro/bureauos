import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applySettingsUpdate,
  parseSettingsUpdate,
  SettingsUpdateError,
} from "./settings-update.js";
import { loadConfig } from "./loader.js";

const SAMPLE_CONFIG = `organization:
  name: "Round Trip Co"

setup:
  preset: "agency"
  mode: "branch_and_pr"

autonomy:
  level: 2
  observe_signals: true
  merge_pull_requests: false

growth_autonomy:
  draft_content: true
  publish_public_content: false

limits:
  max_retries_per_task: 2
  require_tests_for_code_changes: true
`;

describe("parseSettingsUpdate", () => {
  it("accepts allowlisted autonomy, growth, and limit edits", () => {
    const update = parseSettingsUpdate({
      autonomy: { merge_pull_requests: true },
      growth_autonomy: { publish_public_content: true },
      limits: { max_retries_per_task: 4, require_tests_for_code_changes: false },
    });
    expect(update.autonomy).toEqual({ merge_pull_requests: true });
    expect(update.growth_autonomy).toEqual({ publish_public_content: true });
    expect(update.limits).toEqual({
      max_retries_per_task: 4,
      require_tests_for_code_changes: false,
    });
  });

  it("accepts a valid interface language and rejects unknown languages/keys", () => {
    expect(parseSettingsUpdate({ interface: { language: "it" } }).interface).toEqual({
      language: "it",
    });
    expect(parseSettingsUpdate({ interface: { language: "en" } }).interface).toEqual({
      language: "en",
    });
    expect(() => parseSettingsUpdate({ interface: { language: "fr" } })).toThrow(
      SettingsUpdateError,
    );
    expect(() => parseSettingsUpdate({ interface: { mode: "headless" } })).toThrow(
      SettingsUpdateError,
    );
  });

  it("rejects unknown groups, unknown keys, and wrong types", () => {
    expect(() => parseSettingsUpdate({ providers: {} })).toThrow(SettingsUpdateError);
    expect(() => parseSettingsUpdate({ autonomy: { not_a_key: true } })).toThrow(
      SettingsUpdateError,
    );
    expect(() => parseSettingsUpdate({ autonomy: { merge_pull_requests: 1 } })).toThrow(
      SettingsUpdateError,
    );
    expect(() => parseSettingsUpdate({ limits: { max_retries_per_task: -1 } })).toThrow(
      SettingsUpdateError,
    );
    expect(() => parseSettingsUpdate({ limits: { max_retries_per_task: 1.5 } })).toThrow(
      SettingsUpdateError,
    );
    expect(() => parseSettingsUpdate({})).toThrow(SettingsUpdateError);
    expect(() => parseSettingsUpdate("nope")).toThrow(SettingsUpdateError);
  });
});

describe("applySettingsUpdate", () => {
  let dir: string;
  let configFile: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-settings-"));
    configFile = join(dir, "bureauos.yaml");
    await writeFile(configFile, SAMPLE_CONFIG, "utf8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("patches targeted leaves and preserves the rest of the file", async () => {
    const result = await applySettingsUpdate(configFile, {
      autonomy: { merge_pull_requests: true },
      limits: { max_retries_per_task: 6 },
    });

    expect(result.config.autonomy.merge_pull_requests).toBe(true);
    expect(result.config.autonomy.observe_signals).toBe(true);
    expect(result.config.limits.max_retries_per_task).toBe(6);
    expect(result.config.organization.name).toBe("Round Trip Co");
    expect(result.changes).toEqual([
      { path: "autonomy.merge_pull_requests", value: true },
      { path: "limits.max_retries_per_task", value: 6 },
    ]);

    // The persisted file round-trips through the loader with the new values.
    const reloaded = await loadConfig(configFile);
    expect(reloaded.autonomy.merge_pull_requests).toBe(true);
    expect(reloaded.limits.max_retries_per_task).toBe(6);
    expect(reloaded.growth_autonomy.draft_content).toBe(true);
  });

  it("persists the interface language and round-trips through the loader", async () => {
    const result = await applySettingsUpdate(configFile, {
      interface: { language: "it" },
    });
    expect(result.config.interface.language).toBe("it");
    expect(result.changes).toEqual([{ path: "interface.language", value: "it" }]);

    const reloaded = await loadConfig(configFile);
    expect(reloaded.interface.language).toBe("it");
    // Unrelated config is preserved.
    expect(reloaded.organization.name).toBe("Round Trip Co");
  });

  it("rejects a patch that would produce an invalid config without writing", async () => {
    // A negative retry count is caught at parse time; force a schema failure by
    // bypassing the parser with a raw invalid value.
    const before = await readFile(configFile, "utf8");
    await expect(
      applySettingsUpdate(configFile, {
        limits: { max_retries_per_task: 0 as unknown as number },
      }),
    ).rejects.toBeInstanceOf(SettingsUpdateError);
    const after = await readFile(configFile, "utf8");
    expect(after).toBe(before);
  });
});
