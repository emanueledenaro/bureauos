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
| Supreme Coordinator as only owner-facing agent | `CoordinatorIntakeService`, ElectronJS Coordinator panel, `bureau intake`, `POST /coordinator/intake` | partial |
| Company memory | `.bureauos/memory/COMPANY.md`, `ROOT.md`, daily notes, decisions | partial |
| Client memory | `ClientRegistry`, per-client memory files | implemented |
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
| Today view | React renderer | partial |
| Goals view | React renderer | partial |
| Revenue pulse | React renderer + `/company-pulse` | partial |
| Live operations timeline | SSE `/events` + audit log | implemented |
| Supreme Coordinator chat | React renderer + `/coordinator/intake` | partial |
| Approvals panel | React renderer + `/approvals/resolve` | partial |
| Reports generation | `BusinessReportService`, `bureau report generate`, `/reports/generate` | implemented |
| Reports view | report action in Revenue Pulse, `/reports` endpoint | partial |
| Settings view | not implemented | designed |
| Native tray, notifications, auto-start | not implemented | designed |

## Agent Organization

| Documented capability | Runtime surface | Status |
| --- | --- | --- |
| Agent role catalog | `AGENT_ROLES` | implemented |
| PM agent per project | concrete PM stub | partial |
| Delivery agents | concrete/stub agents | partial |
| Growth agents | template agents | partial |
| Compliance agent | concrete compliance stub | partial |
| Agent provider routing | provider router | partial |
| Codex runtime capability | adapter placeholder | designed |
| MCP capability bus | config/capability model | designed |

## Growth and Revenue

| Documented capability | Runtime surface | Status |
| --- | --- | --- |
| Brand memory | memory files | designed |
| Offer memory | memory files | designed |
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
| Threshold triggers | not implemented | designed |
| Failing check detection | GitHub adapter foundation | designed |
| Stale PR/issue detection | GitHub adapter foundation | designed |

## External Integrations

| Documented capability | Runtime surface | Status |
| --- | --- | --- |
| GitHub labels | `github ensure-labels` | implemented |
| GitHub issue sync | `github sync` | partial |
| GitHub issue draft generation | `github draft-issues`, `/github/issue-drafts`, Electron project cards | implemented |
| GitHub issue creation from drafts | `github create-issues`, `/github/create-issues`, Electron project cards | implemented |
| GitHub PR creation | not implemented | designed |
| OpenAI provider | provider adapter | partial |
| Anthropic provider | provider adapter | partial |
| Google provider | provider adapter | partial |
| OpenRouter provider | provider adapter | partial |
| Local provider | provider adapter | partial |
| Gmail/Slack/Drive/Calendar | not implemented | designed |
| Supabase/Stripe/Vercel | not implemented | designed |
| Ads platforms | draft-only policy, no adapter | designed |

## Project Teams

| Documented capability | Runtime surface | Status |
| --- | --- | --- |
| Project Manager dispatch | `project dispatch`, `/projects/dispatch`, Electron project cards | implemented |
| Project-scoped memory packet | `project-dispatch-packet` artifact | implemented |
| Per-agent handoff packet | `agent-handoff` artifact | implemented |
| Runtime-enforced memory isolation | `MemoryBoundaryService`, `ScopedMemoryStore`, dispatcher `memory` capability | implemented |
| Per-project PM ownership config | not implemented | designed |

## Current Priority Order

1. Add OpenCode-style provider auth/connect flows for CLI and ElectronJS Settings.
2. Wire the provider router into concrete agents with role-specific defaults.
3. Add GitHub check parsing and webhook ingestion.
4. Add ElectronJS pages for clients, projects, approvals, reports, memory, settings.
5. Add always-on scheduler tasks for daily report, project health, growth review, and client review.
6. Add budget-aware and capability-aware routing.
7. Add connector adapters behind draft-first policy gates.
