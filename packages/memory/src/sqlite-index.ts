import { mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { MemoryHit } from "./store.js";

type SqliteValue = string | number | null;

interface SqliteStatement {
  all(...params: SqliteValue[]): Array<Record<string, unknown>>;
  get(...params: SqliteValue[]): Record<string, unknown> | undefined;
  run(...params: SqliteValue[]): unknown;
}

interface SqliteDatabase {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

interface SqliteModule {
  DatabaseSync: new (path: string) => SqliteDatabase;
}

interface IndexedMarkdownFile {
  absolutePath: string;
  relativePath: string;
  mtimeMs: number;
  size: number;
  updated: string;
}

export interface SqliteFtsMemorySearchOptions {
  limit?: number;
}

export interface SqliteFtsMemoryIndexStatus {
  available: boolean;
  path: string;
  document_count: number;
  stale: boolean;
  reason?: string;
}

const INDEX_SCHEMA_VERSION = 1;
const DEFAULT_INDEX_FILE = ".index/memory-fts5.sqlite";
const IGNORED_MEMORY_DIRS = new Set([".index", ".git", "node_modules"]);

let sqliteModulePromise: Promise<SqliteModule | undefined> | undefined;

function toPortablePath(path: string): string {
  return path.split(sep).join("/");
}

function rowString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function rowNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeScore(score: number): number {
  return Math.max(Math.round(Math.max(score, 0.000001) * 1000) / 1000, 0.001);
}

function tokenizeQuery(query: string): string[] {
  return query
    .split(/[^A-Za-z0-9À-ÖØ-öø-ÿ_]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function toFtsQuery(query: string): string {
  return tokenizeQuery(query)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" OR ");
}

async function loadSqliteModule(): Promise<SqliteModule | undefined> {
  sqliteModulePromise ??= (async () => {
    try {
      const specifier = "node:sqlite";
      return (await import(specifier)) as SqliteModule;
    } catch {
      return undefined;
    }
  })();
  return sqliteModulePromise;
}

async function listMarkdownFiles(root: string): Promise<IndexedMarkdownFile[]> {
  const files: IndexedMarkdownFile[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = (await readdir(dir, { withFileTypes: true, encoding: "utf8" })) as Array<{
        name: string;
        isDirectory(): boolean;
        isFile(): boolean;
      }>;
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_MEMORY_DIRS.has(entry.name)) continue;
        await walk(resolve(dir, entry.name));
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const absolutePath = resolve(dir, entry.name);
      const info = await stat(absolutePath).catch(() => undefined);
      if (!info?.isFile()) continue;
      files.push({
        absolutePath,
        relativePath: toPortablePath(relative(root, absolutePath)),
        mtimeMs: Math.trunc(info.mtimeMs),
        size: info.size,
        updated: info.mtime.toISOString(),
      });
    }
  }
  await walk(root);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return files;
}

function closeDatabase(db: SqliteDatabase): void {
  try {
    db.close();
  } catch {
    // Closing is best-effort because a failed/corrupt index must not break memory search.
  }
}

export class SqliteFtsMemoryIndex {
  private readonly root: string;
  public readonly path: string;

  constructor(memoryRoot: string, indexPath = join(memoryRoot, DEFAULT_INDEX_FILE)) {
    this.root = resolve(memoryRoot);
    this.path = resolve(indexPath);
  }

  async status(): Promise<SqliteFtsMemoryIndexStatus> {
    const sqlite = await loadSqliteModule();
    if (!sqlite) {
      return {
        available: false,
        path: this.path,
        document_count: 0,
        stale: true,
        reason: "node:sqlite is unavailable",
      };
    }
    const files = await listMarkdownFiles(this.root);
    try {
      const db = new sqlite.DatabaseSync(this.path);
      try {
        const stale = await this.isStale(db, files);
        const row = db.prepare("SELECT COUNT(*) AS count FROM memory_files").get();
        return {
          available: true,
          path: this.path,
          document_count: row ? rowNumber(row, "count") : 0,
          stale,
        };
      } finally {
        closeDatabase(db);
      }
    } catch (error) {
      return {
        available: true,
        path: this.path,
        document_count: 0,
        stale: true,
        reason: error instanceof Error ? error.message : "index unavailable",
      };
    }
  }

  async rebuild(): Promise<SqliteFtsMemoryIndexStatus> {
    const sqlite = await loadSqliteModule();
    if (!sqlite) {
      return {
        available: false,
        path: this.path,
        document_count: 0,
        stale: true,
        reason: "node:sqlite is unavailable",
      };
    }
    const files = await listMarkdownFiles(this.root);
    await this.writeFreshDatabase(sqlite, files);
    return {
      available: true,
      path: this.path,
      document_count: files.length,
      stale: false,
    };
  }

  async search(query: string, options: SqliteFtsMemorySearchOptions = {}): Promise<MemoryHit[]> {
    const sqlite = await loadSqliteModule();
    const ftsQuery = toFtsQuery(query);
    if (!sqlite || !ftsQuery) return [];
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 200);
    const files = await listMarkdownFiles(this.root);
    const db = await this.openFreshDatabase(sqlite, files);
    try {
      const rows = db
        .prepare(
          `SELECT
             f.absolute_path AS absolute_path,
             f.path AS relative_path,
             f.updated AS updated,
             snippet(memory_fts, 1, '', '', '...', 24) AS snippet,
             -bm25(memory_fts) AS score
           FROM memory_fts
           JOIN memory_files f ON f.path = memory_fts.path
           WHERE memory_fts MATCH ?
           ORDER BY bm25(memory_fts), f.path
           LIMIT ?`,
        )
        .all(ftsQuery, limit);
      return rows.map((row) => ({
        path: rowString(row, "absolute_path"),
        relativePath: rowString(row, "relative_path"),
        snippet: rowString(row, "snippet").replace(/\s+/g, " "),
        score: normalizeScore(rowNumber(row, "score")),
        updated: rowString(row, "updated"),
        source: "sqlite_fts5",
      }));
    } finally {
      closeDatabase(db);
    }
  }

  private async openFreshDatabase(
    sqlite: SqliteModule,
    files: readonly IndexedMarkdownFile[],
  ): Promise<SqliteDatabase> {
    try {
      const db = new sqlite.DatabaseSync(this.path);
      if (!(await this.isStale(db, files))) return db;
      closeDatabase(db);
    } catch {
      // Corrupt or absent indexes are rebuilt atomically below.
    }
    await this.writeFreshDatabase(sqlite, files);
    return new sqlite.DatabaseSync(this.path);
  }

  private async isStale(
    db: SqliteDatabase,
    files: readonly IndexedMarkdownFile[],
  ): Promise<boolean> {
    try {
      const schema = db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get();
      if (rowString(schema ?? {}, "value") !== String(INDEX_SCHEMA_VERSION)) return true;
      const rows = db.prepare("SELECT path, mtime_ms, size FROM memory_files ORDER BY path").all();
      if (rows.length !== files.length) return true;
      for (let index = 0; index < files.length; index += 1) {
        const row = rows[index];
        const file = files[index];
        if (!row || !file) return true;
        if (rowString(row, "path") !== file.relativePath) return true;
        if (rowNumber(row, "mtime_ms") !== file.mtimeMs) return true;
        if (rowNumber(row, "size") !== file.size) return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  private async writeFreshDatabase(
    sqlite: SqliteModule,
    files: readonly IndexedMarkdownFile[],
  ): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await rm(tempPath, { force: true }).catch(() => undefined);
    const db = new sqlite.DatabaseSync(tempPath);
    try {
      db.exec(`
        CREATE TABLE metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE memory_files (
          path TEXT PRIMARY KEY,
          absolute_path TEXT NOT NULL,
          mtime_ms INTEGER NOT NULL,
          size INTEGER NOT NULL,
          updated TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE memory_fts USING fts5(path UNINDEXED, body, tokenize = 'unicode61');
      `);
      db.prepare("INSERT INTO metadata(key, value) VALUES ('schema_version', ?)").run(
        String(INDEX_SCHEMA_VERSION),
      );
      const insertFile = db.prepare(
        `INSERT INTO memory_files(path, absolute_path, mtime_ms, size, updated)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const insertFts = db.prepare("INSERT INTO memory_fts(path, body) VALUES (?, ?)");
      for (const file of files) {
        const body = await readFile(file.absolutePath, "utf8").catch(() => "");
        insertFile.run(file.relativePath, file.absolutePath, file.mtimeMs, file.size, file.updated);
        insertFts.run(file.relativePath, body);
      }
    } finally {
      closeDatabase(db);
    }
    await rename(tempPath, this.path);
  }
}
