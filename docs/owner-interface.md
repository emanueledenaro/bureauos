# Owner Interface

BureauOS needs an owner-facing ElectronJS desktop interface.

The owner should not need to inspect Markdown files, GitHub issues, logs, and agent reports manually to understand the business.

The ElectronJS Operating Room is the command center for the AI agency.

## Core Principle

```text
One conversation.
One command center.
Full business visibility.
```

The owner talks to the supreme coordinator.

The desktop Operating Room shows the state of the company.

## Primary Views

### Executive Overview

Shows the current state of the business.

Includes:

- revenue pipeline
- active opportunities
- active clients
- active projects
- blocked work
- approvals needed
- risks
- next autonomous actions
- latest executive report

### Clients

Shows every client and their value.

Includes:

- client name
- industry
- active projects
- total revenue
- expected revenue
- lifetime value
- relationship health
- payment status
- upsell potential
- public proof permission
- next follow-up

### Projects

Shows delivery state.

Includes:

- project status
- repository
- assigned team
- current milestone
- open issues
- open PRs
- failing checks
- blockers
- latest activity
- next action

### Opportunities

Shows business pipeline.

Includes:

- lead or client
- source
- expected value
- qualification status
- proposal status
- pricing status
- approval needed
- next action

### Approvals

Shows decisions waiting for owner approval.

Approval types:

- send proposal
- accept project
- publish content
- contact client
- launch ad campaign
- change ad budget
- use client logo/testimonial
- commit to price
- commit to scope
- merge PR
- deploy production

Each approval should show:

- context
- risk
- recommendation
- artifact
- expiry
- approve / reject / ask revision

### Agents

Shows what each team is doing.

Includes:

- supreme coordinator status
- project manager agents
- delivery agents
- growth agents
- compliance agent
- active runs
- recent outputs
- blocked agents
- capability usage

### Reports

Shows business and operational reports.

Includes:

- daily executive report
- business operating report
- client reports
- project reports
- growth reports
- capability audit reports

## Coordinator Chat

The main input surface is a chat with the supreme coordinator.

Examples:

```text
I spoke with a restaurant that wants a booking website.
```

```text
Show me clients that made us the most money.
```

```text
What is blocked today?
```

```text
Approve sending the proposal to Client X.
```

The chat should be connected to the same memory and policy system as the daemon.

The thread is durable. Owner messages, coordinator replies, attachment metadata, and linked intake results are stored under the workspace so the coordinator panel can reload the conversation after a refresh or app restart.

The same chat endpoint handles two paths:

- opportunity-like messages create the client, project, opportunity, artifacts, and approval gates;
- general questions assemble a memory packet and answer through the configured Supreme Coordinator provider when available, with a deterministic local-memory answer when no valid provider route exists.

## Mobile-First Requirement

The owner may use BureauOS from a phone.

The ElectronJS interface should support:

- quick status check
- approvals
- voice or text intake
- client lookup
- project status
- morning report
- urgent alerts

The mobile experience should focus on decisions and status, not dense management tables.

## Notification Model

BureauOS should notify only when useful.

Notification types:

- approval needed
- high-risk blocker
- client issue
- revenue opportunity
- production/security risk
- completed important work
- daily executive report

It should avoid constant low-value notifications.

## Interface Data Sources

The ElectronJS interface reads from:

- `.bureauos/memory`
- client intelligence
- project memory
- run reports
- GitHub state
- capability audits
- integrations when connected
- business reports

The ElectronJS interface should not become a second source of truth. It visualizes and updates the BureauOS memory and connected systems.

## Suggested MVP

The first interface can be simple:

```text
Dashboard
Clients
Projects
Opportunities
Approvals
Reports
Coordinator Chat
Settings
```

The goal is not a complex enterprise UI. The goal is clarity for the owner.
