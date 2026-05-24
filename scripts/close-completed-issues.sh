#!/usr/bin/env bash
set -e
REPO="emanueledenaro/bureauos"

TITLES=(
  "Phase 1.3: MemoryStore interface + LocalMemoryStore (markdown backend)"
  "Phase 1.4: Client registry CRUD"
  "Phase 1.4: Project registry CRUD"
  "Phase 1.4: Opportunity registry"
  "Phase 1.4: Approval registry"
  "Phase 1.4: bureau client/project/opportunity create CLI"
  "Phase 1.5: Policy engine"
  "Phase 1.5: Standing and one-off approvals with expiry"
  "Phase 1.5: bureau policy explain CLI subcommand"
  "Phase 1.6: Artifact store writeArtifact/readArtifact/listArtifacts"
  "Phase 1.7: bureau audit tail/search CLI"
  "Phase 1.8: Run engine lifecycle + persistence"
  "Phase 1.8: startRun + stub dispatch"
  "Phase 1.8: bureau run new + bureau status CLI"
  "Phase 2: ProviderAdapter + RuntimeAdapter contracts"
  "Phase 2: OpenAI adapter"
  "Phase 2: Anthropic adapter"
  "Phase 2: Google Gemini adapter"
  "Phase 2: Local model adapter"
  "Phase 2: OpenRouter gateway adapter"
  "Phase 2: Codex runtime adapter"
  "Phase 2: Provider router"
  "Phase 2: bureau providers list/test CLI"
  "Phase 3: GitHub client wrapper"
  "Phase 4: Electron shell"
  "Phase 4: Local HTTP API server"
  "Phase 4: Portfolio Operating Room view"
  "Phase 4: Live Operations Timeline"
  "Phase 4: Supreme Coordinator chat panel"
  "Phase 4: Pending Approvals panel"
  "Phase 4: Revenue Pulse KPI strip"
  "Phase 4: Agent Layer footer strip"
)

for title in "${TITLES[@]}"; do
  # gh search is fuzzy; restrict to exact-title matches via --jq
  number=$(gh issue list --repo "$REPO" --state open --limit 200 \
    --json number,title --jq ".[] | select(.title == \"${title//\"/\\\"}\") | .number" \
    | head -1)
  if [ -n "$number" ]; then
    gh issue close "$number" --repo "$REPO" --reason completed \
      --comment "Shipped in commit ecd5cb0." >/dev/null 2>&1
    echo "closed #$number $title"
  else
    echo "not found: $title"
  fi
done
