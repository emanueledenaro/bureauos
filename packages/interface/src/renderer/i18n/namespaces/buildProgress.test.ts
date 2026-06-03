import { describe, expect, it } from "vitest";
import ns from "./buildProgress";

describe("buildProgress namespace", () => {
  it("has identical keys in en and it", () => {
    expect(Object.keys(ns.en).sort()).toEqual(Object.keys(ns.it).sort());
  });

  it("includes the core build-progress keys", () => {
    expect(ns.en["buildProgress.statusCompleted"]).toBeTruthy();
    expect(ns.en["buildProgress.lineBuilding"]).toBeTruthy();
    expect(ns.it["buildProgress.statusCompleted"]).toBe("Completata");
  });
});
