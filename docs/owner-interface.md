# Owner Interface

The owner-facing product is the BureauOS Operating Room: an ElectronJS desktop
app that visualizes kernel state so the owner does not have to read Markdown
files, GitHub issues, logs, and agent reports by hand.

This page is a tour of the shipped MVP in [`@bureauos/interface`](../packages/interface/README.md).
It describes what exists today. Items still in progress are tracked under Phase 4
in the [BACKLOG](../BACKLOG.md). For status language across the project see
[Implementation Coverage](./implementation-coverage.md).

## Core Principle

```text
One conversation.
One command center.
Full business visibility.
```

The owner talks to the Supreme Coordinator. The Operating Room shows the state
of the company. The interface is not a second source of truth: it reads and
updates kernel state through the local API. Merge, deploy, client contact,
public publishing, paid ads, billing, and destructive actions stay
approval-gated.

## How It Runs

- The Electron main process boots a local HTTP API server from `@bureauos/core`
  against the workspace at `process.cwd()`, or `BUREAUOS_WORKSPACE` when set.
- The renderer (React + Tailwind) fetches state from that local API and discovers
  the dynamically bound port over the `bureau:api-url` IPC channel.
- When `GITHUB_TOKEN` is present, the API can create GitHub issues from approved
  draft artifacts under policy.

Run it against a demo workspace:

```bash
BUREAUOS_WORKSPACE=/tmp/bureauos-demo pnpm --filter @bureauos/interface run dev
```

See [Getting Started](./getting-started.md) for the full demo flow.

## Layout

The shell has four persistent regions:

- **Left sidebar** — navigation grouped into Command, Business, and Control, with
  live badges from kernel state and a System Status card showing API health,
  agent count, and run count. On small screens it collapses into a drawer.
- **Header** — adaptive mode selector, three status pills, and the date. It also
  exposes buttons to open the quick chat, the pending-approvals sheet, and the
  mobile sidebar.
- **Center work area** — the active view (see below). Most views render the main
  view plus a Live Operations Timeline strip and a Revenue Pulse KPI strip
  underneath; the Coordinator page takes the full height on its own.
- **Agent Layer footer** — a role-chip strip across the bottom with one chip per
  agent role; clicking it opens the Agents view, and a detail sheet shows a
  selected agent's capabilities and current activity.

## The Views

Navigation is mode-based. The sidebar groups the modes as follows.

### Command

- **Coordinator** — the Supreme Coordinator chat as a dedicated full-height page.
  Owner messages and coordinator replies are durable: they are persisted in the
  workspace and reloaded after a refresh or restart. The same endpoint handles
  two paths — opportunity-like messages create the client, project, opportunity,
  artifacts, and approval gates, while general questions assemble a memory packet
  and answer through the configured provider (with a deterministic local-memory
  fallback when no valid provider route exists). Replies stream token-by-token
  over SSE. Coordinator output renders paragraphs, lists, inline code, and fenced
  code blocks.
- **Portfolio** — the Portfolio Operating Room: client columns with project
  cards (name, status pill, progress, stack), a capacity allocation bar, and
  per-project Project Manager chips from each project's `OWNERSHIP.md`. Project
  cards surface repository delivery state and PR/check signal metadata when a
  repository is linked.
- **Today** — an action queue that surfaces only what needs attention today:
  pending approvals, blocked projects, problematic runs, client follow-ups due,
  stalled opportunities, provider setup gaps, and growth-memory readiness.

### Business

- **Revenue** — the revenue pipeline view with an action to qualify
  opportunities and draft pricing/proposal work.
- **Delivery** — delivery state across projects, with an action to verify linked
  repositories without mutating code.
- **Growth** — brand, offer, and channel memory cards plus actions to generate
  draft-only content and a growth review.
- **Clients** — client intelligence account cards with pipeline value, won
  value, delivery risk, relationship follow-ups, and memory paths, plus actions
  to generate client-success status reports and run a memory-trigger scan.

### Control

- **Risk** — risk and blocker surface with an action to run a bounded autonomous
  retry scan.
- **Approvals** — the full approvals page: pending approvals with
  Approve / Reject, filters, and resolved history. Money, deletion, legal,
  production, security, and final external commitments land here.
- **Memory** — the audited Supreme Coordinator global-memory packet: root memory
  preview, ranked query hits, and relative memory paths. Search is manual so
  dashboard polling does not generate repeated global-memory audit events.
- **Agents** — the agent roster with capability assignments, enabled actions,
  risk class, and approval gates.
- **Goals** — an OKR board derived from revenue, delivery, client success,
  growth, autonomy, and execution registries.
- **Reports** — business and operational reports, with an action to generate
  executive, cross-project, and business operating reports.
- **Settings** — a safe workspace configuration summary plus provider auth: the
  OpenCode-style connector catalog, model picker with capability/budget
  metadata, browser OAuth for `openai-codex`, and explicit API-key/local-endpoint
  connect for API providers. Secrets are never printed.

### Shared strips

- **Live Operations Timeline** — a horizontal timeline backed by the audit log
  with typed event icons, updated over SSE and deduped against the audit
  fallback.
- **Revenue Pulse** — a KPI strip wired to the opportunity registry through
  `/company-pulse`, with sparklines and a report-generation action.

## Command Palette (Quick Chat)

`Cmd+K` (`Ctrl+K`) opens a quick-chat popover for the Supreme Coordinator from
any view. It shares the coordinator endpoint with the full page and offers a
shortcut to open the dedicated Coordinator page. The Coordinator lives on its own
page rather than a fixed right rail.

## Adaptive Modes

On load the interface picks a sensible default mode from kernel state, and on
small screens it defaults to the Coordinator surface. The owner can switch modes
at any time from the sidebar or the header selector; once the owner picks a mode,
the app stops auto-selecting.

## Pending Approvals Sheet

A bottom sheet, reachable from the header, lists the top pending approvals with
inline Approve / Reject and a shortcut to the full Approvals page. It shows the
target, scope, risk level, and action for each item.

## Coordinator Chat Examples

```text
I spoke with a restaurant that wants a booking website.
```

```text
Show me clients that made us the most money.
```

```text
What is blocked today?
```

```text
Approve sending the proposal to Client X.
```

The chat is connected to the same memory and policy system as the daemon.

## Interface Data Sources

The Operating Room reads from the local API, which is backed by:

- `.bureauos/memory`
- client intelligence
- project memory and ownership
- run reports and artifacts
- the audit log
- GitHub state when a token is configured
- capability audits
- business reports

## Notification Model

Native tray, OS notifications, and auto-start are not implemented yet
(`designed` in coverage). When added, notifications should fire only for useful
events — approval needed, high-risk blocker, client issue, revenue opportunity,
production/security risk, completed important work, and the daily executive
report — and avoid constant low-value noise.

## Mobile Pass

The shell already collapses the sidebar into a drawer and defaults to the
Coordinator surface on small screens. A dedicated single-column mobile pass for
the KPI strip, approvals bottom sheet, and agent layer is still on the backlog.

## See Also

- [CLI Reference](./cli.md)
- [UI Reference: Operating Room](./ui-reference/operating-room.md)
- [Implementation Coverage](./implementation-coverage.md)
- [v1 Acceptance Checklist](./v1-acceptance-checklist.md)
- [`@bureauos/interface` package README](../packages/interface/README.md)
