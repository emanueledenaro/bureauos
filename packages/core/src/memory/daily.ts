import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { workspacePaths } from "../paths.js";
import { atomicWriteFile, ensureDir, fileExists, withFileLock } from "../registries/base.js";

export type DailyNoteSection = "Events" | "Runs" | "Decisions" | "Follow-ups";

function todayIso(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function emptyDailyNote(iso: string): string {
  return `# ${iso}\n\n## Events\n\n(none yet)\n\n## Runs\n\n(none yet)\n\n## Decisions\n\n(none yet)\n\n## Follow-ups\n\n(none yet)\n`;
}

function appendToSection(content: string, section: DailyNoteSection, line: string): string {
  const header = `## ${section}`;
  const headerIndex = content.indexOf(header);
  const normalizedLine = `- ${line.trim()}`;
  if (headerIndex < 0) {
    const base = content.endsWith("\n") ? content : `${content}\n`;
    return `${base}\n${header}\n\n${normalizedLine}\n`;
  }

  const sectionStart = headerIndex + header.length;
  const nextHeaderIndex = content.indexOf("\n## ", sectionStart);
  const beforeSection = content.slice(0, sectionStart);
  const sectionBody = content.slice(
    sectionStart,
    nextHeaderIndex >= 0 ? nextHeaderIndex : content.length,
  );
  const afterSection = nextHeaderIndex >= 0 ? content.slice(nextHeaderIndex) : "";
  const existingLines = sectionBody
    .split(/\r?\n/)
    .map((item) => item.trimEnd())
    .filter((item) => item.trim() !== "" && item.trim() !== "(none yet)");
  const updatedBody = ["", "", ...existingLines, normalizedLine].join("\n");
  return `${beforeSection}${updatedBody}\n${afterSection.replace(/^\n/, "")}`;
}

/**
 * Append a line to today's daily note. Creates the file with a header if it
 * doesn't exist. Daily notes live under `.bureauos/memory/memory/YYYY-MM-DD.md`.
 */
export async function appendDailyNote(
  workspaceRoot: string,
  section: DailyNoteSection,
  line: string,
  date = new Date(),
): Promise<string> {
  const iso = todayIso(date);
  const paths = workspacePaths(workspaceRoot);
  const path = join(paths.dailyDir, `${iso}.md`);
  await ensureDir(paths.dailyDir);
  // Serialize the read-modify-write so two concurrent section appends for the
  // same day cannot both read the same base and lose one another's line, and
  // write atomically (temp+rename) so a crash mid-write cannot truncate the
  // note. Mirrors the SER-163 hardening applied to RunEngine.patch.
  await withFileLock(path, async () => {
    const current = (await fileExists(path)) ? await readFile(path, "utf8") : emptyDailyNote(iso);
    await atomicWriteFile(path, appendToSection(current, section, line));
  });
  return path;
}
