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
  const slug = input
    .toLowerCase()
    .trim()
    .replace(SLUG_RE, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (slug) return slug;
  // A name with no [a-z0-9] characters — non-Latin (e.g. "株式会社"), symbol-only
  // ("!!!"), or empty — would otherwise yield "". Slugs name directories
  // (clients/<slug>/, projects/<slug>/), so an empty slug writes files into the
  // registry root and makes every such name collide. Fall back to a
  // deterministic token so distinct names get distinct, filesystem-safe slugs;
  // identity still belongs to the ID, not the slug (SER-230).
  return `item-${stableHash(input)}`;
}

/** Dependency-free deterministic 32-bit FNV-1a hash, rendered as base36. */
function stableHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
