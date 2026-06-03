import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";
import {
  GitStatusDiffInspector,
  SubprocessHostCommandExecutor,
  type WorkspaceDiffInspector,
} from "./codex-host-runner.js";
import type {
  CodexRuntimeRunner,
  CodexRuntimeRunnerInput,
  CodexRuntimeRunnerResult,
} from "./codex.js";

/**
 * Provider-LLM code generation runner.
 *
 * This is the irreplaceable core of the Autonomous Build MVP: instead of running
 * an external coding-tool CLI ({@link HostCodexRuntimeRunner}), it asks the
 * connected model provider to emit a complete, runnable implementation and
 * writes those files into the run's isolated workspace.
 *
 * It implements the SAME small {@link CodexRuntimeRunner} interface that the
 * host runner does, so the caller can wrap it in `CodexRuntimeAdapter` and the
 * whole outer safety boundary (dangerous-scope, dangerous-command, secret-path,
 * changed-file-limit) applies for free on top of whatever this runner returns.
 *
 * Safety model: the LLM response is DATA, never commands. The runner only ever
 * writes files; it never executes anything it parsed out of the model output.
 * Every output path is confined to `workspaceRoot` (no absolute paths, no `..`,
 * no secret-looking files), file count and total bytes are capped, and the
 * runner is fully deterministic given a fake `generate` closure (the only
 * non-determinism, the default git diff inspector, is injectable).
 */

/** Per-file unit parsed out of the model's envelope stream. */
export interface ProviderCodegenFile {
  path: string;
  content: string;
}

/** Minimal file-writer seam so tests can avoid touching the real filesystem. */
export interface ProviderCodegenFileWriter {
  /** Create a directory (and parents) — mirrors `fs.mkdir(..., { recursive })`. */
  mkdir(path: string): Promise<void>;
  /** Write a file's full contents — mirrors `fs.writeFile(path, content)`. */
  writeFile(path: string, content: string): Promise<void>;
}

export interface ProviderCodegenRunnerOptions {
  /** The LLM call. Injected so the runner stays pure/deterministic in tests. */
  generate: (req: { system: string; prompt: string }) => Promise<string>;
  /**
   * Maximum number of files the run may write. Defaults to 25 but callers should
   * pass `runtime.codex.max_changed_files` so the runner and the adapter agree.
   */
  maxFiles?: number;
  /**
   * Total-bytes budget across all written files. Defends against a runaway
   * response. Defaults to a generous bound tied to the provider output size.
   */
  maxOutputChars?: number;
  /** Diff inspector for git workspaces; defaults to `git status --porcelain`. */
  diff?: WorkspaceDiffInspector;
  /** File-writer seam; defaults to node `fs/promises`. */
  fileWriter?: ProviderCodegenFileWriter;
}

const DEFAULT_MAX_FILES = 25;
const DEFAULT_MAX_OUTPUT_CHARS = 200_000;

/** Paths that look like secrets/keys are never written, even after confinement. */
const SECRET_PATH_PATTERN = /secret|credential|\.pem$|id_rsa|private[-_]?key/i;
const ENV_PATH_PATTERN = /(^|\/)\.env(?:\.|$)/i;

/** An HTML entry point that makes a static site runnable (`index.html`/`.htm`). */
const HTML_ENTRY_PATTERN = /(^|\/)index\.html?$/i;
/** Browser assets that need an HTML host to be runnable (`.js`/`.mjs`/`.css`). */
const WEB_ASSET_PATTERN = /\.(?:m?js|css)$/i;

/**
 * Envelope markers. The model is instructed to emit ONLY files wrapped like:
 *
 *   <<<FILE path="relative/path.ext">>>
 *   ...verbatim content...
 *   <<<END FILE>>>
 *
 * The parser is deliberately tolerant: it ignores any prose outside envelopes
 * and, if an END marker is missing, reads content until the next FILE marker or
 * EOF. The `path="..."` attribute accepts single OR double quotes.
 */
const FILE_MARKER = /^[ \t]*<<<FILE\s+path=(?:"([^"]*)"|'([^']*)')\s*>>>[ \t]*$/;
const END_MARKER = /^[ \t]*<<<END FILE>>>[ \t]*$/;

export class ProviderCodegenRunner implements CodexRuntimeRunner {
  private readonly generate: (req: { system: string; prompt: string }) => Promise<string>;
  private readonly maxFiles: number;
  private readonly maxOutputChars: number;
  private readonly diff: WorkspaceDiffInspector;
  private readonly fileWriter: ProviderCodegenFileWriter;

  constructor(options: ProviderCodegenRunnerOptions) {
    this.generate = options.generate;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    this.diff = options.diff ?? new GitStatusDiffInspector(new SubprocessHostCommandExecutor());
    this.fileWriter = options.fileWriter ?? new NodeFsFileWriter();
  }

  async execute(input: CodexRuntimeRunnerInput): Promise<CodexRuntimeRunnerResult> {
    const workspaceRoot = resolve(input.context.workspaceRoot);
    const scope = (input.task.scope ?? "").trim();
    if (!scope) {
      return runnerError("provider codegen runner has no task scope to build from");
    }

    const system = buildSystemPrompt();
    const prompt = buildUserPrompt(input.task);

    let text: string;
    try {
      text = await this.generate({ system, prompt });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return runnerError(`provider generation failed: ${message}`);
    }

    // Extract files: the strict envelope first, then a markdown-fence fallback
    // (some models wrap code in ``` blocks despite the instructions).
    let parsed = parseFiles(text);
    if (parsed.length === 0) {
      // The model may have planned/explained instead of emitting files (a
      // coordination-framed briefing can steer it that way). Retry ONCE with a
      // forceful, code-only instruction before giving up.
      try {
        const retryText = await this.generate({
          system,
          prompt: buildRetryUserPrompt(input.task),
        });
        parsed = parseFiles(retryText);
      } catch {
        // Keep `parsed` empty; the error below reports it.
      }
    }
    if (parsed.length === 0) {
      return runnerError("provider returned no files");
    }

    // Completeness pass: a static web build is only RUNNABLE if it has an HTML
    // entry point. Some models emit only the JS/CSS (e.g. `app.js` + `styles.css`)
    // with no `index.html`, leaving nothing to open. When that happens, run ONE
    // bounded follow-up asking ONLY for the entry point, and merge any new file
    // it returns. Capped to a single extra generation (no loops); if it still
    // produces no entry point we proceed with what exists rather than fail.
    parsed = await this.ensureEntryPoint(parsed, { system });

    // Validate + confine every path BEFORE writing anything. Invalid paths are
    // skipped and recorded as a blocker note; they are never written.
    const blockers: string[] = [];
    const valid: ProviderCodegenFile[] = [];
    for (const file of parsed) {
      const safeRelative = confinePath(file.path, workspaceRoot);
      if (!safeRelative) {
        blockers.push(`rejected unsafe path: ${file.path}`);
        continue;
      }
      valid.push({ path: safeRelative, content: file.content });
    }

    if (valid.length === 0) {
      return runnerError("provider returned no writable files", blockers);
    }

    // Defense-in-depth caps (the adapter also enforces max_changed_files): refuse
    // to write anything if the file count or total byte budget is exceeded.
    if (valid.length > this.maxFiles) {
      return runnerError(
        `provider returned ${valid.length} files, exceeding the limit of ${this.maxFiles}`,
        blockers,
      );
    }
    const totalChars = valid.reduce((sum, file) => sum + file.content.length, 0);
    if (totalChars > this.maxOutputChars) {
      return runnerError(
        `provider output of ${totalChars} chars exceeds the budget of ${this.maxOutputChars}`,
        blockers,
      );
    }

    // Write the confined files. Paths are already proven to resolve inside the
    // workspace, so this cannot escape it.
    for (const file of valid) {
      const absolute = resolve(workspaceRoot, file.path);
      await this.fileWriter.mkdir(dirname(absolute));
      await this.fileWriter.writeFile(absolute, file.content);
    }

    const writtenPaths = valid.map((file) => file.path);
    const changedFiles = await this.resolveChangedFiles(workspaceRoot, writtenPaths);

    const evidenceLines = [
      `Generated ${writtenPaths.length} file${writtenPaths.length === 1 ? "" : "s"} via provider LLM: ${writtenPaths.join(", ")}`,
    ];
    if (blockers.length > 0) {
      evidenceLines.push(`Skipped ${blockers.length} unsafe path(s): ${blockers.join("; ")}`);
    }

    return {
      ok: true,
      artifacts: [],
      evidence: evidenceLines.join("\n"),
      changedFiles,
      // This runner runs NO commands; it only writes files. The empty list keeps
      // the adapter's dangerous-command boundary trivially satisfied.
      commands: [],
    };
  }

  /**
   * Bounded completeness pass that guarantees a runnable entry point.
   *
   * If the parsed files include web assets (`.js`/`.mjs`/`.css`) but NO HTML
   * entry (`index.html`/`index.htm`), the site has nothing to open. This runs
   * exactly ONE follow-up `generate` asking only for the entry point, gives the
   * model the list of already-generated paths, and merges back any file it
   * returns that is not already present (normally just `index.html`). All later
   * path confinement and caps still apply to the merged files.
   *
   * It is strictly bounded: at most one extra generation, no loops. If the
   * follow-up fails or still yields no entry point, the original files are
   * returned unchanged — the run never fails solely because an entry point is
   * missing.
   */
  private async ensureEntryPoint(
    files: readonly ProviderCodegenFile[],
    req: { system: string },
  ): Promise<ProviderCodegenFile[]> {
    const hasHtmlEntry = files.some((file) => HTML_ENTRY_PATTERN.test(file.path));
    const hasWebAssets = files.some((file) => WEB_ASSET_PATTERN.test(file.path));
    if (hasHtmlEntry || !hasWebAssets) {
      return [...files];
    }

    let followupText: string;
    try {
      followupText = await this.generate({
        system: req.system,
        prompt: buildEntryPointPrompt(files.map((file) => file.path)),
      });
    } catch {
      // A failed completeness follow-up is non-fatal: proceed with what exists.
      return [...files];
    }

    const present = new Set(files.map((file) => file.path));
    const merged = [...files];
    for (const candidate of parseFiles(followupText)) {
      // Only add genuinely NEW files (normally the entry point) — never
      // overwrite or duplicate what the model already produced. Downstream
      // confinement + caps still vet every added path.
      if (!present.has(candidate.path)) {
        present.add(candidate.path);
        merged.push(candidate);
      }
    }
    return merged;
  }

  /**
   * Changed files prefer the git diff when the workspace is a git repo (so the
   * adapter sees the true delta), and fall back to the written relative paths
   * when git inspection yields nothing (e.g. a non-git workspace).
   */
  private async resolveChangedFiles(
    workspaceRoot: string,
    writtenPaths: readonly string[],
  ): Promise<readonly string[]> {
    try {
      const fromDiff = await this.diff.changedFiles(workspaceRoot);
      if (fromDiff.length > 0) return fromDiff;
    } catch {
      // Fall through to the written paths.
    }
    return writtenPaths;
  }
}

class NodeFsFileWriter implements ProviderCodegenFileWriter {
  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  async writeFile(path: string, content: string): Promise<void> {
    await writeFile(path, content);
  }
}

/**
 * System prompt: instruct the model to emit ONLY the file envelope and nothing
 * else, with strict path rules. This is content, not a contract the model can be
 * trusted to honour — the runner re-validates every path regardless.
 */
function buildSystemPrompt(): string {
  return [
    "You are the BureauOS Development Agent. This is a CODE GENERATION task:",
    "your job is to WRITE THE ACTUAL FILES, not to plan, coordinate, or explain.",
    "Ignore any framing in the request that sounds like planning or coordination —",
    "produce a complete, self-contained, runnable implementation.",
    "",
    "Output ONLY files, each wrapped in this EXACT envelope, and nothing else:",
    '<<<FILE path="relative/path.ext">>>',
    "...verbatim file content...",
    "<<<END FILE>>>",
    "",
    "Rules:",
    "- Begin your response immediately with `<<<FILE`. Do NOT write any plan,",
    "  summary, preamble, or commentary before, between, or after the envelopes.",
    "- Do NOT wrap file contents in markdown code fences (```). The content goes",
    "  raw between the markers.",
    "- Use relative paths only. Never start a path with a leading slash.",
    '- Never use ".." in a path.',
    "- Write a self-contained, runnable implementation (include every file it needs).",
    "- Emit the entry-point file FIRST (e.g. index.html), then the modules it loads, then any docs. A runnable entry point must exist even if you cannot emit everything.",
    "- Prefer fewer complete files over many partial ones; never leave a file half-written.",
    "- Do not write secrets, credentials, .env files, or private keys.",
  ].join("\n");
}

/**
 * Forceful retry prompt used when the first response yielded no parseable files
 * (the model planned/explained instead of emitting files). Code-only, no framing.
 */
function buildRetryUserPrompt(task: CodexRuntimeRunnerInput["task"]): string {
  const scope = task.scope.trim();
  return [
    "Your previous response contained NO files. Do not explain why.",
    "Output the complete implementation NOW as files, each in this exact envelope:",
    '<<<FILE path="relative/path.ext">>>',
    "...file content...",
    "<<<END FILE>>>",
    "",
    `Build this: ${scope}`,
    "",
    "Start your reply with `<<<FILE` and output nothing else.",
  ].join("\n");
}

/**
 * Completeness follow-up prompt: the first response produced web assets but no
 * HTML entry point, so ask for ONLY a single `index.html` that loads the
 * already-generated files and makes the site runnable. The model is given the
 * exact list of existing paths so it wires them up rather than regenerating them.
 */
function buildEntryPointPrompt(existingPaths: readonly string[]): string {
  return [
    "Your previous response produced these files but NO HTML entry point, so the",
    "site cannot be opened:",
    ...existingPaths.map((path) => `- ${path}`),
    "",
    "Output ONLY a single index.html (no other files, no explanation) in this",
    "exact envelope:",
    '<<<FILE path="index.html">>>',
    "...file content...",
    "<<<END FILE>>>",
    "",
    "The index.html must make the site runnable by loading the files above —",
    'reference each .js file with <script> (use type="module" for ES modules) and',
    'each .css file with <link rel="stylesheet">. Do NOT recreate those files;',
    "only write the index.html that wires them together. Start with `<<<FILE`.",
  ].join("\n");
}

/**
 * User prompt built from the run's task: the scope is the headline build request
 * and the briefing/inputs supply project context. Mirrors how the host runner's
 * `buildCodegenPrompt` pulls scope + briefing from the task.
 */
function buildUserPrompt(task: CodexRuntimeRunnerInput["task"]): string {
  const parts = [`Task: ${task.scope.trim()}`];
  const briefing = task.inputs?.["briefing"];
  if (typeof briefing === "string" && briefing.trim()) {
    parts.push(`Context:\n${briefing.trim()}`);
  }
  parts.push("Output the full set of files needed for a working implementation.");
  return parts.join("\n\n");
}

/**
 * Tolerant envelope parser. Walks the model output line by line:
 *  - Lines outside any envelope are ignored (prose, blank lines, fences).
 *  - A FILE marker opens a new file; its content accumulates verbatim.
 *  - An END marker closes the current file.
 *  - A FILE marker while a file is open closes the previous file first (a
 *    missing END is tolerated), then opens the new one.
 *  - At EOF, any still-open file is flushed.
 *
 * Content is captured exactly as written between the markers (the trailing
 * newline before a marker line is trimmed so a round-trip is faithful).
 */
export function parseEnvelopes(text: string): ProviderCodegenFile[] {
  const files: ProviderCodegenFile[] = [];
  const lines = text.split("\n");

  let currentPath: string | undefined;
  let currentLines: string[] = [];

  const flush = (): void => {
    if (currentPath === undefined) return;
    files.push({ path: currentPath, content: currentLines.join("\n") });
    currentPath = undefined;
    currentLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    const fileMatch = FILE_MARKER.exec(line);
    if (fileMatch) {
      // A new file starts: flush any previous (tolerates a missing END marker).
      flush();
      currentPath = fileMatch[1] ?? fileMatch[2] ?? "";
      currentLines = [];
      continue;
    }
    if (currentPath !== undefined && END_MARKER.test(line)) {
      flush();
      continue;
    }
    if (currentPath !== undefined) {
      currentLines.push(line);
    }
    // Lines outside any envelope are ignored.
  }
  // Tolerate a final file whose END marker was omitted before EOF.
  flush();

  return files.filter((file) => file.path.trim() !== "");
}

/**
 * Extract files from a model response: the strict `<<<FILE>>>` envelope first,
 * then a markdown-fence fallback for models that wrap code in ``` blocks despite
 * the instructions.
 */
export function parseFiles(text: string): ProviderCodegenFile[] {
  const envelopes = parseEnvelopes(text);
  if (envelopes.length > 0) return envelopes;
  return parseMarkdownFences(text);
}

const FENCE = /```([^\n`]*)\n([\s\S]*?)```/g;
const LANG_FILENAME: Readonly<Record<string, string>> = {
  html: "index.html",
  htm: "index.html",
  js: "main.js",
  javascript: "main.js",
  jsx: "main.jsx",
  mjs: "main.mjs",
  ts: "main.ts",
  typescript: "main.ts",
  css: "styles.css",
  json: "data.json",
  md: "README.md",
  markdown: "README.md",
};

/**
 * Fallback parser: pull files out of fenced code blocks. The filename comes from
 * (1) a filename token in the fence info string (```js main.js / ```html
 * title="index.html"), else (2) a filename comment on the first content line
 * (`// main.js`, `<!-- index.html -->`, ...), else (3) the fence language
 * (html -> index.html, js -> main.js, ...). Unknown blocks are skipped so prose
 * fences never become junk files.
 */
export function parseMarkdownFences(text: string): ProviderCodegenFile[] {
  const files: ProviderCodegenFile[] = [];
  const used = new Set<string>();
  FENCE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE.exec(text)) !== null) {
    const info = (match[1] ?? "").trim();
    const content = (match[2] ?? "").replace(/\n$/, "");
    if (content.trim() === "") continue;
    const name = inferFenceFilename(info, content, used);
    if (!name) continue;
    used.add(name);
    files.push({ path: name, content });
  }
  return files;
}

function inferFenceFilename(
  info: string,
  content: string,
  used: ReadonlySet<string>,
): string | undefined {
  // 1. explicit filename token in the info string.
  const infoFile = info.match(/([\w.\-/]+\.[a-z0-9]{1,5})\b/i);
  if (infoFile?.[1] && !/^https?:/i.test(infoFile[1])) return dedupeFenceName(infoFile[1], used);
  // 2. filename hint on the block's first content line (a comment).
  const firstLine = content.split("\n", 1)[0] ?? "";
  const hint = firstLine.match(/(?:\/\/|<!--|\/\*|#)\s*([\w.\-/]+\.[a-z0-9]{1,5})\b/i);
  if (hint?.[1]) return dedupeFenceName(hint[1], used);
  // 3. infer from the fence language.
  const lang = (info.split(/\s+/)[0] ?? "").toLowerCase();
  const base = LANG_FILENAME[lang];
  return base ? dedupeFenceName(base, used) : undefined;
}

function dedupeFenceName(name: string, used: ReadonlySet<string>): string | undefined {
  const cleaned = name.trim().replace(/^\.\//, "");
  if (!cleaned) return undefined;
  if (!used.has(cleaned)) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const stem = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  for (let i = 2; i < 50; i += 1) {
    const candidate = `${stem}-${i}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Validate and confine a model-supplied path against `workspaceRoot`. Returns the
 * normalized, workspace-relative path when safe, or `undefined` when it must be
 * rejected (absolute, contains `..`, escapes the workspace, or looks like a
 * secret/key/.env file).
 */
export function confinePath(rawPath: string, workspaceRoot: string): string | undefined {
  const trimmed = rawPath.trim();
  if (!trimmed) return undefined;
  // Reject absolute paths (POSIX or Windows) before any resolution.
  if (isAbsolute(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\")) return undefined;
  // Reject any traversal component outright, on either separator.
  const withForwardSlashes = trimmed.replace(/\\/g, "/");
  if (withForwardSlashes.split("/").some((segment) => segment === "..")) return undefined;

  // Normalize and confirm the resolved path still lives inside the workspace.
  const normalizedRelative = normalize(withForwardSlashes);
  if (normalizedRelative.startsWith("..")) return undefined;
  const absolute = resolve(workspaceRoot, normalizedRelative);
  const rel = relative(workspaceRoot, absolute);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;

  // Reject secret-ish paths regardless of confinement.
  if (ENV_PATH_PATTERN.test(rel) || SECRET_PATH_PATTERN.test(rel)) return undefined;

  // Return a stable forward-slash relative path for changedFiles reporting.
  return rel.replace(/\\/g, "/");
}

function runnerError(message: string, blockers: readonly string[] = []): CodexRuntimeRunnerResult {
  const detail = blockers.length > 0 ? `${message}; ${blockers.join("; ")}` : message;
  return {
    ok: false,
    artifacts: [],
    error: detail,
    evidence: `Provider codegen runner produced no changes: ${detail}`,
    changedFiles: [],
    commands: [],
  };
}
