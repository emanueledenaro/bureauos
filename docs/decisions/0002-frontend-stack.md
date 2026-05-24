# ADR 0002: ElectronJS Stack for the Owner Interface

- Status: accepted
- Date: 2026-05-24
- Deciders: founder

## Context

The Owner Interface (see [docs/ui-reference/operating-room.md](../ui-reference/operating-room.md)) is the visual command center of BureauOS. It needs:

- a permanent desktop presence (system tray, auto-start, native notifications for approvals)
- direct local filesystem access to `.bureauos/memory/` (no CORS, no proxy)
- always-on daemon behavior — the kernel must run even when the user closes the chat tab
- a polished, calm UI that matches the founder's design mock (light neutrals, generous whitespace, soft borders)
- cross-platform distribution (macOS, Windows, Linux) without per-OS UI rewrites

The kernel was already committed to TypeScript on Node 20 in [ADR 0001](0001-runtime-language.md).

## Decision

Adopt **ElectronJS + React + Tailwind CSS + electron-vite** for `@bureauos/interface`.

Stack:

- Electron 32.x
- electron-vite 2.x as the build orchestrator (main + preload + renderer in one config)
- React 18.x for the renderer
- Tailwind CSS 3.x (with PostCSS + Autoprefixer)
- TypeScript 5.x with strict mode
- IPC over `contextBridge.exposeInMainWorld("bureau", ...)`

The ElectronJS main process owns the lifecycle of the local HTTP API server from `@bureauos/core` and the renderer talks to it via fetch. The CLI's `bureau serve` remains a headless developer/admin alternative, not the primary owner interface.

## Alternatives Considered

- **Next.js or Vite web app, run locally on `localhost:N`**:
  - Pros: lighter bundle, no packaging, faster dev loop.
  - Cons: no native daemon, no system tray, no native notifications, requires the user to keep a terminal open and a browser tab open. Loses on the always-on requirement and is not the founder-requested ElectronJS product direction.
- **Tauri**:
  - Pros: ~10MB bundle vs Electron's ~100MB; rust-based backend would be faster.
  - Cons: introduces Rust into the monorepo, violating ADR 0001's "one language" goal. Smaller ecosystem for the kinds of native dialogs and MCP integrations the kernel needs. Revisit later if bundle size becomes a real pain.
- **Native apps (Swift / Kotlin / WinUI)**:
  - Pros: best-in-class native feel.
  - Cons: three codebases. Not feasible for a small open-source project.

## Consequences

Positive:

- A single Electron app ships on macOS, Windows, and Linux.
- The renderer can share TypeScript types with the kernel (`@bureauos/core` and `@bureauos/memory` are workspace dependencies).
- IPC-mediated API access keeps the renderer sandboxed (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`).
- Tailwind + design tokens lets the founder's mock land 1:1 without a heavy component library.

Negative:

- ~100MB bundled Chromium per install.
- Need a CI matrix to produce installers per OS (deferred to Phase 4 follow-up).
- Auto-update wiring (electron-updater) is a future task.

## Revisit Trigger

- Bundle size pain that blocks distribution.
- A maturity gap in Electron's accessibility, security, or platform integrations that hurts the owner experience.
- The team gaining Rust expertise that makes Tauri practical.
