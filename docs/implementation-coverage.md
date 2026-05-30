# Implementation Coverage

This file maps the BureauOS documentation to runtime functionality.

The release readiness source of truth is
[`docs/v1-acceptance-checklist.md`](./v1-acceptance-checklist.md). Use this
coverage file for capability status detail, and use the v1 checklist to decide
whether a capability is required, deferred, or v1+.

Every major capability described in the docs must become one of:

- kernel module
- CLI command
- ElectronJS surface
- local API endpoint
- artifact template
- policy gate
- scheduled daemon behavior
- connector/capability adapter
- verified test

## Coverage States

- `implemented`: code exists and is tested.
- `partial`: code exists, but the behavior is not complete yet.
- `designed`: documented but not implemented.
- `blocked`: requires external credentials, platform access, or owner policy.

## Core Company OS

| Documented capability | Runtime surface | Status |
| --- | --- | --- |
| Supreme Coordinator as only owner-facing agent | `CoordinatorIntakeService`, `CoordinatorChatService`, `CoordinatorGlobalMemoryService`, ElectronJS Coordinator panel, `bureau intake`, `POST /coordinator/intake`, `GET/POST /coordinator/messages`, `GET /coordinator/memory` | partial |
| Company memory | `.bureauos/memory/COMPANY.md`, `ROOT.md`, daily notes, decisions | partial |
| Client memory | `ClientRegistry`, per-client memory files | implemented |
| Client account intelligence | `ClientIntelligenceService`, value score/classification, `/clients/intelligence`, `bureau client intelligence`, ElectronJS Clients page | implemented |
| Project memory | `ProjectRegistry`, per-project memory files | implemented |
| Memory keyword search | `LocalMemoryStore.search`, SQLite FTS5 accelerator with scan fallback, configured `search_index` path, `bureau memory search`, `bureau memory index status\|rebuild` | implemented |
| Semantic memory index | `LocalLexicalSemanticMemoryIndex` (offline TF-IDF over markdown) + `NoopSemanticMemoryIndex` fallback, `createSemanticMemoryIndex` factory, `memory.semantic_index.provider: none\|local\|custom` | partial |
| Memory browser | `MemoryBrowserService` routed through `LocalMemoryStore.search` (FTS5) and the config semantic index, `GET /memory/browser` | implemented |
| Run decision records | `RunEngine` auto-appends `DECISIONS.md` records on completion via `recordDecision` (honors `memory.write_decision_records`), cross-linked to runs and client/project decision logs | implemented |
| Opportunity pipeline | `OpportunityRegistry`, `RevenuePipelineService`, revenue pulse, `revenue-pipeline-report` | partial |
| Run lifecycle | `RunEngine`, injected coordinator dispatcher, `bureau run new --stub` | partial |
| Artifact store | `ArtifactStore` | partial |
| Audit log | `AuditLog`, `/audit`, SSE events | implemented |
| Approval gates | `ApprovalRegistry`, `PolicyEngine`, ElectronJS approvals | partial |

## Owner Intake

| Documented capability | Runtime surface | Status |
| --- | --- | --- |
| Owner describes a client opportunity in natural language | ElectronJS Coordinator panel, `bureau intake` | implemented |
| Create/update client | `CoordinatorIntakeService` | implemented |
| Create opportunity | `CoordinatorIntakeService` | implemented |
| Create project | `CoordinatorIntakeService` | implemented |
| Create project memory | `ProjectRegistry` | implemented |
| Prepare proposal and pricing drafts | `proposal-brief`, `pricing-brief` artifacts | implemented |
| Prepare repository plan | `repository-provisioning-plan` artifact | implemented |
| Prepare compliance review | `compliance-review` artifact | implemented |
| Create owner approval gates | `ApprovalRegistry` | implemented |
| Draft growth assets safely | `social-post-brief`, `ad-campaign-brief` artifacts | implemented |

## ElectronJS Operating Room

| Documented capability | Runtime surface | Status |
| --- | --- | --- |
| ElectronJS desktop app | `@bureauos/interface` | partial |
| Portfolio view | React renderer | partial |
| Clients view | `ClientIntelligenceService` backed account cards with pipeline, won value, delivery risk, follow-ups, and memory paths | implemented |
| Today view | React renderer action queue from approvals, blocked projects, problematic runs, client follow-ups, stalled opportunities, provider status, and growth memory readiness | implemented |
| Goals view | React renderer OKR board derived from revenue, delivery, client success, growth, autonomy, and execution registries | implemented |
| Revenue pulse | React renderer + `/company-pulse` | partial |
| Live operations timeline | SSE `/events` + audit log | implemented |
| Supreme Coordinator chat | React renderer + `/coordinator/messages`, workspace-backed chat history, memory packet assembly, provider-router-backed answer path with deterministic local fallback | partial |
| Memory view | React renderer + `GET /coordinator/memory`, audited global-memory packet, query hits, root memory preview, and relative memory paths | implemented |
| Approvals panel and page | React renderer + `/approvals`, `/approvals/resolved`, `/approvals/resolve`, pending rail, filtered history page | implemented |
| Reports generation | `BusinessReportService`, `bureau report generate`, `/reports/generate` | implemented |
| Cross-project executive reports | `cross-project-executive-report` artifact from project, ownership, approval, run, and pipeline registries | implemented |
| Reports view | report action in Revenue Pulse, `/reports` endpoint including executive, cross-project, operating, revenue pipeline, and client reports | partial |
| Settings view | provider settings panel plus safe `/settings` workspace configuration summary | partial |
| Native tray, notifications, auto-start | not implemented | designed |

## Agent Organization

| Documented capability | Runtime surface | Status |
| --- | --- | --- |
| Agent role catalog | `AGENT_ROLES` | implemented |
| PM agent per project | concrete PM agent with provider-backed drafting, per-project `OWNERSHIP.md`, and deterministic local template when selected route is unavailable | partial |
| Delivery agents | concrete/template agents with provider-backed drafting, deterministic local template fallback, Reviewer/QA/Security agents that enrich their narrative via the provider while keeping their deterministic structured gate authoritative, and Development Agent runtime execution when Codex runtime plus capability checker are supplied | partial |
| Growth agents | template agents with provider-backed drafting and deterministic local template when selected route is unavailable | partial |
| Compliance agent | concrete compliance agent with provider-backed drafting and deterministic local template when selected route is unavailable | partial |
| Agent provider routing | `ProviderRouter`, `configureAgentProviderRouting`, dispatcher model capability, per-model capability metadata, budget-tier filtering, and no API fallback from `openai-codex` OAuth | implemented |
| Codex runtime capability | capability registry boundary, `CapabilityUseService`, `CodexRuntimeAdapter` prepare/execute contract with injected runner, `capabilities check`, `/capabilities/check`, gate/audit artifacts before runtime execution, changed-file limit evidence for runtime-reported diffs | partial |
| MCP capability bus | `CapabilityRegistry`, config parsing, `/capabilities`, `/capabilities/check`, `bureau capabilities list/check`, Electron Agents capability matrix, `capability-audit` artifacts | partial |

## Growth and Revenue

| Documented capability | Runtime surface | Status |
| --- | --- | --- |
| Brand memory | `GrowthMemoryService`, `BRAND.md`, `/growth/memory`, `bureau growth memory`, Electron Growth tab | implemented |
| Offer memory | `GrowthMemoryService`, `OFFERS.md`, `/growth/memory`, `bureau growth memory`, Electron Growth tab | implemented |
| Channel memory | `GrowthMemoryService`, `CHANNELS.md`, `/growth/memory`, `bureau growth memory`, Electron Growth tab | implemented |
| Content drafts | `GrowthContentPipelineService`, `content-pipeline-report`, `bureau growth content`, `/growth/content-pipeline/generate`, Electron Growth action | implemented |
| Social drafts | `social-post-brief` artifact from intake and content pipeline | implemented |
| Ad campaign drafts | `ad-campaign-brief` artifact from intake and content pipeline | partial |
| Lead and opportunity pipeline | `RevenuePipelineService`, `revenue-pipeline-report`, `lead-qualification-report`, `bureau revenue pipeline`, `/revenue/pipeline/generate`, Electron Revenue action | partial |
| Proposal drafts | `proposal-brief` artifact from intake and revenue pipeline | partial |
| Pricing drafts | `pricing-brief` artifact from intake and revenue pipeline | partial |
| Conversion audits | `conversion-audit` artifact from revenue pipeline when qualification is missing or pipeline is empty | partial |
| Client account plans | `ClientAccountPlanService`, `client-account-plan` artifact from real client intelligence, `bureau client account-plan`, `/client-account-plans/generate` | implemented |
| Client success status reports | `ClientSuccessStatusService`, `client-success-status-report` artifact with approval-gated draft follow-up, `bureau client success-status`, `/client-success-status/generate` | implemented |
| Paid ads launch | policy-gated, not automated | blocked |
| Public posting | policy-gated, not automated | blocked |

## Always-On Autonomy

| Documented capability | Runtime surface | Status |
| --- | --- | --- |
| Scheduler | `Scheduler`, `bureau daemon run`, `bureau daemon start`, `bureau daemon stop`, `bureau daemon status`, workspace-local daemon status JSON | partial |
| Daily executive report | scheduler + `BusinessReportService` | partial |
| Project health checks | `ProjectHealthReviewService`, `project-health-report` artifact, scheduler attachment, `bureau project health`, `/project-health/generate` | partial |
| Project repository verification | `ProjectRepositoryVerificationService`, `repository-verification-report`, `bureau project verify-repositories`, `/project-repositories/verify`, scheduler linked-repository verification | partial |
| Growth review | `GrowthReviewService`, `growth-review` artifact, scheduler attachment, `bureau growth review`, `/growth/review/generate` | partial |
| Client account review | scheduler creates account review runs and real client-account-plan artifacts from client intelligence | partial |
| Threshold triggers | `GitHubSignalTriggerService` and `OperationalSignalTriggerService` start idempotent runs from failing/stale GitHub work, blocked internal work, unanswered client messages, and empty content pipeline signals; internal signals now attach `project-health-report`, `client-account-plan`, or `content-pipeline-report` artifacts before specialist dispatch | implemented |
| Memory triggers | `MemoryTriggerService`, `memory_due` client-success runs from due `next_follow_up_at` client memory, `client-success-status-report` artifacts, `bureau autonomy memory-scan`, `/autonomy/memory-triggers/scan`, scheduler memory scan | implemented |
| Bounded retry system | `AutonomousRetryService`, `autonomy-retry-report`, `bureau autonomy retry-scan`, `/autonomy/retries/scan`, scheduler retry scan, max attempts from `limits.max_retries_per_task` | partial |
| Failing check detection | `GitHubSignalSyncService`, `GitHubWebhookIngestionService`, `github sync`, `/github/webhook`, `github-signal-report` | partial |
| Stale PR/issue detection | `GitHubSignalSyncService`, `github sync --stale-days` | partial |

## External Integrations

| Documented capability | Runtime surface | Status |
| --- | --- | --- |
| GitHub labels | `github ensure-labels` | implemented |
| GitHub issue/PR/check sync | `github sync`, `/github/webhook`, daemon project-repo polling through repository verification, `github-signal-report` artifacts, audit signals, threshold-triggered runs, Electron timeline signal cards | partial |
| GitHub repository provisioning | `GitHubRepositoryProvisionService`, `github provision-repo`, `/github/provision-repository`, `repository-provisioning-report`, private-by-default visibility gate | partial |
| GitHub issue draft generation | `github draft-issues`, `/github/issue-drafts`, Electron project cards | implemented |
| GitHub issue creation from drafts | `github create-issues`, `/github/create-issues`, Electron project cards | implemented |
| GitHub PR creation | `GitHubPullRequestPublishService`, `github create-pr`, `/github/create-pr`, `github-pr-publish-report`, policy gates for linked issue and test evidence | partial |
| Development branch creation | `DevelopmentBranchService`, deterministic `bureauos/...` branch naming, policy-gated `create_branches`, conflict fallback/blocking, and audit events | partial |
| Project test evidence | `ProjectTestRunnerService`, structured/discovered test commands, subprocess execution boundary, `test-evidence-report` artifacts, and PR gate evidence only for passing tests | partial |
| Linear work-item MCP | `linear` capability registry boundary, `CapabilityUseService` policy mappings for read/create/comment/update issue actions, `LinearIssueReaderService` adapter boundary for capability-gated read/list flows, and `LinearIssueActionService` for policy-gated comment/update/state actions with local evidence artifacts; runtime MCP calls are provided by the host assistant/client | partial |
| Linear issue ingestion | `LinearIssueIngestionService`, `linearIssueToRunScope`, `project-dispatch-packet` artifacts, and Linear read capability checks | implemented |
| OpenAI Codex OAuth provider | separate `openai-codex` provider, browser PKCE OAuth, ChatGPT Codex backend `generateText`/SSE `stream`, persisted token refresh, Codex-compatible `instructions`/`store=false` request body, no API fallback | implemented |
| OpenAI API provider | separate `openai` provider, SDK-backed API-key adapter with `generateText`/`stream` | implemented |
| Anthropic provider | SDK-backed API-key adapter with `generateText`/`stream` | implemented |
| Google provider | Gemini REST adapter with `generateText`/SSE `stream` | implemented |
| OpenRouter provider | OpenAI-compatible adapter with model listing, `generateText`, and SSE `stream` | implemented |
| Local provider | OpenAI-compatible local/Ollama adapter with model listing, `generateText`, and SSE `stream` | implemented |
| Provider connector catalog | `listProviderConnectors`, OpenCode-style `provider` config overrides, `enabled_providers`/`disabled_providers`, `/provider/connectors`, `/provider/models`, catalog-backed auth methods, model defaults/lists, model capability/budget metadata, and env mappings | implemented |
| Provider auth/connect | `ProviderAuthStore`, auth modes, OpenCode-style `/provider/auth` and OAuth authorize/callback endpoints, `.bureauos/auth/providers.json` | implemented |
| Electron provider settings | Settings mode, safe workspace configuration summary, connector catalog selector, model picker, browser OAuth for `openai-codex`, explicit API-key/local endpoint connect for API providers | implemented |
| Gmail/Slack/Drive/Calendar | not implemented | designed |
| Supabase/Stripe/Vercel | not implemented | designed |
| Ads platforms | draft-only policy, no adapter | designed |

## Project Teams

| Documented capability | Runtime surface | Status |
| --- | --- | --- |
| Project Manager dispatch | `project dispatch`, `/projects/dispatch`, Electron project cards, ownership-aware run creator | implemented |
| Project-scoped memory packet | `project-dispatch-packet` artifact | implemented |
| Per-agent handoff packet | `agent-handoff` artifact | implemented |
| Runtime-enforced memory isolation | `MemoryBoundaryService`, `ScopedMemoryStore`, dispatcher `memory` capability | implemented |
| Supreme Coordinator global memory access | `CoordinatorGlobalMemoryService`, `GET /coordinator/memory`, audited `memory.global.search` events, relative memory paths | implemented |
| Per-project PM ownership config | `ProjectRegistry` creates/repairs `OWNERSHIP.md`, `GET /project-ownership`, CLI project create/list/dispatch PM visibility, Electron portfolio PM chips | implemented |
| Cross-project executive report | `BusinessReportService` portfolio matrix with PM, risk, approvals, active runs, and next action per project | implemented |

## Current Priority Order

1. Add ElectronJS pages for clients, projects, approvals, reports, memory, settings.
2. Expand always-on scheduler execution from review artifacts into retry loops and repository verification.
3. Add connector adapters behind draft-first policy gates.
4. Wire Codex runtime execution for development/reviewer/QA under policy.
5. Add OS notifications/tray/autostart for long-running daemon mode.
