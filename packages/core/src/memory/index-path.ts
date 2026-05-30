import { isAbsolute, resolve } from "node:path";
import { LocalMemoryStore, SqliteFtsMemoryIndex } from "@bureauos/memory";
import type { BureauConfig } from "../config/schema.js";
import { workspacePaths } from "../paths.js";

/**
 * Resolve the absolute path to the FTS5 `search_index` SQLite file.
 *
 * The configured `supreme_coordinator.memory.search_index` value is interpreted
 * relative to the workspace root (where `bureauos.yaml` lives), matching the
 * default `.bureauos/memory/indexes/memory.sqlite`. Absolute configured values
 * are honored as-is. This is the single source of truth so the CLI, memory
 * browser, and store search all point at the same on-disk index instead of the
 * legacy hardcoded `.index/memory-fts5.sqlite` location.
 */
export function resolveSearchIndexPath(workspaceRoot: string, config: BureauConfig): string {
  const configured = config.supreme_coordinator.memory.search_index;
  const root = workspacePaths(workspaceRoot).root;
  return isAbsolute(configured) ? configured : resolve(root, configured);
}

/**
 * Build a {@link LocalMemoryStore} whose FTS5 accelerator honors the configured
 * `search_index` path.
 */
export function memoryStoreForConfig(
  workspaceRoot: string,
  config: BureauConfig,
): LocalMemoryStore {
  const paths = workspacePaths(workspaceRoot);
  return new LocalMemoryStore(paths.memoryDir, {
    indexPath: resolveSearchIndexPath(workspaceRoot, config),
  });
}

/**
 * Build a {@link SqliteFtsMemoryIndex} bound to the workspace memory root and
 * the configured `search_index` path. Used by `bureau memory index` commands.
 */
export function memoryIndexForConfig(
  workspaceRoot: string,
  config: BureauConfig,
): SqliteFtsMemoryIndex {
  const paths = workspacePaths(workspaceRoot);
  return new SqliteFtsMemoryIndex(paths.memoryDir, resolveSearchIndexPath(workspaceRoot, config));
}
