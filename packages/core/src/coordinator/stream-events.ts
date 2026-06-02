import type { CoordinatorChatStreamEvent } from "./chat.js";
import type { CoordinatorIntakeResult } from "./intake.js";

/**
 * Derives the delegation / run_status / artifact event sequence from a completed
 * intake result. Phase 2 yields these (before `final`) so the UI can render an
 * event-driven delegation card. The coordinator already did this work in
 * `process()`; emitting *during* that work is a future refinement that would only
 * change where these events are yielded — not their shape or the frontend.
 */
export function intakeToStreamEvents(
  result: CoordinatorIntakeResult,
): CoordinatorChatStreamEvent[] {
  const events: CoordinatorChatStreamEvent[] = [];
  const run = result.run;
  if (run) {
    events.push({
      type: "delegation",
      phase: "dispatched",
      label: result.project?.name ?? result.opportunity?.title ?? "Delegated work",
      runId: run.id,
      agentRole: run.created_by ?? "supreme_coordinator",
    });
    events.push({ type: "run_status", runId: run.id, status: run.status });
  }
  for (const artifact of result.artifacts ?? []) {
    events.push({
      type: "artifact",
      artifactId: artifact.id,
      artifactType: artifact.type,
      status: artifact.status,
    });
  }
  return events;
}
