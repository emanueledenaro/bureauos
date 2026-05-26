# Local-First Security and Policy Model

BureauOS v1 is a local-first, single-owner runtime foundation. It can inspect
workspace state, create artifacts, run bounded development work, and open draft
delivery surfaces when policy allows. It is not a remote multi-tenant service
and it does not authorize unbounded business automation.

This document is the operator-facing security model for v1.

## Trust Boundaries

BureauOS has four practical boundaries:

1. Repository source files
2. Local workspace data under `.bureauos/`
3. Local API and ElectronJS Operating Room process
4. External capabilities such as GitHub, Linear, model providers, MCP servers,
   and the Codex runtime

The repository should contain product source and public documentation only.
Workspace state, provider credentials, memory, artifacts, approvals, and audit
logs belong under `.bureauos/` or in environment variables controlled by the
operator.

The local API and ElectronJS app are trusted local processes for one owner on
one machine. Do not expose the local API to the public internet. Hosted,
multi-owner, or team use needs a stronger identity and authorization model than
v1 currently claims.

External capabilities are never a shortcut around policy. A tool can be
available and still be blocked for a specific agent, action, project, or risk
class.

## Default Agent Permissions

Allowed by default in v1-style operation:

- read repository and workspace state
- read Linear/GitHub state when credentials are provided
- classify work and create internal artifacts
- draft issues, reports, proposals, content, ads, and client messages
- create local run records and audit records
- run tests and build commands for bounded development work
- create branches and open draft pull requests when the configured policy,
  linked work item, changed-file limits, and test evidence allow it

Blocked by default:

- merge pull requests
- deploy production
- send client messages
- publish public content
- launch paid ads or change ad budgets
- change billing, pricing commitments, invoices, payouts, or refunds
- accept client scope or make legal commitments
- touch, rotate, print, or commit secrets
- delete customer data or perform destructive database actions
- rewrite git history, force push, or delete branches

A blocked default is not a permanent ban. It means the owner must approve the
specific action or configure a standing policy with a clear scope and expiry.

## Policy Decisions

Every high-impact action should pass through policy before execution. A policy
decision has one of three outcomes:

- `allow`: the action can run and should write evidence.
- `deny`: the action must not run.
- `requires_approval`: the action pauses until the owner approves or denies it.

Policy checks should consider:

- agent role
- capability
- action
- target project/client
- risk class
- configured autonomy level
- owner approval state
- required evidence such as linked issue, test output, or PR template data

Example allowed action:

```text
agent: development
capability: codex
action: run_tests
target: linked project repository
decision: allow
reason: Development agent can run local verification commands.
```

Example denied action:

```text
agent: development
capability: github
action: merge_pull_request
target: production repository
decision: deny
reason: Merge is disabled by default in v1.
```

Example approval-required action:

```text
agent: client_success
capability: gmail
action: send_client_message
target: Acme weekly status email
decision: requires_approval
reason: Client communication requires owner approval unless a scoped standing policy exists.
```

## Approval Semantics

Approvals are action-sensitive records. They should name the action, target,
scope, source, owner, and expiry.

One-off approval authorizes one specific action:

```yaml
approval:
  type: one_off
  action: open_pull_request
  target: acme-booking-website
  artifact: run_123_release_pr
  expires_after_action: true
```

Standing approval authorizes repeated actions within a narrow scope:

```yaml
approval:
  type: standing
  action: send_client_message
  client: acme
  message_type: weekly_status_report
  expires: 2026-06-30
```

Standing approval does not expand to adjacent risks. A standing weekly status
email policy does not authorize new pricing, scope changes, contract terms,
public case studies, or production deployment.

## Credential Storage

Credentials must not be committed to the repository and must not be stored in
`bureauos.yaml`.

| Location | Good For | Tradeoff |
| --- | --- | --- |
| Environment variables | CI, one-off local sessions, temporary tokens | Easy to rotate, but process-visible and easy to leak through shell history or logs |
| Local workspace auth files | Local-first owner workspaces and provider login state | Inspectable and portable, but must stay out of git and should use filesystem permissions |
| OS keychain | Long-lived local desktop credentials | Better local protection, but needs platform-specific implementation and recovery paths |

Current v1 provider auth is local-first. Provider commands mask raw API keys and
OAuth tokens in CLI/API output. Audit records should include provider id,
credential id, action, and result, never raw secrets.

Operational rules:

- Keep `.bureauos/`, `.env`, `.env.*`, and local agent instructions out of git.
- Prefer short-lived tokens for live verification work.
- Rotate any token that may have been printed, committed, pasted into an issue,
  or stored in an artifact by mistake.
- Use separate credentials per provider and per environment where possible.
- Treat production credentials as approval-required even when read access works.

## Audit Semantics

Audit logs and artifacts are evidence, not decoration.

Important events should record:

- action requested
- actor or agent
- target
- policy outcome
- approval id when applicable
- capability used
- relevant artifact ids
- success, failure, or blocked result

The v1 audit log is append-oriented local evidence. It is enough for local
inspection and release evidence, but it is not yet tamper-evident signing,
anchoring, or retention management. Those are future hardening items.

## Draft Pull Request Boundary

Opening a draft pull request is an evidence-producing delivery action, not a
merge or deploy approval.

Draft PR creation should require:

- linked Linear or GitHub work item
- bounded scope
- changed-file evidence
- test/build evidence when code changed
- policy decision showing merge and deploy are still separate gates
- PR body that includes verification and risk notes

Even after a draft PR exists, these remain blocked unless separately approved:

- marking the PR ready for merge when policy requires review
- merging the PR
- deploying to production
- announcing the change to a client
- publishing release claims

Linear comments, GitHub issue updates, and PR descriptions are coordination
surfaces. They do not override local policy or audit requirements.

## Operator Checklist

Before running broader autonomous work:

```bash
git status --short
pnpm run private-context:check
pnpm run release:check
```

Then confirm:

- the active workspace is the intended `.bureauos/` folder
- provider credentials are masked in CLI/API output
- risky actions produce approval records instead of executing
- draft PRs include linked work and verification evidence
- merge, deploy, billing, client send, public publish, paid ads, and destructive
  actions remain blocked without explicit approval

See also:

- [Autonomy Policy](./autonomy-policy.md)
- [Capabilities and Integrations](./capabilities-and-integrations.md)
- [Providers](./providers.md)
- [Secrets and Local Threat Model](./secrets.md)
- [Repository Hygiene](./repository-hygiene.md)
- [Release Process](./release-process.md)
