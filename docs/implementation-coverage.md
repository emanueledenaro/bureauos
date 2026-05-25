# Implementation Coverage

This file maps the BureauOS documentation to runtime functionality.

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
| Client account intelligence | `ClientIntelligenceService`, `/clients/intelligence`, `bureau client intelligence`, ElectronJS Clients page | implemented |
| Project memory | `ProjectRegistry`, per-project memory files | implemented |
| Opportunity pipeline | `OpportunityRegistry`, revenue pulse | partial |
| Run lifecycle | `RunEngine` | partial |
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
| Today view | React renderer | partial |
| Goals view | React renderer | partial |
| Revenue pulse | React renderer + `/company-pulse` | partial |
| Live operations timeline | SSE `/events` + audit log | implemented |
| Supreme Coordinator chat | React renderer + `/coordinator/messages`, workspace-backed chat history, memory packet assembly, provider-router-backed answer path with deterministic local fallback | partial |
| Memory view | React renderer + `GET /coordinator/memory`, audited global-memory packet, query hits, root memory preview, and relative memory paths | implemented |
| Approvals panel and page | React renderer + `/approvals`, `/approvals/resolved`, `/approvals/resolve`, pending rail, filtered history page | implemented |
| Reports generation | `BusinessReportService`, `bureau report generate`, `/reports/generate` | implemented |
| Cross-project executive reports | `cross-project-executive-report` artifact from project, ownership, approval, run, and pipeline registries | implemented |
| Reports view | report action in Revenue Pulse, `/reports` endpoint including executive, cross-project, operating, and client reports | partial |
| Settings view | provider settings panel plus safe `/settings` workspace configuration summary | partial |
| Native tray, notifications, auto-start | not implemented | designed |

## Agent Organization

| Documented capability | Runtime surface | Status |
| --- | --- | --- |
| Agent role catalog | `AGENT_ROLES` | implemented |
| PM agent per project | concrete PM agent with provider-backed drafting, per-project `OWNERSHIP.md`, and deterministic local template when selected route is unavailable | partial |
| Delivery agents | concrete/template agents with provider-backed drafting and deterministic local template when selected route is unavailable | partial |
| Growth agents | template agents with provider-backed drafting and deterministic local template when selected route is unavailable | partial |
| Compliance agent | concrete compliance agent with provider-backed drafting and deterministic local template when selected route is unavailable | partial |
| Agent provider routing | `ProviderRouter`, `configureAgentProviderRouting`, dispatcher model capability | implemented |
| Codex runtime capability | capability registry boundary plus adapter placeholder | partial |
| MCP capability bus | `CapabilityRegistry`, config parsing, `/capabilities`, `bureau capabilities list`, Electron Agents capability matrix | partial |

## Growth and Revenue

| Documented capability | Runtime surface | Status |
| --- | --- | --- |
| Brand memory | `GrowthMemoryService`, `BRAND.md`, `/growth/memory`, `bureau growth memory`, Electron Growth tab | implemented |
| Offer memory | `GrowthMemoryService`, `OFFERS.md`, `/growth/memory`, `bureau growth memory`, Electron Growth tab | implemented |
| Channel memory | `GrowthMemoryService`, `CHANNELS.md`, `/growth/memory`, `bureau growth memory`, Electron Growth tab | implemented |
| Content drafts | artifacts | partial |
| Social drafts | `social-post-brief` artifact | partial |
| Ad campaign drafts | `ad-campaign-brief` artifact | partial |
| Proposal drafts | `proposal-brief` artifact | partial |
| Pricing drafts | `pricing-brief` artifact | partial |
| Conversion audits | artifact type exists | designed |
| Client account plans | `client-account-plan` artifact | partial |
| Paid ads launch | policy-gated, not automated | blocked |
| Public posting | policy-gated, not automated | blocked |

## Always-On Autonomy

| Documented capability | Runtime surface | Status |
| --- | --- | --- |
| Scheduler | `Scheduler` | partial |
| Daily executive report | scheduler + `BusinessReportService` | partial |
| Project health checks | scheduler/run stubs | partial |
| Growth review | scheduler/run stubs | partial |
| Client account review | scheduler/run stubs | partial |
| Threshold triggers | `GitHubSignalTriggerService` and `OperationalSignalTriggerService` start idempotent runs from failing/stale GitHub work, blocked internal work, unanswered client messages, and empty content pipeline signals | partial |
| Failing check detection | `GitHubSignalSyncService`, `GitHubWebhookIngestionService`, `github sync`, `/github/webhook`, `github-signal-report` | partial |
| Stale PR/issue detection | `GitHubSignalSyncService`, `github sync --stale-days` | partial |

## External Integrations

| Documented capability | Runtime surface | Status |
| --- | --- | --- |
| GitHub labels | `github ensure-labels` | implemented |
| GitHub issue/PR/check sync | `github sync`, `/github/webhook`, daemon project-repo polling, `github-signal-report` artifacts, audit signals, threshold-triggered runs, Electron timeline signal cards | partial |
| GitHub issue draft generation | `github draft-issues`, `/github/issue-drafts`, Electron project cards | implemented |
| GitHub issue creation from drafts | `github create-issues`, `/github/create-issues`, Electron project cards | implemented |
| GitHub PR creation | not implemented | designed |
| OpenAI Codex OAuth provider | separate `openai-codex` provider, browser PKCE OAuth, ChatGPT Codex backend `generateText`/SSE `stream`, persisted token refresh, no API fallback | partial |
| OpenAI API provider | separate `openai` provider, SDK-backed API-key adapter with `generateText`/`stream` | implemented |
| Anthropic provider | SDK-backed API-key adapter with `generateText`/`stream` | implemented |
| Google provider | Gemini REST adapter with `generateText`/SSE `stream` | implemented |
| OpenRouter provider | OpenAI-compatible adapter with model listing, `generateText`, and SSE `stream` | implemented |
| Local provider | OpenAI-compatible local/Ollama adapter with model listing, `generateText`, and SSE `stream` | implemented |
| Provider connector catalog | `listProviderConnectors`, OpenCode-style `provider` config overrides, `enabled_providers`/`disabled_providers`, `/provider/connectors`, `/provider/models`, catalog-backed auth methods, model defaults/lists, and env mappings | implemented |
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
2. Expand always-on scheduler execution beyond run stubs into deeper verification/retry loops.
3. Add budget-aware and capability-aware routing.
4. Add connector adapters behind draft-first policy gates.
5. Wire Codex runtime execution for development/reviewer/QA under policy.
6. Add OS notifications/tray/autostart for long-running daemon mode.
