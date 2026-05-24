#!/usr/bin/env bash
set -e
REPO="emanueledenaro/bureauos"

mkissue() {
  local title="$1"; local phase="$2"; local area="$3"; local body="$4"
  gh issue create --repo "$REPO" --title "$title" \
    --label "phase:$phase" --label "area:$area" --label "type:feature" --label "stage:dev-ready" \
    --body "$body" 2>&1 | tail -1
}

mkissue_done() {
  local title="$1"; local phase="$2"; local area="$3"; local body="$4"
  local url
  url=$(gh issue create --repo "$REPO" --title "$title" \
    --label "phase:$phase" --label "area:$area" --label "type:feature" --label "stage:done" \
    --body "$body" 2>&1 | tail -1)
  echo "$url"
  local num
  num=$(echo "$url" | grep -oE '[0-9]+$' || true)
  if [ -n "$num" ]; then
    gh issue close "$num" --repo "$REPO" --reason completed >/dev/null 2>&1 || true
  fi
}

# Already shipped
mkissue_done "Phase 0: TypeScript + pnpm monorepo bootstrap" 0 kernel "Adopted TypeScript on Node 20 LTS, pnpm workspaces, packages: core, memory, providers, capabilities, cli, interface placeholder. See ADR 0001."
mkissue_done "Phase 0: GitHub Actions CI workflow" 0 tests "ci.yml runs typecheck, build, test, and a smoke bureau init across the monorepo."
mkissue_done "Phase 1.1: Config schema and loader" 1 core "zod schema covering organization, setup, interface, supreme_coordinator, agents, autonomy, growth_autonomy, limits, memory, github. 7 tests passing."
mkissue_done "Phase 1.2: bureau init workspace initializer" 1 cli "Creates .bureauos tree with memory files, daily note, audit log, approvals folders, first executive report. Refuses overwrite without force. 6 tests passing."
mkissue_done "Phase 1.7: Audit log JSONL" 1 audit "AuditLog appends events to .bureauos/audit/audit.log. workspace.init event wired. 2 tests passing."

# Phase 0 remaining
mkissue "Phase 0: ESLint + Prettier configuration" 0 tests "Add ESLint with typescript-eslint and Prettier. Run on all packages via pnpm -r run lint."
mkissue "Phase 0: Docs link-check workflow" 0 docs "Add .github/workflows/docs.yml that fails on broken internal markdown links."
mkissue "Phase 0: CODEOWNERS file" 0 docs "Add CODEOWNERS to route reviews."

# Phase 1.1 extension
mkissue "Phase 1.1: Extend config schema with triggers/capabilities/business sections" 1 core "Add remaining sections from examples/bureauos.example.yaml."
mkissue "Phase 1.1: bureau config validate CLI subcommand" 1 cli "Implement bureau config validate [path]."

# Phase 1.3 Memory
mkissue "Phase 1.3: MemoryStore interface + LocalMemoryStore (markdown backend)" 1 memory "Define read/write/append/list/search. Implement LocalMemoryStore reading and writing .bureauos/memory."
mkissue "Phase 1.3: loadRootMemory + assembleContextPacket" 1 memory "Per docs/memory-model.md. Bounded context packets for agents."
mkissue "Phase 1.3: Daily-note creation and append rules" 1 memory "One file per local date. Helpers to write run summaries, decisions, follow-ups."
mkissue "Phase 1.3: SQLite FTS5 keyword index" 1 memory "Index Markdown files under .bureauos/memory. Stored at memory/indexes/memory.sqlite."
mkissue "Phase 1.3: Semantic search stub + provider hook" 1 memory "Stub returns no matches. Real embeddings arrive with provider router."
mkissue "Phase 1.3: bureau memory search CLI subcommand" 1 cli "Combine keyword and semantic search."

# Phase 1.4 Registries
mkissue "Phase 1.4: Company registry" 1 registries "Single record at COMPANY.md plus JSON sidecar."
mkissue "Phase 1.4: Client registry CRUD" 1 registries "Per-client folder with CLIENT.md, PROJECTS.md, REVENUE.md, RELATIONSHIP.md, PERMISSIONS.md, COMMUNICATION.md, OPPORTUNITIES.md, DECISIONS.md, RISKS.md."
mkissue "Phase 1.4: Project registry CRUD" 1 registries "Per-project folder with PROJECT.md, ARCHITECTURE.md, BACKLOG.md, RUNS.md, RISKS.md, DECISIONS.md."
mkissue "Phase 1.4: Opportunity registry" 1 registries "opportunities/<id>.md with status, source, expected value, qualification, proposal status, pricing status, approval requirements."
mkissue "Phase 1.4: Agent + capability registries from config" 1 registries "Typed lookups for policy engine and run engine."
mkissue "Phase 1.4: Approval registry" 1 registries "approvals/pending and approvals/resolved. Scope, expiry, recurring vs one-off."
mkissue "Phase 1.4: bureau client/project/opportunity create CLI" 1 cli "CLI commands with required fields and audit."

# Phase 1.5 Policy
mkissue "Phase 1.5: Policy engine" 1 policy "allow/deny/require_approval/escalate. Encodes autonomy levels 0..5 and growth_autonomy switches."
mkissue "Phase 1.5: Standing and one-off approvals with expiry" 1 policy "Approval matcher with action-sensitive memory."
mkissue "Phase 1.5: bureau policy explain CLI subcommand" 1 cli "Prints why an action would be allowed or blocked."

# Phase 1.6 Artifacts
mkissue "Phase 1.6: Artifact store writeArtifact/readArtifact/listArtifacts" 1 core "Use templates/<type>.md. bureauos:artifact marker. Cross-link to runs."
mkissue "Phase 1.6: Tests for every artifact template type" 1 tests "Cover all 23 templates."

# Phase 1.7 Audit extensions
mkissue "Phase 1.7: Wire audit events for every kernel side effect" 1 audit "CRUD, run transitions, policy evaluations, artifact writes."
mkissue "Phase 1.7: Audit log rotation + segment hashing" 1 audit "Daily rotation. Hash of previous segment in new header for tamper-evidence."
mkissue "Phase 1.7: bureau audit tail/search CLI" 1 cli "bureau audit tail and bureau audit search."

# Phase 1.8 Run engine
mkissue "Phase 1.8: Run engine lifecycle + persistence" 1 runtime "States: detected, classified, scoped, policy_checked, dispatched, artifact_written, verified, reported, memory_updated. Persist to runs/<id>.md plus JSON sidecar."
mkissue "Phase 1.8: startRun + stub dispatch" 1 runtime "End-to-end run lifecycle with a stub agent that writes intent as artifact."
mkissue "Phase 1.8: bureau run new + bureau status CLI" 1 cli "bureau run new and bureau status."

# Phase 1.9
mkissue "Phase 1.9: Minimum Viable Kernel acceptance tests" 1 tests "init then client then project then opportunity then run then artifact then audit."

# Phase 2 Provider Router
mkissue "Phase 2: ProviderAdapter + RuntimeAdapter contracts" 2 providers "id, type, listModels, validateCredentials, generateText, generateStructured, stream."
mkissue "Phase 2: OpenAI adapter" 2 providers "openai SDK. Streaming + structured."
mkissue "Phase 2: Anthropic adapter" 2 providers "@anthropic-ai/sdk. Streaming + tool use."
mkissue "Phase 2: Google Gemini adapter" 2 providers "@google/generative-ai."
mkissue "Phase 2: Local model adapter" 2 providers "Ollama or OpenAI-compatible. Configurable base URL."
mkissue "Phase 2: OpenRouter gateway adapter" 2 providers "Single key, many models."
mkissue "Phase 2: Codex runtime adapter" 2 providers "Treated as capability."
mkissue "Phase 2: Credentials handling" 2 providers "Env + gitignored secrets + OS keychain hook."
mkissue "Phase 2: Provider router" 2 providers "Defaults, fallback chains, budget-aware."
mkissue "Phase 2: bureau providers list/test CLI" 2 cli "Validate and print provider/model availability."

# Phase 3 GitHub
mkissue "Phase 3: GitHub client wrapper" 3 github "Octokit with retries and rate-limit handling."
mkissue "Phase 3: GitHub issue read/create + labels" 3 github "Idempotent ensure-labels for the taxonomy."
mkissue "Phase 3: GitHub PR read/create" 3 github "Branch + commit + push + open PR."
mkissue "Phase 3: GitHub checks + webhook ingestion" 3 github "Failures become signals. Webhooks create candidate runs."
mkissue "Phase 3: bureau github sync CLI" 3 cli "Reconcile project state from GitHub."

# Phase 4 Interface
mkissue "Phase 4: Electron shell" 4 interface "electron-vite + React + Tailwind + shadcn/ui. Operating Room layout."
mkissue "Phase 4: Local HTTP API server" 4 core "Fastify or Hono. SSE for live updates. Endpoints per docs."
mkissue "Phase 4: Portfolio Operating Room view" 4 interface "Client columns, project cards, capacity allocation."
mkissue "Phase 4: Live Operations Timeline" 4 interface "Horizontal timeline backed by SSE on audit log."
mkissue "Phase 4: Supreme Coordinator chat panel" 4 interface "Streaming chat with embedded artifact cards and quick actions."
mkissue "Phase 4: Pending Approvals panel" 4 interface "Approve/Reject. Full approvals page. Status footer."
mkissue "Phase 4: Revenue Pulse KPI strip" 4 interface "Pipeline value, expected margin, active opportunities, revenue MTD, CLV, top clients."
mkissue "Phase 4: Agent Layer footer strip" 4 interface "Role chips with hover and click-through."
mkissue "Phase 4: Adaptive modes Portfolio/Today/Goals" 4 interface "Adaptive header switching."
mkissue "Phase 4: Mobile responsive" 4 interface "Single column, chat default, horizontal KPI scroll."

# Phase 5
mkissue "Phase 5: Project Manager agent + memory scoping" 5 runtime "PM cannot see other projects private memory. Coordinator can summarize across projects."

# Phase 6
mkissue "Phase 6: Brand offer channel memory wiring + growth artifacts" 6 runtime "Wire BRAND, OFFERS, CHANNELS, LEADS, CAMPAIGNS, PRICING, PROPOSALS, CONVERSION_NOTES to growth agents."

# Phase 7
mkissue "Phase 7: Scheduler service" 7 daemon "Hourly/daily/weekly schedules."
mkissue "Phase 7: Threshold + memory + event triggers" 7 daemon "Stale PR, blocked issue, unanswered messages, empty pipeline."
mkissue "Phase 7: bureau daemon CLI" 7 cli "start/stop/status."

# Phase 8
mkissue "Phase 8: Development agent + Codex + scoped edits" 8 runtime "Branch creation, scoped edits, test runner."
mkissue "Phase 8: Reviewer + Security + QA on PRs" 8 runtime "Structured comment artifacts."

# Phase 9 Agents
for a in supreme-coordinator project-manager product ux development qa security reviewer release \
         visibility content social creative ads marketing conversion sales pricing proposal compliance client-success; do
  mkissue "Phase 9: ${a} agent implementation" 9 runtime "Implement role per docs/agents.md: responsibilities, inputs, outputs, memory scope, allowed capabilities, prompts, integration tests."
done

# Phase 10 Integrations
mkissue "Phase 10: Stripe integration" 10 capabilities "Read first. Writes approval-gated."
mkissue "Phase 10: Gmail integration" 10 capabilities "Draft only. Send approval-gated."
mkissue "Phase 10: Google Calendar integration" 10 capabilities "Read first. Create with approval."
mkissue "Phase 10: Google Drive integration" 10 capabilities "Read first."
mkissue "Phase 10: Slack integration" 10 capabilities "Read + draft. Post approval-gated."
mkissue "Phase 10: Supabase integration" 10 capabilities "Project-scoped credentials. Read first."
mkissue "Phase 10: Vercel integration" 10 capabilities "Read first. Deploys approval-gated."
mkissue "Phase 10: LinkedIn integration" 10 capabilities "Draft only. Publish approval-gated."
mkissue "Phase 10: X/Twitter integration" 10 capabilities "Draft only. Publish approval-gated."
mkissue "Phase 10: Ads platforms Meta/Google" 10 capabilities "Draft only. Launch, budget, billing all approval-gated."

# Cross-cutting docs
mkissue "Docs: CLI reference page" 0 docs "docs/cli.md."
mkissue "Docs: Provider configuration guide" 0 docs "docs/providers.md."
mkissue "Docs: Secrets handling guide" 0 docs "docs/secrets.md."
mkissue "Docs: Owner interface tour" 0 docs "Update docs/owner-interface.md after MVP ships."

echo "issues done"
