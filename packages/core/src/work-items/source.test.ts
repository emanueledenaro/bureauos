import { describe, expect, it } from "vitest";
import {
  OWNER_BUILD_WORK_ITEM_TYPE,
  ownerBuildSourceWorkItem,
  sourceWorkItemFromFrontMatter,
  sourceWorkItemFrontMatter,
} from "./source.js";

describe("ownerBuildSourceWorkItem (AB-U5)", () => {
  it("derives a recorded work item from the project id", () => {
    const item = ownerBuildSourceWorkItem({ projectId: "proj_123" });
    expect(item).toEqual({
      type: OWNER_BUILD_WORK_ITEM_TYPE,
      identifier: "owner-build/proj_123",
    });
  });

  it("includes the opportunity id when supplied, for traceability", () => {
    const item = ownerBuildSourceWorkItem({ projectId: "proj_123", opportunityId: "opp_9" });
    expect(item.identifier).toBe("owner-build/proj_123/opp_9");
  });

  it("round-trips through run front matter so the run carries a traceable reference", () => {
    const item = ownerBuildSourceWorkItem({ projectId: "proj_123" });
    const front = sourceWorkItemFrontMatter(item);
    // The recorded reference is what satisfies the `linked_issue` gate downstream.
    expect(front.source_work_item_type).toBe(OWNER_BUILD_WORK_ITEM_TYPE);
    expect(front.source_work_item_id).toBe("owner-build/proj_123");
    // It is NOT a Linear issue, so no linear_* mirror fields are stamped.
    expect(front["linear_identifier"]).toBeUndefined();
    expect(sourceWorkItemFromFrontMatter(front)).toEqual(item);
  });
});
