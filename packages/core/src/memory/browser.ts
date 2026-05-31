import { stat } from "node:fs/promises";
import { basename, isAbsolute, relative, sep } from "node:path";
import type { SemanticMemoryIndex } from "@bureauos/memory";
import type { BureauConfig } from "../config/schema.js";
import { memoryStoreForConfig } from "./index-path.js";
import { createSemanticMemoryIndex } from "./semantic-index.js";
import { workspacePaths } from "../paths.js";

export type MemoryBrowserCategory = "client" | "project" | "daily" | "decision";

export interface MemoryBrowserEntry {
  path: string;
  category: MemoryBrowserCategory;
  title: string;
  preview: string;
  score?: number;
  updated?: string;
}

export interface MemoryBrowserDetail extends MemoryBrowserEntry {
  body: string;
}

export interface MemoryBrowserResult {
  generated_at: string;
  query: string;
  semantic_index: BureauConfig["memory"]["semantic_index"];
  semantic_hits: Array<{ path: string; snippet: string; score: number }>;
  categories: Array<{ id: MemoryBrowserCategory; label: string; count: number }>;
  entries: MemoryBrowserEntry[];
  selected?: MemoryBrowserDetail;
}

export interface MemoryBrowserOptions {
  query?: string;
  path?: string;
  limit?: number;
}

export interface MemoryBrowserDeps {
  semanticIndex?: SemanticMemoryIndex;
}

const CATEGORY_LABELS: Record<MemoryBrowserCategory, string> = {
  client: "Client",
  project: "Project",
  daily: "Daily",
  decision: "Decision",
};

// Reciprocal-rank-fusion damping constant (the conventional default). Larger
// values flatten the contribution of top ranks; 60 is the widely used choice.
const RRF_K = 60;

/**
 * Rank paths by descending score and return a path -> 1-based rank map. Ties
 * break by path so ordering is deterministic. Used to fuse the keyword and
 * semantic channels on a common, scale-free footing (SER-196).
 */
function ranksByScore(scores: Map<string, number>): Map<string, number> {
  const ordered = Array.from(scores.entries()).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const ranks = new Map<string, number>();
  ordered.forEach(([path], index) => ranks.set(path, index + 1));
  return ranks;
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(sk-[A-Za-z0-9_-]{8,})\b/g, "[redacted]"],
  [/\b(xox[baprs]-[A-Za-z0-9-]{8,})\b/g, "[redacted]"],
  [
    /\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|authorization)\s*[:=]\s*)([^\s"'`]+)/gi,
    "$1[redacted]",
  ],
  [/\b(Bearer\s+)([A-Za-z0-9._-]{12,})\b/gi, "$1[redacted]"],
];

function toPortablePath(path: string): string {
  return path.split(sep).join("/");
}

function memoryRelativePath(memoryRoot: string, path: string): string {
  const relativePath = relative(memoryRoot, path);
  if (!relativePath || relativePath.startsWith("..")) return toPortablePath(path);
  return toPortablePath(relativePath);
}

function normalizeSemanticPath(memoryRoot: string, path: string): string {
  const candidate = isAbsolute(path) ? memoryRelativePath(memoryRoot, path) : toPortablePath(path);
  return candidate.replace(/^\.?\//, "");
}

function stripFrontMatter(body: string): string {
  if (!body.startsWith("---")) return body;
  const end = body.indexOf("\n---", 3);
  if (end < 0) return body;
  return body.slice(end + 4).replace(/^\s+/, "");
}

function redactSecretLookingText(input: string): string {
  return SECRET_PATTERNS.reduce((text, [pattern, replacement]) => {
    return text.replace(pattern, replacement);
  }, input);
}

function inferCategory(path: string): MemoryBrowserCategory | undefined {
  if (basename(path) === "DECISIONS.md") return "decision";
  if (path.startsWith("clients/")) return "client";
  if (path.startsWith("projects/")) return "project";
  if (path.startsWith("memory/")) return "daily";
  return undefined;
}

function titleFromBody(path: string, body: string): string {
  const visibleBody = stripFrontMatter(body);
  const heading = visibleBody.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return basename(path).replace(/\.md$/i, "");
}

function previewFromBody(body: string): string {
  const visibleBody = stripFrontMatter(body)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .join(" ")
    .replace(/\s+/g, " ");
  return redactSecretLookingText(visibleBody).slice(0, 260) || "(empty)";
}

export class MemoryBrowserService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly config: BureauConfig,
    private readonly deps: MemoryBrowserDeps = {},
  ) {}

  async browse(options: MemoryBrowserOptions = {}): Promise<MemoryBrowserResult> {
    const query = options.query?.trim() ?? "";
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 80), 1), 200);
    const paths = workspacePaths(this.workspaceRoot);
    // Route keyword retrieval through the shared FTS5-backed store so the
    // browser and `LocalMemoryStore.search` agree on ranking and honor the
    // configured `search_index` path instead of a duplicate in-process scan.
    const store = memoryStoreForConfig(this.workspaceRoot, this.config);
    const entries: MemoryBrowserEntry[] = [];
    const redactedBodies = new Map<string, string>();
    const semanticIndex =
      this.deps.semanticIndex ?? createSemanticMemoryIndex(this.workspaceRoot, this.config);
    const semanticHits =
      query && this.config.memory.semantic_index.enabled && semanticIndex.enabled
        ? (
            await semanticIndex.search(query, {
              limit,
              minScore: this.config.memory.semantic_index.min_score,
            })
          ).map((hit) => ({
            path: normalizeSemanticPath(paths.memoryDir, hit.path),
            snippet: redactSecretLookingText(hit.snippet),
            score: hit.score,
          }))
        : [];
    const semanticHitsByPath = new Map(semanticHits.map((hit) => [hit.path, hit]));

    // Candidate set: for a query, the FTS5 (or scan fallback) keyword hits plus
    // any semantic hits; for browse-all, every categorized markdown file.
    const keywordScores = new Map<string, number>();
    let candidates: string[];
    if (query) {
      const hits = await store.search(query, { limit: Math.min(limit * 4, 200) });
      for (const hit of hits) {
        const relativePath = hit.relativePath ?? memoryRelativePath(paths.memoryDir, hit.path);
        keywordScores.set(relativePath, hit.score);
      }
      candidates = Array.from(new Set([...keywordScores.keys(), ...semanticHitsByPath.keys()]));
    } else {
      candidates = (await store.list())
        .filter((file) => file.endsWith(".md"))
        .map((file) => memoryRelativePath(paths.memoryDir, file));
    }

    // Keyword (FTS5 BM25) scores are unbounded and on a much larger scale than
    // semantic cosine scores (clamped to [0,1]); an additive blend let any
    // keyword match dominate so a purely-semantic ("conceptually related") hit
    // could never outrank even a marginal keyword hit. Combine the two channels
    // with reciprocal-rank fusion instead, which is scale-free: each channel
    // contributes 1/(k + rank), so a strong semantic-only hit can outrank a
    // lower-ranked keyword hit (SER-196).
    const keywordRanks = ranksByScore(keywordScores);
    const semanticRanks = ranksByScore(
      new Map(Array.from(semanticHitsByPath, ([path, hit]) => [path, hit.score])),
    );

    for (const relativePath of candidates) {
      const category = inferCategory(relativePath);
      if (!category) continue;

      let body: string;
      try {
        body = await store.read(relativePath);
      } catch {
        continue;
      }
      const redactedBody = redactSecretLookingText(stripFrontMatter(body));
      const baseEntry: MemoryBrowserEntry = {
        path: relativePath,
        category,
        title: titleFromBody(relativePath, body),
        preview: previewFromBody(body),
        updated: await stat(store.resolveRelative(relativePath))
          .then((info) => info.mtime.toISOString())
          .catch(() => undefined),
      };
      const keywordRank = keywordRanks.get(relativePath);
      const semanticRank = semanticRanks.get(relativePath);
      if (query && keywordRank === undefined && semanticRank === undefined) continue;
      const score =
        (keywordRank === undefined ? 0 : 1 / (RRF_K + keywordRank)) +
        (semanticRank === undefined ? 0 : 1 / (RRF_K + semanticRank));
      entries.push(query ? { ...baseEntry, score } : baseEntry);
      redactedBodies.set(relativePath, redactedBody);
    }

    entries.sort((a, b) => {
      const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return a.path.localeCompare(b.path);
    });
    const limited = entries.slice(0, limit);
    const selectedPath = options.path?.trim();
    const selectedEntry =
      limited.find((entry) => entry.path === selectedPath) ??
      (selectedPath ? undefined : limited[0]);
    const selected = selectedEntry
      ? {
          ...selectedEntry,
          body:
            redactedBodies.get(selectedEntry.path) ??
            redactSecretLookingText(stripFrontMatter(await store.read(selectedEntry.path))),
        }
      : undefined;

    return {
      generated_at: new Date().toISOString(),
      query,
      semantic_index: this.config.memory.semantic_index,
      semantic_hits: semanticHits,
      categories: (Object.keys(CATEGORY_LABELS) as MemoryBrowserCategory[]).map((id) => ({
        id,
        label: CATEGORY_LABELS[id],
        count: limited.filter((entry) => entry.category === id).length,
      })),
      entries: limited,
      ...(selected ? { selected } : {}),
    };
  }
}

export { redactSecretLookingText };
