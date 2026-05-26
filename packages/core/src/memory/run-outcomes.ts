import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditLog } from "../audit/log.js";
import { sourceWorkItemLabel } from "../work-items/source.js";
import { workspacePaths } from "../paths.js";
import { fileExists, listDirs, readDoc } from "../registries/base.js";
import type { ClientRecord } from "../registries/client.js";
import type { ProjectRecord } from "../registries/project.js";
import type { RunRecord, RunStatus } from "../runs/engine.js";

const WRITEBACK_STATUSES: ReadonlySet<RunStatus> = new Set(["completed", "blocked", "failed"]);

export interface RunOutcomeWritebackResult {
  written: string[];
}

export interface RunOutcomeWritebackDeps {
  audit: AuditLog;
}

export async function writeRunOutcomeMemory(
  workspaceRoot: string,
  run: RunRecord,
  deps: RunOutcomeWritebackDeps,
): Promise<RunOutcomeWritebackResult> {
  if (!WRITEBACK_STATUSES.has(run.status)) return { written: [] };

  const written: string[] = [];
  const summary = runOutcomeSummary(run);
  const paths = workspacePaths(workspaceRoot);

  if (run.project_id) {
    const projectDir = await findProjectDir(workspaceRoot, run.project_id);
    if (projectDir) {
      const runsPath = join(projectDir, "RUNS.md");
      await appendMemory(runsPath, `Run ${run.id} ${run.status}`, summary);
      written.push(runsPath);
      if (run.status === "blocked" || run.status === "failed") {
        const risksPath = join(projectDir, "RISKS.md");
        await appendMemory(risksPath, `Run ${run.id} ${run.status}`, riskSummary(run));
        written.push(risksPath);
      }
    }
  }

  if (run.client_id) {
    const clientDir = await findClientDir(workspaceRoot, run.client_id);
    if (clientDir) {
      const projectsPath = join(clientDir, "PROJECTS.md");
      await appendMemory(projectsPath, `Run ${run.id} ${run.status}`, summary);
      written.push(projectsPath);
      if (run.status === "blocked" || run.status === "failed") {
        const risksPath = join(clientDir, "RISKS.md");
        await appendMemory(risksPath, `Run ${run.id} ${run.status}`, riskSummary(run));
        written.push(risksPath);
      }
    }
  }

  if (written.length > 0) {
    await deps.audit.append({
      actor: run.created_by,
      action: "memory.run_outcome_written",
      target: run.id,
      result: "ok",
    });
  }

  return { written: written.map((path) => path.slice(paths.memoryDir.length + 1)) };
}

function runOutcomeSummary(run: RunRecord): string {
  return [
    `- Run: ${run.id}`,
    `- Type: ${run.type}`,
    `- Status: ${run.status}`,
    `- Scope: ${run.scope}`,
    `- Trigger: ${run.trigger_type} (${run.trigger_source})`,
    `- Source work item: ${sourceWorkItemLabel(run)}`,
    `- Dispatch: ${String(run["dispatch_status"] ?? "(none)")}`,
    `- Artifacts: ${formatList(run.artifacts)}`,
    `- Decisions: ${formatList(run.decisions)}`,
    `- Blockers: ${formatList(frontList(run["dispatch_blockers"]))}`,
    `- Error: ${String(run["dispatch_error"] ?? "(none)")}`,
    `- Approvals: ${formatList(frontList(run["approval_ids"], run["approval_id"]))}`,
    `- Pull requests: ${formatList(
      frontList(run["github_pr_url"], run["pull_request_url"], run["pr_url"]),
    )}`,
    `- Verification: ${formatList(frontList(run["test_evidence"], run["verification"]))}`,
    `- Completed: ${run.completed || "(not completed)"}`,
  ].join("\n");
}

function riskSummary(run: RunRecord): string {
  return [
    `- Run: ${run.id}`,
    `- Status: ${run.status}`,
    `- Scope: ${run.scope}`,
    `- Blockers: ${formatList(frontList(run["dispatch_blockers"]))}`,
    `- Error: ${String(run["dispatch_error"] ?? "(none)")}`,
  ].join("\n");
}

function frontList(...values: unknown[]): string[] {
  return values.flatMap((value) => {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === "string" && value.trim()) return [value.trim()];
    if (typeof value === "number" || typeof value === "boolean") return [String(value)];
    return [];
  });
}

function formatList(values: readonly string[]): string {
  return values.length ? values.join(", ") : "(none)";
}

async function appendMemory(path: string, heading: string, content: string): Promise<void> {
  await appendFile(path, `\n\n## ${heading}\n\n${content.trim()}\n`, "utf8");
}

async function findClientDir(workspaceRoot: string, clientId: string): Promise<string | undefined> {
  const paths = workspacePaths(workspaceRoot);
  const dirs = await listDirs(paths.clientsDir);
  for (const dir of dirs) {
    const profile = join(dir, "CLIENT.md");
    if (!(await fileExists(profile))) continue;
    const doc = await readDoc<ClientRecord>(profile);
    if (doc.front.id === clientId) return dir;
  }
  return undefined;
}

async function findProjectDir(
  workspaceRoot: string,
  projectId: string,
): Promise<string | undefined> {
  const paths = workspacePaths(workspaceRoot);
  const dirs = await listDirs(paths.projectsDir);
  for (const dir of dirs) {
    const profile = join(dir, "PROJECT.md");
    if (!(await fileExists(profile))) continue;
    const doc = await readDoc<ProjectRecord>(profile);
    if (doc.front.id === projectId) return dir;
  }
  return undefined;
}
