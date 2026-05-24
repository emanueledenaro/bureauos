import { readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

/**
 * Minimal markdown-backed memory store.
 *
 * Phase 1.3 of the BACKLOG. SQLite FTS5 indexing arrives next; for now the
 * search is a naive scan over the workspace memory tree. This implementation
 * is correct for small workspaces and tests; we trade performance for
 * simplicity at the kernel-bootstrap stage.
 */

export interface MemoryHit {
  path: string;
  snippet: string;
  score: number;
}

export interface SearchOptions {
  limit?: number;
  includeBody?: boolean;
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

function toPortablePath(path: string): string {
  return path.split(sep).join("/");
}

function normalizeRelativePath(path: string): string {
  const portable = path.replace(/\\/g, "/").replace(/^\/+/, "");
  return portable === "." ? "" : portable.replace(/\/+$/, "");
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

  constructor(public readonly memoryRoot: string) {
    this.root = resolve(memoryRoot);
  }

  async read(relativePath: string): Promise<string> {
    return readFile(this.resolveInsideRoot(relativePath), "utf8");
  }

  async list(relativeDir = ""): Promise<string[]> {
    const start = relativeDir ? this.resolveInsideRoot(relativeDir) : this.root;
    return this.walk(start);
  }

  /**
   * Naive keyword search. Scores by number of case-insensitive matches.
   * Returns the top `limit` hits ordered by score then by path.
   */
  async search(query: string, options: SearchOptions = {}): Promise<MemoryHit[]> {
    const limit = options.limit ?? 20;
    const needle = query.toLowerCase();
    if (!needle) return [];
    const files = await this.walk(this.root);
    return this.searchFiles(files, needle, limit);
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
    const normalized = normalizeRelativePath(relativePath);
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
  options: SearchOptions = {},
): Promise<ContextPacket> {
  const root = await store.read("ROOT.md").catch(() => "");
  const topHits = query ? await store.search(query, options) : [];
  return {
    rootMemory: root,
    topHits,
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
