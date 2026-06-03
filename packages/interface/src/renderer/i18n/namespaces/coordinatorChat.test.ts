import { describe, expect, it } from "vitest";
import ns from "./coordinatorChat";

describe("coordinatorChat namespace", () => {
  it("has identical keys in en and it", () => {
    expect(Object.keys(ns.en).sort()).toEqual(Object.keys(ns.it).sort());
  });

  it("includes the core chat keys", () => {
    expect(ns.en["messageActions.copy"]).toBeTruthy();
    expect(ns.en["reasoning.readingContext"]).toBeTruthy();
    expect(ns.en["composer.stop"]).toBeTruthy();
  });
});
