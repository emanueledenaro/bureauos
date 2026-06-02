import { describe, expect, it } from "vitest";
import type { CoordinatorMessageRecord } from "./api";
import { lastOwnerMessage, truncateBefore, truncateToLastOwnerInclusive } from "./chat-thread";

const msg = (id: string, role: "owner" | "coordinator"): CoordinatorMessageRecord => ({
  id,
  role,
  text: id,
  created: "2026-06-02T10:00:00.000Z",
});

const thread = [msg("o1", "owner"), msg("c1", "coordinator"), msg("o2", "owner"), msg("c2", "coordinator")];

describe("chat-thread", () => {
  it("finds the last owner message", () => {
    expect(lastOwnerMessage(thread)?.id).toBe("o2");
    expect(lastOwnerMessage([])).toBeUndefined();
  });

  it("truncateBefore drops the target message and everything after (edit)", () => {
    expect(truncateBefore(thread, "o2").map((m) => m.id)).toEqual(["o1", "c1"]);
    expect(truncateBefore(thread, "missing").map((m) => m.id)).toEqual(["o1", "c1", "o2", "c2"]);
  });

  it("truncateToLastOwnerInclusive keeps through the last owner turn (regenerate)", () => {
    expect(truncateToLastOwnerInclusive(thread).map((m) => m.id)).toEqual(["o1", "c1", "o2"]);
    expect(truncateToLastOwnerInclusive([msg("c0", "coordinator")]).map((m) => m.id)).toEqual([]);
  });
});
