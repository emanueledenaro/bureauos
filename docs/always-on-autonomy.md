# Always-On Autonomy

BureauOS is designed to keep working without waiting for the owner to manually identify every task.

The owner should be able to sleep, travel, or work from a phone while projects continue moving inside approved policies.

## Core Principle

BureauOS is proactive by default and bounded by policy.

```text
The owner defines goals, policies, and limits.
The supreme coordinator observes the world, detects work, starts runs, delegates teams, verifies output, and reports only what matters.
```

The system should not require the owner to say:

- check if tests failed
- check if a PR is stale
- check if there are bugs
- check if a client is blocked
- check if there are leads
- check if content should be created
- check if a release can be prepared

Those are operational responsibilities of the always-on coordinator.

## Autonomy Loop

```text
Observe
  -> Detect
  -> Classify
  -> Prioritize
  -> Start Run
  -> Dispatch Team
  -> Execute
  -> Verify
  -> Decide
  -> Report
  -> Learn
```

### Observe

Continuously or periodically read signals from:

- GitHub issues
- GitHub pull requests
- CI checks
- repository activity
- test failures
- deployment status
- logs and monitoring systems
- project deadlines
- client channels
- email or CRM
- website analytics
- marketing channels
- content calendar
- lead pipeline

### Detect

Turn raw signals into possible work.

Examples:

- failing CI check
- new bug report
- stale PR
- unanswered client message
- issue blocked for too long
- dependency security alert
- release milestone approaching
- traffic spike on a landing page
- lead replied to outreach
- new client project idea
- content pipeline empty

### Classify

Classify detected work as:

- bug
- feature
- review
- QA verification
- security issue
- release preparation
- client success risk
- marketing opportunity
- sales opportunity
- client project opportunity
- operational maintenance

### Prioritize

Rank detected work by:

- severity
- client impact
- revenue impact
- deadline
- risk
- effort
- dependency chain
- owner policy
- team capacity

### Start Run

The supreme coordinator can start a run without a user command when policy allows it.

Examples:

```text
CI failed on Project A
  -> start QA triage run

PR has been stale for 48 hours
  -> start review follow-up run

Client message asks for status
  -> start client success report run

Landing page conversion dropped
  -> start conversion audit run

Security alert opened
  -> start security triage run
```

### Dispatch Team

The coordinator assigns the work to the right project manager or growth team.

Specialist agents receive bounded context packets and produce artifacts.

### Execute

Agents work within approved autonomy levels.

They may:

- create issues
- label work
- comment with findings
- create branches
- open PRs
- update PRs
- draft client messages
- draft content
- draft proposals
- draft pricing and margin notes
- draft client project intakes

They may not perform higher-risk actions unless policy allows it or the owner explicitly requested it.

### Verify

Before reporting completion, BureauOS verifies:

- test evidence
- issue alignment
- policy gates
- security gates
- client impact
- public communication risk
- memory write-back

### Decide

The coordinator decides whether to:

- continue autonomously
- ask another agent
- split work
- open a PR
- draft a response
- wait for a scheduled check
- escalate to the owner

### Report

The owner should receive concise updates, not constant noise.

Reports should focus on:

- what moved
- what is blocked
- what needs owner decision
- what was completed
- what risk changed
- what will happen next

### Learn

Every autonomous run writes back:

- run report
- decisions
- test evidence
- blockers
- owner approvals
- project memory updates
- root memory updates when relevant

## Trigger Types

### Event Triggers

Run immediately when an external event happens.

Examples:

- new GitHub issue
- new PR
- failed check
- security alert
- client message
- lead reply

### Scheduled Triggers

Run on a schedule.

Examples:

- hourly project health check
- daily executive report
- weekly sprint planning
- weekly growth review
- monthly client account review

### Threshold Triggers

Run when a metric crosses a threshold.

Examples:

- PR stale for more than 48 hours
- issue blocked for more than 24 hours
- project or run blocked past the configured threshold
- client message unanswered past the configured threshold
- conversion rate down 20 percent
- no content drafted for 7 days
- release milestone less than 3 days away

Implemented internal threshold scans:

- `blocked_project_age`
- `blocked_run_age`
- `unanswered_client_message_age`
- `empty_content_pipeline`

These produce an `operational-signal-report`, then start policy-gated threshold runs through the Supreme Coordinator.

Each internal threshold also creates a concrete first artifact before specialist dispatch:

- blocked project/run -> `project-health-report`
- unanswered client message -> `client-account-plan`
- empty content pipeline -> `content-pipeline-report`

Client messages and public growth actions remain draft-only unless policy explicitly allows sending/publishing.

### Memory Triggers

Run because memory says something is due.

Examples:

- follow up with a lead tomorrow
- review a decision after two weeks
- re-check a bug after deployment
- prepare release notes on Friday

Implemented memory-due scans:

- `client_follow_up_due`

The scheduler and `bureau autonomy memory-scan` read durable client memory, find due `next_follow_up_at` values, and start idempotent `memory_due` client-success runs. Each run creates a `client-success-status-report` with account context and a draft follow-up. Sending the message remains approval-gated.

## Autonomy Classes

### Safe Autonomous Work

Usually allowed:

- read state
- summarize state
- create internal reports
- create issues
- label issues
- draft content
- draft replies
- draft proposals
- draft pricing and margin notes
- draft client project intakes
- run tests
- open PRs if project policy allows it

### Approval-Gated Work

Requires owner request or approved policy:

- publish public content
- contact clients or leads
- spend money
- change pricing
- send final proposals
- accept projects
- make commitments
- merge PRs
- deploy production
- touch secrets
- destructive operations

## Owner Experience

The ideal owner experience:

```text
Morning report:
- Project A: CI failed overnight, QA isolated the failing test, Dev opened PR #42.
- Project B: client asked for status, Client Success drafted a reply and is waiting for approval.
- Growth: Content Agent prepared two posts from yesterday's shipped work.
- Revenue: a mobile app opportunity was converted into a project intake, pricing brief, and proposal draft.
- Security: one dependency alert was triaged as low risk.
- Decision needed: approve scope, price, or client send.
```

The owner should not need to inspect every system manually.

## Failure Handling

If BureauOS cannot proceed:

- record the blocker
- retry only within policy
- ask another agent when useful
- escalate with one concrete question
- stop before unsafe action

No autonomous run should silently fail.

The runtime retry loop uses `limits.max_retries_per_task` as a hard boundary. Failed or blocked runs can be retried through `bureau autonomy retry-scan`, `POST /autonomy/retries/scan`, or the daemon retry scan. After the limit, BureauOS writes an `autonomy-retry-report` and escalates instead of looping.
