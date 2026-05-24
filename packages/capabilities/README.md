# @bureauos/capabilities

Capability layer for BureauOS.

Capability surfaces (see [docs/capabilities-and-integrations.md](../../docs/capabilities-and-integrations.md)):

- GitHub issues, labels, PRs, and check runs
- Codex runtime (Phase 8)
- MCP tool bus
- Shell
- Browser automation
- Stripe, Gmail, Calendar, Slack, Google Drive, Supabase, Vercel, ads platforms (Phase 10)

Each capability declares allowed agents, allowed actions, required approvals, risk class, and audit requirements. Capabilities are off by default and gated by the policy engine.

## Status

GitHub issue, label, PR, and check-run reads are wired through the Octokit adapter. Other connectors remain adapter-level or designed.
