# Operating Model

BureauOS models a full AI agency, not a single assistant.

It manages both delivery and growth:

- delivery: software projects for the owner, company, and clients
- growth: visibility, content, marketing, conversion, sales, and client success

## Core Entities

### Company

The top-level operating unit.

Contains:

- owner preferences
- global policies
- active clients
- active projects
- global priorities
- standard procedures
- quality gates
- provider configuration
- brand positioning
- active offers
- growth channels
- sales pipeline
- conversion history
- risk and compliance policy
- public claims policy
- approved budgets

### Client

A client is an external or internal stakeholder.

A client can own one or more projects.

Contains:

- business context
- communication preferences
- commercial constraints
- relationship status
- project history
- revenue history
- lifetime value
- strategic value
- payment reliability
- permissions
- risks
- deadlines
- contacts
- approved scope
- escalation rules

### Project

A project is a software workstream.

Contains:

- repository
- stack
- architecture
- backlog
- roadmap
- open issues
- open pull requests
- test commands
- deployment rules
- project decisions
- project-specific memory

### Offer

An offer is a market-facing package of value.

Contains:

- target audience
- promise
- scope
- price or pricing logic
- margin assumptions
- proof assets
- delivery requirements
- constraints
- conversion path

### Channel

A channel is a place where the company earns attention or demand.

Examples:

- website
- GitHub
- X/Twitter
- LinkedIn
- newsletter
- email
- communities
- paid ads
- referrals

Contains:

- audience
- content rules
- publication policy
- previous posts or campaigns
- performance notes

### Lead

A lead is a potential client or opportunity.

Contains:

- source
- fit
- need
- urgency
- budget signal
- next action
- last contact
- owner approval status

### Opportunity

An opportunity is a possible revenue event.

Examples:

- a lead asks for a mobile app
- an existing client asks for new functionality
- a retainer can be renewed
- a completed project can become a case study and referral source

Contains:

- source
- client or lead
- business need
- possible offer
- expected value
- delivery feasibility
- margin risk
- next action
- approval status

### Team

A team belongs to one project.

It includes:

- Project Manager Agent
- Product Agent
- UX/UI Agent
- Development Agent
- QA Agent
- Security Agent
- Reviewer Agent
- Release Agent

Teams can be different per project. A simple library may not need UX. A payments product may require security review for most changes.

### Growth Team

The growth team belongs to the company, not one software project.

It includes:

- Visibility Agent
- Content Agent
- Social Agent
- Creative Agent
- Ads Agent
- Marketing Agent
- Conversion Agent
- Sales Agent
- Pricing Agent
- Proposal Agent
- Compliance Agent
- Client Success Agent

The growth team can use delivery evidence from project teams, but it must not expose private client information or promise delivery scope without approval.

### Run

A run is one unit of agentic work.

Examples:

- refine a feature request
- reproduce a bug
- implement an issue
- review a pull request
- prepare a release
- plan a sprint
- run a daily operational check
- create a content plan
- prepare a campaign brief
- audit a funnel
- qualify a lead
- prepare a proposal brief
- prepare a client status report
- prepare pricing and margin notes
- convert a client idea into a project intake
- prepare a social post
- prepare an ad campaign brief
- prepare a compliance review
- provision a repository after approval

Every run has:

- trigger
- scope
- assigned project
- agents involved
- input context
- output artifacts
- status
- decisions
- evidence
- next action

### Task

A task is a smaller unit inside a run.

Example:

```text
Run: Implement Google login
Task 1: Product spec
Task 2: UX flow
Task 3: Security review
Task 4: Implementation plan
Task 5: Code changes
Task 6: Tests
Task 7: Pull request review
```

### Artifact

An artifact is a durable output.

Artifacts are structured, auditable, and reusable.

### Decision

A decision records what was chosen, why, what was rejected, and what it affects.

The decision log prevents context drift.

### Policy

A policy defines allowed actions, required gates, and escalation conditions.

## Communication Model

The user communicates only with the supreme coordinator.

Internal agents communicate through:

- task assignments
- structured artifacts
- review findings
- decision records
- blocking questions
- test reports

Raw agent-to-agent free chat should not be the primary memory.

## Internal Collaboration Modes

### Sequential Mode

Used when outputs depend on each other.

Example:

```text
Product spec -> UX spec -> Dev plan -> Implementation
```

### Parallel Mode

Used when agents can analyze the same input independently.

Example:

```text
Security Agent, QA Agent, and Dev Agent inspect a feature request in parallel.
```

### Council Mode

Used for important decisions.

Several agents provide structured opinions, then the project manager or supreme coordinator decides.

Example:

```text
Question: Should this change be split into multiple PRs?

Product: one user-facing capability
Dev: touches auth, billing, and settings
QA: test matrix is too large
Security: auth and billing require separate review

Decision: split into three issues
```

### Escalation Mode

Used when autonomy should stop.

Examples:

- unclear client requirement
- high-risk production change
- payment or billing code
- secrets or credentials
- legal or compliance ambiguity
- repeated agent failure
- destructive repository action

## Agile Model

BureauOS should support AI-native agile operations:

- backlog refinement
- sprint planning
- daily operational check
- implementation runs
- review runs
- release readiness
- retrospective

The agile process is artifact-driven, not meeting-driven.

## Definition of Done

A task is done only when:

- the requested scope is satisfied
- acceptance criteria are checked
- relevant tests are run or explicitly marked unavailable
- risks are documented
- decisions are logged
- GitHub state is updated
- the supreme coordinator can explain the final state cleanly
