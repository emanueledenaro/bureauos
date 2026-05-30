import { readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export interface SemanticMemoryHit {
  path: string;
  snippet: string;
  score: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface SemanticMemoryDocument {
  path: string;
  body: string;
  title?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface SemanticMemorySearchOptions {
  limit?: number;
  minScore?: number;
  paths?: readonly string[];
}

export interface SemanticMemoryIndex {
  readonly kind: string;
  readonly enabled: boolean;
  search(query: string, options?: SemanticMemorySearchOptions): Promise<SemanticMemoryHit[]>;
  upsert?(documents: readonly SemanticMemoryDocument[]): Promise<void>;
  remove?(paths: readonly string[]): Promise<void>;
}

export class NoopSemanticMemoryIndex implements SemanticMemoryIndex {
  readonly kind = "noop";
  readonly enabled: boolean;

  constructor(options: { enabled?: boolean } = {}) {
    this.enabled = options.enabled ?? false;
  }

  async search(): Promise<SemanticMemoryHit[]> {
    return [];
  }

  async upsert(): Promise<void> {
    return;
  }

  async remove(): Promise<void> {
    return;
  }
}

export const noopSemanticMemoryIndex = new NoopSemanticMemoryIndex();

// ---------------------------------------------------------------------------
// Local, offline-by-default semantic index.
//
// This is a deterministic lexical "embedding": a TF-IDF weighted bag-of-words
// model with cosine similarity. It never calls a network or a model provider,
// so it is safe to enable in a local-first workspace. It surfaces conceptually
// related memory beyond exact substring matching (e.g. shared rare terms across
// documents) while staying fully reproducible from the markdown source of
// truth.
// ---------------------------------------------------------------------------

const IGNORED_MEMORY_DIRS = new Set([".index", ".git", "node_modules", "indexes"]);

/**
 * Lightweight English-ish stop words. Removing them keeps the TF-IDF model
 * focused on content-bearing terms so similarity reflects topic overlap rather
 * than shared filler words.
 */
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "will",
  "with",
]);

interface LexicalDocument {
  path: string;
  body: string;
  termFrequencies: Map<string, number>;
  length: number;
  mtimeMs: number;
}

function toPortablePath(path: string): string {
  return path.split(sep).join("/");
}

export function tokenizeForSemanticIndex(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9à-öø-ÿ_]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function termFrequencies(tokens: readonly string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return tf;
}

export interface LocalLexicalSemanticMemoryIndexOptions {
  enabled?: boolean;
  /** Stale-cache window in ms; the on-disk corpus is re-read when older. */
  cacheTtlMs?: number;
}

/**
 * Offline TF-IDF semantic index over the workspace markdown memory.
 *
 * The corpus is derived from the markdown files on disk (the source of truth),
 * cached in memory, and refreshed when the directory changes. Scores are cosine
 * similarities in the inclusive range `[0, 1]`, so the configured `min_score`
 * threshold composes naturally with the keyword backend.
 */
export class LocalLexicalSemanticMemoryIndex implements SemanticMemoryIndex {
  readonly kind = "local-lexical";
  readonly enabled: boolean;

  private readonly root: string;
  private readonly cacheTtlMs: number;
  private corpus: LexicalDocument[] | undefined;
  private documentFrequencies: Map<string, number> = new Map();
  private corpusLoadedAt = 0;
  private corpusSignature = "";
  private readonly overrides = new Map<string, SemanticMemoryDocument | null>();

  constructor(memoryRoot: string, options: LocalLexicalSemanticMemoryIndexOptions = {}) {
    this.root = resolve(memoryRoot);
    this.enabled = options.enabled ?? true;
    this.cacheTtlMs = options.cacheTtlMs ?? 2000;
  }

  async search(
    query: string,
    options: SemanticMemorySearchOptions = {},
  ): Promise<SemanticMemoryHit[]> {
    if (!this.enabled) return [];
    const queryTokens = tokenizeForSemanticIndex(query);
    if (queryTokens.length === 0) return [];

    const corpus = await this.loadCorpus();
    if (corpus.length === 0) return [];

    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 10), 1), 200);
    const minScore = options.minScore ?? 0;
    const pathFilter = options.paths ? new Set(options.paths) : undefined;

    const queryTf = termFrequencies(queryTokens);
    const queryVector = this.weightedVector(queryTf);
    const queryNorm = vectorNorm(queryVector);
    if (queryNorm === 0) return [];

    const hits: SemanticMemoryHit[] = [];
    for (const doc of corpus) {
      if (pathFilter && !pathFilter.has(doc.path)) continue;
      const docVector = this.weightedVector(doc.termFrequencies);
      const score = cosineSimilarity(queryVector, queryNorm, docVector);
      if (score <= 0 || score < minScore) continue;
      hits.push({
        path: doc.path,
        snippet: snippetForTokens(doc.body, queryTokens),
        score: roundScore(score),
      });
    }

    hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return hits.slice(0, limit);
  }

  /**
   * Apply in-memory document overrides. Useful for callers that index content
   * not yet flushed to disk; overrides take precedence over the on-disk corpus
   * for the matching path until {@link remove} clears them.
   */
  async upsert(documents: readonly SemanticMemoryDocument[]): Promise<void> {
    for (const doc of documents) {
      this.overrides.set(toPortablePath(doc.path), doc);
    }
    this.corpus = undefined;
  }

  async remove(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      this.overrides.set(toPortablePath(path), null);
    }
    this.corpus = undefined;
  }

  private weightedVector(termFrequenciesMap: Map<string, number>): Map<string, number> {
    const docCount = this.corpus?.length ?? 0;
    const vector = new Map<string, number>();
    for (const [term, frequency] of termFrequenciesMap) {
      const df = this.documentFrequencies.get(term) ?? 0;
      // Smoothed inverse document frequency; +1 keeps unseen query terms usable.
      const idf = Math.log((docCount + 1) / (df + 1)) + 1;
      vector.set(term, frequency * idf);
    }
    return vector;
  }

  private async loadCorpus(): Promise<LexicalDocument[]> {
    const now = Date.now();
    if (this.corpus && now - this.corpusLoadedAt < this.cacheTtlMs) {
      return this.corpus;
    }
    const files = await this.listMarkdownFiles();
    const signature = files.map((file) => `${file.relativePath}:${file.mtimeMs}`).join("|");
    if (this.corpus && signature === this.corpusSignature) {
      this.corpusLoadedAt = now;
      return this.corpus;
    }

    const documents = new Map<string, LexicalDocument>();
    for (const file of files) {
      if (this.overrides.has(file.relativePath)) continue;
      const body = await readFile(file.absolutePath, "utf8").catch(() => undefined);
      if (body === undefined) continue;
      documents.set(
        file.relativePath,
        this.toLexicalDocument(file.relativePath, body, file.mtimeMs),
      );
    }
    for (const [path, override] of this.overrides) {
      if (override === null) {
        documents.delete(path);
        continue;
      }
      documents.set(path, this.toLexicalDocument(path, override.body, now));
    }

    const corpus = Array.from(documents.values()).sort((a, b) => a.path.localeCompare(b.path));
    this.documentFrequencies = computeDocumentFrequencies(corpus);
    this.corpus = corpus;
    this.corpusLoadedAt = now;
    this.corpusSignature = signature;
    return corpus;
  }

  private toLexicalDocument(path: string, body: string, mtimeMs: number): LexicalDocument {
    const tokens = tokenizeForSemanticIndex(body);
    return {
      path,
      body,
      termFrequencies: termFrequencies(tokens),
      length: tokens.length,
      mtimeMs,
    };
  }

  private async listMarkdownFiles(): Promise<
    Array<{ absolutePath: string; relativePath: string; mtimeMs: number }>
  > {
    const files: Array<{ absolutePath: string; relativePath: string; mtimeMs: number }> = [];
    const walk = async (dir: string): Promise<void> => {
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
          relativePath: toPortablePath(relative(this.root, absolutePath)),
          mtimeMs: Math.trunc(info.mtimeMs),
        });
      }
    };
    await walk(this.root);
    files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return files;
  }
}

function computeDocumentFrequencies(corpus: readonly LexicalDocument[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of corpus) {
    for (const term of doc.termFrequencies.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  return df;
}

function vectorNorm(vector: Map<string, number>): number {
  let sum = 0;
  for (const value of vector.values()) sum += value * value;
  return Math.sqrt(sum);
}

function cosineSimilarity(
  queryVector: Map<string, number>,
  queryNorm: number,
  docVector: Map<string, number>,
): number {
  const docNorm = vectorNorm(docVector);
  if (docNorm === 0 || queryNorm === 0) return 0;
  let dot = 0;
  // Iterate the smaller vector for efficiency.
  const [small, large] =
    queryVector.size <= docVector.size ? [queryVector, docVector] : [docVector, queryVector];
  for (const [term, value] of small) {
    const other = large.get(term);
    if (other !== undefined) dot += value * other;
  }
  return dot / (queryNorm * docNorm);
}

function roundScore(score: number): number {
  return Math.round(Math.min(Math.max(score, 0), 1) * 1000) / 1000;
}

function snippetForTokens(body: string, queryTokens: readonly string[]): string {
  const lower = body.toLowerCase();
  let bestIndex = -1;
  for (const token of queryTokens) {
    const index = lower.indexOf(token);
    if (index >= 0 && (bestIndex < 0 || index < bestIndex)) bestIndex = index;
  }
  if (bestIndex < 0) {
    return body.slice(0, 160).replace(/\s+/g, " ").trim();
  }
  const start = Math.max(0, bestIndex - 80);
  const end = Math.min(body.length, bestIndex + 80);
  return body.slice(start, end).replace(/\s+/g, " ").trim();
}
