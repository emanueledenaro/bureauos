# Architecture

BureauOS is organized around a hierarchy of authority, memory, delivery execution, and growth execution.

## High-Level Architecture

```text
Owner / Client
  |
  v
Supreme Executive Coordinator
  |
  +-- Executive Memory Kernel
  +-- Company Memory
  +-- Client Registry
  +-- Project Registry
  +-- Global Memory Index
  +-- Daily Operational Notes
  +-- Decision Log
  +-- Searchable Archive
  +-- Policy Engine
  +-- Run Scheduler
  +-- Event Watcher
  +-- Signal Classifier
  +-- Health Monitor
  +-- Capability Registry
  +-- MCP / Tool Bus
  +-- Skill Registry
  +-- Owner Interface
  +-- GitHub Adapter
  +-- Agent Dispatcher
  |
  +-- Project Manager Agent per project
  |     |
  |     +-- Product Agent
  |     +-- UX/UI Agent
  |     +-- Development Agent
  |     +-- QA Agent
  |     +-- Security Agent
  |     +-- Reviewer Agent
  |     +-- Release Agent
  |
  +-- Growth & Revenue Team
        |
        +-- Visibility Agent
        +-- Content Agent
        +-- Marketing Agent
        +-- Conversion Agent
        +-- Sales Agent
        +-- Client Success Agent
```

## Authority Layers

### Owner

The human or organization that defines strategy, permissions, commercial constraints, and final authority.

The owner does not talk to every internal agent. The owner talks to the supreme executive coordinator.

### Supreme Executive Coordinator

The supreme executive coordinator is the user-facing brain of the agency.

It behaves like a combination of:

- CEO
- CTO
- COO
- growth lead
- account lead
- delivery manager
- portfolio manager

It owns:

- total structured memory of the company
- global priorities
- client routing
- project assignment
- market positioning
- visibility strategy
- marketing pipeline
- conversion strategy
- client success oversight
- policy enforcement
- cross-project visibility
- risk escalation
- reporting to the user
- final synthesis of internal work
- promotion of important facts into durable memory

It does not blindly execute every task itself. It governs the organization.

The coordinator must be able to answer, at any time:

- what clients exist
- what projects exist
- what offers exist
- what channels are active
- what leads and proposals are active
- what each team is doing
- what decisions were made
- what is blocked
- what is risky
- what should happen next
- what can be started without waiting for the owner

That requires a persistent memory kernel, not only a system prompt.

### Project Manager Agent

Each project has one project manager agent.

The project manager owns:

- project memory
- project backlog
- project-specific constraints
- project-specific delivery state
- internal team coordination
- project-level reporting to the supreme coordinator

Project managers do not need full company memory. They receive only the relevant company policy and their project context. The supreme coordinator is the only agent with global cross-project memory access by default.

### Specialist Agents

Specialist agents execute bounded functions:

Delivery agents:

- Product Agent
- UX/UI Agent
- Development Agent
- QA Agent
- Security Agent
- Reviewer Agent
- Release Agent

Growth and revenue agents:

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

They should not act as general assistants. Their scope is narrow by design.

## Main Components

### Context Engine

Builds the briefing for each run.

It retrieves:

- company policy
- client context
- project memory
- open issues
- open pull requests
- recent decisions
- relevant artifacts
- repository conventions
- test commands

The coordinator should never rely only on its prompt. It must construct a fresh briefing before making operational decisions.

### Executive Memory Kernel

The executive memory kernel gives the supreme coordinator persistent company awareness.

It contains:

- `ROOT.md` or equivalent compact company index
- company facts and operating rules
- client registry
- project registry
- durable decisions
- active work index
- recent daily notes
- searchable historical archive
- memory search index
- background promotion and compaction jobs

The coordinator should always load the compact root memory, then drill into project, client, run, and decision memory through search and direct retrieval.

### Memory Layer

Stores structured memory at several levels:

- company
- client
- project
- team
- run
- decision
- artifact

The memory layer must distinguish:

- always-loaded executive awareness
- project-scoped working memory
- searchable long-term archive
- raw history that should not be lost

See [Memory Model](memory-model.md).

### Policy Engine

Decides what agents may do.

Examples:

- create issues
- write comments
- create branches
- push commits
- open pull requests
- merge pull requests
- deploy
- contact clients
- touch secrets
- change billing code

Policy is the boundary between autonomy and uncontrolled behavior.

### Capability Registry

Tracks which runtimes, skills, MCP servers, APIs, CLIs, and tools exist.

It answers:

- which agents can use a capability
- which actions are allowed
- which approvals are required
- which risks apply
- which audit record must be written

### MCP / Tool Bus

Connects BureauOS agents to external systems through controlled tools.

Examples:

- GitHub
- Slack
- Gmail
- Google Drive
- Supabase
- Stripe
- Vercel
- browser automation
- ads platforms
- analytics
- custom business systems

### Skill Registry

Maps reusable skills to agents and run types.

Skills can provide:

- workflows
- scripts
- templates
- verification procedures
- domain-specific instructions

### Runtime Adapter Layer

Allows an agent to execute work through a runtime such as Codex, Claude Code, local CLIs, or future execution engines.

BureauOS should remain provider-agnostic. Codex can be a first-class runtime for development work, but the operating model should not depend on one vendor.

### Owner Interface

Shows the owner the company state.

It provides:

- executive overview
- client intelligence
- project status
- revenue pipeline
- approvals
- agent activity
- reports
- coordinator chat
- settings

The owner interface reads from BureauOS memory and connected systems. It should not become a separate source of truth.

### Event Watcher

Observes external and internal signals.

Examples:

- GitHub events
- CI failures
- deployment status
- security alerts
- client messages
- lead replies
- scheduled checks
- due follow-ups
- analytics changes

The event watcher turns signals into candidate runs.

### Signal Classifier

Classifies candidate work before dispatch.

Examples:

- bug
- feature
- review
- QA verification
- security triage
- release readiness
- client success
- content opportunity
- sales opportunity
- conversion issue

### Health Monitor

Runs recurring operational checks.

Examples:

- stale pull requests
- blocked issues
- failing checks
- overdue milestones
- unanswered client messages
- empty content pipeline
- open leads without next action
- missing reports

### Agent Dispatcher

Starts the right agents for a run.

It supports:

- sequential execution when one artifact depends on another
- parallel execution when independent specialists can work at once
- council sessions when several agents must evaluate the same decision
- retries within a strict limit
- escalation when output is incomplete or conflicting

### Artifact Store

Stores the durable outputs of agents.

Examples:

- feature spec
- design spec
- bug report
- test plan
- implementation plan
- security review
- pull request review
- release notes
- decision record

Artifacts are preferred over raw chat transcripts.

### GitHub Adapter

Maps BureauOS work to GitHub:

- issues
- labels
- comments
- pull requests
- checks
- branches
- milestones
- projects
- releases

GitHub remains the visible operational source of truth.

## Always-On Loop

BureauOS is designed to run as a daemon.

```text
observe -> prioritize -> dispatch -> execute -> verify -> report -> learn
```

### Observe

Read GitHub, repo state, issues, PRs, checks, schedules, monitoring, client channels, lead pipeline, growth channels, and external signals.

### Prioritize

Rank work by urgency, client value, risk, dependency, and policy.

### Dispatch

Assign work to the relevant project manager and internal agents.

### Execute

Agents produce artifacts, code, tests, reviews, comments, or PRs according to policy.

### Verify

Run checks, compare output to acceptance criteria, review scope, and detect risk.

### Report

The supreme coordinator gives the owner a clean operational update.

### Learn

Update memories, decision logs, project state, and retrospectives.
