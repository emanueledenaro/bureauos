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
} from "../registries/base.js";

export type ArtifactType =
  | "project-brief"
  | "feature-spec"
  | "design-spec"
  | "bug-report"
  | "technical-plan"
  | "test-plan"
  | "security-review"
  | "pr-review"
  | "decision-record"
  | "run-report"
  | "project-dispatch-packet"
  | "agent-handoff"
  | "executive-report"
  | "cross-project-executive-report"
  | "business-operating-report"
  | "project-health-report"
  | "repository-verification-report"
  | "autonomy-retry-report"
  | "growth-review"
  | "brand-brief"
  | "offer-brief"
  | "campaign-brief"
  | "conversion-audit"
  | "lead-qualification-report"
  | "client-project-intake"
  | "pricing-brief"
  | "proposal-brief"
  | "compliance-review"
  | "social-post-brief"
  | "creative-brief"
  | "ad-campaign-brief"
  | "repository-provisioning-plan"
  | "repository-provisioning-report"
  | "capability-audit"
  | "client-account-plan"
  | "github-issue-draft"
  | "github-issue-publish-report"
  | "github-pr-publish-report"
  | "github-signal-report"
  | "operational-signal-report"
  | "client-profile"
  | "owner-attachment";

export interface ArtifactRecord extends FrontMatter {
  id: string;
  type: ArtifactType;
  created_by: string;
  run_id: string;
  client_id: string;
  project_id: string;
  status: "draft" | "submitted" | "accepted" | "rejected" | "superseded";
  created: string;
}

export interface WriteArtifactInput {
  type: ArtifactType;
  createdBy: string;
  body: string;
  runId?: string;
  clientId?: string;
  projectId?: string;
  status?: ArtifactRecord["status"];
  metadata?: FrontMatter;
}

export class ArtifactStore {
  constructor(public readonly workspaceRoot: string) {}

  private paths() {
    return workspacePaths(this.workspaceRoot);
  }

  private file(id: string): string {
    return join(this.paths().artifactsDir, `${id}.md`);
  }

  async write(input: WriteArtifactInput): Promise<ArtifactRecord> {
    const id = newId("art");
    await ensureDir(this.paths().artifactsDir);
    const record: ArtifactRecord = {
      ...(input.metadata ?? {}),
      id,
      type: input.type,
      created_by: input.createdBy,
      run_id: input.runId ?? "",
      client_id: input.clientId ?? "",
      project_id: input.projectId ?? "",
      status: input.status ?? "draft",
      created: new Date().toISOString(),
    };
    const marker = `<!-- bureauos:artifact type="${input.type}" id="${id}" created_by="${input.createdBy}" -->`;
    const body = `${marker}\n\n${input.body}`;
    await writeDoc(this.file(id), record, body);
    return record;
  }

  async read(id: string): Promise<{ record: ArtifactRecord; body: string } | undefined> {
    const path = this.file(id);
    if (!(await fileExists(path))) return undefined;
    const doc = await readDoc<ArtifactRecord>(path);
    return { record: doc.front, body: doc.body };
  }

  async list(
    filter: Partial<Pick<ArtifactRecord, "type" | "run_id" | "client_id" | "project_id">> = {},
  ): Promise<ArtifactRecord[]> {
    const files = await listDocs(this.paths().artifactsDir);
    const out: ArtifactRecord[] = [];
    for (const f of files) {
      const doc = await readDoc<ArtifactRecord>(f);
      const r = doc.front;
      if (filter.type && r.type !== filter.type) continue;
      if (filter.run_id && r.run_id !== filter.run_id) continue;
      if (filter.client_id && r.client_id !== filter.client_id) continue;
      if (filter.project_id && r.project_id !== filter.project_id) continue;
      out.push(r);
    }
    return out;
  }
}
