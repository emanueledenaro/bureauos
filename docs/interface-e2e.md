# Interface E2E QA

The Operating Room has a Playwright smoke and visual-evidence suite for the
renderer.

Run it locally:

```bash
pnpm run e2e:interface
```

The command builds `@bureauos/core`, starts the Vite renderer on an isolated
test port, starts temporary local BOS API servers from the tests, and exercises
empty and seeded workspaces.

Coverage:

- desktop screenshots for Home, Coordinator, Clients, Delivery, Approvals,
  Reports, Memory, Settings, Growth, Revenue, Agents, Today, and Goals
- mobile screenshots for Home, Coordinator, and Approvals
- page identity, framework-overlay, horizontal-overflow, and forbidden
  demo/fallback-data checks

The suite avoids the live desktop Electron window because Computer Use can be
environment-dependent. It tests the same renderer against temporary local BOS
API state.
