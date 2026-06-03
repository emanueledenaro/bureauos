import { describe, expect, it } from "vitest";
import { parseModelOverride } from "./model-override.js";

describe("parseModelOverride", () => {
  it("accepts a well-formed override", () => {
    expect(parseModelOverride({ provider: "anthropic", model: "claude-sonnet" })).toEqual({
      provider: "anthropic",
      model: "claude-sonnet",
    });
  });
  it("rejects missing/blank/wrong-typed fields", () => {
    expect(parseModelOverride(undefined)).toBeUndefined();
    expect(parseModelOverride({})).toBeUndefined();
    expect(parseModelOverride({ provider: "anthropic" })).toBeUndefined();
    expect(parseModelOverride({ provider: " ", model: "x" })).toBeUndefined();
    expect(parseModelOverride({ provider: 1, model: "x" })).toBeUndefined();
  });
});
