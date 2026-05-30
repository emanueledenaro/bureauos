# BureauOS v1 Acceptance Checklist

This checklist is the source of truth for deciding when BureauOS is ready to be
called v1. It separates what must be true for v1 from what is intentionally
deferred and what belongs to v1+.

BureauOS v1 means the local-first agency operating system can safely intake
work, maintain structured memory, enforce policy, dispatch specialist agents,
prepare policy-bounded GitHub pull request work, show owner state in the
ElectronJS Operating Room, and produce auditable evidence. It does not mean
unbounded business automation, production deployment, client contact, paid ads,
or automatic merge behavior.

## Status Legend

- `implemented`: code exists and is covered by automated tests or manual smoke
  evidence.
- `partial`: code exists, but the end-to-end behavior is incomplete or depends
  on a host/runtime integration.
- `designed`: the behavior is documented but not implemented.
- `blocked`: the behavior requires credentials, platform access, packaging
  decisions, or owner policy before it can be verified.

## Release Rule

BureauOS can be tagged v1 only when every required item is either:

- `implemented`, with evidence listed in the release checklist, or
- explicitly accepted as `partial` because the missing piece is a host-provided
  runtime, credential, or owner policy that is documented and safe by default.

No required item may remain `designed` or `blocked` without a documented release
exception.

## Required For v1

| Area | v1 acceptance requirement | Current state | Evidence surface |
| --- | --- | --- | --- |
| Kernel initialization | `bureau init` creates a usable local workspace with config, memory, approvals, artifacts, audit, and first report without external calls. | implemented | CLI, workspace fixtures, init tests |
| Configuration | YAML configuration loads autonomy, providers, limits, policies, workspace paths, and capability settings with safe defaults. | implemented | config loader tests |
| Memory | Root, company, client, project, daily, decision, approval, run, growth, and artifact memory are human-readable and workspace-local. | partial | memory services, registries, generated markdown, run-completion decision records (`RunEngine` + `recordDecision`) |
| Memory authority | The Supreme Coordinator can assemble global memory, while project agents receive scoped memory only. | implemented | `CoordinatorGlobalMemoryService`, `MemoryBoundaryService`, dispatcher tests |
| Search and promotion | Important memory can be retrieved predictably; semantic embedding indexes are not required for v1, but the always-loaded ROOT index must stay current (see Durable memory consolidation). | partial | markdown search, SQLite FTS5 index honoring configured `search_index` + `bureau memory index status\|rebuild`, optional offline TF-IDF semantic index (`provider: local`), memory packet assembly |
| Durable memory consolidation | The always-loaded `ROOT.md` executive index stays current: its structured sections (clients in play, active projects, priorities, blockers, recent decisions, risk register, topics) are regenerated deterministically from live workspace state, on demand (`bureau memory consolidate`) and on a daily daemon tick gated by `memory.promote_daily_notes_to_durable_memory`. Every consolidation is audited (`memory.root.consolidated`). | implemented | `RootMemoryConsolidationService`, scheduler `consolidate_root_memory` tick, CLI `memory consolidate`, `consolidation.test.ts` |
| Policy engine | Risk, autonomy, capability, approval, public action, billing, client-contact, merge, deploy, and destructive-action boundaries are enforced before external action. One-off owner approvals authorize a single action then are consumed; previews (`policy explain`, `capabilities check`) never burn them. | partial | `PolicyEngine`, `CapabilityUseService`, `ApprovalRegistry.consume`, approval registry tests |
| Audit trail | Important actions, capability checks, approvals, generated artifacts, and runtime boundaries are recorded in audit artifacts or append-only logs. | implemented | `AuditLog`, `capability-audit`, run reports |
| Provider routing | Model-agnostic routing supports OpenAI, OpenAI Codex OAuth, Anthropic, Google, OpenRouter, local endpoints, and deterministic fallback where appropriate. | implemented | provider adapter tests, router tests |
| Capability registry | Capabilities are declared, checked, audited, and denied by default when policy or config does not allow them. | partial | capability registry, CLI/API checks |
| Coordinator intake | Owner intake can create/update clients, opportunities, projects, proposal/pricing drafts, compliance reviews, growth drafts, and approval gates. | implemented | intake tests, artifact generation |
| Run lifecycle | Runs can be created, dispatched through the coordinator, assigned specialists, and written back as reports/artifacts; specialist failures truthfully end the run `blocked` with `dispatch_blockers` instead of a false `completed`. | partial | `RunEngine`, coordinator dispatcher, `coordinator.test.ts` |
| Specialist agents | PM, product, development, QA, security, reviewer, compliance, growth, and revenue agents can produce bounded artifacts with provider or deterministic fallback, and their `ok:false` blockers propagate through dispatch, project dispatch, and retry rather than being swallowed. | partial | agent tests, dispatcher tests, `project-dispatch.test.ts` |
| Development runtime | Development Agent can prepare a technical plan and use a real host-backed Codex runner (opt-in via `runtime.codex.enabled`, shell-less subprocess execution, command allow-list, hardened git allow-list that rejects subcommand-smuggling/escape global flags such as `-c`/`-C`/`--git-dir`/`--exec-path`, workspace-confined cwd, diff evidence) behind the `CodexRuntimeAdapter` safety boundary, only after policy and capability checks; stays template-only when disabled. | partial | development agent tests, `HostCodexRuntimeRunner` tests, `buildCodexRuntimeFromConfig` tests, Codex runtime boundary |
| GitHub labels and issues | BureauOS can draft/create GitHub issues, ensure labels, and sync relevant issue/PR/check signals under policy. | partial | GitHub services and tests |
| Branch creation | Development branches are policy-gated, deterministic, auditable, and blocked on unsafe/conflicting conditions. | partial | `DevelopmentBranchService` |
| Test evidence | Project test commands can be discovered or configured, executed in a subprocess boundary, and stored as structured evidence. | partial | `ProjectTestRunnerService`, `test-evidence-report` |
| Draft PR publishing | Draft pull requests can be opened only with linked work, test evidence, policy approval, and a body that follows the repository PR template. | partial | `GitHubPullRequestPublishService` |
| Merge/deploy separation | Merge, production deploy, client announcements, pricing commitments, paid ads, and public publishing remain separate approval-gated actions. | implemented | policy gates, PR publisher tests |
| Linear work intake | Linear issues can be read by the host MCP layer and ingested into BureauOS run scopes/artifacts through the Linear capability boundary. | partial | Linear capability registry, ingestion service |
| Daemon | Scheduler, daemon start/stop/status, retries, memory triggers, health checks, and daily reports operate locally with bounded loops. | partial | scheduler, daemon state, autonomy services |
| Electron Operating Room | The desktop app shows company state, clients, projects, approvals, reports, memory, settings, provider status, and coordinator chat from kernel/API state. | partial | `@bureauos/interface`, local API |
| Owner approvals | Pending and resolved approvals are visible and actionable, with history preserved. | implemented | approval registry, Electron approvals, API |
| Security baseline | Secrets are not stored in repo; destructive shell/file/git actions are blocked by default (including git allow-list bypass attempts via global flags like `-c`/`-C`/`--git-dir`/`--exec-path`); provider auth is kept in local workspace auth files. | partial | runtime boundary, auth store, security docs, `docs/security-and-policy-model.md`, `docs/secrets.md`, audit gate |
| Local API safety | Local API exposes only workspace state needed by the interface and must document trust assumptions before v1. | partial | API routes, settings summary |
| Tests | Core behavior has automated coverage and v1 release must pass build, typecheck, test, lint, and targeted smoke checks. | partial | workspace scripts and CI |
| Documentation | README, roadmap, implementation coverage, CLI reference, owner-interface tour, policy docs, security docs, and this checklist accurately describe shipped vs. future behavior. | partial | public docs, `docs/cli.md`, `docs/owner-interface.md` |
| Release process | v1 release notes, changelog entry, version tag, verification evidence, packaging decision, and known limitations are prepared before tagging. | partial | `docs/release-process.md`, `CHANGELOG.md`, `release:check`, `packages/interface/electron-builder.yml` |

## Deferred From v1

These items are valuable, but they must not block v1.

| Area | Deferred capability | Reason |
| --- | --- | --- |
| Autonomous merge | Automatic merge of pull requests. | Requires stronger review, CI, rollback, and owner policy. |
| Production deploy | Direct production deploys through Vercel, cloud CLIs, or custom pipelines. | High business risk; must remain approval-gated and connector-specific. |
| Client contact | Sending final emails, Slack messages, proposals, or client commitments. | Requires explicit owner authorization and account connectors. |
| Paid ads | Launching campaigns or changing budgets. | Money movement and public claims require stronger policy and platform adapters. |
| Billing changes | Stripe plan changes, invoices, refunds, payouts, or revenue sharing. | Financial actions require dedicated connector policies and audit. |
| External business connectors | Gmail, Slack, Drive, Calendar, Stripe, Supabase, Vercel, and ads adapters. | Draft-first docs and capability boundaries can ship before full adapters. |
| Semantic memory | Embedding indexes, compaction, and searchable archive acceleration. (Deterministic ROOT consolidation is now in v1 — see Durable memory consolidation; model-backed prose enrichment of ROOT remains v1+.) | Markdown memory remains the v1 source of truth. |
| Tamper-evident audit | Audit log signing, rotation, anchoring, and retention policies. | Append-only local audit is enough for v1 foundation. |
| Native app polish | Tray, notifications, auto-start, packaging, notarization, and installer flows. | Useful for adoption, not required for kernel correctness. |
| Multi-owner/team mode | Shared workspaces, permissions, sync, and cloud identity. | BureauOS v1 is local-first owner-operator software. |

## v1+ Capabilities

These are post-v1 expansion tracks.

| Track | Capability |
| --- | --- |
| Business connectors | Gmail, Slack, Drive, Calendar, Stripe, Supabase, Vercel, ads, CRM, analytics, and bookkeeping adapters. |
| Autonomous delivery | Full branch, test, fix, review, PR, CI repair, release note, and owner-approval loops across repositories. |
| Memory intelligence | Semantic search, summarization, promotion, retention policies, cross-client insights, and duplicate detection. |
| Operating Room depth | Native notifications, tray status, command palette, timeline filters, artifact diff views, and richer approval workflows. |
| Risk and compliance | Policy packs for legal, privacy, ads, billing, public claims, client data, and production access. |
| Growth system | Draft-first social, content, creative, proposal, case study, referral, upsell, and conversion workflows. |
| Distribution | Signed desktop releases, updater, sample workspaces, marketplace-style capability packs, and onboarding wizard. |

## Current Blockers And Decisions

These items need an explicit decision or environment before v1 verification can
be considered complete.

| Decision | Needed before v1 | Current state |
| --- | --- | --- |
| Codex runtime host | A real host-backed subprocess runner (`HostCodexRuntimeRunner`) now executes an owner-configured, allow-listed command sequence behind the safety boundary, wired through `runtime.codex` config and the CLI dispatcher. Remaining decision: how the host drives actual model-driven code generation (Codex CLI vs API vs agent loop) into that command/edit cycle, and whether the Electron host injects its own executor. | partial |
| Local API trust model | Document whether API access is loopback-only, token-protected, or process-private for v1. | partial | `docs/secrets.md` |
| Release packaging | Decided: v1 ships source-only; an unsigned opt-in desktop build is configured by `packages/interface/electron-builder.yml`. Signed distribution is post-v1. | implemented |
| GitHub verification workspace | Provide a safe test repository for live issue, branch, test, and draft PR smoke checks. | blocked |
| Linear verification workspace | Use host MCP access only; repository runtime should keep Linear as a capability boundary, not embed credentials. | blocked |
| Public positioning | Keep public copy accurate: BureauOS is a local-first, policy-driven foundation, not a fully autonomous agency today. | implemented |

## v1 Verification Checklist

Before tagging v1, collect evidence for these checks in the release notes.

```bash
pnpm install
pnpm run release:check
pnpm -r run build
pnpm -r run typecheck
pnpm -r run test
pnpm run lint
```

Manual smoke checks:

- Run `bureau init` in a clean temporary workspace and inspect generated config,
  memory, approvals, artifacts, and audit files.
- Run `bureau status`, `bureau audit tail`, and a stub planning run.
- Start the local API and ElectronJS Operating Room against the smoke workspace.
- Verify provider settings show safe auth state without printing secrets.
- Verify approvals can be created, resolved, and reviewed.
- In a safe GitHub test repository, verify label sync, issue draft creation,
  branch creation, test evidence, and draft PR publishing.
- Verify merge, deploy, public posting, client contact, paid ads, billing, and
  destructive actions remain blocked without explicit owner approval.

## Maintenance Rule

Whenever a capability moves from `designed` to `partial`, or from `partial` to
`implemented`, update both this checklist and `docs/implementation-coverage.md`
in the same pull request. Each status change should cite code, tests, docs, or
manual smoke evidence.
