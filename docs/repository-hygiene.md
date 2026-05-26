# Repository Hygiene

BureauOS is public, but local agent context often is not. Keep private
operator instructions, local process traces, generated plans, credentials, and
workspace memory out of public commits unless they have been explicitly
sanitized and turned into product documentation.

## Local-Only Files

These paths are intentionally ignored:

- `AGENTS.md`
- `docs/superpowers/`
- `.bureauos/`
- `.env` and `.env.*`

Use the ignored root `AGENTS.md` only for personal or machine-local operating
instructions. If an instruction belongs in the project, move the sanitized
version into a public document such as `README.md`, `CONTRIBUTING.md`,
`SECURITY.md`, or a focused file under `docs/`.

Generated planning artifacts under `docs/superpowers/` are local process
artifacts by default. Do not commit them directly. If one contains durable
product value, rewrite it into a normal public doc with:

- no personal data
- no local machine paths
- no private business context
- no credentials, tokens, emails, phone numbers, or account details
- clear status language that distinguishes implemented, partial, designed, and
  blocked work

## Public Documentation

Public docs should describe BureauOS itself: architecture, policies, runtime
behavior, testing, release readiness, and contributor expectations.

Do not use public docs as a transcript of agent work. Preserve useful decisions
as explicit decision records, roadmap entries, implementation coverage updates,
or acceptance checklists.

## Pre-Commit Review

Before staging or opening a PR:

```bash
git status --short
pnpm run private-context:check
git diff --cached --stat
git diff --cached --check
```

Also review the staged diff manually for private context. The automated check
blocks the most obvious mistakes, but it is not a substitute for review.

## Current Local Artifacts

The existing untracked `docs/superpowers/` files are intentionally excluded
from public commits. Durable Phase 8 and v1 readiness decisions have been
promoted into public docs instead.
