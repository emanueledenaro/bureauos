import { appendFile } from "node:fs/promises";
import { workspacePaths } from "../paths.js";
import { fileExists } from "../registries/base.js";

export interface DecisionInput {
  what: string;
  why: string;
  alternativesRejected?: string[];
  evidence?: string[];
  affects?: string[];
  revisitWhen?: string;
  runId?: string;
  actor: string;
}

/**
 * Append a structured decision record to `DECISIONS.md`. Cross-links to the
 * originating run when present.
 */
export async function appendDecision(
  workspaceRoot: string,
  input: DecisionInput,
): Promise<string> {
  const path = workspacePaths(workspaceRoot).decisionsLog;
  const exists = await fileExists(path);
  if (!exists) {
    await appendFile(path, "# Decisions\n\nDurable decision records. Append-only by convention.\n\n", "utf8");
  }
  const ts = new Date().toISOString();
  const lines = [
    "",
    `## ${ts} - ${input.what}`,
    "",
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
  lines.push("");
  await appendFile(path, lines.join("\n"), "utf8");
  return path;
}
