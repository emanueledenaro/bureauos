import { describe, expect, it } from "vitest";
import { newId, slugify } from "./ids.js";

describe("newId", () => {
  it("returns a prefixed id with a 64-bit (16 hex char) suffix", () => {
    const id = newId("run");
    expect(id).toMatch(/^run_[0-9a-f]{16}$/);
  });

  it("returns different ids on subsequent calls", () => {
    const a = newId("client");
    const b = newId("client");
    expect(a).not.toBe(b);
  });

  it("generates collision-free ids in bulk (entropy guard)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20_000; i += 1) ids.add(newId("art"));
    expect(ids.size).toBe(20_000);
  });
});

describe("slugify", () => {
  it("lowercases and replaces non-alphanumeric", () => {
    expect(slugify("Acme Co.")).toBe("acme-co");
  });

  it("collapses runs of separators", () => {
    expect(slugify("  Hello,   World!! ")).toBe("hello-world");
  });

  it("trims to 64 characters", () => {
    const long = "x".repeat(200);
    expect(slugify(long)).toHaveLength(64);
  });

  it("falls back to a non-empty, filesystem-safe slug for non-Latin/symbol/empty names (SER-230)", () => {
    const slugPattern = /^[a-z0-9][a-z0-9-]*$/;
    for (const name of ["株式会社", "!!!", "   ", "", "—–-"]) {
      const slug = slugify(name);
      expect(slug.length).toBeGreaterThan(0);
      expect(slug).toMatch(slugPattern);
    }
    // Distinct empty-slugifying names get distinct slugs (no collision into "").
    expect(slugify("株式会社")).not.toBe(slugify("!!!"));
    // Deterministic: the same name always maps to the same slug.
    expect(slugify("株式会社")).toBe(slugify("株式会社"));
    // Latin names are unchanged by the fallback.
    expect(slugify("Acme Co.")).toBe("acme-co");
  });
});
