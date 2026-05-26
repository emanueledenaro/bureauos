import { relative, sep } from "node:path";
import {
  LocalMemoryStore,
  assembleContextPacket,
  type ContextPacket,
  type MemoryHit,
  type SemanticMemoryHit,
  type SearchOptions,
} from "@bureauos/memory";
import { AuditLog, type AuditEvent } from "../audit/log.js";
import { workspacePaths } from "../paths.js";

export const GLOBAL_MEMORY_ACTOR = "supreme_coordinator";
export const GLOBAL_MEMORY_CAPABILITY = "global_memory_search";

export interface CoordinatorGlobalMemoryHit {
  path: string;
  snippet: string;
  score: number;
}

export interface CoordinatorGlobalMemoryPacket {
  rootMemory: string;
  topHits: CoordinatorGlobalMemoryHit[];
  semanticHits: CoordinatorGlobalMemoryHit[];
  generatedAt: string;
  audit: AuditEvent;
}

export interface CoordinatorGlobalMemoryInput extends SearchOptions {
  query: string;
  actor?: string;
  source?: string;
}

export interface CoordinatorGlobalMemoryDeps {
  audit?: AuditLog;
}

function toPortablePath(path: string): string {
  return path.split(sep).join("/");
}

function memoryRelativePath(memoryRoot: string, path: string): string {
  const relativePath = relative(memoryRoot, path);
  if (!relativePath || relativePath.startsWith("..")) return toPortablePath(path);
  return toPortablePath(relativePath);
}

function sanitizeHit(memoryRoot: string, hit: MemoryHit): CoordinatorGlobalMemoryHit {
  return {
    path: memoryRelativePath(memoryRoot, hit.path),
    snippet: hit.snippet,
    score: hit.score,
  };
}

function sanitizeSemanticHit(
  memoryRoot: string,
  hit: SemanticMemoryHit,
): CoordinatorGlobalMemoryHit {
  return {
    path: memoryRelativePath(memoryRoot, hit.path),
    snippet: hit.snippet,
    score: hit.score,
  };
}

function sanitizePacket(
  memoryRoot: string,
  packet: ContextPacket,
): Omit<CoordinatorGlobalMemoryPacket, "audit"> {
  return {
    rootMemory: packet.rootMemory,
    topHits: packet.topHits.map((hit) => sanitizeHit(memoryRoot, hit)),
    semanticHits: packet.semanticHits.map((hit) => sanitizeSemanticHit(memoryRoot, hit)),
    generatedAt: packet.generatedAt,
  };
}

/**
 * Official global-memory path for the Supreme Coordinator.
 *
 * Project teams receive scoped memory through `MemoryBoundaryService`; the
 * coordinator is the only owner-facing agent allowed to assemble company-wide
 * context through this service. Every access is audit logged.
 */
export class CoordinatorGlobalMemoryService {
  private readonly audit: AuditLog;

  constructor(
    private readonly workspaceRoot: string,
    deps: CoordinatorGlobalMemoryDeps = {},
  ) {
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
  }

  async assemble(input: CoordinatorGlobalMemoryInput): Promise<CoordinatorGlobalMemoryPacket> {
    const actor = input.actor ?? GLOBAL_MEMORY_ACTOR;
    const target = input.source || input.query.slice(0, 120) || "global-memory";
    if (actor !== GLOBAL_MEMORY_ACTOR) {
      const audit = await this.audit.append({
        actor,
        action: "memory.global.search.denied",
        target,
        capability: GLOBAL_MEMORY_CAPABILITY,
        result: "error",
        error: "global memory access is reserved for the supreme coordinator",
      });
      throw new Error(`global memory access denied for actor "${actor}" (${audit.timestamp})`);
    }

    const paths = workspacePaths(this.workspaceRoot);
    const store = new LocalMemoryStore(paths.memoryDir);
    const searchOptions: SearchOptions = {};
    if (typeof input.limit === "number") searchOptions.limit = input.limit;
    if (typeof input.includeBody === "boolean") searchOptions.includeBody = input.includeBody;
    const packet = await assembleContextPacket(store, input.query, searchOptions);
    const sanitized = sanitizePacket(paths.memoryDir, packet);
    const audit = await this.audit.append({
      actor,
      action: "memory.global.search",
      target,
      capability: GLOBAL_MEMORY_CAPABILITY,
      result: "ok",
    });
    return { ...sanitized, audit };
  }
}
