import {
  ScopedMemoryStore,
  type MemoryAccessRule,
  type MemoryHit,
  type SearchOptions,
} from "@bureauos/memory";
import type { AgentDefinition } from "../agents/roles.js";
import { workspacePaths } from "../paths.js";
import { ClientRegistry, type ClientRecord } from "../registries/client.js";
import { ProjectRegistry, type ProjectRecord } from "../registries/project.js";
import type { RunRecord } from "../runs/engine.js";

export const MEMORY_CAPABILITY = "memory";
export const MEMORY_BOUNDARY_CAPABILITY = "memory_boundary";

export interface AgentMemoryBoundary {
  actor: string;
  scope: AgentDefinition["scope"];
  label: string;
  allowed: readonly MemoryAccessRule[];
  client?: ClientRecord;
  project?: ProjectRecord;
  store: AgentMemoryCapability;
}

export interface AgentMemoryCapability {
  readonly boundary: Omit<AgentMemoryBoundary, "store">;
  canAccess(relativePath: string): boolean;
  read(relativePath: string): Promise<string>;
  list(relativeDir?: string): Promise<string[]>;
  search(query: string, options?: SearchOptions): Promise<MemoryHit[]>;
}

export interface MemoryBoundaryInput {
  agent: AgentDefinition;
  run: RunRecord;
  contextArtifactIds?: readonly string[];
}

export interface MemoryBoundaryDeps {
  clients?: ClientRegistry;
  projects?: ProjectRegistry;
}

function file(path: string, label: string): MemoryAccessRule {
  return { path, kind: "file", label };
}

function dir(path: string, label: string): MemoryAccessRule {
  return { path, kind: "directory", label };
}

function uniqueRules(rules: readonly MemoryAccessRule[]): MemoryAccessRule[] {
  const seen = new Set<string>();
  const out: MemoryAccessRule[] = [];
  for (const rule of rules) {
    const key = `${rule.kind}:${rule.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rule);
  }
  return out;
}

function scopedCapability(
  memoryRoot: string,
  boundary: Omit<AgentMemoryBoundary, "store">,
): AgentMemoryCapability {
  const store = new ScopedMemoryStore(memoryRoot, boundary.allowed, boundary.label);
  return {
    boundary,
    canAccess: (relativePath) => store.canAccess(relativePath),
    read: (relativePath) => store.read(relativePath),
    list: (relativeDir) => store.list(relativeDir),
    search: (query, options) => store.search(query, options),
  };
}

/**
 * Builds the runtime memory boundary for an agent execution.
 *
 * The Supreme Coordinator is the only default global reader. Project managers
 * get project/client memory for their assigned project. Specialist delivery
 * agents get task-bounded artifacts plus policy/run memory, so unrelated
 * project folders are not reachable through the official memory capability.
 */
export class MemoryBoundaryService {
  private readonly clients: ClientRegistry;
  private readonly projects: ProjectRegistry;

  constructor(
    private readonly workspaceRoot: string,
    deps: MemoryBoundaryDeps = {},
  ) {
    this.clients = deps.clients ?? new ClientRegistry(workspaceRoot);
    this.projects = deps.projects ?? new ProjectRegistry(workspaceRoot);
  }

  async forAgent(input: MemoryBoundaryInput): Promise<AgentMemoryBoundary> {
    const { agent, run } = input;
    const { client, project } = await this.resolveRunScope(run);
    const allowed = uniqueRules(
      agent.scope === "global"
        ? [dir("", "global executive memory")]
        : this.projectRules(agent, run, client, project, input.contextArtifactIds ?? []),
    );
    const boundary: Omit<AgentMemoryBoundary, "store"> = {
      actor: agent.id,
      scope: agent.scope,
      label: `${agent.id}:${run.id}`,
      allowed,
      ...(client ? { client } : {}),
      ...(project ? { project } : {}),
    };
    return {
      ...boundary,
      store: scopedCapability(workspacePaths(this.workspaceRoot).memoryDir, boundary),
    };
  }

  private projectRules(
    agent: AgentDefinition,
    run: RunRecord,
    client: ClientRecord | undefined,
    project: ProjectRecord | undefined,
    contextArtifactIds: readonly string[],
  ): MemoryAccessRule[] {
    const rules: MemoryAccessRule[] = [
      file("POLICIES.md", "company policy"),
      file(`runs/${run.id}.md`, "current run memory"),
      ...contextArtifactIds.map((id) => file(`artifacts/${id}.md`, "bounded context artifact")),
    ];

    if (agent.id === "project_manager") {
      rules.push(file("COMPANY.md", "company operating context"));
      if (client) rules.push(dir(`clients/${client.slug}`, "assigned client memory"));
      if (project) rules.push(dir(`projects/${project.slug}`, "assigned project memory"));
      return rules;
    }

    return rules;
  }

  private async resolveRunScope(
    run: RunRecord,
  ): Promise<{ client?: ClientRecord; project?: ProjectRecord }> {
    const [projects, clients] = await Promise.all([this.projects.list(), this.clients.list()]);
    const project = run.project_id
      ? projects.find((candidate) => candidate.id === run.project_id)
      : undefined;
    const clientId = run.client_id || project?.client_id || "";
    const client = clientId ? clients.find((candidate) => candidate.id === clientId) : undefined;
    return {
      ...(client ? { client } : {}),
      ...(project ? { project } : {}),
    };
  }
}
