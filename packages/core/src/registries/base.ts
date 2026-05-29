import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { dirname, join } from "node:path";

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
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      front[key] = inner ? inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")) : [];
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

export function renderFrontMatter(front: FrontMatter, body: string): string {
  const lines: string[] = ["---"];
  for (const [k, v] of Object.entries(front)) {
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(", ")}]`);
    } else if (typeof v === "string") {
      lines.push(`${k}: ${/[:#"']/.test(v) ? JSON.stringify(v) : v}`);
    } else {
      lines.push(`${k}: ${String(v)}`);
    }
  }
  lines.push("---", body.startsWith("\n") ? body.slice(1) : body);
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

export async function writeDoc(path: string, front: FrontMatter, body: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, renderFrontMatter(front, body), "utf8");
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
