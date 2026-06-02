import { rm } from "node:fs/promises";
import { join } from "node:path";
import { AuditLog } from "../audit/log.js";
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
import { OpportunityRegistry } from "./opportunity.js";
import { ProjectRegistry } from "./project.js";

export type ClientStatus = "lead" | "active" | "paused" | "churned" | "archived";

export interface ClientRecord extends FrontMatter {
  id: string;
  slug: string;
  name: string;
  status: ClientStatus;
  industry: string;
  last_client_message_at: string;
  last_owner_response_at: string;
  next_follow_up_at: string;
  created: string;
  updated: string;
}

export interface CreateClientInput {
  name: string;
  status?: ClientStatus;
  industry?: string;
  notes?: string;
}

export interface ListClientsOptions {
  includeArchived?: boolean;
}

export interface ClientRegistryDeps {
  audit?: AuditLog;
  projects?: ProjectRegistry;
  opportunities?: OpportunityRegistry;
}

/**
 * Outcome of a `deleteClient` cascade. `deleted` distinguishes a real removal
 * from a no-op "not found" so callers (and the audit trail) can tell whether
 * anything changed. `projects` / `opportunities` list the dependent record IDs
 * that were cascade-removed alongside the client.
 */
export interface DeletedClientSummary {
  deleted: boolean;
  reason?: "not_found";
  client?: { id: string; slug: string; name: string };
  projects: string[];
  opportunities: string[];
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

/**
 * Normalize a client name/slug for tolerant equality: strip accents, lowercase,
 * and collapse every non-alphanumeric run to a single space. So "Pizzeria
 * Aurora", "pizzeria-aurora", and "PIZZERIA  AURORA." all compare equal.
 */
function normalizeClientLookup(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export class ClientRegistry {
  private readonly audit: AuditLog;
  private readonly projects: ProjectRegistry;
  private readonly opportunities: OpportunityRegistry;

  constructor(
    public readonly workspaceRoot: string,
    deps: ClientRegistryDeps = {},
  ) {
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
    this.projects = deps.projects ?? new ProjectRegistry(workspaceRoot);
    this.opportunities = deps.opportunities ?? new OpportunityRegistry(workspaceRoot);
  }

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
      last_client_message_at: "",
      last_owner_response_at: "",
      next_follow_up_at: "",
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

  async list(options: ListClientsOptions = {}): Promise<ClientRecord[]> {
    const dirs = await listDirs(this.paths().clientsDir);
    const out: ClientRecord[] = [];
    for (const d of dirs) {
      const path = join(d, "CLIENT.md");
      if (!(await fileExists(path))) continue;
      const doc = await readDoc<ClientRecord>(path);
      if (!options.includeArchived && doc.front.status === "archived") continue;
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
    // Serialize the read-modify-write so concurrent field patches to the same
    // record do not lose one another (the second writer would otherwise read a
    // stale base and overwrite the first writer's change).
    return withFileLock(path, async () => {
      const doc = await readDoc<ClientRecord>(path);
      const updated: ClientRecord = {
        ...doc.front,
        ...patch,
        updated: new Date().toISOString(),
      };
      await writeDoc(path, updated, doc.body);
      return updated;
    });
  }

  /**
   * Resolve a client by slug first, then by a normalized display-name match
   * (case/accent/punctuation-insensitive). Lets callers accept the owner's
   * phrasing ("Pizzeria Aurora") or the canonical slug ("pizzeria-aurora")
   * interchangeably. Returns `undefined` when nothing matches.
   */
  async resolve(slugOrName: string): Promise<ClientRecord | undefined> {
    const trimmed = slugOrName.trim();
    if (!trimmed) return undefined;
    const direct = await this.get(trimmed);
    if (direct) return direct;
    const bySlug = await this.get(slugify(trimmed));
    if (bySlug) return bySlug;
    const target = normalizeClientLookup(trimmed);
    if (!target) return undefined;
    const all = await this.list({ includeArchived: true });
    return all.find((client) => normalizeClientLookup(client.name) === target);
  }

  /**
   * Permanently delete a client and cascade-delete only the projects and
   * opportunities that belong to it (matched on the client's stable `id`, never
   * its slug, so renamed records still cascade and unrelated records are never
   * touched). Removing the `clients/<slug>/` directory also removes it from the
   * client index, since `list()` derives the registry from those directories
   * and ROOT consolidation re-derives the always-loaded index from `list()`.
   *
   * Idempotent-ish: deleting a missing client returns `{ deleted: false,
   * reason: "not_found" }` instead of throwing, and a `client.deleted` audit
   * event is written only when a client was actually removed (listing the
   * cascaded project/opportunity IDs).
   *
   * This is a destructive operation. The executive `delete_client` tool gates
   * it behind explicit owner confirmation; this method performs the removal
   * once that gate has passed.
   */
  async deleteClient(slug: string): Promise<DeletedClientSummary> {
    const path = join(this.clientDir(slug), "CLIENT.md");
    if (!(await fileExists(path))) {
      return { deleted: false, reason: "not_found", projects: [], opportunities: [] };
    }

    return withFileLock(path, async () => {
      if (!(await fileExists(path))) {
        return { deleted: false, reason: "not_found", projects: [], opportunities: [] };
      }
      const doc = await readDoc<ClientRecord>(path);
      const client = doc.front;

      // Cascade only this client's own dependents, keyed on the stable id.
      const dependentProjects = await this.projects.listForClient(client.id);
      const deletedProjects: string[] = [];
      for (const project of dependentProjects) {
        if (await this.projects.delete(project.slug)) deletedProjects.push(project.id);
      }

      const dependentOpportunities = await this.opportunities.listForClient(client.id);
      const deletedOpportunities: string[] = [];
      for (const opportunity of dependentOpportunities) {
        if (await this.opportunities.delete(opportunity.id)) {
          deletedOpportunities.push(opportunity.id);
        }
      }

      // Remove the client directory last, so a crash mid-cascade leaves the
      // client discoverable for a retry rather than orphaning its dependents.
      await rm(this.clientDir(slug), { recursive: true, force: true });

      await this.audit.append({
        actor: "supreme_coordinator",
        action: "client.deleted",
        target: client.id,
        result: "ok",
      });

      return {
        deleted: true,
        client: { id: client.id, slug: client.slug, name: client.name },
        projects: deletedProjects,
        opportunities: deletedOpportunities,
      };
    });
  }
}
