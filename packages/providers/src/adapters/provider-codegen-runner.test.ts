import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CodexRuntimeAdapter } from "./codex.js";
import type { CodexRuntimeRunnerInput } from "./codex.js";
import {
  confinePath,
  parseEnvelopes,
  parseFiles,
  parseMarkdownFences,
  ProviderCodegenRunner,
} from "./provider-codegen-runner.js";

function input(
  workspaceRoot: string,
  overrides: Partial<CodexRuntimeRunnerInput["task"]> = {},
): CodexRuntimeRunnerInput {
  return {
    context: { workspaceRoot, runId: "run_1" },
    task: { intent: "development_agent_execution", scope: "Build a small site", ...overrides },
  };
}

// A diff inspector that reports nothing, so changedFiles falls back to the
// written relative paths (deterministic, no real git needed).
const emptyDiff = {
  async changedFiles(): Promise<readonly string[]> {
    return [];
  },
};

function envelope(path: string, content: string): string {
  return `<<<FILE path="${path}">>>\n${content}\n<<<END FILE>>>`;
}

describe("ProviderCodegenRunner", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-provider-codegen-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes parsed files to the workspace and reports them as changed files", async () => {
    const text = [
      "Here is your site:",
      envelope("index.html", "<!doctype html>\n<title>Pokeball</title>"),
      "and the script:",
      envelope("src/main.js", "import * as THREE from 'three';\nconst scene = new THREE.Scene();"),
    ].join("\n\n");

    const runner = new ProviderCodegenRunner({
      generate: async () => text,
      diff: emptyDiff,
    });

    const result = await runner.execute(input(dir));

    expect(result.ok).toBe(true);
    expect(result.commands).toEqual([]);
    expect(result.changedFiles).toEqual(["index.html", "src/main.js"]);
    expect(result.evidence).toContain("Generated 2 files via provider LLM");

    const html = await readFile(join(dir, "index.html"), "utf8");
    expect(html).toContain("Pokeball");
    const js = await readFile(join(dir, "src", "main.js"), "utf8");
    expect(js).toContain("new THREE.Scene()");
  });

  it("retries once with a stricter prompt when the first response has no files", async () => {
    const calls: string[] = [];
    const runner = new ProviderCodegenRunner({
      generate: async ({ prompt }) => {
        calls.push(prompt);
        // First response: the model "plans" instead of emitting files.
        if (calls.length === 1) return "Here is my plan: 1) set up the scene. 2) add lights.";
        // Retry: it emits the actual file.
        return envelope("index.html", "<!doctype html>\n<title>Built on retry</title>");
      },
      diff: emptyDiff,
    });

    const result = await runner.execute(input(dir));

    expect(calls.length).toBe(2); // retried exactly once
    expect(result.ok).toBe(true);
    expect(result.changedFiles).toEqual(["index.html"]);
    expect(await readFile(join(dir, "index.html"), "utf8")).toContain("Built on retry");
  });

  it("falls back to markdown code fences when the model wraps files in ``` blocks", async () => {
    const text = [
      "Sure! Here is the site.",
      "```html",
      "<!doctype html>",
      '<script type="module" src="./main.js"></script>',
      "```",
      "```js",
      "import * as THREE from 'three';",
      "const scene = new THREE.Scene();",
      "```",
    ].join("\n");

    const runner = new ProviderCodegenRunner({ generate: async () => text, diff: emptyDiff });
    const result = await runner.execute(input(dir));

    expect(result.ok).toBe(true);
    expect(result.changedFiles).toEqual(["index.html", "main.js"]);
    expect(await readFile(join(dir, "index.html"), "utf8")).toContain("module");
    expect(await readFile(join(dir, "main.js"), "utf8")).toContain("new THREE.Scene()");
  });

  it("passes the task scope and briefing into the user prompt", async () => {
    let seenPrompt = "";
    let seenSystem = "";
    const runner = new ProviderCodegenRunner({
      generate: async ({ system, prompt }) => {
        seenSystem = system;
        seenPrompt = prompt;
        return envelope("app.js", "console.log('hi');");
      },
      diff: emptyDiff,
    });

    await runner.execute(
      input(dir, {
        scope: "Build a Pokeball three.js scene",
        inputs: { briefing: "Project codename: pokeball-demo" },
      }),
    );

    expect(seenPrompt).toContain("Task: Build a Pokeball three.js scene");
    expect(seenPrompt).toContain("pokeball-demo");
    // The system prompt must instruct the exact envelope format.
    expect(seenSystem).toContain('<<<FILE path="relative/path.ext">>>');
    expect(seenSystem).toContain("<<<END FILE>>>");
  });

  it("skips path-traversal and absolute paths but still writes the safe file", async () => {
    const text = [
      envelope("../escape.js", "module.exports = 'nope';"),
      envelope("/etc/passwd", "root:x:0:0"),
      envelope("safe/ok.js", "module.exports = 'yes';"),
    ].join("\n\n");

    const runner = new ProviderCodegenRunner({
      generate: async () => text,
      diff: emptyDiff,
    });

    const result = await runner.execute(input(dir));

    expect(result.ok).toBe(true);
    expect(result.changedFiles).toEqual(["safe/ok.js"]);
    expect(result.evidence).toContain("Skipped 2 unsafe path(s)");

    // The escaping files were never written.
    await expect(readFile(join(dir, "..", "escape.js"), "utf8")).rejects.toBeTruthy();
    const ok = await readFile(join(dir, "safe", "ok.js"), "utf8");
    expect(ok).toContain("yes");
  });

  it("rejects secret-looking paths like .env", async () => {
    const text = [
      envelope(".env", "OPENAI_API_KEY=sk-secret"),
      envelope("config/credentials.json", "{}"),
      envelope("server.js", "module.exports = {};"),
    ].join("\n\n");

    const runner = new ProviderCodegenRunner({
      generate: async () => text,
      diff: emptyDiff,
    });

    const result = await runner.execute(input(dir));

    expect(result.ok).toBe(true);
    expect(result.changedFiles).toEqual(["server.js"]);
    // The secret-looking files were never written.
    await expect(readFile(join(dir, ".env"), "utf8")).rejects.toBeTruthy();
    await expect(readFile(join(dir, "config", "credentials.json"), "utf8")).rejects.toBeTruthy();
  });

  it("returns ok:false and writes nothing when the file count exceeds maxFiles", async () => {
    const text = Array.from({ length: 4 }, (_, i) => envelope(`file-${i}.js`, `// ${i}`)).join(
      "\n\n",
    );
    const runner = new ProviderCodegenRunner({
      generate: async () => text,
      diff: emptyDiff,
      maxFiles: 3,
    });

    const result = await runner.execute(input(dir));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("exceeding the limit of 3");
    expect(result.changedFiles).toEqual([]);
    // Nothing was written when the cap is exceeded.
    await expect(readFile(join(dir, "file-0.js"), "utf8")).rejects.toBeTruthy();
  });

  it("returns ok:false and writes nothing when the total byte budget is exceeded", async () => {
    const big = "x".repeat(50);
    const runner = new ProviderCodegenRunner({
      generate: async () => envelope("big.js", big),
      diff: emptyDiff,
      maxOutputChars: 10,
    });

    const result = await runner.execute(input(dir));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("budget");
    await expect(readFile(join(dir, "big.js"), "utf8")).rejects.toBeTruthy();
  });

  it("returns ok:false with 'provider returned no files' when nothing parses", async () => {
    const runner = new ProviderCodegenRunner({
      generate: async () => "Sorry, I cannot help with that. No files here.",
      diff: emptyDiff,
    });

    const result = await runner.execute(input(dir));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("provider returned no files");
    expect(result.changedFiles).toEqual([]);
  });

  it("returns ok:false when the task has no scope to build from", async () => {
    const runner = new ProviderCodegenRunner({
      generate: async () => envelope("a.js", "x"),
      diff: emptyDiff,
    });

    const result = await runner.execute(input(dir, { scope: "   " }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("no task scope");
  });

  it("tolerates a missing END marker by reading to the next FILE marker / EOF", async () => {
    const text = [
      '<<<FILE path="a.js">>>',
      "const a = 1;",
      // no END marker before the next file:
      '<<<FILE path="b.js">>>',
      "const b = 2;",
      // and no trailing END marker at EOF either.
    ].join("\n");

    const runner = new ProviderCodegenRunner({
      generate: async () => text,
      diff: emptyDiff,
    });

    const result = await runner.execute(input(dir));

    expect(result.ok).toBe(true);
    expect(result.changedFiles).toEqual(["a.js", "b.js"]);
    expect(await readFile(join(dir, "a.js"), "utf8")).toBe("const a = 1;");
    expect(await readFile(join(dir, "b.js"), "utf8")).toBe("const b = 2;");
  });

  it("prefers the git diff for changedFiles when the workspace is a git repo", async () => {
    const runner = new ProviderCodegenRunner({
      generate: async () => envelope("written.js", "// content"),
      diff: {
        async changedFiles(): Promise<readonly string[]> {
          return ["written.js", "package.json"];
        },
      },
    });

    const result = await runner.execute(input(dir));

    expect(result.ok).toBe(true);
    // The diff (not just the written path) drives changedFiles.
    expect(result.changedFiles).toEqual(["written.js", "package.json"]);
  });

  it("passes a clean small change through the CodexRuntimeAdapter safety boundary", async () => {
    const runner = new ProviderCodegenRunner({
      generate: async () => envelope("index.html", "<title>ok</title>"),
      diff: emptyDiff,
    });
    const adapter = new CodexRuntimeAdapter("codex-provider", { runner, maxChangedFiles: 5 });
    await adapter.prepare({ workspaceRoot: dir, runId: "run_1" });

    const result = await adapter.execute({
      capability: "edit_code",
      intent: "implement scoped change",
      scope: "Build a tiny page",
    });

    expect(result.ok).toBe(true);
    expect(result.changedFiles).toEqual(["index.html"]);
    expect(result.commands).toEqual([]);
  });

  it("is blocked by the adapter's changed-file limit as defense-in-depth", async () => {
    // The runner writes 4 files; the adapter limit of 2 must block at the boundary.
    const text = Array.from({ length: 4 }, (_, i) => envelope(`f-${i}.js`, `// ${i}`)).join("\n\n");
    const runner = new ProviderCodegenRunner({
      generate: async () => text,
      diff: emptyDiff,
      // Keep the runner's own cap high so the adapter is the one that blocks.
      maxFiles: 10,
    });
    const adapter = new CodexRuntimeAdapter("codex-provider", { runner, maxChangedFiles: 2 });
    await adapter.prepare({ workspaceRoot: dir, runId: "run_1" });

    const result = await adapter.execute({
      capability: "edit_code",
      intent: "implement change",
      scope: "Add several files",
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.blockers?.join(" ")).toContain("changed file count exceeds runtime limit");
  });
});

describe("parseEnvelopes", () => {
  it("ignores prose outside envelopes and handles single or double quotes", () => {
    const text = [
      "Some intro prose to ignore.",
      "<<<FILE path='single.js'>>>",
      "const s = 1;",
      "<<<END FILE>>>",
      "trailing prose",
      '<<<FILE path="double.js">>>',
      "const d = 2;",
      "<<<END FILE>>>",
    ].join("\n");

    expect(parseEnvelopes(text)).toEqual([
      { path: "single.js", content: "const s = 1;" },
      { path: "double.js", content: "const d = 2;" },
    ]);
  });

  it("preserves multi-line content verbatim", () => {
    const text = ['<<<FILE path="a.txt">>>', "line 1", "", "line 3", "<<<END FILE>>>"].join("\n");
    expect(parseEnvelopes(text)).toEqual([{ path: "a.txt", content: "line 1\n\nline 3" }]);
  });
});

describe("confinePath", () => {
  const root = "/workspace";

  it("accepts a normalized relative path", () => {
    expect(confinePath("src/app.js", root)).toBe("src/app.js");
    expect(confinePath("./src/app.js", root)).toBe("src/app.js");
  });

  it("rejects absolute paths", () => {
    expect(confinePath("/etc/passwd", root)).toBeUndefined();
  });

  it("rejects traversal", () => {
    expect(confinePath("../escape.js", root)).toBeUndefined();
    expect(confinePath("a/../../escape.js", root)).toBeUndefined();
  });

  it("rejects secret-looking paths", () => {
    expect(confinePath(".env", root)).toBeUndefined();
    expect(confinePath("config/.env.local", root)).toBeUndefined();
    expect(confinePath("keys/id_rsa", root)).toBeUndefined();
    expect(confinePath("certs/server.pem", root)).toBeUndefined();
    expect(confinePath("secrets/token.txt", root)).toBeUndefined();
  });
});

describe("parseMarkdownFences", () => {
  it("infers filenames from the fence language", () => {
    const text = "```html\n<x/>\n```\n```js\ncode\n```\n```css\n.a{}\n```\n```md\n# hi\n```";
    expect(parseMarkdownFences(text)).toEqual([
      { path: "index.html", content: "<x/>" },
      { path: "main.js", content: "code" },
      { path: "styles.css", content: ".a{}" },
      { path: "README.md", content: "# hi" },
    ]);
  });

  it("uses an explicit filename token in the fence info string", () => {
    const text = "```js src/app.js\nconsole.log(1)\n```";
    expect(parseMarkdownFences(text)).toEqual([{ path: "src/app.js", content: "console.log(1)" }]);
  });

  it("uses a filename comment on the first content line", () => {
    const text = "```js\n// utils.js\nexport const x = 1;\n```";
    expect(parseMarkdownFences(text)).toEqual([
      { path: "utils.js", content: "// utils.js\nexport const x = 1;" },
    ]);
  });

  it("dedupes repeated inferred names and skips unknown/empty blocks", () => {
    const text = "```js\na\n```\n```js\nb\n```\n```\n\n```\n```wat\nc\n```";
    expect(parseMarkdownFences(text)).toEqual([
      { path: "main.js", content: "a" },
      { path: "main-2.js", content: "b" },
    ]);
  });
});

describe("parseFiles", () => {
  it("prefers the envelope and ignores fences when both appear", () => {
    const text = `${envelope("index.html", "<env/>")}\n\n\`\`\`js\nshould not be used\n\`\`\``;
    expect(parseFiles(text)).toEqual([{ path: "index.html", content: "<env/>" }]);
  });

  it("falls back to fences when there is no envelope", () => {
    expect(parseFiles("```html\n<x/>\n```")).toEqual([{ path: "index.html", content: "<x/>" }]);
  });
});
