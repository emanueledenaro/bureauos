import { join } from "node:path";
import { newId, slugify } from "../ids.js";
import { workspacePaths } from "../paths.js";
import { ensureDir, fileExists, listDirs, readDoc, writeDoc, type FrontMatter } from "./base.js";

export type ClientStatus = "lead" | "active" | "paused" | "churned";

export interface ClientRecord extends FrontMatter {
  id: string;
  slug: string;
  name: string;
  status: ClientStatus;
  industry: string;
  created: string;
  updated: string;
}

export interface CreateClientInput {
  name: string;
  status?: ClientStatus;
  industry?: string;
  notes?: string;
}

const CLIENT_FILES = [
  ["CLIENT.md", "Client profile and identity."],
  ["PROJECTS.md", "Projects for this client. Reference project IDs."],
  ["REVENUE.md", "Revenue history, expected revenue, payment status."],
  ["RELATIONSHIP.md", "Relationship state, satisfaction signals, retention risk."],
  ["PERMISSIONS.md", "Public proof permissions: logo, testimonial, case study, screenshots."],
  ["COMMUNICATION.md", "Preferred channels, communication style, last contact, next follow-up."],
  ["OPPORTUNITIES.md", "Open opportunities and upsell potential."],
  ["DECISIONS.md", "Durable decisions about this client."],
  ["RISKS.md", "Risks specific to this client: payment, scope, satisfaction, legal."],
] as const;

export class ClientRegistry {
  constructor(public readonly workspaceRoot: string) {}

  private paths() {
    return workspacePaths(this.workspaceRoot);
  }

  private clientDir(slug: string): string {
    return join(this.paths().clientsDir, slug);
  }

  async create(input: CreateClientInput): Promise<ClientRecord> {
    const id = newId("client");
    const slug = slugify(input.name);
    const dir = this.clientDir(slug);
    if (await fileExists(dir)) {
      throw new Error(`client slug already exists: ${slug}`);
    }
    await ensureDir(dir);

    const now = new Date().toISOString();
    const record: ClientRecord = {
      id,
      slug,
      name: input.name,
      status: input.status ?? "lead",
      industry: input.industry ?? "unspecified",
      created: now,
      updated: now,
    };

    const body = `# ${input.name}\n\n${input.notes ?? ""}\n`;
    await writeDoc(join(dir, "CLIENT.md"), record, body);

    for (const [filename, hint] of CLIENT_FILES) {
      if (filename === "CLIENT.md") continue;
      await writeDoc(
        join(dir, filename),
        { client_id: id, slug },
        `# ${filename.replace(/\.md$/, "")}\n\n${hint}\n\n(none yet)\n`,
      );
    }
    return record;
  }

  async get(slug: string): Promise<ClientRecord | undefined> {
    const path = join(this.clientDir(slug), "CLIENT.md");
    if (!(await fileExists(path))) return undefined;
    const doc = await readDoc<ClientRecord>(path);
    return doc.front;
  }

  async list(): Promise<ClientRecord[]> {
    const dirs = await listDirs(this.paths().clientsDir);
    const out: ClientRecord[] = [];
    for (const d of dirs) {
      const path = join(d, "CLIENT.md");
      if (!(await fileExists(path))) continue;
      const doc = await readDoc<ClientRecord>(path);
      out.push(doc.front);
    }
    return out;
  }

  async update(
    slug: string,
    patch: Partial<Omit<ClientRecord, "id" | "slug" | "created">>,
  ): Promise<ClientRecord> {
    const path = join(this.clientDir(slug), "CLIENT.md");
    if (!(await fileExists(path))) {
      throw new Error(`client not found: ${slug}`);
    }
    const doc = await readDoc<ClientRecord>(path);
    const updated: ClientRecord = {
      ...doc.front,
      ...patch,
      updated: new Date().toISOString(),
    };
    await writeDoc(path, updated, doc.body);
    return updated;
  }
}
