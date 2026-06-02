import type { CoordinatorIntakeResult } from "./api";
import { runTone, type Tone } from "./tone";

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
