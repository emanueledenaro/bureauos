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

- [ ] Implement a `MemoryStore` interface in `packages/memory` (read, write, append, list, search).
- [ ] Implement a Markdown-backed `LocalMemoryStore` that reads/writes the `.bureauos/memory` tree.
- [ ] Implement `loadRootMemory()` and `assembleContextPacket(query)` per [docs/memory-model.md](docs/memory-model.md).
- [ ] Implement daily-note creation and append rules (one file per local date).
- [ ] Implement decision-record writes (`DECISIONS.md` and `runs/<id>.md` cross-link).
- [ ] Add SQLite-based keyword index over Markdown files (FTS5).
- [ ] Add a semantic index interface; ship a stub implementation that returns no matches (real embedding provider arrives with the provider router).
- [ ] Implement `bureau memory search "<query>"` CLI command.
- [ ] Add tests for write-back rules, isolation between project folders, and promotion of daily notes to durable files.

### 1.4 Registries

- [ ] Implement the Company registry (single record).
- [ ] Implement the Client registry (CRUD against `.bureauos/memory/clients/`).
- [ ] Implement the Project registry (CRUD against `.bureauos/memory/projects/`).
- [ ] Implement the Opportunity registry (`.bureauos/memory/opportunities/`).
- [ ] Implement the Agent registry (from config).
- [ ] Implement the Capability registry (from config).
- [ ] Implement the Approval registry (`.bureauos/approvals/pending/` + `resolved/`).
- [ ] Each registry exposes a stable string ID and an append-only event log entry on every change.
- [ ] Add tests for ID stability across renames.

### 1.5 Policy Engine

- [ ] Define the policy input/output contract from [docs/protocol.md](docs/protocol.md) `policy_check`.
- [ ] Implement an evaluator that takes (action, actor, target, capability, autonomy level, approval state, risk class) and returns allow / deny / require approval / require more context / escalate.
- [ ] Encode the default autonomy levels 0..5 from [docs/autonomy-policy.md](docs/autonomy-policy.md).
- [ ] Encode the separate growth-autonomy switches.
- [ ] Implement one-off and standing approvals (with expiry).
- [ ] Add a `bureau policy explain <action>` CLI command that prints why an action would be allowed or blocked.
- [ ] Add tests for every action listed in `growth_autonomy` and `require_owner_approval_for` in the example config.

### 1.6 Artifact Store

- [ ] Implement `writeArtifact(type, payload)` that writes a Markdown file under `.bureauos/memory/artifacts/<id>.md` using the matching template from `templates/`.
- [ ] Implement the `<!-- bureauos:artifact ... -->` marker convention end-to-end (write and parse).
- [ ] Implement `readArtifact(id)` and `listArtifacts({type, runId, clientId, projectId})`.
- [ ] Add cross-links from artifacts to their run report.
- [ ] Add tests covering each template type.

### 1.7 Audit Log

- [x] Implement an append-only JSONL audit log at `.bureauos/audit/audit.log`.
- [x] Event shape: timestamp, actor, action, target, capability, policy result, approval id, artifact id, result, error.
- [ ] Wire every kernel API call that produces a side effect to write one audit event (`workspace.init` is wired; the rest follow as registries/runs/policy land).
- [ ] Implement `bureau audit tail` and `bureau audit search` CLI commands.
- [ ] Add a tamper-evidence check: rotate the file daily and store a hash of the previous segment in the header of the next one.

### 1.8 Run Engine (local-only)

- [ ] Define the run lifecycle states from the protocol.
- [ ] Implement `Run` as an entity with persisted state in `.bureauos/memory/runs/<id>.md` plus a JSON sidecar for indexing.
- [ ] Implement `startRun({trigger, scope})` that runs through context build then policy check then dispatch stub then artifact write then report then memory update, but with no model calls yet. The dispatch step calls a stub agent that just records intent.
- [ ] Add a `bureau run new` CLI command.
- [ ] Add a `bureau status` CLI command that shows active runs, pending approvals, and high-level company pulse.
- [ ] Add tests for a full lifecycle of a single internal run.

### 1.9 Minimum Viable Kernel Acceptance

- [ ] `bureau init` creates a clean workspace.
- [ ] A client can be created via CLI.
- [ ] A project can be created via CLI and linked to the client.
- [ ] An opportunity can be created via CLI.
- [ ] A run can be started and produces an artifact and a run report.
- [ ] Policy allows, denies, or requires approval as configured.
- [ ] Audit log contains one entry per side effect.
- [ ] All of the above is covered by tests in CI.

## Phase 2 — Provider Router

Goal: real model calls behind a provider-agnostic interface. The router selects providers per agent role, with fallbacks and budget awareness.

- [ ] Define `ProviderAdapter` and `RuntimeAdapter` contracts in `packages/providers`.
- [ ] Implement an OpenAI text adapter.
- [ ] Implement an Anthropic text adapter.
- [ ] Implement a Google (Gemini) text adapter.
- [ ] Implement a local-model adapter (Ollama or compatible OpenAI-style endpoint).
- [ ] Implement an OpenRouter / gateway adapter.
- [ ] Implement a Codex runtime adapter (treat Codex as a capability, not a generic provider).
- [ ] Implement credentials loading from environment variables and a local secrets file (never in git).
- [ ] Implement `validateCredentials()` per adapter.
- [ ] Implement the router: default provider per agent + fallback chain + budget-aware routing + capability-aware routing.
- [ ] Implement a streaming interface that the coordinator chat panel will consume.
- [ ] Add a `bureau providers list` and `bureau providers test` CLI command.
- [ ] Add tests with recorded HTTP fixtures for each adapter.

## Phase 3 — GitHub Adapter (v0.4)

Goal: BureauOS can read and write GitHub state under policy.

- [ ] Implement a GitHub client wrapper using a personal access token (PAT) or GitHub App credentials.
- [ ] Implement issue read.
- [ ] Implement issue create from an artifact (uses the `agent-run.yml` template).
- [ ] Implement label management (idempotent ensure-labels for the taxonomy in [docs/github-native-workflow.md](docs/github-native-workflow.md)).
- [ ] Implement comment write with the `<!-- bureauos:artifact ... -->` marker.
- [ ] Implement PR read.
- [ ] Implement PR create (branch + commit + push + open PR).
- [ ] Implement check parsing (read checks and surface failures into the run engine).
- [ ] Implement webhook ingestion (signal generation from GitHub events).
- [ ] Add a `bureau github sync` CLI command that pulls authoritative state into the project registry.
- [ ] Add tests with `nock` or equivalent HTTP recording.

## Phase 4 — Owner Interface MVP (v0.3)

Goal: a local web app that visualizes kernel state, shaped like [docs/ui-reference/operating-room.md](docs/ui-reference/operating-room.md). Read-only first, then approvals, then chat.

### 4.1 Shell

- [ ] Choose the frontend stack (recommendation: Next.js + Tailwind + shadcn/ui). Record in an ADR.
- [ ] Create `packages/interface` with the chosen scaffold.
- [ ] Implement the page layout: left sidebar, center work area, right rail, bottom strips.
- [ ] Implement the adaptive header (logo, breadcrumb selector for Portfolio / Today / Goals, status pills, date, avatar).
- [ ] Implement the left sidebar navigation (Home, Revenue, Delivery, Growth, Clients, Risk, Memory, Agents, Inbox, Approvals, Reports, Settings).
- [ ] Implement the System Status card at the bottom of the sidebar.
- [ ] Implement a typed API client that talks to the kernel via a local HTTP server.

### 4.2 Local API Server

- [ ] Add a local HTTP server in `packages/core` (Fastify or Hono) that exposes the kernel surfaces listed in `docs/bos-kernel-infrastructure.md` (Owner Interface API).
- [ ] Endpoints: `/company-pulse`, `/clients`, `/projects`, `/opportunities`, `/approvals`, `/runs`, `/agents`, `/reports`, `/coordinator/messages`, `/settings`.
- [ ] Implement Server-Sent Events for live timeline and coordinator chat streaming.
- [ ] Add authentication for the local server (single-owner token; multi-user can come later).

### 4.3 Portfolio Operating Room

- [ ] Implement the Portfolio Map view: client columns with capacity percentages and stacked project cards.
- [ ] Implement the project card component: name, status pill, progress bar, PR link, agent chips.
- [ ] Implement the Capacity Allocation horizontal stacked bar.
- [ ] Implement the four tabs (Portfolio Map, Workload, Gantt, Kanban) with the first one functional and the others as placeholders that say "Coming next".
- [ ] Implement the Filters control (status, client, agent).
- [ ] Wire data from the project registry and run engine.

### 4.4 Live Operations Timeline

- [ ] Implement the horizontal timeline component.
- [ ] Wire events from the audit log via SSE.
- [ ] Implement event icons by event type and agent badge below each entry.
- [ ] Implement `View all activity` link to a full audit page.

### 4.5 Supreme Coordinator Panel

- [ ] Implement the chat surface (read-only first).
- [ ] Implement the embedded artifact card component (e.g. opportunity card).
- [ ] Implement quick-action chips below assistant messages.
- [ ] Wire the chat to the provider router via the local API once Phase 2 is live.
- [ ] Add the online indicator backed by a coordinator-health check.

### 4.6 Pending Approvals Panel

- [ ] Implement the approvals list component with title, subtitle, metadata, Approve/Reject buttons.
- [ ] Wire to the approval registry (read).
- [ ] Implement Approve and Reject (write).
- [ ] Implement the footer status line: "Autonomous mode is handling NN% of operations" (computed from the audit log).
- [ ] Add a full `/approvals` page with filters and history.

### 4.7 Revenue Pulse

- [ ] Implement the KPI strip layout.
- [ ] Implement each KPI card: value, sparkline, delta vs previous period.
- [ ] KPIs: Pipeline Value, Expected Margin, Active Opportunities, Revenue (MTD), Client Lifetime Value.
- [ ] Implement the Top Clients by LTV ranked list.
- [ ] Wire data from the opportunity registry and client revenue memory.
- [ ] Add a `View full report` page.

### 4.8 Agent Layer

- [ ] Implement the horizontal role-chip strip at the bottom of every page.
- [ ] One chip per agent role from `docs/agents.md`.
- [ ] Hover state shows the agent's current run and capability usage.
- [ ] Click opens an agent detail panel (read-only for MVP).
- [ ] Add a `Manage Agents` button that opens `/agents`.

### 4.9 Adaptive Modes

- [ ] Implement `Today` mode: surface only what needs action today (approvals, blockers, urgent risks).
- [ ] Implement `Goals` mode: company goals, OKRs, milestone progress.
- [ ] Implement the rule that decides which mode to default to based on kernel state.

### 4.10 Mobile Pass

- [ ] Collapse to single column.
- [ ] Coordinator chat becomes the default surface.
- [ ] Pending Approvals collapses into a bottom sheet.
- [ ] KPI strip becomes a horizontally scrollable row.
- [ ] Agent Layer collapses into a menu.

## Phase 5 — Project Teams (v0.5)

Goal: real multi-project support with isolated project memory and project-manager agents.

- [ ] Implement the project manager agent role end-to-end (config, memory scope, dispatch).
- [ ] Implement context-packet generation per agent (bounded context, not full memory).
- [ ] Implement project memory isolation (a PM cannot see another project's memory unless authorized).
- [ ] Implement the coordinator's global memory access path (with audit).
- [ ] Implement cross-project executive reports.
- [ ] Add tests proving isolation cannot be bypassed by accident.

## Phase 6 — Growth and Revenue (v0.6)

Goal: brand, offers, content, leads, pricing, proposals, conversion, client success — all with draft-first defaults.

- [ ] Wire brand memory, offer memory, channels memory.
- [ ] Implement the content pipeline (draft only).
- [ ] Implement the lead and opportunity pipeline.
- [ ] Implement campaign briefs and conversion audits as artifacts.
- [ ] Implement the pricing brief and proposal brief flows.
- [ ] Implement compliance reviews and approval records for any external commitment.
- [ ] Implement client account plans and client success status reports.
- [ ] Wire all of this into the Growth and Revenue tab of the interface.

## Phase 7 — Always-On Daemon (v0.7)

Goal: scheduler and event watchers so BureauOS works while the owner is offline.

- [ ] Implement a scheduler service that runs alongside the local API.
- [ ] Implement scheduled triggers from the example config (hourly project health, daily executive report, weekly growth review, weekly client account review).
- [ ] Implement threshold triggers (stale PR, blocked issue, unanswered client message, empty content pipeline).
- [ ] Implement memory triggers (follow-ups due).
- [ ] Implement event ingestion from the GitHub adapter.
- [ ] Implement signal classification.
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

- [ ] Supreme Executive Coordinator
- [ ] Project Manager
- [ ] Product
- [ ] UX/UI
- [ ] Development
- [ ] QA
- [ ] Security
- [ ] Reviewer
- [ ] Release

### Growth and revenue agents

- [ ] Visibility
- [ ] Content
- [ ] Social
- [ ] Creative
- [ ] Ads
- [ ] Marketing
- [ ] Conversion
- [ ] Sales
- [ ] Pricing
- [ ] Proposal
- [ ] Compliance
- [ ] Client Success

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
- [ ] Provider configuration guide under `docs/providers.md`.
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
