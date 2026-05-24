# Workflows

BureauOS workflows are run by the supreme coordinator and project manager agents.

Most workflows can be started by the owner, by a scheduled check, or by an observed event. The owner should not have to manually notice every bug, stale PR, lead, or blocker.

## Feature Workflow

```text
Owner request, roadmap signal, or scheduled backlog review
  -> Supreme Coordinator intake
  -> project routing
  -> Project Manager creates run
  -> Product Agent creates feature spec
  -> UX Agent creates design spec
  -> QA Agent creates test plan
  -> Security Agent reviews risk when relevant
  -> Project Manager consolidates dev-ready issue
  -> Maintainer gate
  -> Development Agent implements
  -> Reviewer Agent reviews PR
  -> QA Agent verifies
  -> Supreme Coordinator reports status
```

## Bug Workflow

```text
Bug report, failing check, monitoring signal, or regression suspicion
  -> Supreme Coordinator routes to project
  -> QA Agent reproduces or classifies
  -> QA Agent creates bug report
  -> Project Manager confirms priority
  -> Development Agent fixes
  -> QA Agent verifies regression
  -> Reviewer Agent reviews PR
  -> Supreme Coordinator reports status
```

## Pull Request Review Workflow

```text
Pull request opened, updated, stale, or failing checks
  -> Project Manager loads issue and PR context
  -> Reviewer Agent inspects diff
  -> QA Agent checks test evidence
  -> Security Agent checks sensitive areas
  -> Project Manager creates review summary
  -> Supreme Coordinator decides whether to escalate
```

## Release Workflow

```text
Release candidate, milestone date, or accumulated completed work
  -> Project Manager gathers merged work
  -> QA Agent checks release criteria
  -> Security Agent checks release risk
  -> Release Agent writes changelog and notes
  -> Project Manager creates release readiness report
  -> Supreme Coordinator asks for approval or triggers release by policy
```

## Sprint Workflow

```text
Scheduled sprint event or backlog health trigger
  -> Supreme Coordinator reviews portfolio priorities
  -> Project Managers propose sprint candidates
  -> Product Agents refine issues
  -> QA Agents surface bugs and regressions
  -> Security Agents flag high-risk areas
  -> Supreme Coordinator allocates focus
  -> Project Managers update milestones and labels
```

## Daily Operational Check

The always-on daemon should periodically check:

- blocked issues
- failing checks
- stale pull requests
- unanswered review comments
- urgent bugs
- approaching deadlines
- pending human approvals
- completed work that needs reporting

The output should be a concise operational report, not a raw event dump.

## Autonomous Detection Workflow

```text
Event or scheduled check
  -> Event Watcher records signal
  -> Signal Classifier classifies work type
  -> Supreme Coordinator checks memory, policy, and current portfolio state
  -> Supreme Coordinator starts a run if policy allows it
  -> Project Manager or Growth Team executes
  -> Specialist agents produce artifacts
  -> Supreme Coordinator verifies output
  -> Supreme Coordinator reports only important outcomes or required decisions
```

## Project Health Workflow

```text
Scheduled project health check
  -> Project Manager reviews issues, PRs, checks, milestones, and blockers
  -> QA Agent inspects failing checks or bug signals
  -> Reviewer Agent inspects stale PRs
  -> Release Agent checks release readiness
  -> Project Manager opens or updates runs
  -> Supreme Coordinator receives a portfolio-level summary
```

## Growth Workflow

```text
Owner goal or scheduled growth check
  -> Supreme Coordinator reviews company memory, offers, active projects, and proof assets
  -> Visibility Agent checks positioning and public credibility
  -> Content Agent prepares content opportunities from real work
  -> Social Agent prepares channel-specific posts
  -> Creative Agent prepares images or creative briefs
  -> Ads Agent prepares campaign briefs and budget recommendations
  -> Marketing Agent maps campaign/channel options
  -> Conversion Agent reviews funnel and lead capture
  -> Sales Agent prepares outreach, proposal, or follow-up drafts
  -> Compliance Agent checks claims, permissions, budget, and external commitments
  -> Client Success Agent checks retention and expansion opportunities
  -> Supreme Coordinator prioritizes actions and asks for approval when public action, paid spend, or client contact is required
```

## Client Pipeline Workflow

```text
New lead or opportunity
  -> Supreme Coordinator checks fit against offers and capacity
  -> Sales Agent qualifies the lead
  -> Conversion Agent maps objections and next action
  -> Project Manager estimates delivery feasibility when needed
  -> Pricing Agent prepares pricing and margin notes
  -> Proposal Agent drafts proposal or statement of work
  -> Supreme Coordinator prepares owner-facing recommendation
  -> Owner approval before external commitment
```

## Client Project Intake Workflow

```text
Owner explains a client project idea
  -> Supreme Coordinator creates client opportunity
  -> Compliance Agent classifies legal, privacy, payment, and contract risk
  -> Sales Agent qualifies business fit
  -> Product Agent turns idea into business requirements
  -> UX Agent maps user flows when relevant
  -> Development Agent estimates technical approach
  -> QA Agent defines validation risk
  -> Security Agent checks sensitive areas
  -> Pricing Agent prepares pricing and margin notes
  -> Proposal Agent prepares proposal draft
  -> Compliance Agent reviews external commitments
  -> Supreme Coordinator asks owner only for critical missing decisions
  -> Owner approves scope, price, and external communication
  -> Project Manager creates project workspace, backlog, and delivery team
  -> Delivery team starts work
```

## Marketing and Ads Workflow

```text
Product, offer, or proof asset exists
  -> Supreme Coordinator checks business goal and channel policy
  -> Visibility Agent checks positioning
  -> Content Agent drafts core message
  -> Social Agent adapts message for X, LinkedIn, or other channels
  -> Creative Agent creates visual direction or image prompts
  -> Ads Agent drafts paid campaign plan and budget recommendation
  -> Conversion Agent checks landing page and CTA
  -> Compliance Agent reviews claims, client permissions, budget, and platform risk
  -> Supreme Coordinator publishes or launches only if owner request or policy allows it
  -> Always-on monitor tracks performance and follow-up opportunities
```

Example:

```text
The owner says a client wants a mobile booking app.
BureauOS turns the idea into a qualified opportunity, proposal draft, delivery plan, and project team without waiting for the owner to manually coordinate every step.
```

## Retrospective Workflow

After a significant run or sprint:

```text
1. Gather completed work.
2. Gather failed or delayed work.
3. Identify recurring blockers.
4. Identify policy gaps.
5. Identify prompt or agent role issues.
6. Write lessons into memory.
7. Create follow-up issues where needed.
```
