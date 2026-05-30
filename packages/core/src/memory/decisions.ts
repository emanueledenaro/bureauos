import { appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { AuditLog } from "../audit/log.js";
import { workspacePaths } from "../paths.js";
import {
  ensureDir,
  fileExists,
  listDirs,
  readDoc,
  withFileLock,
  writeDoc,
} from "../registries/base.js";
import type { ClientRecord } from "../registries/client.js";
import type { ProjectRecord } from "../registries/project.js";
import type { RunRecord } from "../runs/engine.js";
import { appendDailyNote } from "./daily.js";

export interface DecisionInput {
  what: string;
  why: string;
  alternativesRejected?: string[];
  evidence?: string[];
  affects?: string[];
  revisitWhen?: string;
  runId?: string;
  clientId?: string;
  projectId?: string;
  actor: string;
  date?: Date;
  memoryScope?: {
    clientId?: string;
    projectId?: string;
  };
}

export interface DecisionWriteResult {
  id: string;
  globalPath?: string;
  clientPath?: string;
  projectPath?: string;
  runPath?: string;
  dailyPath?: string;
}

/**
 * Append a structured decision record to `DECISIONS.md`. Cross-links to the
 * originating run when present.
 */
export async function appendDecision(workspaceRoot: string, input: DecisionInput): Promise<string> {
  const result = await recordDecision(workspaceRoot, input);
  return (
    result.globalPath ??
    result.projectPath ??
    result.clientPath ??
    workspacePaths(workspaceRoot).decisionsLog
  );
}

export async function recordDecision(
  workspaceRoot: string,
  input: DecisionInput,
): Promise<DecisionWriteResult> {
  const paths = workspacePaths(workspaceRoot);
  const ts = (input.date ?? new Date()).toISOString();
  const id = decisionId(ts, input);
  const runDoc = input.runId ? await readRun(paths.runsDir, input.runId) : undefined;
  const run = runDoc?.front;
  const clientId = input.clientId ?? cleanId(run?.client_id);
  const projectId = input.projectId ?? cleanId(run?.project_id);

  validateMemoryScope(input, { clientId, projectId });

  const block = decisionBlock(id, ts, input, { clientId, projectId });
  const writes: DecisionWriteResult = { id };
  const writeGlobal = input.memoryScope === undefined;

  if (writeGlobal) {
    await appendDecisionBlock(paths.decisionsLog, "# Decisions", block);
    writes.globalPath = paths.decisionsLog;
  }

  if (clientId) {
    const clientPath = await findClientDecisionPath(workspaceRoot, clientId);
    if (clientPath) {
      await appendDecisionBlock(clientPath, "# Client Decisions", block);
      writes.clientPath = clientPath;
    }
  }

  if (projectId) {
    const projectPath = await findProjectDecisionPath(workspaceRoot, projectId);
    if (projectPath) {
      await appendDecisionBlock(projectPath, "# Project Decisions", block);
      writes.projectPath = projectPath;
    }
  }

  if (runDoc && input.runId) {
    await crossLinkRunDecision(runDoc.path, runDoc.front, runDoc.body, id, input.what);
    writes.runPath = runDoc.path;
  }

  if (writeGlobal) {
    writes.dailyPath = await appendDailyNote(
      workspaceRoot,
      "Decisions",
      `${id}: ${input.what}${input.runId ? ` (run ${input.runId})` : ""}`,
      input.date,
    );
  }

  await new AuditLog(paths.auditLog).append({
    actor: input.actor,
    action: "memory.decision_recorded",
    target: id,
    result: "ok",
  });

  return writes;
}

function decisionId(ts: string, input: DecisionInput): string {
  const hash = createHash("sha1")
    .update(`${ts}\n${input.actor}\n${input.what}\n${input.why}`)
    .digest("hex")
    .slice(0, 8);
  return `decision_${ts.replace(/\D/g, "").slice(0, 17)}_${hash}`;
}

function cleanId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function validateMemoryScope(
  input: DecisionInput,
  resolved: { clientId?: string; projectId?: string },
): void {
  if (!input.memoryScope) return;
  if (input.memoryScope.clientId && resolved.clientId !== input.memoryScope.clientId) {
    throw new Error("decision client scope denied");
  }
  if (input.memoryScope.projectId && resolved.projectId !== input.memoryScope.projectId) {
    throw new Error("decision project scope denied");
  }
}

function decisionBlock(
  id: string,
  ts: string,
  input: DecisionInput,
  resolved: { clientId?: string; projectId?: string },
): string {
  const lines = [
    "",
    `## ${ts} - ${input.what}`,
    "",
    `- Decision ID: ${id}`,
    `- Actor: ${input.actor}`,
    `- Why: ${input.why}`,
  ];
  if (input.alternativesRejected?.length) {
    lines.push(`- Rejected: ${input.alternativesRejected.join("; ")}`);
  }
  if (input.evidence?.length) {
    lines.push(`- Evidence: ${input.evidence.join("; ")}`);
  }
  if (input.affects?.length) {
    lines.push(`- Affects: ${input.affects.join(", ")}`);
  }
  if (input.revisitWhen) {
    lines.push(`- Revisit when: ${input.revisitWhen}`);
  }
  if (input.runId) {
    lines.push(`- Run: ${input.runId}`);
  }
  if (resolved.clientId) {
    lines.push(`- Client: ${resolved.clientId}`);
  }
  if (resolved.projectId) {
    lines.push(`- Project: ${resolved.projectId}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function appendDecisionBlock(path: string, heading: string, block: string): Promise<void> {
  await ensureDir(dirname(path));
  // Serialize the heading-then-block append per target file. Without this, two
  // concurrent decision writes (e.g. several runs completing in one scheduler
  // tick) could both see the file missing and both emit the heading, or
  // interleave one caller's block between another's heading and block.
  await withFileLock(path, async () => {
    if (!(await fileExists(path))) {
      await appendFile(
        path,
        `${heading}\n\nDurable decision records. Append-only by convention.\n`,
        "utf8",
      );
    }
    await appendFile(path, block, "utf8");
  });
}

async function readRun(
  runsDir: string,
  runId: string,
): Promise<{ path: string; front: RunRecord; body: string } | undefined> {
  const path = join(runsDir, `${runId}.md`);
  if (!(await fileExists(path))) return undefined;
  const doc = await readDoc<RunRecord>(path);
  return { path, front: doc.front, body: doc.body };
}

async function crossLinkRunDecision(
  path: string,
  run: RunRecord,
  body: string,
  decisionIdValue: string,
  title: string,
): Promise<void> {
  const decisions = Array.from(new Set([...(run.decisions ?? []), decisionIdValue]));
  const updated: RunRecord = {
    ...run,
    decisions,
    updated: new Date().toISOString(),
  };
  await writeDoc(path, updated, appendRunDecision(body, decisionIdValue, title));
}

function appendRunDecision(body: string, decisionIdValue: string, title: string): string {
  const line = `- ${decisionIdValue}: ${title}`;
  if (body.includes(line)) return body;
  const section = "## Decision Records";
  if (!body.includes(section)) {
    const base = body.endsWith("\n") ? body : `${body}\n`;
    return `${base}\n${section}\n\n${line}\n`;
  }
  const start = body.indexOf(section) + section.length;
  const nextHeader = body.indexOf("\n## ", start);
  if (nextHeader < 0) return `${body.trimEnd()}\n${line}\n`;
  return `${body.slice(0, nextHeader).trimEnd()}\n${line}\n${body.slice(nextHeader)}`;
}

async function findClientDecisionPath(
  workspaceRoot: string,
  clientId: string,
): Promise<string | undefined> {
  const paths = workspacePaths(workspaceRoot);
  const dirs = await listDirs(paths.clientsDir);
  for (const dir of dirs) {
    const profile = join(dir, "CLIENT.md");
    if (!(await fileExists(profile))) continue;
    const doc = await readDoc<ClientRecord>(profile);
    if (doc.front.id === clientId) return join(dir, "DECISIONS.md");
  }
  return undefined;
}

async function findProjectDecisionPath(
  workspaceRoot: string,
  projectId: string,
): Promise<string | undefined> {
  const paths = workspacePaths(workspaceRoot);
  const dirs = await listDirs(paths.projectsDir);
  for (const dir of dirs) {
    const profile = join(dir, "PROJECT.md");
    if (!(await fileExists(profile))) continue;
    const doc = await readDoc<ProjectRecord>(profile);
    if (doc.front.id === projectId) return join(dir, "DECISIONS.md");
  }
  return undefined;
}
