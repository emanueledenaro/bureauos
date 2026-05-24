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
- Local API server (Phase 4)

This package runs on Node 20 LTS, local-first. It does not perform external actions; the provider router and capabilities handle that under policy.

## Status

Scaffold only. See [BACKLOG.md](../../BACKLOG.md) Phase 1.
