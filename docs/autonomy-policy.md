# Autonomy Policy

BureauOS agents are autonomous inside policy, not autonomous without limits.

## Autonomy Levels

BureauOS should be proactive. Autonomy levels control what the system may do after it detects work by itself.

Detection and triage are allowed by default. Higher-impact actions require the configured level, an owner request, or an approved policy.

Autonomy applies to capabilities too. An agent may only use tools, skills, MCP servers, runtimes, and external APIs that are assigned to that agent and allowed by policy.

### Level 0: Read Only

Agents may:

- read repository files
- read issues
- read pull requests
- summarize state

Agents may not:

- write comments
- edit files
- create branches
- open PRs

### Level 1: Issue and Comment

Agents may:

- create issues
- label issues
- comment on issues and PRs
- create artifacts
- start autonomous triage runs from observed signals

Agents may not:

- modify code
- push branches
- open PRs

### Level 2: Branch and PR

Agents may:

- create branches
- modify files
- run tests
- commit changes
- open pull requests

Agents may not:

- merge PRs
- deploy
- change secrets

### Level 3: PR Maintenance

Agents may:

- update PRs after review
- fix test failures
- respond to review comments
- re-run checks

Agents may not:

- merge without policy
- deploy without policy

### Level 4: Merge

Agents may merge only when all required gates pass:

- linked issue
- passing checks
- required agent reviews
- risk below configured threshold
- no unresolved human approval requirement

### Level 5: Release and Deploy

Agents may release or deploy only when explicitly enabled.

This level should be opt-in per project and environment.

## Growth Autonomy

Growth work has a separate public-action boundary.

Recommended default:

```yaml
growth_autonomy:
  draft_content: true
  draft_campaigns: true
  draft_replies: true
  draft_proposals: true
  update_internal_pipeline: true
  publish_public_content: false
  send_client_messages: false
  run_paid_ads: false
  change_pricing: false
  send_final_proposals: false
  accept_projects: false
  publish_social_posts: false
  generate_public_creatives: true
  launch_ad_campaigns: false
  change_ad_budget: false
```

Agents can prepare marketing, sales, creative, ads, pricing, and proposal assets autonomously. Public publishing, client contact, paid spend, pricing changes, final proposal sends, and project acceptance require explicit owner request or approved policy.

`false` in the default policy means blocked by default, not permanently forbidden. A specific owner command can authorize a one-off action. A durable policy can authorize repeated actions within a defined scope.

Examples:

```yaml
temporary_approval:
  action: publish_public_content
  channel: linkedin
  artifact: campaign_post_123
  approved_by: owner
  expires_after_action: true
```

```yaml
standing_approval:
  action: send_client_messages
  client: acme
  message_type: weekly_status_report
  approved_by: owner
  expires: 2026-06-30
```

## Default Recommendation

For early open-source BureauOS:

```yaml
autonomy:
  observe_signals: true
  start_triage_runs: true
  create_internal_reports: true
  create_issues: true
  comment_on_issues: true
  create_branches: true
  open_pull_requests: true
  push_commits: true
  merge_pull_requests: false
  deploy_production: false
```

## Mandatory Human Escalation

Escalate to a human when work involves:

- production secrets
- billing or payments
- legal commitments
- destructive database changes
- customer data deletion
- authentication or authorization policy changes
- security-critical findings
- public communication to a client when not explicitly requested or allowed by policy
- public content publication when not explicitly requested or allowed by policy
- paid advertising spend when not explicitly requested or allowed by policy
- ad campaign launch or budget changes when not explicitly requested or allowed by policy
- use of client logos, testimonials, or private assets when permission is missing
- pricing or proposal commitments when not explicitly requested or allowed by policy
- accepting a new client project when not explicitly requested or allowed by policy
- production deployment when deploy autonomy is disabled
- repeated failure after the configured retry limit

## Retry Policy

Agents may retry bounded tasks.

Recommended default:

```yaml
limits:
  max_retries_per_task: 2
```

After two failed clarification or repair attempts, escalate.

## Scope Policy

Recommended default:

```yaml
limits:
  max_files_changed_without_human_review: 8
  require_tests_for_code_changes: true
  require_security_review_for_auth_changes: true
  require_security_review_for_payment_changes: true
```

## Destructive Action Policy

Destructive actions require explicit human permission unless a project policy says otherwise.

Examples:

- deleting branches
- force pushing
- dropping databases
- deleting user data
- rotating production credentials
- rewriting history
- removing large amounts of code

## Capability Policy

Capabilities must be explicitly assigned.

Examples:

- Codex runtime can edit code for Development Agent.
- GitHub MCP can create issues for Project Manager.
- Ads MCP can draft campaigns for Ads Agent.
- Ads MCP cannot launch campaigns unless approved.
- Stripe MCP cannot change billing settings unless approved.

Every high-impact capability action should produce an audit record.

## Policy File Example

See [bureauos.example.yaml](../examples/bureauos.example.yaml).
