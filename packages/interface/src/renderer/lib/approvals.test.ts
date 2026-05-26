import { describe, expect, it } from "vitest";
import type { ApprovalRecord, RunRecord } from "./api";
import {
  approvalMatchesRun,
  approvalRequiresDecisionNote,
  approvalRiskLevel,
  groupApprovalsByRunAndRisk,
  isStaleApprovalError,
} from "./approvals";

const approval = (overrides: Partial<ApprovalRecord>): ApprovalRecord => ({
  id: "appr_test",
  action: "create_issues",
  actor: "supreme_coordinator",
  target: "repo",
  scope: "Create GitHub issues",
  status: "pending",
  created: "2026-05-26T10:00:00.000Z",
  updated: "2026-05-26T10:00:00.000Z",
  ...overrides,
});

const run = (overrides: Partial<RunRecord>): RunRecord => ({
  id: "run_1",
  type: "development",
  status: "needs_human",
  scope: "Build approval inbox",
  created: "2026-05-26T09:00:00.000Z",
  ...overrides,
});

describe("approval inbox helpers", () => {
  it("groups pending approvals by run and risk", () => {
    const groups = groupApprovalsByRunAndRisk(
      [
        approval({ id: "appr_low", run_id: "run_1", risk_level: "low" }),
        approval({
          id: "appr_high",
          run_id: "run_1",
          action: "send_final_proposals",
          risk_level: "high",
        }),
        approval({
          id: "appr_critical",
          run_id: "run_2",
          action: "deploy_production",
          risk_level: "critical",
        }),
      ],
      [run({ id: "run_1", scope: "Client proposal" }), run({ id: "run_2", scope: "Release" })],
    );

    expect(groups[0]?.runKey).toBe("run_2");
    expect(groups[0]?.riskGroups[0]?.risk).toBe("critical");
    expect(groups[1]?.runKey).toBe("run_1");
    expect(groups[1]?.riskGroups.map((group) => group.risk)).toEqual(["high", "low"]);
    expect(groups[1]?.label).toBe("Client proposal");
  });

  it("requires explicit decision notes for high-risk approvals", () => {
    expect(approvalRequiresDecisionNote(approval({ action: "send_final_proposals" }))).toBe(true);
    expect(approvalRiskLevel(approval({ action: "deploy_production" }))).toBe("critical");
    expect(approvalRequiresDecisionNote(approval({ action: "create_issues" }))).toBe(false);
  });

  it("detects stale approvals and run matches for refreshed views", () => {
    const item = approval({ id: "appr_1", run_id: "run_1" });

    expect(approvalMatchesRun(item, run({ id: "run_1" }))).toBe(true);
    expect(approvalMatchesRun(item, run({ id: "run_2" }))).toBe(false);
    expect(isStaleApprovalError(new Error("409 approval is no longer pending"))).toBe(true);
  });
});
