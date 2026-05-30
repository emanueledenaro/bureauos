import {
  LocalLexicalSemanticMemoryIndex,
  noopSemanticMemoryIndex,
  type SemanticMemoryIndex,
} from "@bureauos/memory";
import type { BureauConfig } from "../config/schema.js";
import { workspacePaths } from "../paths.js";

export interface SemanticMemoryIndexFactoryDeps {
  /**
   * A host-injected, provider-backed index used when
   * `memory.semantic_index.provider` is `custom`. When absent, the factory
   * falls back to the safe no-op index so unconfigured workspaces stay offline.
   */
  customIndex?: SemanticMemoryIndex;
}

/**
 * Resolve the semantic memory index to use for a workspace from config.
 *
 * - Disabled or `provider: none` -> {@link noopSemanticMemoryIndex} (no work).
 * - `provider: local` -> offline deterministic TF-IDF index over the markdown
 *   memory. Local-first and never calls the network.
 * - `provider: custom` -> a host-injected provider-backed index when supplied,
 *   otherwise the no-op fallback (so an unconfigured `custom` stays safe).
 */
export function createSemanticMemoryIndex(
  workspaceRoot: string,
  config: BureauConfig,
  deps: SemanticMemoryIndexFactoryDeps = {},
): SemanticMemoryIndex {
  const settings = config.memory.semantic_index;
  if (!settings.enabled || settings.provider === "none") {
    return noopSemanticMemoryIndex;
  }
  if (settings.provider === "local") {
    const paths = workspacePaths(workspaceRoot);
    return new LocalLexicalSemanticMemoryIndex(paths.memoryDir, { enabled: true });
  }
  // provider === "custom"
  return deps.customIndex ?? noopSemanticMemoryIndex;
}
