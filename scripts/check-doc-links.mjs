#!/usr/bin/env node
// Internal Markdown link checker (SER-40).
//
// Scans the project's authored docs for relative Markdown links and fails if a
// link points at a file that does not exist. Internal-only by design: external
// URLs (http/https/mailto/tel), in-page anchors (#...), and template
// placeholders are skipped, so the check is deterministic and offline — no
// network flakiness. The same script backs the CI workflow and the local
// `pnpm docs:check-links` command (single source of truth).

import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Authored documentation surfaces. Generated artifacts, examples, and
// node_modules are intentionally excluded so the check covers only docs we own.
const ROOT_DOCS = ["README.md", "CONTRIBUTING.md", "SECURITY.md"];
const DOC_DIRS = ["docs"];

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function listMarkdown(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listMarkdown(full)));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function isExternal(target) {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(target) || // scheme: http:, mailto:, etc.
    target.startsWith("#") || // in-page anchor
    target.startsWith("<") || // angle-bracket autolink/placeholder
    target.startsWith("{") // template placeholder
  );
}

async function checkFile(file, broken) {
  const text = await readFile(file, "utf8");
  let match;
  while ((match = LINK_RE.exec(text))) {
    const raw = match[1].trim().split(/\s+/)[0]; // drop optional "title"
    if (!raw || isExternal(raw)) continue;
    const targetPath = raw.split("#")[0]; // strip in-file anchor
    if (!targetPath) continue;
    const resolved = resolve(dirname(file), targetPath);
    if (!(await exists(resolved))) {
      broken.push({ file: relative(ROOT, file), link: raw });
    }
  }
}

async function main() {
  const files = [
    ...ROOT_DOCS.map((name) => join(ROOT, name)),
    ...(await Promise.all(DOC_DIRS.map((dir) => listMarkdown(join(ROOT, dir))))).flat(),
  ];

  const broken = [];
  for (const file of files) {
    if (await exists(file)) await checkFile(file, broken);
  }

  if (broken.length > 0) {
    console.error(`Broken internal Markdown links (${broken.length}):`);
    for (const b of broken) console.error(`  ${b.file} -> ${b.link}`);
    process.exit(1);
  }
  console.log(`OK: no broken internal links across ${files.length} doc file(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
