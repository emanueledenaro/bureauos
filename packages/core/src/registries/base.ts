import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Common helpers used by file-backed registries.
 *
 * Registries persist as markdown files with a YAML-like front-matter block
 * delimited by `---` lines. The body of the markdown holds free-form notes
 * that humans can edit. The front-matter block holds the structured fields.
 */

export interface FrontMatter {
  [key: string]: string | number | boolean | string[];
}

export interface ParsedDocument<T extends FrontMatter = FrontMatter> {
  front: T;
  body: string;
}

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function parseStringValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === "string") return parsed;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

/**
 * Parse the inner content of a serialized front-matter array.
 *
 * `renderFrontMatter` writes arrays as `[${elements.map(JSON.stringify).join(", ")}]`,
 * so the canonical form is a JSON array of JSON-encoded elements. Parsing must
 * match that: a naive `split(",")` corrupts any element that itself contains a
 * comma (e.g. `"b,c"`), splitting one element into two.
 *
 * Strategy:
 *  1. Try `JSON.parse` on the whole `[...]` value. This round-trips everything
 *     the serializer produces, including commas, quotes, and escapes inside
 *     elements.
 *  2. Fall back to a quote-aware splitter for legacy/hand-edited front matter
 *     whose elements were written without strict JSON quoting (e.g. `[a, b]`).
 *     This respects quoted segments so commas inside quotes stay attached.
 */
function parseArrayValue(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((element) => (typeof element === "string" ? element : String(element)));
    }
  } catch {
    // Not strict JSON (legacy or hand-edited); fall through to quote-aware split.
  }

  const inner = value.slice(1, -1).trim();
  if (!inner) return [];

  const elements: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i]!;
    if (quote) {
      if (char === "\\" && quote === '"' && i + 1 < inner.length) {
        // Preserve escaped char inside a double-quoted segment.
        current += char + inner[i + 1]!;
        i += 1;
        continue;
      }
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      elements.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  elements.push(current);

  return elements.map((element) => parseStringValue(element.trim()));
}

export function parseFrontMatter<T extends FrontMatter = FrontMatter>(
  raw: string,
): ParsedDocument<T> {
  const m = FM_RE.exec(raw);
  if (!m) {
    return { front: {} as T, body: raw };
  }
  const fmRaw = m[1] ?? "";
  const body = m[2] ?? "";
  const front: FrontMatter = {};
  for (const line of fmRaw.split("\n")) {
    const eq = line.indexOf(":");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!key) continue;
    if (value.startsWith('"') && value.endsWith('"')) {
      // JSON-encoded scalar (covers newlines and other YAML-special values).
      front[key] = parseStringValue(value);
    } else if (value.startsWith("[") && value.endsWith("]")) {
      front[key] = parseArrayValue(value);
    } else if (value === "true" || value === "false") {
      front[key] = value === "true";
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      front[key] = Number(value);
    } else {
      front[key] = parseStringValue(value);
    }
  }
  return { front: front as T, body };
}

/**
 * Decide whether a scalar string must be serialized as a JSON-quoted value to
 * survive a render -> parse round-trip.
 *
 * The front-matter block is line-delimited and parsed key-by-key, so any value
 * that would break that structure (newlines, carriage returns, tabs, other
 * control chars) or that the parser would otherwise reinterpret (YAML-special
 * chars, leading/trailing whitespace, list/quote syntax, boolean/number
 * look-alikes) must be quoted. JSON-quoting escapes embedded newlines as `\n`,
 * keeping the value on a single line that `parseStringValue` decodes back
 * exactly.
 */
function needsQuoting(value: string): boolean {
  if (value === "") return false;
  // Control characters (newline, carriage return, tab, etc.) would corrupt the
  // single-line front-matter layout.
  if (/[\u0000-\u001f\u007f]/.test(value)) return true;
  // YAML-special characters the parser keys on, plus brackets/commas that the
  // array branch would otherwise capture.
  if (/[:#"'[\],]/.test(value)) return true;
  // Leading or trailing whitespace is lost because the parser trims values.
  if (value !== value.trim()) return true;
  // Values that would round-trip as a different type (boolean/number) must be
  // quoted to remain strings.
  if (value === "true" || value === "false") return true;
  if (/^-?\d+(\.\d+)?$/.test(value)) return true;
  return false;
}

export function renderFrontMatter(front: FrontMatter, body: string): string {
  const lines: string[] = ["---"];
  for (const [k, v] of Object.entries(front)) {
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`);
    } else if (typeof v === "string") {
      lines.push(`${k}: ${needsQuoting(v) ? JSON.stringify(v) : v}`);
    } else {
      lines.push(`${k}: ${String(v)}`);
    }
  }
  // Emit the body verbatim. The closing `---` is followed by a single newline
  // (from `join`), and `parseFrontMatter`'s `\n?` consumes exactly that one
  // newline, so a body that itself begins with a newline round-trips intact
  // instead of silently losing its leading blank line.
  lines.push("---", body);
  return lines.join("\n");
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serialize concurrent read-modify-write sequences on the same file path.
 *
 * File-backed stores load a document, mutate it in memory, and write it back.
 * Without serialization two overlapping callers can both read the same base
 * version and the second write silently discards the first caller's change.
 * `withFileLock` chains operations per normalized path so each runs to
 * completion before the next begins. The chain is keyed by path, so writes to
 * different files still run concurrently.
 */
const fileLocks = new Map<string, Promise<unknown>>();

export async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const key = join(path);
  const previous = fileLocks.get(key) ?? Promise.resolve();
  // Run `fn` after the previous operation settles (success or failure), so the
  // queue keeps draining even if an earlier op rejected. The caller still sees
  // its own result/rejection via `run`.
  const run = previous.then(fn, fn);
  // Store a never-rejecting tail so the next caller chains off a settled
  // promise without an unhandled-rejection warning.
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  fileLocks.set(key, tail);
  try {
    return await run;
  } finally {
    // Drop the entry once this op is the last queued one to keep the map from
    // growing without bound.
    if (fileLocks.get(key) === tail) fileLocks.delete(key);
  }
}

/**
 * Atomically write a file by writing to a sibling temp file and renaming it
 * into place. `rename` is atomic on POSIX filesystems, so a reader never sees a
 * partially written document and a crash mid-write cannot truncate the target.
 */
export async function atomicWriteFile(path: string, contents: string): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, contents, "utf8");
    await rename(tmp, path);
  } catch (error) {
    // Best-effort cleanup of the temp file if the rename never happened.
    await rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeDoc(path: string, front: FrontMatter, body: string): Promise<void> {
  await atomicWriteFile(path, renderFrontMatter(front, body));
}

export async function readDoc<T extends FrontMatter = FrontMatter>(
  path: string,
): Promise<ParsedDocument<T>> {
  const raw = await readFile(path, "utf8");
  return parseFrontMatter<T>(raw);
}

export async function listDocs(dir: string, suffix = ".md"): Promise<string[]> {
  if (!(await fileExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(suffix)).map((e) => join(dir, e.name));
}

export async function listDirs(dir: string): Promise<string[]> {
  if (!(await fileExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => join(dir, e.name));
}
