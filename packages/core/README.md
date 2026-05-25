# @bureauos/core

The BureauOS kernel.

Responsibilities (see [docs/bos-kernel-infrastructure.md](../../docs/bos-kernel-infrastructure.md)):

- Config loader
- Workspace initializer (`bureau init`)
- Registries: company, client, project, opportunity, agent, capability, approval
- Policy engine
- Run engine
- Artifact store
- Audit log
- Always-on scheduler, daemon lifecycle state, and signal triggers
- Local API server

This package runs on Node 20 LTS, local-first. It does not perform external actions; the provider router and capabilities handle that under policy.

## Status

Local-first kernel primitives, registries, policy gates, run lifecycle, reports, GitHub signal ingestion, provider-aware agent drafting, OpenCode-style provider connector config, model capability/budget route controls, capability registry exposure, daemon lifecycle state, and internal operational signal triggers are implemented. Runtime execution adapters and deeper external connectors are still being wired behind policy.
