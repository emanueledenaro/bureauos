import type { CoordinatorChatStreamEvent } from "./api";

type StreamStatus = Extract<CoordinatorChatStreamEvent, { type: "status" }>["status"];

export interface ReasoningStep {
  key: string;
  fallback: string;
}

export function reasoningStepForStatus(status: StreamStatus): ReasoningStep {
  switch (status) {
    case "started":
      return { key: "reasoning.readingContext", fallback: "Reading company context" };
    case "provider_streaming":
      return { key: "reasoning.drafting", fallback: "Drafting the reply" };
    case "persisting":
      return { key: "reasoning.saving", fallback: "Saving to memory" };
    default:
      return { key: "reasoning.working", fallback: "Working" };
  }
}
