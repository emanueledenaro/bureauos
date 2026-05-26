import { describe, expect, it } from "vitest";
import { linearIssueToRunScope } from "./work-scope.js";

describe("linearIssueToRunScope", () => {
  it("maps a clear Linear feature issue into a run scope", () => {
    const result = linearIssueToRunScope({
      identifier: "SER-62",
      title: "Wire Codex runtime adapter to development agent execution",
      description:
        "Acceptance criteria:\n- Development Agent calls Codex runtime.\n- Runtime output is stored as artifacts.\n- Missing credentials fail safely.",
      url: "https://linear.app/serium/issue/SER-62/wire-codex-runtime-adapter",
      labels: ["Feature"],
      projectId: "bureauos-project",
      teamKey: "SER",
    });

    expect(result.readiness).toBe("ready");
    expect(result.runType).toBe("feature");
    expect(result.triggerType).toBe("external_signal");
    expect(result.triggerSource).toBe("linear://issue/SER-62");
    expect(result.scope).toContain("Wire Codex runtime adapter");
    expect(result.acceptanceCriteria).toHaveLength(3);
    expect(result.externalIssue.identifier).toBe("SER-62");
  });

  it("refuses issues without acceptance criteria", () => {
    const result = linearIssueToRunScope({
      identifier: "SER-200",
      title: "Make BureauOS better",
      description: "Improve the whole thing.",
      url: "https://linear.app/serium/issue/SER-200/make-bureauos-better",
      labels: ["Feature"],
      projectId: "bureauos-project",
      teamKey: "SER",
    });

    expect(result.readiness).toBe("needs_clarification");
    expect(result.blockers).toContain("missing acceptance criteria");
  });

  it("refuses unsafe merge or deploy requests", () => {
    const result = linearIssueToRunScope({
      identifier: "SER-201",
      title: "Ship and deploy automatically",
      description:
        "Acceptance criteria:\n- Merge the pull request.\n- Deploy production without asking.",
      url: "https://linear.app/serium/issue/SER-201/ship-and-deploy-automatically",
      labels: ["Feature"],
      projectId: "bureauos-project",
      teamKey: "SER",
    });

    expect(result.readiness).toBe("needs_clarification");
    expect(result.blockers).toContain("contains blocked operation: merge");
    expect(result.blockers).toContain("contains blocked operation: deploy");
  });
});
