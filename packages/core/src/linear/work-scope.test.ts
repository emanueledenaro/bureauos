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
    expect(result.intakePlan.riskLevel).toBe("low");
    expect(result.intakePlan.productAcceptanceCriteria).toHaveLength(3);
    expect(result.intakePlan.productClarificationRequests).toEqual([]);
    expect(result.intakePlan.projectManagerTaskPlan).toContain(
      "Project Manager creates role handoffs and dependency order.",
    );
    expect(result.intakePlan.agentAssignments).toContainEqual(
      expect.objectContaining({ agent: "development", status: "ready" }),
    );
    expect(result.externalIssue.identifier).toBe("SER-62");
    expect(result.sourceWorkItem).toEqual({
      type: "linear_issue",
      identifier: "SER-62",
      url: "https://linear.app/serium/issue/SER-62/wire-codex-runtime-adapter",
    });
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
    expect(result.blockers).toContain("ambiguous scope needs product clarification");
    expect(result.intakePlan.productClarificationRequests).toEqual(
      expect.arrayContaining([
        "Provide concrete acceptance criteria before development starts.",
        "Narrow the scope to one deliverable, one user outcome, and explicit non-goals.",
      ]),
    );
    expect(result.intakePlan.agentAssignments).toContainEqual(
      expect.objectContaining({ agent: "development", status: "blocked" }),
    );
  });

  it("refuses oversized issues before development assignment", () => {
    const criteria = Array.from(
      { length: 12 },
      (_, index) => `- Acceptance criterion ${index + 1} is independently verifiable.`,
    ).join("\n");
    const result = linearIssueToRunScope({
      identifier: "SER-202",
      title: "Implement every Operating Room workflow",
      description: `Acceptance criteria:\n${criteria}`,
      url: "https://linear.app/serium/issue/SER-202/implement-every-operating-room-workflow",
      labels: ["Feature"],
      projectId: "bureauos-project",
      teamKey: "SER",
    });

    expect(result.readiness).toBe("needs_clarification");
    expect(result.blockers).toContain("oversized issue scope: 12 acceptance criteria");
    expect(result.intakePlan.riskLevel).toBe("high");
    expect(result.intakePlan.productClarificationRequests).toContain(
      "Split the issue into smaller tickets before assigning development.",
    );
    expect(result.intakePlan.projectManagerTaskPlan).toContain(
      "Coordinator waits for clarified scope before development execution.",
    );
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
