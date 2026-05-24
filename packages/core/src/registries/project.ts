import { join } from "node:path";
import { newId, slugify } from "../ids.js";
import { workspacePaths } from "../paths.js";
import { ensureDir, fileExists, listDirs, readDoc, writeDoc, type FrontMatter } from "./base.js";

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

export interface CreateProjectInput {
  name: string;
  clientId: string;
  status?: ProjectStatus;
  repository?: string;
  stack?: string;
  notes?: string;
}

const PROJECT_FILES = [
  ["PROJECT.md", "Project profile, business goal, and constraints."],
  ["ARCHITECTURE.md", "Architecture overview, stack, and conventions."],
  ["BACKLOG.md", "Backlog. Reference GitHub issues when applicable."],
  ["RUNS.md", "Run history. References .bureauos/memory/runs/<id>.md."],
  ["RISKS.md", "Open project risks: delivery, scope, security, payment."],
  ["DECISIONS.md", "Durable decisions for this project."],
] as const;

export class ProjectRegistry {
  constructor(public readonly workspaceRoot: string) {}

  private paths() {
    return workspacePaths(this.workspaceRoot);
  }

  private projectDir(slug: string): string {
    return join(this.paths().projectsDir, slug);
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

  async update(
    slug: string,
    patch: Partial<Omit<ProjectRecord, "id" | "slug" | "created">>,
  ): Promise<ProjectRecord> {
    const path = join(this.projectDir(slug), "PROJECT.md");
    if (!(await fileExists(path))) {
      throw new Error(`project not found: ${slug}`);
    }
    const doc = await readDoc<ProjectRecord>(path);
    const updated: ProjectRecord = {
      ...doc.front,
      ...patch,
      updated: new Date().toISOString(),
    };
    await writeDoc(path, updated, doc.body);
    return updated;
  }
}
