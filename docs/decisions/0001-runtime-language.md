# ADR 0001: Runtime Language and Toolchain

- Status: accepted
- Date: 2026-05-24
- Deciders: founder

## Context

BureauOS needs a single primary runtime language for the kernel, CLI, local API server, and owner interface.

Constraints and forces:

- The owner interface (see [docs/ui-reference/operating-room.md](../ui-reference/operating-room.md)) is a web application; TypeScript is the natural default for the frontend.
- The team is small. One language across the stack reduces cognitive overhead and lets the kernel share types with the interface.
- The kernel must run locally on macOS, Linux, and Windows. The chosen runtime must work on all three without heroics.
- Codex, Claude Code, Gemini CLI, and similar development runtimes are language-agnostic and are treated as **capabilities** consumed by the kernel, not as the kernel itself. The kernel's choice of language does not constrain those capabilities.
- Many MCP servers ship as Node packages; using Node aligns with the ecosystem we will plug into.
- The kernel deals mostly with file I/O, schema validation, policy evaluation, and JSON/Markdown manipulation. None of these require a language with a heavy runtime.
- A model-agnostic provider router needs to be a thin layer over HTTP/SDK clients; every major model provider ships a first-class TypeScript SDK.

## Decision

Adopt **TypeScript on Node.js 20 LTS** for the entire BureauOS runtime: kernel, CLI, local API server, and owner interface.

Toolchain:

- Node.js 20 LTS (`.nvmrc` pins the exact version)
- pnpm 9.x workspaces as the package manager
- TypeScript 5.x with `strict: true` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`
- Vitest as the test runner
- ESLint + Prettier (configured in Phase 0)
- zod for runtime schema validation
- ESM modules throughout (`"type": "module"`)

Python, Go, or other-language capabilities can be added later as **runtime adapters** under `packages/capabilities`, communicating with the kernel via subprocess, HTTP, or MCP. The kernel itself stays TypeScript.

## Alternatives Considered

- **Python**: strong for data and ML, but splits the codebase from the interface and weakens type-sharing. The kernel does very little number crunching; this advantage is not relevant here.
- **Go**: excellent single-binary distribution and great concurrency, but no type-sharing with the web interface and a smaller MCP ecosystem today.
- **Rust**: tempting for a long-running daemon, but premature optimization for v0.x. We can extract hot paths to Rust later if profiling demands it.
- **Polyglot from day one** (TS interface + Python kernel): rejected because it doubles the build/test/deploy surface for no immediate benefit.

## Consequences

Positive:

- One toolchain across packages.
- Easy code sharing between kernel and interface (shared zod schemas, shared types).
- Fast local installs via pnpm.
- Aligned with most MCP servers and model provider SDKs.

Negative:

- Requires Node 20 on developer machines (mitigated by `.nvmrc`).
- Cross-language capabilities (e.g. a Python ML capability) need a small adapter shim.
- TypeScript strict mode adds friction in early scaffolding, accepted in exchange for stability later.

## Revisit Trigger

Reconsider this decision if any of the following becomes true:

- The kernel needs single-binary distribution before we ship a Node-based installer.
- A core capability cannot be wrapped from Node and forces a language split.
- Performance profiling shows Node is the bottleneck for any kernel-critical operation.
