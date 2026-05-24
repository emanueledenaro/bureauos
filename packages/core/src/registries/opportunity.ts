import { join } from "node:path";
import { newId } from "../ids.js";
import { workspacePaths } from "../paths.js";
import {
  ensureDir,
  fileExists,
  listDocs,
  readDoc,
  writeDoc,
  type FrontMatter,
} from "./base.js";

export type OpportunityStatus =
  | "intake"
  | "qualified"
  | "proposal_draft"
  | "proposal_sent"
  | "won"
  | "lost"
  | "stalled";

export interface OpportunityRecord extends FrontMatter {
  id: string;
  title: string;
  source: string;
  client_id: string;
  status: OpportunityStatus;
  expected_value: number;
  expected_margin: number;
  qualification_status: string;
  proposal_status: string;
  pricing_status: string;
  next_action: string;
  approval_required: string[];
  created: string;
  updated: string;
}

export interface CreateOpportunityInput {
  title: string;
  source: string;
  clientId: string;
  expectedValue?: number;
  expectedMargin?: number;
  notes?: string;
}

export class OpportunityRegistry {
  constructor(public readonly workspaceRoot: string) {}

  private paths() {
    return workspacePaths(this.workspaceRoot);
  }

  private file(id: string): string {
    return join(this.paths().opportunitiesDir, `${id}.md`);
  }

  async create(input: CreateOpportunityInput): Promise<OpportunityRecord> {
    const id = newId("opp");
    await ensureDir(this.paths().opportunitiesDir);
    const now = new Date().toISOString();
    const record: OpportunityRecord = {
      id,
      title: input.title,
      source: input.source,
      client_id: input.clientId,
      status: "intake",
      expected_value: input.expectedValue ?? 0,
      expected_margin: input.expectedMargin ?? 0,
      qualification_status: "pending",
      proposal_status: "draft_required",
      pricing_status: "pending",
      next_action: "qualify",
      approval_required: ["final_scope", "final_price", "client_send"],
      created: now,
      updated: now,
    };
    const body = `# ${input.title}\n\n${input.notes ?? ""}\n`;
    await writeDoc(this.file(id), record, body);
    return record;
  }

  async get(id: string): Promise<OpportunityRecord | undefined> {
    const path = this.file(id);
    if (!(await fileExists(path))) return undefined;
    const doc = await readDoc<OpportunityRecord>(path);
    return doc.front;
  }

  async list(): Promise<OpportunityRecord[]> {
    const files = await listDocs(this.paths().opportunitiesDir);
    const out: OpportunityRecord[] = [];
    for (const f of files) {
      const doc = await readDoc<OpportunityRecord>(f);
      out.push(doc.front);
    }
    return out;
  }

  async update(
    id: string,
    patch: Partial<Omit<OpportunityRecord, "id" | "created">>,
  ): Promise<OpportunityRecord> {
    const path = this.file(id);
    if (!(await fileExists(path))) throw new Error(`opportunity not found: ${id}`);
    const doc = await readDoc<OpportunityRecord>(path);
    const updated: OpportunityRecord = {
      ...doc.front,
      ...patch,
      updated: new Date().toISOString(),
    };
    await writeDoc(path, updated, doc.body);
    return updated;
  }
}
