import { describe, expect, it } from "vitest";
import { newId, slugify } from "./ids.js";

describe("newId", () => {
  it("returns a prefixed id with hex suffix", () => {
    const id = newId("run");
    expect(id).toMatch(/^run_[0-9a-f]{8}$/);
  });

  it("returns different ids on subsequent calls", () => {
    const a = newId("client");
    const b = newId("client");
    expect(a).not.toBe(b);
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
});
