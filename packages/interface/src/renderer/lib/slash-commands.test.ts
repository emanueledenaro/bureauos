import { describe, expect, it } from "vitest";
import { filterSlashCommands, parseSlash, SLASH_COMMANDS } from "./slash-commands";

describe("slash-commands", () => {
  it("detects an in-progress slash token at the start of the input", () => {
    expect(parseSlash("/clie")).toEqual({ isSlash: true, query: "clie" });
    expect(parseSlash("/")).toEqual({ isSlash: true, query: "" });
  });

  it("stops treating it as a slash once a space (completed command) is typed", () => {
    expect(parseSlash("/cliente Acme")).toEqual({ isSlash: false, query: "" });
    expect(parseSlash("hello")).toEqual({ isSlash: false, query: "" });
  });

  it("filters commands by trigger or label substring", () => {
    expect(filterSlashCommands("").length).toBe(SLASH_COMMANDS.length);
    expect(filterSlashCommands("prop").map((c) => c.id)).toContain("proposal");
    expect(filterSlashCommands("zzz")).toEqual([]);
  });
});
