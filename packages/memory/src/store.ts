import { readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import {
  noopSemanticMemoryIndex,
  type SemanticMemoryHit,
  type SemanticMemoryIndex,
} from "./semantic.js";
import { SqliteFtsMemoryIndex } from "./sqlite-index.js";

/**
 * Markdown-backed memory store.
 *
 * Markdown stays the source of truth. SQLite FTS5 is used as an accelerator
 * when the local Node runtime exposes `node:sqlite`; corrupt or missing indexes
 * fall back to the plain scan path.
 */

export interface MemoryHit {
  path: string;
  relativePath?: string;
  snippet: string;
  score: number;
  updated?: string;
  source?: "scan" | "sqlite_fts5";
}

export type MemorySearchBackend = "auto" | "scan" | "sqlite_fts5";

export interface SearchOptions {
  limit?: number;
  includeBody?: boolean;
  backend?: MemorySearchBackend;
}

export interface ContextAssemblyOptions extends SearchOptions {
  semanticIndex?: SemanticMemoryIndex;
  semanticLimit?: number;
  semanticMinScore?: number;
}

export type MemoryAccessKind = "file" | "directory";

export interface MemoryAccessRule {
  path: string;
  kind: MemoryAccessKind;
  label?: string;
}

export class MemoryAccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryAccessDeniedError";
  }
}

const IGNORED_MEMORY_DIRS = new Set([".index", ".git", "node_modules"]);

function toPortablePath(path: string): string {
  return path.split(sep).join("/");
}

/**
 * Normalize a relative memory path to a portable, canonical form.
 *
 * Backslashes become `/`, leading/trailing slashes are stripped, and `.`/`..`
 * segments are collapsed with posix semantics so the textual access checks
 * agree with what the filesystem would resolve. A path that walks above its own
 * root (a leftover leading `..`) is rejected, so traversal can never bypass
 * scope isolation such as `clients/acme/../bravo/secret.md`.
 */
function normalizeRelativePath(path: string): string {
  const portable = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const segments: string[] = [];
  for (const segment of portable.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        throw new MemoryAccessDeniedError(`memory path escapes root: ${path}`);
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

/**
 * Like {@link normalizeRelativePath} but returns `null` instead of throwing when
 * the path escapes its root. Used by boolean access predicates that must report
 * "no access" rather than surfacing an error.
 */
function tryNormalizeRelativePath(path: string): string | null {
  try {
    return normalizeRelativePath(path);
  } catch (error) {
    if (error instanceof MemoryAccessDeniedError) return null;
    throw error;
  }
}

function normalizeRule(rule: string | MemoryAccessRule): MemoryAccessRule {
  if (typeof rule === "string") {
    const kind = rule.endsWith("/") || rule === "" || rule === "." ? "directory" : "file";
    return { path: normalizeRelativePath(rule), kind };
  }
  return { ...rule, path: normalizeRelativePath(rule.path) };
}

export class LocalMemoryStore {
  protected readonly root: string;
  protected readonly indexPath: string | undefined;

  /**
   * @param memoryRoot Absolute path to the workspace memory directory.
   * @param options Optional configuration. `indexPath` honors the configured
   *   FTS5 `search_index` location; when omitted, the index defaults to a path
   *   inside the memory root (see {@link SqliteFtsMemoryIndex}).
   */
  constructor(
    public readonly memoryRoot: string,
    options: { indexPath?: string } = {},
  ) {
    this.root = resolve(memoryRoot);
    this.indexPath = options.indexPath ? resolve(options.indexPath) : undefined;
  }

  async read(relativePath: string): Promise<string> {
    return readFile(this.resolveInsideRoot(relativePath), "utf8");
  }

  /**
   * Resolve a relative memory path to an absolute path inside the memory root.
   * Throws {@link MemoryAccessDeniedError} when the path escapes the root.
   */
  resolveRelative(relativePath: string): string {
    return this.resolveInsideRoot(relativePath);
  }

  async list(relativeDir = ""): Promise<string[]> {
    const start = relativeDir ? this.resolveInsideRoot(relativeDir) : this.root;
    return this.walk(start);
  }

  /**
   * Keyword search over Markdown memory.
   * Uses SQLite FTS5 in `auto` mode when available and safe, then falls back to
   * a plain scan if the accelerator is missing or unhealthy.
   */
  async search(query: string, options: SearchOptions = {}): Promise<MemoryHit[]> {
    const limit = options.limit ?? 20;
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return [];
    const backend = options.backend ?? "auto";
    if (backend !== "scan") {
      try {
        const hits = await this.ftsIndex().search(normalizedQuery, { limit });
        if (backend === "sqlite_fts5" || hits.length > 0) return hits;
      } catch {
        if (backend === "sqlite_fts5") return [];
      }
    }
    const needle = normalizedQuery.toLowerCase();
    const files = await this.walk(this.root);
    return this.searchFiles(files, needle, limit);
  }

  /**
   * Build an FTS5 index bound to this store's memory root, honoring the
   * configured `search_index` path when one was supplied to the constructor.
   */
  protected ftsIndex(): SqliteFtsMemoryIndex {
    return this.indexPath
      ? new SqliteFtsMemoryIndex(this.root, this.indexPath)
      : new SqliteFtsMemoryIndex(this.root);
  }

  protected resolveInsideRoot(relativePath: string): string {
    const resolved = resolve(this.root, relativePath);
    if (resolved !== this.root && !resolved.startsWith(`${this.root}${sep}`)) {
      throw new MemoryAccessDeniedError(`memory path escapes root: ${relativePath}`);
    }
    return resolved;
  }

  protected relativeToRoot(path: string): string {
    return toPortablePath(relative(this.root, path));
  }

  protected async searchFiles(
    files: readonly string[],
    needle: string,
    limit: number,
  ): Promise<MemoryHit[]> {
    const hits: MemoryHit[] = [];
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      let content: string;
      try {
        content = await readFile(file, "utf8");
      } catch {
        continue;
      }
      const lc = content.toLowerCase();
      let score = 0;
      let from = 0;
      while (true) {
        const idx = lc.indexOf(needle, from);
        if (idx < 0) break;
        score++;
        from = idx + needle.length;
      }
      if (score > 0) {
        const idx = lc.indexOf(needle);
        const start = Math.max(0, idx - 80);
        const end = Math.min(content.length, idx + needle.length + 80);
        hits.push({
          path: file,
          snippet: content.slice(start, end).replace(/\s+/g, " "),
          score,
          source: "scan",
        });
      }
    }
    hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return hits.slice(0, limit);
  }

  protected async walk(dir: string): Promise<string[]> {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = (await readdir(dir, { withFileTypes: true, encoding: "utf8" })) as Array<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
      }>;
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const e of entries) {
      const full = resolve(dir, e.name);
      if (e.isDirectory()) {
        if (IGNORED_MEMORY_DIRS.has(e.name)) continue;
        const sub = await this.walk(full);
        out.push(...sub);
      } else if (e.isFile()) {
        out.push(full);
      }
    }
    return out;
  }
}

export class ScopedMemoryStore extends LocalMemoryStore {
  public readonly allowed: readonly MemoryAccessRule[];

  constructor(
    memoryRoot: string,
    allowed: readonly (string | MemoryAccessRule)[],
    public readonly label = "scoped-memory",
  ) {
    super(memoryRoot);
    this.allowed = allowed.map(normalizeRule);
  }

  canAccess(relativePath: string): boolean {
    const normalized = tryNormalizeRelativePath(relativePath);
    if (normalized === null) return false;
    return this.allowed.some((rule) => this.matchesRule(normalized, rule));
  }

  override async read(relativePath: string): Promise<string> {
    this.assertAccess(relativePath);
    return super.read(relativePath);
  }

  override async list(relativeDir = ""): Promise<string[]> {
    const requested = normalizeRelativePath(relativeDir);
    if (!requested) {
      return this.listAllowedRoots();
    }
    const matchingRules = this.allowed.filter(
      (rule) => this.matchesRule(requested, rule) || this.isAncestor(requested, rule.path),
    );
    if (matchingRules.length === 0) {
      throw new MemoryAccessDeniedError(`memory path denied by ${this.label}: ${relativeDir}`);
    }
    const files = await this.filesForRules(matchingRules);
    return files.filter((file) => {
      const rel = this.relativeToRoot(file);
      return rel === requested || rel.startsWith(`${requested}/`);
    });
  }

  override async search(query: string, options: SearchOptions = {}): Promise<MemoryHit[]> {
    const limit = options.limit ?? 20;
    const needle = query.toLowerCase();
    if (!needle) return [];
    const files = await this.filesForRules(this.allowed);
    return this.searchFiles(files, needle, limit);
  }

  private assertAccess(relativePath: string): void {
    if (!this.canAccess(relativePath)) {
      throw new MemoryAccessDeniedError(`memory path denied by ${this.label}: ${relativePath}`);
    }
  }

  private matchesRule(relativePath: string, rule: MemoryAccessRule): boolean {
    if (rule.path === "") return true;
    if (rule.kind === "file") return relativePath === rule.path;
    return relativePath === rule.path || relativePath.startsWith(`${rule.path}/`);
  }

  private isAncestor(candidate: string, target: string): boolean {
    return candidate !== "" && target.startsWith(`${candidate}/`);
  }

  private async listAllowedRoots(): Promise<string[]> {
    return this.filesForRules(this.allowed);
  }

  private async filesForRules(rules: readonly MemoryAccessRule[]): Promise<string[]> {
    const seen = new Set<string>();
    const files: string[] = [];
    for (const rule of rules) {
      const resolved = this.resolveInsideRoot(rule.path);
      const found = rule.kind === "file" ? [resolved] : await this.walk(resolved);
      for (const file of found) {
        const rel = this.relativeToRoot(file);
        if (!this.allowed.some((allowedRule) => this.matchesRule(rel, allowedRule))) continue;
        if (seen.has(file)) continue;
        seen.add(file);
        files.push(file);
      }
    }
    return files;
  }
}

export interface ContextPacket {
  rootMemory: string;
  topHits: MemoryHit[];
  semanticHits: SemanticMemoryHit[];
  generatedAt: string;
}

/**
 * Assemble a bounded context packet from the memory store.
 * Loads `ROOT.md` always, then runs a keyword search to surface the most
 * relevant deeper memory. Suitable as the "executive briefing" before a run.
 */
export async function assembleContextPacket(
  store: LocalMemoryStore,
  query: string,
  options: ContextAssemblyOptions = {},
): Promise<ContextPacket> {
  const root = await store.read("ROOT.md").catch(() => "");
  const topHits = query ? await store.search(query, options) : [];
  const semanticIndex = options.semanticIndex ?? noopSemanticMemoryIndex;
  const semanticHits = query
    ? await semanticIndex.search(query, {
        limit: options.semanticLimit ?? options.limit,
        minScore: options.semanticMinScore,
      })
    : [];
  return {
    rootMemory: root,
    topHits,
    semanticHits,
    generatedAt: new Date().toISOString(),
  };
}

export async function workspaceExists(memoryRoot: string): Promise<boolean> {
  try {
    const s = await stat(memoryRoot);
    return s.isDirectory();
  } catch {
    return false;
  }
}
