export const VERSION = "0.0.0";

export {
  LocalMemoryStore,
  MemoryAccessDeniedError,
  ScopedMemoryStore,
  assembleContextPacket,
  workspaceExists,
} from "./store.js";
export { NoopSemanticMemoryIndex, noopSemanticMemoryIndex } from "./semantic.js";
export type {
  ContextAssemblyOptions,
  ContextPacket,
  MemoryAccessKind,
  MemoryAccessRule,
  MemoryHit,
  SearchOptions,
} from "./store.js";
export type {
  SemanticMemoryDocument,
  SemanticMemoryHit,
  SemanticMemoryIndex,
  SemanticMemorySearchOptions,
} from "./semantic.js";
