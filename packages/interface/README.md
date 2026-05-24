# @bureauos/interface

Electron desktop application for the BureauOS Operating Room.

Layout matches [docs/ui-reference/operating-room.md](../../docs/ui-reference/operating-room.md):

- Left sidebar (Home, Revenue, Delivery, Growth, Clients, Risk, Memory, Agents, Inbox, Approvals, Reports, Settings)
- Header with adaptive selector and three status pills
- Portfolio Operating Room with client columns and capacity allocation
- Live Operations Timeline (backed by the kernel audit log)
- Supreme Coordinator chat (stub)
- Pending Approvals panel with approve/reject
- Revenue Pulse KPI strip
- Agent Layer footer

## How it works

- The Electron main process boots a local HTTP API server from `@bureauos/core` against the workspace at `process.cwd()` (override with `BUREAUOS_WORKSPACE`).
- The renderer (React + Tailwind) fetches state from that local API.
- IPC `bureau:api-url` lets the renderer discover the dynamic port the main process bound.

## Development

```bash
pnpm install
pnpm --filter @bureauos/interface run dev
```

To run against a pre-existing workspace, set:

```bash
BUREAUOS_WORKSPACE=/path/to/your/.bureauos pnpm --filter @bureauos/interface run dev
```

## Build

```bash
pnpm --filter @bureauos/interface run build
pnpm --filter @bureauos/interface run dist
```

## Status

Scaffold complete. The dashboard is read-only with one write action (approve / reject). Remaining work is tracked under Phase 4 in the [BACKLOG](../../BACKLOG.md).
