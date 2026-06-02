import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { nodeText } from "./code-text";

describe("code-text", () => {
  it("returns plain strings and numbers", () => {
    expect(nodeText("hello")).toBe("hello");
    expect(nodeText(42)).toBe("42");
    expect(nodeText(null)).toBe("");
  });

  it("joins arrays and walks element children", () => {
    expect(nodeText(["a", "b"])).toBe("ab");
    const tree = createElement("span", null, ["const ", createElement("em", null, "x"), " = 1"]);
    expect(nodeText(tree)).toBe("const x = 1");
  });
});
