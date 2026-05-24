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
type: feature
type: bug
type: refactor
type: docs
type: chore
type: release
```

### Stage

```text
stage: intake
stage: product-ready
stage: design-ready
stage: dev-ready
stage: in-progress
stage: review
stage: qa
stage: blocked
stage: done
```

### Agent

```text
agent: coordinator
agent: pm
agent: product
agent: ux
agent: dev
agent: qa
agent: security
agent: reviewer
agent: release
```

### Risk

```text
risk: low
risk: medium
risk: high
risk: critical
```

### Needs

```text
needs: human
needs: repro
needs: logs
needs: design
needs: tests
needs: security
needs: decision
```

### Autonomy

```text
autonomy: read-only
autonomy: issue-only
autonomy: pr-allowed
autonomy: merge-allowed
autonomy: deploy-allowed
```

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

