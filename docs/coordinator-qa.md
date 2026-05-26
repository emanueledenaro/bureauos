# Coordinator QA

This workflow keeps Coordinator chat QA repeatable even when the local Electron
window is not attachable through Computer Use.

Computer Use remains the preferred desktop validation path for release evidence.
When it cannot attach to the Electron window, use this fallback without changing
the product requirement: validate visible Coordinator behavior through the local
API and renderer, then capture browser/Playwright screenshots of the same
Coordinator panel.

## Prompt Matrix

Run the deterministic prompt matrix against a temporary BureauOS workspace:

```bash
pnpm qa:coordinator
```

The command builds `@bureauos/core`, starts a temporary local API, sends the
canonical Italian owner prompts, and fails if any visible reply contains prompt
leakage, defensive no-mutation filler, generic fallback clients, or routine
approval gates.

To run against an already running local API:

```bash
node scripts/qa-coordinator-prompt-matrix.mjs --base http://127.0.0.1:3737
```

Use `--skip-project-scope` when pointing at a persistent workspace and you do
not want the project-scope prompt to create a local opportunity/artifacts.

## Renderer Evidence Fallback

When Computer Use cannot attach to Electron:

1. Start the API bridge expected by the browser renderer:

```bash
node packages/cli/dist/bin/bureau.js serve --port 3737
```

1. Start or reuse the interface dev server:

```bash
pnpm --filter @bureauos/interface dev
```

1. Open `http://localhost:5173`, navigate to Coordinator, run the same prompt
   matrix, and capture screenshots/accessibility snapshots with the browser
   automation tool.

The fallback evidence should include:

- the prompt matrix command output
- at least one Coordinator screenshot after the latest prompt
- the final client/project/approval counts
- any Computer Use failure text, if the fallback was used because desktop
  attachment failed

## Expected Prompts

- `ciao`
- `abbiamo un cliente si chiama Pizzeria Amodeo lo puoi salvare?`
- `pizzeria amodeo vorrebbe un sito basico di html e css per una pizza specifica la margherita`
- `il sito di amodeo che ho richiesto?`
- `come siamo messi?`

Expected behavior:

- concise greeting, no posture dump
- client-only save does not create project/opportunity/approval records
- project-scope intake preserves `Pizzeria Amodeo`
- status questions are answer-only and use existing BOS state
- company status comes from registries
- no visible prompt, scratchpad, provider payload, `Non ho creato...`,
  `ho solo letto...`, `Restaurant Lead`, or `New Client Lead`
