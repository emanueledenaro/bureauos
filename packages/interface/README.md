# @bureauos/interface

Electron desktop application for the BureauOS Operating Room.

Layout matches [docs/ui-reference/operating-room.md](../../docs/ui-reference/operating-room.md):

- Left sidebar (Home, Revenue, Delivery, Growth, Clients, Risk, Memory, Agents, Inbox, Approvals, Reports, Settings)
- Header with adaptive selector and three status pills
- Today mode action queue for approvals, blockers, follow-ups, run failures, provider setup, and growth memory gaps
- Portfolio Operating Room with client columns and capacity allocation
- Project ownership chips from per-project `OWNERSHIP.md`
- Live Operations Timeline (backed by the kernel audit log)
- Supreme Coordinator intake
- Project Manager dispatch from project cards
- Pending Approvals panel plus full approvals page with filters and resolved history
- Revenue Pulse KPI strip
- Cross-project executive reports generated from project ownership, approvals, runs, and pipeline
- Growth memory cards for brand, offers, and channels
- Client intelligence cards with value, project history, relationship follow-ups, and memory paths
- Memory view with audited Supreme Coordinator packet search, root memory preview, and ranked hits
- Settings mode with safe workspace configuration, provider auth connect/disconnect, model picker, and OpenCode-style connector metadata
- Supreme Coordinator chat reloaded from audited global workspace memory, with general questions answered through the provider router when configured
- Agent Layer footer
- Agents view with capability assignments, enabled actions, risk, and approval gates

## How it works

- The Electron main process boots a local HTTP API server from `@bureauos/core` against the workspace at `process.cwd()` (override with `BUREAUOS_WORKSPACE`).
- The renderer (React + Tailwind) fetches state from that local API.
- IPC `bureau:api-url` lets the renderer discover the dynamic port the main process bound.
- If `GITHUB_TOKEN` is present, the API can create GitHub issues from approved draft artifacts under policy.

## Development

```bash
pnpm install
pnpm --filter @bureauos/interface run dev
```

To run against a pre-existing workspace, set:

```bash
BUREAUOS_WORKSPACE=/path/to/your/workspace pnpm --filter @bureauos/interface run dev
```

## Build

```bash
pnpm --filter @bureauos/interface run build
pnpm --filter @bureauos/interface run dist
```

## Status

The dashboard reads live kernel state and supports an adaptive Today queue, provider-routed coordinator chat with durable history and audited global memory packets, opportunity intake, ownership-aware project dispatch, approval resolution with filtered history, cross-project executive report generation, client intelligence, memory packet search, growth memory for brand/offers/channels, safe workspace settings, provider auth settings with connector catalog/default model/model-list visibility, capability inspection, GitHub issue draft generation, and policy-gated GitHub issue creation when a repository and token are configured. Remaining work is tracked under Phase 4 in the [BACKLOG](../../BACKLOG.md).
