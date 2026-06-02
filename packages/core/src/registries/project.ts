import { rm } from "node:fs/promises";
import { join } from "node:path";
import { newId, slugify } from "../ids.js";
import { workspacePaths } from "../paths.js";
import {
  ensureDir,
  fileExists,
  listDirs,
  readDoc,
  withFileLock,
  writeDoc,
  type FrontMatter,
} from "./base.js";

export type ProjectStatus =
  | "intake"
  | "proposal"
  | "approved"
  | "in_progress"
  | "blocked"
  | "delivered"
  | "cancelled";

export interface ProjectRecord extends FrontMatter {
  id: string;
  slug: string;
  name: string;
  client_id: string;
  status: ProjectStatus;
  repository: string;
  stack: string;
  created: string;
  updated: string;
}

export type ProjectOwnershipStatus = "active" | "paused" | "unassigned";

export interface ProjectOwnershipRecord extends FrontMatter {
  id: string;
  project_id: string;
  project_slug: string;
  client_id: string;
  manager_agent_id: string;
  manager_role: string;
  team_id: string;
  status: ProjectOwnershipStatus;
  assigned_agents: string[];
  escalation_agent_id: string;
  created: string;
  updated: string;
}

export interface CreateProjectInput {
  name: string;
  clientId: string;
  status?: ProjectStatus;
  repository?: string;
  stack?: string;
  notes?: string;
  managerAgentId?: string;
  assignedAgents?: string[];
  teamId?: string;
}

export interface ProjectOwnershipInput {
  managerAgentId?: string;
  managerRole?: string;
  teamId?: string;
  status?: ProjectOwnershipStatus;
  assignedAgents?: string[];
  escalationAgentId?: string;
}

const PROJECT_FILES = [
  ["PROJECT.md", "Project profile, business goal, and constraints."],
  ["ARCHITECTURE.md", "Architecture overview, stack, and conventions."],
  ["BACKLOG.md", "Backlog. Reference GitHub issues when applicable."],
  ["RUNS.md", "Run history. References .bureauos/memory/runs/<id>.md."],
  ["RISKS.md", "Open project risks: delivery, scope, security, payment."],
  ["DECISIONS.md", "Durable decisions for this project."],
] as const;

const DEFAULT_PROJECT_TEAM = [
  "project_manager",
  "product",
  "ux",
  "development",
  "qa",
  "security",
  "reviewer",
] as const;

function uniqueAgents(agents: readonly string[]): string[] {
  return [...new Set(agents.map((agent) => agent.trim()).filter(Boolean))];
}

function ownershipBody(record: ProjectOwnershipRecord): string {
  return `# Project Ownership

This file defines the project manager and isolated project team for this project.

## Manager

- Agent: ${record.manager_agent_id}
- Role: ${record.manager_role}
- Status: ${record.status}
- Escalation: ${record.escalation_agent_id}

## Assigned Team

${record.assigned_agents.map((agent) => `- ${agent}`).join("\n")}

## Operating Contract

- The Project Manager owns project memory, backlog coordination, specialist handoffs, and status reporting.
- The Project Manager reports to the Supreme Coordinator.
- Specialist agents use project-scoped memory and escalate cross-project context requests.
`;
}

export class ProjectRegistry {
  constructor(public readonly workspaceRoot: string) {}

  private paths() {
    return workspacePaths(this.workspaceRoot);
  }

  private projectDir(slug: string): string {
    return join(this.paths().projectsDir, slug);
  }

  private ownershipPath(slug: string): string {
    return join(this.projectDir(slug), "OWNERSHIP.md");
  }

  private ownershipRecord(
    project: ProjectRecord,
    input: ProjectOwnershipInput = {},
    existing?: ProjectOwnershipRecord,
  ): ProjectOwnershipRecord {
    const now = new Date().toISOString();
    const managerAgentId = input.managerAgentId ?? existing?.manager_agent_id ?? "project_manager";
    const assignedAgents = uniqueAgents([
      managerAgentId,
      ...(input.assignedAgents ?? existing?.assigned_agents ?? DEFAULT_PROJECT_TEAM),
    ]);
    return {
      id: existing?.id ?? newId("ownership"),
      project_id: project.id,
      project_slug: project.slug,
      client_id: project.client_id,
      manager_agent_id: managerAgentId,
      manager_role: input.managerRole ?? existing?.manager_role ?? "Project Manager",
      team_id: input.teamId ?? existing?.team_id ?? `team_${project.slug}`,
      status: input.status ?? existing?.status ?? "active",
      assigned_agents: assignedAgents,
      escalation_agent_id:
        input.escalationAgentId ?? existing?.escalation_agent_id ?? "supreme_coordinator",
      created: existing?.created ?? now,
      updated: now,
    };
  }

  private async writeOwnership(
    project: ProjectRecord,
    input: ProjectOwnershipInput = {},
    existing?: ProjectOwnershipRecord,
  ): Promise<ProjectOwnershipRecord> {
    const record = this.ownershipRecord(project, input, existing);
    await writeDoc(this.ownershipPath(project.slug), record, ownershipBody(record));
    return record;
  }

  async create(input: CreateProjectInput): Promise<ProjectRecord> {
    const id = newId("project");
    const slug = slugify(input.name);
    const dir = this.projectDir(slug);
    if (await fileExists(dir)) {
      throw new Error(`project slug already exists: ${slug}`);
    }
    await ensureDir(dir);
    await ensureDir(join(dir, "memory"));

    const now = new Date().toISOString();
    const record: ProjectRecord = {
      id,
      slug,
      name: input.name,
      client_id: input.clientId,
      status: input.status ?? "intake",
      repository: input.repository ?? "",
      stack: input.stack ?? "",
      created: now,
      updated: now,
    };

    const body = `# ${input.name}\n\n${input.notes ?? ""}\n`;
    await writeDoc(join(dir, "PROJECT.md"), record, body);
    const ownershipInput: ProjectOwnershipInput = {};
    if (input.managerAgentId) ownershipInput.managerAgentId = input.managerAgentId;
    if (input.assignedAgents) ownershipInput.assignedAgents = input.assignedAgents;
    if (input.teamId) ownershipInput.teamId = input.teamId;
    await this.writeOwnership(record, ownershipInput);

    for (const [filename, hint] of PROJECT_FILES) {
      if (filename === "PROJECT.md") continue;
      await writeDoc(
        join(dir, filename),
        { project_id: id, slug },
        `# ${filename.replace(/\.md$/, "")}\n\n${hint}\n\n(none yet)\n`,
      );
    }
    return record;
  }

  async get(slug: string): Promise<ProjectRecord | undefined> {
    const path = join(this.projectDir(slug), "PROJECT.md");
    if (!(await fileExists(path))) return undefined;
    const doc = await readDoc<ProjectRecord>(path);
    return doc.front;
  }

  async list(): Promise<ProjectRecord[]> {
    const dirs = await listDirs(this.paths().projectsDir);
    const out: ProjectRecord[] = [];
    for (const d of dirs) {
      const path = join(d, "PROJECT.md");
      if (!(await fileExists(path))) continue;
      const doc = await readDoc<ProjectRecord>(path);
      out.push(doc.front);
    }
    return out;
  }

  async listForClient(clientId: string): Promise<ProjectRecord[]> {
    const all = await this.list();
    return all.filter((p) => p.client_id === clientId);
  }

  /**
   * Remove a project's `projects/<slug>/` directory (profile, ownership,
   * backlog, project memory). Returns whether the project existed: deleting a
   * missing project is a no-op (`false`), not an error, so cascade callers stay
   * idempotent.
   */
  async delete(slug: string): Promise<boolean> {
    const dir = this.projectDir(slug);
    const path = join(dir, "PROJECT.md");
    if (!(await fileExists(path))) return false;
    // Serialize against any concurrent read-modify-write on PROJECT.md so a
    // delete cannot race a status patch into recreating a half-written record.
    return withFileLock(path, async () => {
      if (!(await fileExists(path))) return false;
      await rm(dir, { recursive: true, force: true });
      return true;
    });
  }

  async getOwnership(slug: string): Promise<ProjectOwnershipRecord | undefined> {
    const project = await this.get(slug);
    if (!project) return undefined;
    const path = this.ownershipPath(slug);
    if (!(await fileExists(path))) return this.writeOwnership(project);
    const doc = await readDoc<ProjectOwnershipRecord>(path);
    return doc.front;
  }

  async listOwnership(): Promise<ProjectOwnershipRecord[]> {
    const projects = await this.list();
    const out: ProjectOwnershipRecord[] = [];
    for (const project of projects) {
      const ownership = await this.getOwnership(project.slug);
      if (ownership) out.push(ownership);
    }
    return out;
  }

  async updateOwnership(
    slug: string,
    patch: ProjectOwnershipInput,
  ): Promise<ProjectOwnershipRecord> {
    const project = await this.get(slug);
    if (!project) throw new Error(`project not found: ${slug}`);
    // Serialize the read (getOwnership) + merge + write on OWNERSHIP.md. The
    // lock is keyed on the ownership file; `writeOwnership` is intentionally not
    // locked so this does not nest a lock on the same path.
    return withFileLock(this.ownershipPath(slug), async () => {
      const existing = await this.getOwnership(slug);
      return this.writeOwnership(project, patch, existing);
    });
  }

  async update(
    slug: string,
    patch: Partial<Omit<ProjectRecord, "id" | "slug" | "created">>,
  ): Promise<ProjectRecord> {
    const path = join(this.projectDir(slug), "PROJECT.md");
    if (!(await fileExists(path))) {
      throw new Error(`project not found: ${slug}`);
    }
    // Serialize the read-modify-write so concurrent patches to the same project
    // (status vs. repository URL, driven from scheduler/GitHub paths and
    // coordinator intake) do not overwrite one another.
    return withFileLock(path, async () => {
      const doc = await readDoc<ProjectRecord>(path);
      const updated: ProjectRecord = {
        ...doc.front,
        ...patch,
        updated: new Date().toISOString(),
      };
      await writeDoc(path, updated, doc.body);
      return updated;
    });
  }
}
