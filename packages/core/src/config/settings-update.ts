import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { load as parseYaml, dump as dumpYaml } from "js-yaml";
import { BureauConfigSchema, type BureauConfig } from "./schema.js";
import { ConfigError } from "./loader.js";

/**
 * Editable settings groups the Owner Interface may patch from the Operating
 * Room. Each key in a group is an allowlisted leaf the UI can toggle or edit;
 * anything outside these lists is rejected so the write path can never reach
 * provider secrets, capability wiring, or other sensitive config.
 *
 * `autonomy` and `growth_autonomy` are boolean policy switches. `limits` mixes
 * positive-integer guards with boolean review gates.
 */

const AUTONOMY_BOOLEAN_KEYS = [
  "observe_signals",
  "start_triage_runs",
  "create_internal_reports",
  "create_repositories",
  "create_issues",
  "comment_on_issues",
  "create_branches",
  "push_commits",
  "open_pull_requests",
  "merge_pull_requests",
  "deploy_production",
  "contact_clients_directly",
] as const;

const GROWTH_BOOLEAN_KEYS = [
  "draft_content",
  "draft_campaigns",
  "draft_replies",
  "draft_proposals",
  "update_internal_pipeline",
  "publish_public_content",
  "send_client_messages",
  "run_paid_ads",
  "change_pricing",
  "send_final_proposals",
  "accept_projects",
  "publish_social_posts",
  "generate_public_creatives",
  "launch_ad_campaigns",
  "change_ad_budget",
  "allow_one_off_owner_approval",
  "require_action_sensitive_memory_for_approval",
] as const;

const LIMITS_INTEGER_KEYS = [
  "max_retries_per_task",
  "max_files_changed_without_human_review",
] as const;

const LIMITS_BOOLEAN_KEYS = [
  "require_tests_for_code_changes",
  "require_security_review_for_auth_changes",
  "require_security_review_for_payment_changes",
  "require_human_for_destructive_actions",
] as const;

export type AutonomyBooleanKey = (typeof AUTONOMY_BOOLEAN_KEYS)[number];
export type GrowthBooleanKey = (typeof GROWTH_BOOLEAN_KEYS)[number];
export type LimitsIntegerKey = (typeof LIMITS_INTEGER_KEYS)[number];
export type LimitsBooleanKey = (typeof LIMITS_BOOLEAN_KEYS)[number];

export interface SettingsUpdateInput {
  autonomy?: Partial<Record<AutonomyBooleanKey, boolean>>;
  growth_autonomy?: Partial<Record<GrowthBooleanKey, boolean>>;
  limits?: Partial<Record<LimitsIntegerKey, number>> & Partial<Record<LimitsBooleanKey, boolean>>;
}

/** Audit-friendly description of one changed leaf, e.g. `autonomy.create_issues`. */
export interface SettingsChange {
  path: string;
  value: boolean | number;
}

export interface SettingsUpdateResult {
  config: BureauConfig;
  changes: SettingsChange[];
}

/**
 * Raised when a settings patch is malformed, references an unknown key, or
 * would produce a config the schema rejects. Carries an HTTP-friendly message.
 */
export class SettingsUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsUpdateError";
  }
}

const AUTONOMY_KEY_SET = new Set<string>(AUTONOMY_BOOLEAN_KEYS);
const GROWTH_KEY_SET = new Set<string>(GROWTH_BOOLEAN_KEYS);
const LIMITS_INTEGER_KEY_SET = new Set<string>(LIMITS_INTEGER_KEYS);
const LIMITS_BOOLEAN_KEY_SET = new Set<string>(LIMITS_BOOLEAN_KEYS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a raw settings patch against the editable allowlist and normalize it
 * into typed groups. Throws `SettingsUpdateError` on any unknown key or wrong
 * value type so the caller can return a 400 without touching disk.
 */
export function parseSettingsUpdate(body: unknown): SettingsUpdateInput {
  if (!isPlainObject(body)) {
    throw new SettingsUpdateError("request body must be an object");
  }

  const known = new Set(["autonomy", "growth_autonomy", "limits"]);
  for (const key of Object.keys(body)) {
    if (!known.has(key)) {
      throw new SettingsUpdateError(`unknown settings group: ${key}`);
    }
  }

  const result: SettingsUpdateInput = {};

  if (body.autonomy !== undefined) {
    if (!isPlainObject(body.autonomy)) {
      throw new SettingsUpdateError("autonomy must be an object");
    }
    const autonomy: Partial<Record<AutonomyBooleanKey, boolean>> = {};
    for (const [key, value] of Object.entries(body.autonomy)) {
      if (!AUTONOMY_KEY_SET.has(key)) {
        throw new SettingsUpdateError(`autonomy.${key} is not editable`);
      }
      if (typeof value !== "boolean") {
        throw new SettingsUpdateError(`autonomy.${key} must be a boolean`);
      }
      autonomy[key as AutonomyBooleanKey] = value;
    }
    result.autonomy = autonomy;
  }

  if (body.growth_autonomy !== undefined) {
    if (!isPlainObject(body.growth_autonomy)) {
      throw new SettingsUpdateError("growth_autonomy must be an object");
    }
    const growth: Partial<Record<GrowthBooleanKey, boolean>> = {};
    for (const [key, value] of Object.entries(body.growth_autonomy)) {
      if (!GROWTH_KEY_SET.has(key)) {
        throw new SettingsUpdateError(`growth_autonomy.${key} is not editable`);
      }
      if (typeof value !== "boolean") {
        throw new SettingsUpdateError(`growth_autonomy.${key} must be a boolean`);
      }
      growth[key as GrowthBooleanKey] = value;
    }
    result.growth_autonomy = growth;
  }

  if (body.limits !== undefined) {
    if (!isPlainObject(body.limits)) {
      throw new SettingsUpdateError("limits must be an object");
    }
    const limits: SettingsUpdateInput["limits"] = {};
    for (const [key, value] of Object.entries(body.limits)) {
      if (LIMITS_INTEGER_KEY_SET.has(key)) {
        if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
          throw new SettingsUpdateError(`limits.${key} must be a positive integer`);
        }
        limits[key as LimitsIntegerKey] = value;
      } else if (LIMITS_BOOLEAN_KEY_SET.has(key)) {
        if (typeof value !== "boolean") {
          throw new SettingsUpdateError(`limits.${key} must be a boolean`);
        }
        limits[key as LimitsBooleanKey] = value;
      } else {
        throw new SettingsUpdateError(`limits.${key} is not editable`);
      }
    }
    result.limits = limits;
  }

  if (
    result.autonomy === undefined &&
    result.growth_autonomy === undefined &&
    result.limits === undefined
  ) {
    throw new SettingsUpdateError("no editable settings provided");
  }

  return result;
}

function patchGroup(
  raw: Record<string, unknown>,
  group: string,
  patch: Record<string, boolean | number>,
  changes: SettingsChange[],
): void {
  const existing = isPlainObject(raw[group]) ? (raw[group] as Record<string, unknown>) : {};
  const next: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    next[key] = value;
    changes.push({ path: `${group}.${key}`, value });
  }
  raw[group] = next;
}

/**
 * Apply a validated settings patch to `bureauos.yaml`.
 *
 * Load → patch → validate → atomic write. The existing file is parsed as a
 * plain object so unknown/unedited fields round-trip untouched; only allowlisted
 * leaves are overwritten. The fully patched object is re-validated against the
 * zod schema before anything is written, and the file is replaced atomically via
 * a temp file + rename so a crash mid-write cannot leave a truncated config.
 *
 * Returns the reloaded, schema-validated config plus the list of changed leaves
 * for the audit trail. Throws `SettingsUpdateError` if validation fails and
 * `ConfigError` if the file cannot be read.
 */
export async function applySettingsUpdate(
  configFile: string,
  update: SettingsUpdateInput,
): Promise<SettingsUpdateResult> {
  let rawText: string;
  try {
    rawText = await readFile(configFile, "utf8");
  } catch (cause) {
    throw new ConfigError(`failed to read config at ${configFile}`, configFile, cause);
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(rawText);
  } catch (cause) {
    throw new ConfigError(`failed to parse YAML at ${configFile}`, configFile, cause);
  }

  const document: Record<string, unknown> = isPlainObject(parsed) ? { ...parsed } : {};
  const changes: SettingsChange[] = [];

  if (update.autonomy) {
    patchGroup(document, "autonomy", update.autonomy, changes);
  }
  if (update.growth_autonomy) {
    patchGroup(document, "growth_autonomy", update.growth_autonomy, changes);
  }
  if (update.limits) {
    patchGroup(document, "limits", update.limits, changes);
  }

  // Validate the fully patched document. This catches both bad patches and any
  // pre-existing drift the patch would otherwise persist.
  const result = BureauConfigSchema.safeParse(document);
  if (!result.success) {
    throw new SettingsUpdateError(`invalid config after patch: ${result.error.message}`);
  }

  const serialized = dumpYaml(document, { lineWidth: 100, noRefs: true, sortKeys: false });
  await writeFileAtomic(configFile, serialized);

  return { config: result.data, changes };
}

/**
 * Write `contents` to `filePath` atomically: write a sibling temp file, then
 * rename it over the target. Rename is atomic on the same filesystem, so readers
 * never observe a partially written config.
 */
async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  const tempPath = join(dirname(filePath), `.${randomUUID()}.tmp`);
  await writeFile(tempPath, contents, "utf8");
  await rename(tempPath, filePath);
}
