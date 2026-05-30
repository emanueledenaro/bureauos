import { randomBytes } from "node:crypto";

/**
 * Lowercase alphanumeric ID generator. Stable across renames because we
 * never derive IDs from human-readable names.
 *
 * Format: `<prefix>_<16 hex chars>` (e.g. `run_3a7f2b9148c0e5d2`).
 *
 * Uses 64 bits of entropy. The id-keyed write paths (artifacts, runs,
 * opportunities, approvals) write `<id>.md` with no destination existence
 * check, so a collision would silently overwrite durable data. At 64 bits the
 * birthday-collision probability stays negligible even for very large record
 * sets, which the previous 32-bit width did not provide.
 */
export function newId(prefix: string): string {
  const id = randomBytes(8).toString("hex");
  return `${prefix}_${id}`;
}

const SLUG_RE = /[^a-z0-9]+/g;

/**
 * Convert a human-readable name into a filesystem-safe slug.
 *
 * Slugs are used for folder names (e.g. `clients/acme-co/`); they are
 * cosmetic and must not be relied upon for identity. Identity belongs to
 * the ID, which is stored inside the folder's `CLIENT.md` or equivalent.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(SLUG_RE, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
