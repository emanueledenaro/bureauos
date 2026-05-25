# @bureauos/interface

Electron desktop application for the BureauOS Operating Room.

Layout matches [docs/ui-reference/operating-room.md](../../docs/ui-reference/operating-room.md):

- Left sidebar (Home, Revenue, Delivery, Growth, Clients, Risk, Memory, Agents, Inbox, Approvals, Reports, Settings)
- Header with adaptive selector and three status pills
- Portfolio Operating Room with client columns and capacity allocation
- Live Operations Timeline (backed by the kernel audit log)
- Supreme Coordinator intake
- Project Manager dispatch from project cards
- Pending Approvals panel with approve/reject
- Revenue Pulse KPI strip
- Settings mode with provider auth connect/disconnect, model picker, and OpenCode-style connector metadata
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

The dashboard reads live kernel state and supports coordinator intake, project dispatch, approval resolution, report generation, provider auth settings with connector catalog/default model/model-list visibility, capability inspection, GitHub issue draft generation, and policy-gated GitHub issue creation when a repository and token are configured. Remaining work is tracked under Phase 4 in the [BACKLOG](../../BACKLOG.md).
