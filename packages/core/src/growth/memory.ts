import { relative, sep } from "node:path";
import { AuditLog } from "../audit/log.js";
import { workspacePaths, type WorkspacePaths } from "../paths.js";
import { fileExists, readDoc, writeDoc, type FrontMatter } from "../registries/base.js";

export type GrowthMemorySectionId = "brand" | "offers" | "channels";
export type GrowthMemoryStatus = "empty" | "configured";

export interface GrowthMemorySection extends FrontMatter {
  id: GrowthMemorySectionId;
  title: string;
  path: string;
  status: GrowthMemoryStatus;
  updated: string;
  body: string;
  preview: string;
}

export interface GrowthMemorySummary {
  generated_at: string;
  ready: boolean;
  missing_sections: GrowthMemorySectionId[];
  sections: GrowthMemorySection[];
}

export interface GrowthMemoryUpdateInput {
  brand?: string;
  offers?: string;
  channels?: string;
  actor?: string;
}

export interface GrowthMemoryDeps {
  audit?: AuditLog;
}

interface SectionMeta {
  id: GrowthMemorySectionId;
  title: string;
  path(paths: WorkspacePaths): string;
}

const SECTIONS: readonly SectionMeta[] = [
  { id: "brand", title: "Brand", path: (paths) => paths.brandMemory },
  { id: "offers", title: "Offers", path: (paths) => paths.offersMemory },
  { id: "channels", title: "Channels", path: (paths) => paths.channelsMemory },
];

function cleanBody(body: string): string {
  return body
    .replace(/<!-- bureauos:[\s\S]*?-->/g, "")
    .replace(/\(none yet\)/gi, "")
    .replace(/^# .+$/gm, "")
    .trim();
}

function preview(body: string): string {
  const clean = cleanBody(body).replace(/\s+/g, " ");
  return clean.length > 180 ? `${clean.slice(0, 180)}...` : clean;
}

function sectionStatus(body: string, frontStatus?: unknown): GrowthMemoryStatus {
  if (frontStatus === "configured") return "configured";
  if (frontStatus === "empty") return "empty";
  if (/\(none yet\)/i.test(body)) return "empty";
  return cleanBody(body) ? "configured" : "empty";
}

function sectionBody(title: string, body: string): string {
  return `# ${title}\n\n${body.trim() || "(none yet)"}\n`;
}

function toPortablePath(path: string): string {
  return path.split(sep).join("/");
}

function memoryRelativePath(paths: WorkspacePaths, path: string): string {
  const rel = relative(paths.memoryDir, path);
  return rel && !rel.startsWith("..") ? toPortablePath(rel) : toPortablePath(path);
}

function updatePatch(input: GrowthMemoryUpdateInput): Array<[GrowthMemorySectionId, string]> {
  const out: Array<[GrowthMemorySectionId, string]> = [];
  if (typeof input.brand === "string") out.push(["brand", input.brand]);
  if (typeof input.offers === "string") out.push(["offers", input.offers]);
  if (typeof input.channels === "string") out.push(["channels", input.channels]);
  return out;
}

export class GrowthMemoryService {
  private readonly audit: AuditLog;

  constructor(
    private readonly workspaceRoot: string,
    deps: GrowthMemoryDeps = {},
  ) {
    this.audit = deps.audit ?? new AuditLog(workspacePaths(workspaceRoot).auditLog);
  }

  async get(): Promise<GrowthMemorySummary> {
    const paths = workspacePaths(this.workspaceRoot);
    const sections = await Promise.all(SECTIONS.map((section) => this.readSection(paths, section)));
    const missing = sections
      .filter((section) => section.status === "empty")
      .map((section) => section.id);
    return {
      generated_at: new Date().toISOString(),
      ready: missing.length === 0,
      missing_sections: missing,
      sections,
    };
  }

  async update(input: GrowthMemoryUpdateInput): Promise<GrowthMemorySummary> {
    const patch = updatePatch(input);
    if (patch.length === 0) throw new Error("growth memory update requires at least one section");
    const paths = workspacePaths(this.workspaceRoot);
    const now = new Date().toISOString();
    for (const [id, body] of patch) {
      const section = SECTIONS.find((item) => item.id === id);
      if (!section) continue;
      await writeDoc(
        section.path(paths),
        {
          id,
          status: sectionStatus(body),
          updated: now,
        },
        sectionBody(section.title, body),
      );
    }
    await this.audit.append({
      actor: input.actor ?? "supreme_coordinator",
      action: "growth.memory.updated",
      target: patch.map(([id]) => id).join(","),
      capability: "growth_memory",
      result: "ok",
    });
    return this.get();
  }

  private async readSection(
    paths: WorkspacePaths,
    section: SectionMeta,
  ): Promise<GrowthMemorySection> {
    const path = section.path(paths);
    if (!(await fileExists(path))) {
      return {
        id: section.id,
        title: section.title,
        path: memoryRelativePath(paths, path),
        status: "empty",
        updated: "",
        body: "",
        preview: "",
      };
    }
    const doc = await readDoc<GrowthMemorySection>(path);
    const body = doc.body || "";
    const status = sectionStatus(body, doc.front.status);
    const frontUpdated = typeof doc.front.updated === "string" ? doc.front.updated : "";
    return {
      ...doc.front,
      id: section.id,
      title: section.title,
      path: memoryRelativePath(paths, path),
      status,
      updated: frontUpdated,
      body,
      preview: status === "configured" ? preview(body) : "",
    };
  }
}
