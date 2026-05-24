import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { workspacePaths } from "../paths.js";
import { ensureDir, fileExists } from "../registries/base.js";

function todayIso(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Append a line to today's daily note. Creates the file with a header if it
 * doesn't exist. Daily notes live under `.bureauos/memory/memory/YYYY-MM-DD.md`.
 */
export async function appendDailyNote(
  workspaceRoot: string,
  section: "Events" | "Runs" | "Decisions" | "Follow-ups",
  line: string,
  date = new Date(),
): Promise<string> {
  const iso = todayIso(date);
  const paths = workspacePaths(workspaceRoot);
  const path = join(paths.dailyDir, `${iso}.md`);
  await ensureDir(paths.dailyDir);
  if (!(await fileExists(path))) {
    const seed = `# ${iso}\n\n## Events\n\n## Runs\n\n## Decisions\n\n## Follow-ups\n`;
    await appendFile(path, seed, "utf8");
  }
  await appendFile(path, `\n- (${section}) ${line}\n`, "utf8");
  return path;
}
