import type { CoordinatorIntakeResult } from "./api";
import type { Tone } from "./design-tokens";

export interface DelegationView {
  opportunityId: string;
  projectName: string;
  clientName: string;
  runId: string;
  runStatus: string;
  runTone: Tone;
  artifactCount: number;
  approvalCount: number;
  nextAction?: string;
}

export function runTone(status: string): Tone {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
    case "blocked":
      return "danger";
    case "needs_human":
      return "warning";
    case "in_progress":
    case "queued":
      return "info";
    default:
      return "neutral";
  }
}

export function toDelegationView(result: CoordinatorIntakeResult): DelegationView {
  return {
    opportunityId: result.opportunity.id,
    projectName: result.project.name,
    clientName: result.client.name,
    runId: result.run.id,
    runStatus: result.run.status,
    runTone: runTone(result.run.status),
    artifactCount: result.artifacts.length,
    approvalCount: result.approvals.length,
    nextAction: result.next_actions[0],
  };
}
