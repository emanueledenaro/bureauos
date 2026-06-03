import type { CatalogNamespace } from "../types";

// Strings for the async owner-triggered build-progress card (Unit 3B). The card
// posts a compact status line beneath the coordinator message that started the
// build; copy stays terse to match the delegation card's voice.
export default {
  en: {
    "buildProgress.eyebrow": "Build",
    "buildProgress.artifacts": "Artifacts",
    "buildProgress.statusBuilding": "Building",
    "buildProgress.statusCompleted": "Completed",
    "buildProgress.statusBlocked": "Blocked",
    "buildProgress.statusFailed": "Failed",
    "buildProgress.pipelineStage": "Dev → QA → review",
    "buildProgress.linePending": "Starting the build…",
    "buildProgress.lineBuilding": "Building — {stage}",
    "buildProgress.lineCompleted": "Completed — {count} artifact",
    "buildProgress.lineBlocked": "Blocked — {reason}",
    "buildProgress.lineFailed": "Build did not complete",
  },
  it: {
    "buildProgress.eyebrow": "Build",
    "buildProgress.artifacts": "Artifact",
    "buildProgress.statusBuilding": "In costruzione",
    "buildProgress.statusCompleted": "Completata",
    "buildProgress.statusBlocked": "Bloccata",
    "buildProgress.statusFailed": "Non riuscita",
    "buildProgress.pipelineStage": "Sviluppo → QA → review",
    "buildProgress.linePending": "Avvio della costruzione…",
    "buildProgress.lineBuilding": "Costruzione in corso — {stage}",
    "buildProgress.lineCompleted": "Completata — {count} artifact",
    "buildProgress.lineBlocked": "Bloccata — {reason}",
    "buildProgress.lineFailed": "Costruzione non completata",
  },
} satisfies CatalogNamespace;
