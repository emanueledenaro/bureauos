import { workspacePaths } from "../paths.js";
import { fileExists, readDoc, writeDoc, type FrontMatter } from "./base.js";

export interface CompanyRecord extends FrontMatter {
  name: string;
  preset: string;
  primary_objective: string;
  founded: string;
  updated: string;
  positioning: string;
  active_offers: string[];
  active_channels: string[];
}

const DEFAULTS: CompanyRecord = {
  name: "Untitled BureauOS Workspace",
  preset: "freelancer",
  primary_objective: "sustainable_owner_profit",
  founded: new Date().toISOString(),
  updated: new Date().toISOString(),
  positioning: "",
  active_offers: [],
  active_channels: [],
};

export class CompanyRegistry {
  constructor(public readonly workspaceRoot: string) {}

  private path(): string {
    return workspacePaths(this.workspaceRoot).companyMemory;
  }

  async get(): Promise<CompanyRecord> {
    if (!(await fileExists(this.path()))) {
      return DEFAULTS;
    }
    const doc = await readDoc<CompanyRecord>(this.path());
    return { ...DEFAULTS, ...doc.front };
  }

  async update(patch: Partial<CompanyRecord>, body?: string): Promise<CompanyRecord> {
    const existing = await this.get();
    const updated: CompanyRecord = {
      ...existing,
      ...patch,
      updated: new Date().toISOString(),
    };
    const doc = (await fileExists(this.path()))
      ? await readDoc<CompanyRecord>(this.path())
      : { front: {}, body: "" };
    await writeDoc(this.path(), updated, body ?? doc.body);
    return updated;
  }
}
