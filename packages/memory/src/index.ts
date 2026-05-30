export const VERSION = "0.0.0";

export {
  LocalMemoryStore,
  MemoryAccessDeniedError,
  ScopedMemoryStore,
  assembleContextPacket,
  workspaceExists,
} from "./store.js";
export {
  LocalLexicalSemanticMemoryIndex,
  NoopSemanticMemoryIndex,
  noopSemanticMemoryIndex,
  tokenizeForSemanticIndex,
} from "./semantic.js";
export type { LocalLexicalSemanticMemoryIndexOptions } from "./semantic.js";
export { SqliteFtsMemoryIndex } from "./sqlite-index.js";
export type {
  ContextAssemblyOptions,
  ContextPacket,
  MemoryAccessKind,
  MemoryAccessRule,
  MemoryHit,
  MemorySearchBackend,
  SearchOptions,
} from "./store.js";
export type { SqliteFtsMemoryIndexStatus, SqliteFtsMemorySearchOptions } from "./sqlite-index.js";
export type {
  SemanticMemoryDocument,
  SemanticMemoryHit,
  SemanticMemoryIndex,
  SemanticMemorySearchOptions,
} from "./semantic.js";
