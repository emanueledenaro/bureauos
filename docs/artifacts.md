# Artifacts

Artifacts are the durable outputs of BureauOS.

They make agent work reviewable, auditable, and reusable.

## Artifact Types

### Project Brief

Defines a project.

Contains:

- client
- repository
- stack
- purpose
- constraints
- setup commands
- test commands
- deployment rules

### Feature Spec

Product-ready description of a feature.

Contains:

- title
- background
- user story
- acceptance criteria
- scope
- non-goals
- risks
- open questions

### Design Spec

UX-ready description.

Contains:

- flows
- screens
- states
- copy
- accessibility
- edge cases
- design system notes

### Bug Report

Reproducible bug artifact.

Contains:

- environment
- steps to reproduce
- expected behavior
- actual behavior
- logs
- severity
- regression status

### GitHub Signal Report

Observed GitHub delivery signal.

Contains:

- repository
- source event or sync run
- issue count
- pull request count
- check-run count
- failing checks
- stale issues and pull requests
- new internal opportunities

### Technical Plan

Implementation plan.

Contains:

- mental model
- files likely affected
- local changes
- tests to add or update
- risks
- rollback notes

### Test Plan

QA plan.

Contains:

- acceptance criteria coverage
- unit tests
- integration tests
- manual checks
- regression checks

### Security Review

Security risk analysis.

Contains:

- risk level
- attack surface
- findings
- required mitigations
- approval/block recommendation

### PR Review

Code review artifact.

Contains:

- findings ordered by severity
- issue alignment
- test evidence
- scope assessment
- merge readiness

### Decision Record

Durable decision.

Contains:

- decision
- context
- alternatives rejected
- evidence
- impact
- revisit trigger

### Run Report

Final run summary.

Contains:

- status
- agents involved
- artifacts produced
- files changed
- tests run
- blockers
- next action

### Executive Report

Owner-facing operational report.

Contains:

- completed autonomous work
- revenue and opportunity movement
- active work
- blocked work
- risks
- decisions needed
- next planned autonomous actions
- public or client-facing approvals needed

### Business Operating Report

Company-level report.

Contains:

- revenue opportunities
- proposal pipeline
- expected value
- margin risk
- delivery capacity
- client risks
- marketing output
- decisions needed
- next business actions

### Brand Brief

Company and owner positioning.

Contains:

- target audience
- positioning
- proof assets
- claims allowed
- claims forbidden
- tone
- channels

### Campaign Brief

Marketing campaign plan.

Contains:

- audience
- offer
- channel
- message
- creative angle
- CTA
- budget policy
- approval status

### Conversion Audit

Funnel and offer conversion review.

Contains:

- traffic source
- landing destination
- CTA
- lead capture
- objections
- friction
- recommended changes

### Lead Qualification Report

Sales opportunity analysis.

Contains:

- lead source
- fit
- pain
- urgency
- budget signal
- risks
- next action

### Client Project Intake

Commercial and delivery intake for a client project.

Contains:

- client
- project idea
- business goal
- target users
- required platforms
- core features
- constraints
- open questions
- delivery risks
- approval needs

### Pricing Brief

Commercial reasoning for price and margin.

Contains:

- pricing model
- estimated effort
- delivery risk
- margin risk
- assumptions
- payment structure
- owner approval notes

### Proposal Brief

Draft commercial proposal.

Contains:

- client problem
- proposed solution
- scope
- exclusions
- timeline assumptions
- pricing notes
- delivery process
- approval status

### Compliance Review

Risk and approval gate.

Contains:

- legal/contract risk
- privacy/data risk
- financial/budget risk
- public claim risk
- technical/production risk
- required approvals
- allowed and blocked actions

### Social Post Brief

Channel-specific social draft.

Contains:

- channel
- objective
- source proof
- draft
- visual needs
- claims check
- publishing policy

### Creative Brief

Visual or image-generation brief.

Contains:

- product or offer
- audience
- visual direction
- available assets
- assets needed
- image prompt drafts
- brand and permission notes

### Ad Campaign Brief

Paid campaign plan.

Contains:

- objective
- audience
- ad angles
- copy variants
- creative concepts
- landing page
- budget
- compliance review
- launch policy

### Repository Provisioning Plan

Project workspace setup.

Contains:

- repository name
- visibility
- initial README
- issues
- labels
- milestones
- CI
- deployment
- secrets
- memory paths
- approvals

### Project Dispatch Packet

Bounded project memory packet produced by the Project Manager before specialist execution.

Contains:

- run mission
- client context
- project context
- allowed memory paths
- specialist pipeline
- source artifacts
- pending approval gates
- memory boundary rules

### Agent Handoff

Role-specific assignment packet for a specialist agent.

Contains:

- assigned role
- run and project scope
- dispatch packet reference
- required outputs
- responsibilities
- source artifacts
- must-not rules
- escalation rules

### GitHub Issue Draft

GitHub-ready work item generated from project artifacts.

Contains:

- issue title
- issue body
- labels
- source artifacts
- acceptance criteria
- policy notes
- external commitment gates

### GitHub Issue Publish Report

Audit artifact for real GitHub issue creation.

Contains:

- project
- repository
- policy decision
- created issue URLs
- source draft artifacts

### Capability Audit

Tool and runtime usage record.

Contains:

- agent
- capability
- action
- target
- policy decision
- approval source
- result
- artifacts produced
- risk level

### Client Account Plan

Client relationship and expansion plan.

Contains:

- current projects
- stakeholders
- satisfaction signals
- risks
- renewal opportunities
- upsell opportunities
- next communication

### Client Profile

Durable customer intelligence artifact.

Contains:

- identity
- business context
- relationship state
- project history
- financial value
- permissions
- risks
- classification
- next actions

## Artifact Rules

- Artifacts must be structured.
- Artifacts must cite evidence when possible.
- Artifacts should be stored in GitHub comments, repository files, or a memory store.
- Artifacts should be short enough to be read by future agents.
- Raw chain-of-thought is not an artifact.

## Templates

Initial templates are available in:

- [Project Brief](../templates/project-brief.md)
- [Feature Spec](../templates/feature-spec.md)
- [Bug Report](../templates/bug-report.md)
- [Decision Record](../templates/decision-record.md)
- [Run Report](../templates/run-report.md)
- [Executive Report](../templates/executive-report.md)
- [Business Operating Report](../templates/business-operating-report.md)
- [Brand Brief](../templates/brand-brief.md)
- [Offer Brief](../templates/offer-brief.md)
- [Campaign Brief](../templates/campaign-brief.md)
- [Conversion Audit](../templates/conversion-audit.md)
- [Lead Qualification Report](../templates/lead-qualification-report.md)
- [Client Project Intake](../templates/client-project-intake.md)
- [Pricing Brief](../templates/pricing-brief.md)
- [Proposal Brief](../templates/proposal-brief.md)
- [Compliance Review](../templates/compliance-review.md)
- [Social Post Brief](../templates/social-post-brief.md)
- [Creative Brief](../templates/creative-brief.md)
- [Ad Campaign Brief](../templates/ad-campaign-brief.md)
- [Repository Provisioning Plan](../templates/repository-provisioning-plan.md)
- [Project Dispatch Packet](../templates/project-dispatch-packet.md)
- [Agent Handoff](../templates/agent-handoff.md)
- [GitHub Issue Draft](../templates/github-issue-draft.md)
- [GitHub Issue Publish Report](../templates/github-issue-publish-report.md)
- [Capability Audit](../templates/capability-audit.md)
- [Client Account Plan](../templates/client-account-plan.md)
- [Client Profile](../templates/client-profile.md)
