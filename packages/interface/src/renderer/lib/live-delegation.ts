import type { CoordinatorChatStreamEvent } from "./api";

export interface LiveDelegation {
  active: boolean;
  label?: string;
  runId?: string;
  agentRole?: string;
  status?: string;
  artifactIds: string[];
  artifactCount: number;
}

export const EMPTY_DELEGATION: LiveDelegation = {
  active: false,
  artifactIds: [],
  artifactCount: 0,
};

export function reduceDelegationEvent(
  state: LiveDelegation,
  event: CoordinatorChatStreamEvent,
): LiveDelegation {
  switch (event.type) {
    case "delegation":
      return {
        ...state,
        active: true,
        label: event.label,
        runId: event.runId,
        agentRole: event.agentRole,
      };
    case "run_status":
      return { ...state, active: true, runId: event.runId, status: event.status };
    case "artifact": {
      if (state.artifactIds.includes(event.artifactId)) return state;
      const artifactIds = [...state.artifactIds, event.artifactId];
      return { ...state, active: true, artifactIds, artifactCount: artifactIds.length };
    }
    default:
      return state;
  }
}
