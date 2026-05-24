# @bureauos/cli

The `bureau` command-line interface.

## Commands

See [BACKLOG.md](../../BACKLOG.md) Phase 1.

- `bureau init` — initialize a workspace
- `bureau status` — show company pulse
- `bureau intake --message <m>` — let the Supreme Coordinator create client/project/opportunity work
- `bureau report generate` — generate executive and business operating reports
- `bureau config validate` — validate the local config
- `bureau memory search <q>` — search executive and project memory
- `bureau project dispatch --project <slug>` — create project-scoped dispatch and agent handoff packets
- `bureau run new` — start a new run
- `bureau audit tail` — tail the audit log
- `bureau policy explain <a>` — explain a policy decision
- `bureau providers list` — provider management
- `bureau github draft-issues --project <slug>` — generate GitHub-ready issue drafts from project artifacts
- `bureau github create-issues --project <slug> --owner <o> --repo <r>` — create GitHub issues from approved drafts under policy
- `bureau github ensure-labels --owner <o> --repo <r>` — apply the BureauOS label taxonomy
- `bureau github sync` — reconcile from GitHub
- `bureau daemon` — run scheduler and local API in the foreground

## Status

The CLI is an operational local surface for workspace setup, intake, memory, project dispatch, reports, approvals, provider checks, GitHub label setup, GitHub issue draft generation, policy-gated GitHub issue creation, GitHub issue sync, and daemon mode.
