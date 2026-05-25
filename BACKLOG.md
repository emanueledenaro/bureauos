# BureauOS Backlog

This is the working backlog for building BureauOS from protocol to runtime.

It follows the roadmap in [docs/roadmap.md](docs/roadmap.md) and the build order in [docs/bos-kernel-infrastructure.md](docs/bos-kernel-infrastructure.md). The owner interface targets the design in [docs/ui-reference/operating-room.md](docs/ui-reference/operating-room.md).

Each task is intentionally small enough to land in one focused pull request. Tasks are checkboxes so the file doubles as a public progress tracker.

## How to use this backlog

- Pick the next unchecked task in the earliest open phase.
- Open a GitHub issue from the task (one issue per checkbox is fine; group only when truly trivial).
- Link the issue back here when convenient.
- Mark the box done only after the PR is merged.
- Do not start a later phase before the current one is healthy enough to support it. The kernel must exist before agents. Agents must exist before always-on. External actions are last.

## Conventions

- All runtime code lives under `packages/` (monorepo layout from the kernel spec).
- Docs stay in `docs/`. Templates in `templates/`. Examples in `examples/`.
- No external action is automated until a policy engine can gate it.
- No credentials in the repository.
- Every capability use writes an audit record.
- Markdown is the source of truth for memory; indexes only accelerate retrieval.

## Reference

- [Roadmap](docs/roadmap.md)
- [BOS Kernel Infrastructure](docs/bos-kernel-infrastructure.md)
- [Architecture](docs/architecture.md)
- [Protocol](docs/protocol.md)
- [Memory Model](docs/memory-model.md)
- [Autonomy Policy](docs/autonomy-policy.md)
- [Capabilities and Integrations](docs/capabilities-and-integrations.md)
- [Agent Roles](docs/agents.md)
- [Owner Interface](docs/owner-interface.md)
- [UI Reference: Operating Room](docs/ui-reference/operating-room.md)
- [Example Configuration](examples/bureauos.example.yaml)

---

## Phase 0 — Repository Foundations

Goal: make the repo ready for runtime code without changing the protocol intent.

- [x] Choose the runtime language and pin a toolchain. Recorded in [docs/decisions/0001-runtime-language.md](docs/decisions/0001-runtime-language.md).
- [x] Initialize the monorepo (pnpm workspaces) with `packages/` placeholders matching the kernel spec: `core`, `memory`, `providers`, `capabilities`, `cli`, `interface`.
- [x] Add a root `package.json` with workspace config and shared scripts (build, lint, test, typecheck).
- [x] Add TypeScript base config (`tsconfig.base.json`) and per-package extensions.
- [x] Add `.editorconfig` and `.nvmrc`.
- [x] Add Vitest as the test runner with passing tests for `@bureauos/core` and `@bureauos/cli`.
- [x] Add a GitHub Actions workflow `.github/workflows/ci.yml` that runs typecheck, build, test, and a smoke `bureau init`.
- [x] Add an ADR template under `docs/decisions/`.
- [ ] Add ESLint + Prettier config aligned with the repo's plain-Markdown style.
- [ ] Add a GitHub Actions workflow `.github/workflows/docs.yml` that fails if any internal Markdown link is broken.
- [ ] Add `CODEOWNERS` (even if empty for now) to wire review routing later.

## Phase 1 — BOS Kernel (v0.2)

Goal: a local-first kernel that can initialize a workspace, hold company state, evaluate policy, and write artifacts and audit records. No external action yet.

### 1.1 Config

- [x] Define the `bureauos.yaml` schema in `packages/core/src/config/schema.ts` using zod.
- [x] Implement `loadConfig(path)` that reads, validates, and returns a typed config.
- [x] Implement defaults so a minimal `bureauos.yaml` still loads.
- [x] Add tests for valid config, missing fields, type errors, and structurally invalid YAML.
- [ ] Add a `bureau config validate` CLI subcommand.
- [ ] Cover every field of `examples/bureauos.example.yaml` (currently the core fields; secondary sections like triggers, capabilities, business policies are TODO).

### 1.2 Workspace Initializer

- [x] Implement `bureau init` that creates the `.bureauos/` tree from `docs/bos-kernel-infrastructure.md`.
- [x] Generate a starter `bureauos.yaml` from a chosen preset (freelancer, agency, startup, operator).
- [x] Generate starter `ROOT.md`, `COMPANY.md`, `POLICIES.md`, plus empty sub-folders for clients, projects, runs, artifacts.
- [x] Generate the first executive report from a template.
- [x] Refuse to overwrite an existing workspace unless `--force` is passed.
- [x] Add tests covering each preset and the safe-overwrite behavior.

### 1.3 Memory Engine

- [x] Implement a `MemoryStore` interface in `packages/memory` (read, list, search).
- [x] Implement a Markdown-backed `LocalMemoryStore` that reads the `.bureauos/memory` tree.
- [x] Implement `assembleContextPacket(query)` returning ROOT + ranked hits.
- [x] Implement `bureau memory search "<query>"` CLI command.
- [ ] Implement daily-note creation and append rules (one file per local date).
- [ ] Implement decision-record writes (`DECISIONS.md` and `runs/<id>.md` cross-link).
- [ ] Add SQLite-based keyword index over Markdown files (FTS5).
- [ ] Add a semantic index interface; ship a stub implementation that returns no matches.
- [ ] Add tests for write-back rules and isolation between project folders.

### 1.4 Registries

- [x] Implement the Client registry (CRUD against `.bureauos/memory/clients/`).
- [x] Implement the Project registry (CRUD against `.bureauos/memory/projects/`).
- [x] Implement the Opportunity registry (`.bureauos/memory/opportunities/`).
- [x] Implement the Approval registry (`.bureauos/approvals/pending/` + `resolved/`).
- [x] Each registry exposes a stable string ID generated via `newId()`.
- [x] Audit events on every create/update via CLI.
- [ ] Implement the Company registry (single record).
- [ ] Implement the Agent registry from config.
- [ ] Implement the Capability registry from config.
- [ ] Add tests for ID stability across renames.

### 1.5 Policy Engine

- [x] Define the policy input/output contract from [docs/protocol.md](docs/protocol.md) `policy_check`.
- [x] Implement an evaluator that takes (action, actor, target, capability, risk class) and returns allow / deny / require approval / require more context / escalate.
- [x] Encode autonomy and growth_autonomy switches.
- [x] Implement one-off and standing approvals matching with expiry.
- [x] Add a `bureau policy explain <action>` CLI command.
- [x] Tests covering autonomy actions, growth actions, escalation, and approval matching.
- [ ] Encode the explicit autonomy levels 0..5 as named presets (current implementation uses per-action switches).

### 1.6 Artifact Store

- [x] Implement `writeArtifact(type, payload)` writing Markdown under `.bureauos/memory/artifacts/<id>.md`.
- [x] Implement the `<!-- bureauos:artifact ... -->` marker convention.
- [x] Implement `readArtifact(id)` and `listArtifacts({type, runId, clientId, projectId})`.
- [x] Cross-links from artifacts to their run report via `run_id` front-matter.
- [ ] Use the templates in `templates/` as artifact body scaffolds (current artifacts use inline bodies).
- [ ] Add tests covering every template type.

### 1.7 Audit Log

- [x] Implement an append-only JSONL audit log at `.bureauos/audit/audit.log`.
- [x] Event shape: timestamp, actor, action, target, capability, policy result, approval id, artifact id, result, error.
- [x] Wire audit events for client/project/opportunity create, every run.* transition, approval.*, workspace.init, agent.stub_execute.
- [x] Implement `bureau audit tail [-n N]` CLI command.
- [ ] Implement `bureau audit search <query>` CLI command.
- [ ] Add a tamper-evidence check: rotate the file daily and store a hash of the previous segment in the header of the next one.

### 1.8 Run Engine (local-only)

- [x] Define the run lifecycle states from the protocol.
- [x] Implement `Run` persisted in `.bureauos/memory/runs/<id>.md` with full front-matter.
- [x] Implement `startRun({trigger, scope})` end-to-end with policy check, dispatch stub, artifact write, audit events on every transition.
- [x] Add `bureau run new` CLI command.
- [x] Add `bureau status` CLI command.
- [x] Tests covering full lifecycle and policy-blocked run path.

### 1.9 Minimum Viable Kernel Acceptance

- [x] `bureau init` creates a clean workspace.
- [x] A client can be created via CLI.
- [x] A project can be created via CLI and linked to the client.
- [x] An opportunity can be created via CLI.
- [x] A run can be started and produces an artifact and a run report.
- [x] Policy allows, denies, or requires approval as configured.
- [x] Audit log contains one entry per side effect.
- [x] All of the above is covered by tests in CI (`mvk.e2e.test.ts`).

## Phase 2 — Provider Router

Goal: real model calls behind a provider-agnostic interface. The router selects providers per agent role, with fallbacks and budget awareness.

- [x] Define `ProviderAdapter` and `RuntimeAdapter` contracts in `packages/providers`.
- [x] Implement OpenAI/Anthropic/Google/Local/OpenRouter adapters with credential validation.
- [x] Implement Codex runtime adapter stub.
- [x] Implement env-based credential loading.
- [x] Implement the router with default + fallback chains.
- [x] Add a `bureau providers list` CLI command.
- [x] Add an OpenCode-style auth store and commands (`bureau auth login/list/logout`) for provider credentials.
- [x] Add provider connection management in ElectronJS Settings.
- [x] Wire real model calls (`generateText`, `stream`) for OpenAI, Anthropic, Google, OpenRouter, Local, and OpenAI Codex OAuth.
- [ ] Add budget-aware and capability-aware routing.
- [ ] Add OS keychain integration as an alternative credential source.
- [ ] Add tests with recorded HTTP fixtures for each adapter.

## Phase 3 — GitHub Adapter (v0.4)

Goal: BureauOS can read and write GitHub state under policy.

- [x] Define the `GitHubClient` contract in `@bureauos/capabilities`.
- [x] Ship a `StubGitHubClient` so the kernel and CLI can type-check against the contract.
- [x] Implement a real Octokit-backed client (`OctokitGitHubClient`).
- [x] Implement issue read/list/create.
- [x] Implement label management (`GITHUB_LABEL_TAXONOMY` + `ensureLabels`).
- [x] Implement comment write (`commentOnIssue`).
- [x] Implement PR read/list/create.
- [x] Add a `bureau github ensure-labels` CLI command.
- [x] Add a `bureau github sync` CLI command.
- [x] Generate GitHub-ready issue drafts from coordinator artifacts.
- [x] Add a `bureau github draft-issues` CLI command.
- [x] Add local API support for issue draft generation (`POST /github/issue-drafts`).
- [x] Surface issue draft generation in the ElectronJS project portfolio view.
- [x] Create real GitHub issues from approved draft artifacts under policy.
- [x] Add a `bureau github create-issues` CLI command.
- [x] Add local API support for policy-gated issue creation (`POST /github/create-issues`).
- [x] Surface GitHub issue creation in ElectronJS project cards when a repository is configured.
- [x] Implement check parsing and webhook ingestion.
- [ ] Add tests with `nock` or equivalent HTTP recording.

## Phase 4 — Owner Interface MVP (v0.3)

Goal: a local web app that visualizes kernel state, shaped like [docs/ui-reference/operating-room.md](docs/ui-reference/operating-room.md). Read-only first, then approvals, then chat.

### 4.1 Shell

- [x] Frontend stack decided in [ADR 0002](docs/decisions/0002-frontend-stack.md): Electron + React + Tailwind via electron-vite.
- [x] `packages/interface` scaffolded with main + preload + renderer.
- [x] Page layout: left sidebar, center work area, right rail, bottom strips.
- [x] Adaptive header with three status pills and date.
- [x] Left sidebar navigation with badges from kernel state.
- [x] System Status card at the bottom of the sidebar.
- [x] Typed API client in `src/renderer/lib/api.ts`.

### 4.2 Local API Server

- [x] Local HTTP server in `@bureauos/core` (node:http) exposing the kernel surfaces.
- [x] Endpoints: `/company-pulse`, `/clients`, `/projects`, `/project-ownership`, `/opportunities`, `/approvals`, `/approvals/resolved`, `/runs`, `/agents`, `/providers`, `/audit`, `/approvals/resolve`, `/reports`, `/health`.
- [x] Add `/clients/intelligence` for account-level value, delivery, relationship, and memory-path summaries.
- [x] CORS open for localhost during development.
- [x] Token-based auth path (set `token` in options to enable).
- [x] Implement Server-Sent Events for live timeline streaming.
- [x] Add `GET /coordinator/messages` so the ElectronJS Coordinator panel can reload durable chat history.
- [x] Add `POST /coordinator/messages` so chat can either answer from memory or route opportunity messages into intake.
- [x] Add `GET /coordinator/memory` so the Supreme Coordinator can expose an audited global-memory packet.
- [x] Add `GET /settings` with safe workspace configuration for the ElectronJS Settings page.
- [x] Add `POST /coordinator/intake` so the ElectronJS Coordinator panel can create client/project/opportunity work.
- [x] Add `POST /projects/dispatch` so Project Manager can create scoped packets and specialist handoffs.

### 4.3 Portfolio Operating Room

- [x] Portfolio Map view with client columns and project cards.
- [x] Project card component (name, status pill, progress bar, stack).
- [x] Capacity Allocation horizontal stacked bar.
- [x] Tabs strip rendered (Portfolio Map active, others as placeholders).
- [ ] Implement Workload, Gantt, Kanban tabs.
- [ ] Implement the Filters control (status, client, agent).
- [ ] Surface PR links and agent chips on each card once the GitHub adapter is wired.

### 4.4 Live Operations Timeline

- [x] Horizontal timeline component backed by the audit log.
- [ ] Switch from polling to SSE once the server exposes it.
- [ ] Event icons by event type.

### 4.5 Supreme Coordinator Panel

- [x] Chat surface connected to real coordinator intake.
- [x] Persist coordinator chat history in the workspace and reload it in ElectronJS.
- [x] Wire conversational memory to the provider router once a provider has credentials.
- [ ] Stream tokens via SSE.

### 4.6 Pending Approvals Panel

- [x] Approvals list with Approve / Reject.
- [x] Footer status line.
- [x] Add the full Approvals page with filters and history.

### 4.7 Revenue Pulse

- [x] KPI strip layout with 5 cards.
- [x] Wired to the opportunity registry through `/company-pulse`.
- [ ] Sparklines and delta vs previous period.
- [ ] Top Clients by LTV ranked list.

### 4.8 Agent Layer

- [x] Horizontal role-chip strip at the bottom.
- [x] One chip per role from `AGENT_ROLES`.
- [ ] Hover state with current run and capability usage.
- [ ] Click opens an agent detail panel.

### 4.9 Adaptive Modes

- [x] Implement `Today` mode: surface only what needs action today (approvals, blockers, urgent risks).
- [x] Implement `Goals` mode: company goals, OKRs, milestone progress.
- [x] Implement the rule that decides which mode to default to based on kernel state.

### 4.10 Mobile Pass

- [ ] Collapse to single column.
- [ ] Coordinator chat becomes the default surface.
- [ ] Pending Approvals collapses into a bottom sheet.
- [ ] KPI strip becomes a horizontally scrollable row.
- [ ] Agent Layer collapses into a menu.

### 4.11 Memory Page

- [x] Add an ElectronJS Memory page backed by the audited Supreme Coordinator global-memory packet.
- [x] Show root memory preview, ranked hits, relative paths, and the audit event for each memory search.
- [x] Keep memory search manual so dashboard polling does not generate repeated global-memory audit events.

## Phase 5 — Project Teams (v0.5)

Goal: real multi-project support with isolated project memory and project-manager agents.

- [x] Implement Project Manager dispatch with project-scoped memory packet.
- [x] Implement context-packet generation per agent (bounded context, not full memory).
- [x] Add per-project Project Manager configuration and ownership records.
- [x] Enforce project memory isolation at capability/runtime boundaries.
- [x] Implement the coordinator's global memory access path (with audit).
- [x] Implement cross-project executive reports.
- [x] Add tests proving isolation cannot be bypassed by accident.

## Phase 6 — Growth and Revenue (v0.6)

Goal: brand, offers, content, leads, pricing, proposals, conversion, client success — all with draft-first defaults.

- [x] Wire brand memory, offer memory, channels memory.
- [ ] Implement the content pipeline (draft only).
- [ ] Implement the lead and opportunity pipeline.
- [ ] Implement campaign briefs and conversion audits as artifacts.
- [ ] Implement the pricing brief and proposal brief flows.
- [ ] Implement compliance reviews and approval records for any external commitment.
- [ ] Implement client account plans and client success status reports.
- [x] Generate executive and business operating reports from real registries.
- [ ] Wire all of this into the Growth and Revenue tab of the interface. (brand/offers/channels memory is wired)

## Phase 7 — Always-On Daemon (v0.7)

Goal: scheduler and event watchers so BureauOS works while the owner is offline.

- [ ] Implement a scheduler service that runs alongside the local API.
- [x] Implement scheduled triggers for project health, daily executive report, growth review, and client account review.
- [x] Generate executive and business operating reports during the daily executive report job.
- [ ] Implement threshold triggers (stale PR, blocked issue, unanswered client message, empty content pipeline).
  - [x] GitHub failing check -> bug triage run.
  - [x] GitHub stale PR/issue -> health-check run.
  - [ ] Blocked issue threshold.
  - [ ] Unanswered client message threshold.
  - [ ] Empty content pipeline threshold.
- [ ] Implement memory triggers (follow-ups due).
- [x] Implement event ingestion from the GitHub adapter.
- [x] Implement signal classification for GitHub issue, PR, and check-run events.
- [ ] Implement bounded retries with policy escalation.
- [ ] Add a `bureau daemon` CLI subcommand (start, stop, status).
- [ ] Add tests for each trigger type.

## Phase 8 — PR Execution (v0.8)

Goal: a development agent can implement scoped work end to end under policy.

- [ ] Wire the Codex runtime adapter to the development agent.
- [ ] Implement branch creation per run.
- [ ] Implement scoped file edits with the policy `max_files_changed_without_human_review` enforced.
- [ ] Implement the test-command runner per project.
- [ ] Implement PR opening with the bureauos PR template.
- [ ] Wire the reviewer agent and security agent to comment with structured artifacts.
- [ ] Wire the QA agent to verify acceptance criteria.
- [ ] Keep merge and deploy disabled until explicit policy is configured.

## Phase 9 — Agent Roster (v1.0)

Goal: every agent role from `docs/agents.md` has a working implementation with the right memory scope and capabilities.

Each task below means "implement the role as a typed agent, with its memory scope, allowed capabilities, prompts, and integration tests".

### Delivery agents

Each role exists as an `AgentRuntime` and is reachable through `buildDefaultAgentRegistry()`.
Roles marked with [x] have a concrete stub that writes the role's signature artifact; full
LLM-driven prompts arrive when the provider router is wired end to end.

- [x] Supreme Executive Coordinator
- [x] Project Manager
- [x] Product
- [x] UX/UI
- [x] Development
- [x] QA
- [x] Security
- [x] Reviewer
- [x] Release

### Growth and revenue agents

- [x] Visibility
- [x] Content
- [x] Social
- [x] Creative
- [x] Ads
- [x] Marketing
- [x] Conversion
- [x] Sales
- [x] Pricing
- [x] Proposal
- [x] Compliance
- [x] Client Success

## Phase 10 — External Integrations (v1.0+)

Goal: connect BureauOS to the systems where the business actually happens. Each integration ships behind policy gates and is off by default.

- [ ] Stripe (read first; no billing writes until explicit policy).
- [ ] Gmail (draft only; send is approval-gated).
- [ ] Google Calendar (read first; create with approval).
- [ ] Google Drive (read first).
- [ ] Slack (read + draft; post is approval-gated).
- [ ] Supabase (project-scoped credentials; read first).
- [ ] Vercel (read first; deploys are approval-gated and per-environment).
- [ ] LinkedIn (draft only; publish is approval-gated and one-off by default).
- [ ] X / Twitter (draft only; publish is approval-gated and one-off by default).
- [ ] Ads platforms (Meta, Google Ads) — draft campaigns only; launch, budget changes, and billing changes are all approval-gated.

## Cross-Cutting Concerns

### Testing

- [ ] Vitest setup per package with shared config.
- [ ] Contract tests for every kernel API.
- [ ] Property tests for the policy engine.
- [ ] End-to-end tests for `bureau init` then `bureau run` then `bureau status` then `bureau audit`.
- [ ] Visual regression tests for the interface MVP (Playwright or equivalent).

### Documentation

- [ ] Quickstart in `README.md` linking to `bureau init`.
- [ ] CLI reference page under `docs/cli.md`.
- [x] Provider configuration guide under `docs/providers.md`.
- [ ] Owner interface tour under `docs/owner-interface.md` once the MVP ships.
- [ ] Troubleshooting page.

### Security

- [ ] Secrets handling document under `docs/secrets.md`.
- [ ] Audit log integrity test (segment hashing).
- [ ] Credential rotation guide.
- [ ] Threat model for the local daemon.

### Observability

- [ ] Structured logging across packages.
- [ ] Run metrics (counts, durations, failure rates) exposed via the local API.
- [ ] Optional OpenTelemetry exporter behind a flag.

## Open Questions

Items that need a decision before the related task can start. Open an issue per question and link it here.

- [ ] Should the local interface be a Next.js app or a Vite + React app? Tradeoff: SSR + routing maturity vs simpler local-only deployment.
- [ ] Should the daemon and the interface API be one process or two?
- [ ] Where should provider credentials live by default — OS keychain or a gitignored file? Both?
- [ ] How should we expose the kernel to remote IDE/agent runtimes later (gRPC, HTTP, MCP server)?
- [ ] Do we publish a `bureau` binary via npm only, or also via Homebrew / Scoop / WinGet?

## Out of Scope (for now)

To keep the scope honest, the following are explicitly **not** in the current backlog:

- Hosted multi-tenant SaaS.
- Automatic production deployments.
- Automatic merging of pull requests.
- Automatic ad campaign launches or budget changes.
- Automatic client-facing communication.
- Cross-organization memory sharing.
- A marketplace of third-party agents.

These can be revisited once v1.0 is stable.
