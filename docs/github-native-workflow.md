# GitHub-Native Workflow

BureauOS uses GitHub as the operational surface.

## GitHub Mapping

```text
BureauOS Company       -> GitHub organization or owner account
BureauOS Project       -> GitHub repository
BureauOS Backlog       -> GitHub issues
BureauOS State         -> GitHub labels
BureauOS Handoff       -> GitHub comments
BureauOS Delivery      -> GitHub pull requests
BureauOS Verification  -> GitHub checks
BureauOS Planning      -> GitHub projects and milestones
BureauOS Release       -> GitHub releases
```

## Label Taxonomy

### Type

```text
type:feature
type:bug
type:refactor
type:docs
type:chore
type:release
```

### Stage

```text
stage:intake
stage:product-ready
stage:design-ready
stage:dev-ready
stage:in-progress
stage:review
stage:qa
stage:blocked
stage:done
```

### Agent

```text
agent:coordinator
agent:pm
agent:product
agent:ux
agent:dev
agent:qa
agent:security
agent:reviewer
agent:release
```

### Risk

```text
risk:low
risk:medium
risk:high
risk:critical
```

### Needs

```text
needs:human
needs:repro
needs:logs
needs:design
needs:tests
needs:security
needs:decision
```

### Autonomy

```text
autonomy:read-only
autonomy:issue-only
autonomy:pr-allowed
autonomy:merge-allowed
autonomy:deploy-allowed
```

## Issue Draft Generation

The Supreme Coordinator can convert project artifacts into GitHub-ready issue drafts without publishing them externally.

Runtime surfaces:

- CLI: `bureau github draft-issues --project <project-slug>`
- API: `POST /github/issue-drafts` with `{ "projectSlug": "<project-slug>" }`
- ElectronJS: project cards in the Portfolio Operating Room

Generated drafts are stored as `github-issue-draft` artifacts in persistent memory and audit an event named `github.issue_drafts.generated`.

The first generated package contains:

- Product scope issue
- Repository provisioning issue
- Proposal/pricing issue
- Compliance gate issue
- Growth/content issue

Creating real GitHub issues from these drafts is implemented and policy-gated.

Runtime surfaces:

- CLI: `bureau github create-issues --project <project-slug> --owner <owner> --repo <repo>`
- API: `POST /github/create-issues` with `{ "projectSlug": "...", "owner": "...", "repo": "..." }`
- ElectronJS: project cards when `project.repository` points to a GitHub repository

The creator requires a configured GitHub client. In CLI, pass `--token` or set `GITHUB_TOKEN`. In ElectronJS/daemon mode, start the process with `GITHUB_TOKEN`.

When allowed by policy, BureauOS creates issues, writes a `github-issue-publish-report`, updates empty project repository memory, and audits `github.issue_publish.created`.

When blocked by policy, BureauOS does not call GitHub. It creates or reuses an approval request and audits `github.issue_publish.blocked`.

## Signal Sync

The Supreme Coordinator can observe GitHub as a delivery signal source.

Runtime surface:

- CLI: `bureau github sync --owner <owner> --repo <repo>`

The sync reads issues, pull requests, and check runs for open pull requests. BureauOS writes a `github-signal-report` artifact, creates new internal opportunities for newly observed issues, and audits:

- `github.check_failed.detected`
- `github.issue_stale.detected`
- `github.pr_stale.detected`
- `github.signals.synced`

This is read-only. It does not push commits, comment on issues, or open PRs. Failed checks and stale PRs become internal operating signals for later health-check or bug triage runs.

## Issue Lifecycle

```text
intake
  -> product-ready
  -> design-ready
  -> dev-ready
  -> in-progress
  -> review
  -> qa
  -> done
```

Bug issues may skip UX and Product when already reproducible.

## Pull Request Rules

Pull requests should be:

- linked to one primary issue
- scoped to one change
- small enough to review
- covered by tests or explicit verification notes
- reviewed by relevant specialist agents
- blocked when high-risk policy requires human approval

PR descriptions should include:

- issue link
- summary
- implementation notes
- test evidence
- risk notes
- rollback notes when relevant

## Agent Comments

Agent comments should be structured and tagged.

Example:

```md
<!-- bureauos:artifact type="security-review" agent="security" run="run_123" -->

## Security Review

Risk: medium

Findings:
- OAuth callback URLs must be configured per environment.
- Refresh tokens must not be stored in localStorage.

Required before merge:
- Add callback URL validation.
- Add test for invalid redirect URI.
```

## Source of Truth Rule

GitHub is the operational source of truth for visible work.

Persistent memory may store summaries and decisions, but issue and PR state should be reconciled from GitHub when possible.
