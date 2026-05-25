# @bureauos/capabilities

Capability layer for BureauOS.

Capability surfaces (see [docs/capabilities-and-integrations.md](../../docs/capabilities-and-integrations.md)):

- GitHub issues, labels, PRs, and check runs
- Codex runtime (Phase 8)
- MCP tool bus
- Shell
- Browser automation
- Stripe, Gmail, Calendar, Slack, Google Drive, Supabase, Vercel, ads platforms (Phase 10)

Each capability declares allowed agents, allowed actions, required approvals, risk class, audit requirements, connector identity, and runtime status.

## Status

`CapabilityRegistry` is wired and tested. It merges built-in defaults with workspace `bureauos.yaml`, checks agent/action boundaries, and feeds the API, CLI, and Electron Agents view. GitHub issue, label, PR, and check-run reads are wired through the Octokit adapter. Other connectors remain adapter-level or designed.
