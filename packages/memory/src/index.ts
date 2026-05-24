export const VERSION = "0.0.0";

export {
  LocalMemoryStore,
  MemoryAccessDeniedError,
  ScopedMemoryStore,
  assembleContextPacket,
  workspaceExists,
} from "./store.js";
export type {
  ContextPacket,
  MemoryAccessKind,
  MemoryAccessRule,
  MemoryHit,
  SearchOptions,
} from "./store.js";
