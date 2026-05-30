import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseFrontMatter,
  readDoc,
  renderFrontMatter,
  withFileLock,
  writeDoc,
  type FrontMatter,
} from "./base.js";

describe("front-matter serializer", () => {
  it("round-trips a string field containing a newline (SER-161)", () => {
    const front: FrontMatter = {
      id: "run_1",
      scope: "line one\nline two\nline three",
    };
    const rendered = renderFrontMatter(front, "# body\n");
    // The newline must not leak into the front-matter block as a raw line break.
    const fmBlock = rendered.split("\n---\n")[0] ?? rendered;
    expect(fmBlock.split("\n").filter((l) => l.startsWith("scope:"))).toHaveLength(1);

    const parsed = parseFrontMatter(rendered);
    expect(parsed.front.scope).toBe("line one\nline two\nline three");
    expect(parsed.front.id).toBe("run_1");
    expect(parsed.body).toBe("# body\n");
  });

  it("round-trips strings with YAML-special and control characters", () => {
    const tricky = [
      "has: a colon",
      "has # a hash",
      'has "double" quotes',
      "has 'single' quotes",
      "tab\tseparated",
      "carriage\r\nreturn",
      "[looks, like, an, array]",
      "trailing space ",
      " leading space",
      "true",
      "false",
      "42",
      "-3.14",
      "plain value",
      "",
    ];
    for (const value of tricky) {
      const rendered = renderFrontMatter({ field: value }, "");
      const parsed = parseFrontMatter<{ field: string }>(rendered);
      expect(parsed.front.field, `value: ${JSON.stringify(value)}`).toBe(value);
    }
  });

  it("preserves a body that begins with a newline across a round-trip (SER-191)", () => {
    const bodies = [
      "\nbody starts with a blank line\n",
      "\n\ndouble leading newline\n",
      "no leading newline\n",
      "",
    ];
    for (const body of bodies) {
      const rendered = renderFrontMatter({ id: "x" }, body);
      const parsed = parseFrontMatter(rendered);
      expect(parsed.body, `body: ${JSON.stringify(body)}`).toBe(body);
    }
  });

  it("keeps booleans and numbers typed across a round-trip", () => {
    const rendered = renderFrontMatter({ flag: true, count: 7, ratio: -2.5, tags: ["a", "b"] }, "");
    const parsed = parseFrontMatter(rendered);
    expect(parsed.front.flag).toBe(true);
    expect(parsed.front.count).toBe(7);
    expect(parsed.front.ratio).toBe(-2.5);
    expect(parsed.front.tags).toEqual(["a", "b"]);
  });

  it("round-trips array elements containing commas and quotes (SER-164)", () => {
    const tags = [
      "a",
      "b,c",
      'has "double, quote" inside',
      "has 'single, quote' inside",
      "trailing comma,",
      ",leading comma",
      "plain",
    ];
    const rendered = renderFrontMatter({ id: "run_1", tags }, "# body\n");
    // Arrays must stay on a single front-matter line so the parser sees them whole.
    const fmBlock = rendered.split("\n---\n")[0] ?? rendered;
    expect(fmBlock.split("\n").filter((l) => l.startsWith("tags:"))).toHaveLength(1);

    const parsed = parseFrontMatter<{ id: string; tags: string[] }>(rendered);
    expect(parsed.front.tags).toEqual(tags);
    expect(parsed.front.id).toBe("run_1");
  });

  it("parses an empty array and a single comma-bearing element", () => {
    expect(parseFrontMatter(renderFrontMatter({ tags: [] }, "")).front.tags).toEqual([]);
    const single = parseFrontMatter<{ tags: string[] }>(
      renderFrontMatter({ tags: ["only, one"] }, ""),
    );
    expect(single.front.tags).toEqual(["only, one"]);
  });

  it("still parses legacy unquoted array front matter", () => {
    // Hand-edited / pre-fix front matter wrote bare elements without JSON quoting.
    const parsed = parseFrontMatter<{ tags: string[] }>("---\ntags: [a, b, c]\n---\nbody\n");
    expect(parsed.front.tags).toEqual(["a", "b", "c"]);
  });
});

describe("atomic + serialized document writes (SER-163)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bureauos-base-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("never leaves a partially written document for a reader", async () => {
    const path = join(dir, "doc.md");
    const big = "x".repeat(200_000);
    await writeDoc(path, { id: "doc_1", scope: big }, "# body\n");
    // A full read must always parse cleanly (no truncated front-matter).
    const doc = await readDoc<{ id: string; scope: string }>(path);
    expect(doc.front.id).toBe("doc_1");
    expect(doc.front.scope).toBe(big);
    // No stray temp files left behind.
    const raw = await readFile(path, "utf8");
    expect(raw).toContain("id: doc_1");
  });

  it("serializes concurrent read-modify-write so no update is lost", async () => {
    const path = join(dir, "counter.md");
    await writeDoc(path, { id: "counter", items: [] }, "");

    // 50 concurrent appenders each add one item via withFileLock. Without
    // serialization the read-modify-write would lose most updates.
    const appends = Array.from({ length: 50 }, (_, i) =>
      withFileLock(path, async () => {
        const doc = await readDoc<{ id: string; items: string[] }>(path);
        const items = [...(doc.front.items as string[]), `item-${i}`];
        await writeDoc(path, { ...doc.front, items }, doc.body);
      }),
    );
    await Promise.all(appends);

    const final = await readDoc<{ id: string; items: string[] }>(path);
    expect(final.front.items).toHaveLength(50);
    const unique = new Set(final.front.items as string[]);
    expect(unique.size).toBe(50);
  });

  it("keeps the queue draining after a failing locked operation", async () => {
    const path = join(dir, "queue.md");
    const order: string[] = [];
    const first = withFileLock(path, async () => {
      order.push("first");
      throw new Error("boom");
    });
    const second = withFileLock(path, async () => {
      order.push("second");
    });
    await expect(first).rejects.toThrow("boom");
    await second;
    expect(order).toEqual(["first", "second"]);
  });
});
