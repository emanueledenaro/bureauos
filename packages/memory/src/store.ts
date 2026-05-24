import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

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

export class LocalMemoryStore {
  constructor(public readonly memoryRoot: string) {}

  async read(relativePath: string): Promise<string> {
    return readFile(join(this.memoryRoot, relativePath), "utf8");
  }

  async list(relativeDir = ""): Promise<string[]> {
    const start = relativeDir ? join(this.memoryRoot, relativeDir) : this.memoryRoot;
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
    const files = await this.walk(this.memoryRoot);
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
    hits.sort((a, b) => (b.score - a.score) || a.path.localeCompare(b.path));
    return hits.slice(0, limit);
  }

  private async walk(dir: string): Promise<string[]> {
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
      const full = join(dir, e.name);
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
