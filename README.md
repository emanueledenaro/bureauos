# BureauOS

An always-on autonomous AI agency operating system that runs revenue, software delivery, growth, and client operations.

## Quickstart

Requires **Node 20+** and **pnpm 9+**.

```bash
git clone https://github.com/emanueledenaro/bureauos
cd bureauos
pnpm install
pnpm -r run build
```

Then drive the kernel through the CLI:

```bash
# In any directory where you want a workspace:
node /path/to/bureauos/packages/cli/dist/bin/bureau.js init \
  --name "Your Company" --preset freelancer

# Add some entities:
node /path/to/bureauos/packages/cli/dist/bin/bureau.js client create --name "Acme Co"
node /path/to/bureauos/packages/cli/dist/bin/bureau.js project create --name "Website" --client acme-co --stack "Next.js"
node /path/to/bureauos/packages/cli/dist/bin/bureau.js opportunity create --title "Mobile App" --source linkedin --client acme-co --value 148000

# Run the kernel and see the workspace snapshot:
node /path/to/bureauos/packages/cli/dist/bin/bureau.js run new --type planning --scope "Q3 roadmap"
node /path/to/bureauos/packages/cli/dist/bin/bureau.js status
node /path/to/bureauos/packages/cli/dist/bin/bureau.js audit tail -n 10
```

### Owner Interface (ElectronJS)

```bash
pnpm --filter @bureauos/interface run dev
```

The owner interface is an ElectronJS desktop app. The Electron main process starts the local API server against
`$BUREAUOS_WORKSPACE` (default: `process.cwd()`) and the renderer connects
to it. Layout matches `docs/ui-reference/operating-room.md`.

### What's in the workspace

After `bureau init` the directory contains:

- `bureauos.yaml` — runtime config (autonomy, growth autonomy, limits, ...)
- `memory/` — markdown-first structured memory (ROOT, COMPANY, CLIENTS,
  PROJECTS, BRAND, OFFERS, CHANNELS, LEADS, CAMPAIGNS, PRICING, PROPOSALS,
  COMPLIANCE, APPROVALS, PUBLIC_CLAIMS, POLICIES, ...)
- `audit/audit.log` — append-only JSONL audit trail
- `approvals/` — pending and resolved approval records

See `docs/bos-kernel-infrastructure.md` for the full layout and
[`BACKLOG.md`](./BACKLOG.md) for what's shipped and what's next.

### Build, test, typecheck

```bash
pnpm -r run build      # tsc + electron-vite build for the interface
pnpm -r run typecheck  # strict TypeScript across all packages
pnpm -r run test       # vitest
```

CI on every push runs the same plus a smoke `bureau init`.

BureauOS is an operating model for autonomous AI agency work. A single supreme executive coordinator speaks with the owner, remembers the whole company through structured persistent memory, manages multiple project teams, grows the owner's visibility, runs marketing and conversion work, creates and manages revenue opportunities, and delegates execution to specialized agents with scoped memory, clear policies, and auditable artifacts.

It is not a prompt dump and it is not a single coding bot.

BureauOS models a real software agency:

- one supreme executive AI coordinator for the whole company
- always-on observation, scheduling, and self-started work
- one project manager AI per client or project
- persistent client intelligence for every customer, including history, revenue, value, risks, permissions, and relationship state
- specialized delivery teams for product, UX, development, QA, security, review, and release
- specialized business teams for visibility, content, social, creative, ads, marketing, conversion, sales, pricing, proposals, and client success
- risk and compliance gates for legal, privacy, billing, public claims, contracts, budget, and client commitments
- persistent global memory for the supreme coordinator
- isolated project memory for project managers and teams
- owner command center to see company state, clients, projects, revenue, approvals, agents, and reports
- GitHub issues, labels, comments, pull requests, checks, and actions as the operational surface
- policy-bounded autonomy instead of blind automation
- capability layer for Codex, skills, MCP servers, CLIs, APIs, and external tools
- public actions, client contact, ad spend, pricing changes, merge, and deploy can be enabled only by explicit owner request or approved policy

## Core Idea

The user should not have to talk to ten agents.

The user talks to one supreme executive coordinator. The coordinator is the always-on CEO/CTO/COO/Growth Lead of the AI agency. It must know the company, projects, clients, priorities, risks, deadlines, policies, historical decisions, active work, market positioning, visibility channels, growth pipeline, and the state of every team.

The owner should not have to say "check this bug" or "look at this project." BureauOS must observe signals, detect work, start runs, and move projects forward while the owner is on the phone, offline, or asleep.

The business objective is economic: BureauOS should help the owner make money by finding opportunities, converting them into paid projects, delivering those projects well, retaining clients, and creating expansion opportunities.

BureauOS must behave like an expert operator of a real company. It should understand revenue, margin, pipeline, delivery capacity, client satisfaction, reputation, risk, and growth. The owner should see business outcomes, not just task activity.

## Who It Is For

BureauOS is for owner-operators.

Examples:

- freelancers
- VAT-registered independent professionals
- solo founders
- small software agencies
- consultants
- technical entrepreneurs
- internal innovation leads

These people often have to sell, scope, build, manage clients, handle delivery, publish proof, follow up with leads, and protect margins at the same time.

BureauOS gives them an always-on AI company layer.

The owner explains intent, constraints, and approvals. The system turns that into business operations, software delivery, marketing, sales follow-up, client success, and reporting.

## Easy Setup

BureauOS should be easy to configure.

The default path should be:

```bash
bureau init
```

Then a short wizard:

```text
What are you?
1. Freelancer
2. Small agency
3. Startup / product team
4. Company operator

Where do you work?
- local only
- GitHub
- GitHub + Codex
- GitHub + Codex + MCP

How autonomous should BOS be?
- safe draft mode
- PR mode
- business operations mode
- custom
```

BureauOS should generate the config, memory folders, safe policies, templates, and first report automatically.

Advanced YAML should exist, but it should not be required for the first useful run.

## Owner Command Center

BureauOS needs an ElectronJS desktop interface where the owner can see everything without reading raw files.

The interface should show:

- company health
- revenue and pipeline
- clients and client value
- active projects
- autonomous work in progress
- blocked work
- approvals needed
- agent activity
- GitHub issues and PRs
- marketing and ads activity
- client follow-ups
- daily and business reports

It should also provide one primary conversation surface: the supreme coordinator.

The owner talks to the coordinator. The ElectronJS Operating Room shows what the organization is doing.

The coordinator does not keep all of that inside one prompt. It owns a structured persistent memory system:

- a compact root memory loaded at startup
- durable company memory
- client and project memory
- daily operational notes
- decision records
- run reports
- searchable raw history
- background consolidation from working notes into durable memory

Project managers have isolated project memory. The supreme coordinator has authority to access every project memory and assemble the right briefing before it acts.

```text
Owner / Client
  |
  v
Supreme Executive Coordinator
  |
  +-- Project Team A
  |     +-- Project Manager
  |     +-- Product Agent
  |     +-- UX Agent
  |     +-- Dev Agent
  |     +-- QA Agent
  |     +-- Security Agent
  |     +-- Reviewer Agent
  |     +-- Release Agent
  |
  +-- Project Team B
  |     +-- Project Manager
  |     +-- Product Agent
  |     +-- UX Agent
  |     +-- Dev Agent
  |     +-- QA Agent
  |     +-- Security Agent
  |     +-- Reviewer Agent
  |     +-- Release Agent
  |
  +-- Growth & Revenue Team
  |     +-- Visibility Agent
  |     +-- Content Agent
  |     +-- Social Agent
  |     +-- Creative Agent
  |     +-- Ads Agent
  |     +-- Marketing Agent
  |     +-- Conversion Agent
  |     +-- Sales Agent
  |     +-- Pricing Agent
  |     +-- Proposal Agent
  |     +-- Client Success Agent
  |
  +-- Internal Product Team
        +-- Project Manager
        +-- Product Agent
        +-- Dev Agent
        +-- QA Agent
```

The supreme executive coordinator governs the whole agency. Project managers govern individual software projects. Growth and revenue agents govern visibility, demand generation, conversion, pricing, proposals, and client relationships. Specialist agents execute bounded work.

## Why GitHub

GitHub already has the primitives needed for a software organization:

- issues for backlog and work intake
- labels for routing and state
- comments for handoff and evidence
- pull requests for delivery
- checks for verification
- actions for automation
- projects and milestones for planning

BureauOS treats GitHub as the operating surface for an AI-native software agency.

## Documentation

- [Vision](docs/vision.md)
- [Positioning](docs/positioning.md)
- [Architecture](docs/architecture.md)
- [Protocol](docs/protocol.md)
- [Operating Model](docs/operating-model.md)
- [Agent Roles](docs/agents.md)
- [Memory Model](docs/memory-model.md)
- [Executive Memory](docs/executive-memory.md)
- [Always-On Autonomy](docs/always-on-autonomy.md)
- [Business Objective](docs/business-objective.md)
- [Company Management](docs/company-management.md)
- [Client Intelligence](docs/client-intelligence.md)
- [Easy Setup](docs/easy-setup.md)
- [Owner Interface](docs/owner-interface.md)
- [Founder Intent](docs/founder-intent.md)
- [Project Audit](docs/audit.md)
- [BOS Kernel Infrastructure](docs/bos-kernel-infrastructure.md)
- [Implementation Coverage](docs/implementation-coverage.md)
- [Universal Opportunity Intake](docs/universal-opportunity-intake.md)
- [Growth and Revenue](docs/growth-and-revenue.md)
- [Marketing and Ads Automation](docs/marketing-and-ads-automation.md)
- [Risk and Compliance](docs/risk-and-compliance.md)
- [Capabilities and Integrations](docs/capabilities-and-integrations.md)
- [Open Source Growth](docs/open-source-growth.md)
- [Workflows](docs/workflows.md)
- [GitHub Workflow](docs/github-native-workflow.md)
- [Autonomy Policy](docs/autonomy-policy.md)
- [Artifacts](docs/artifacts.md)
- [Roadmap](docs/roadmap.md)

## Initial Scope

The first version of BureauOS should focus on the protocol before full automation:

1. Define the organizational model.
2. Define agent responsibilities.
3. Define memory boundaries.
4. Define GitHub labels and artifact templates.
5. Define safe autonomy levels.
6. Provide easy presets and an init wizard.
7. Add a CLI or daemon only after the protocol is stable.

## Design Principles

- The user has one interface: the supreme executive coordinator.
- The company objective is to create revenue and profit for the owner.
- The owner should be able to operate like an entrepreneur with an always-on agency behind them.
- The system should report business outcomes, not just completed tasks.
- The supreme coordinator has total structured memory of the company.
- Every project has isolated memory.
- Internal agents communicate through artifacts, not chaotic free chat.
- Every important decision is recorded.
- Autonomy is controlled by policy.
- Humans define the policy; agents execute within it.
- Agents use approved capabilities instead of inventing workarounds.
- Setup must be simple by default and configurable later.
- The owner must have a clear command center that shows the whole business without exposing internal chaos.
- GitHub remains the source of truth for software delivery.
- The agency memory remains the source of truth for brand, marketing, sales, clients, and company operations.
- Commercial commitments require explicit owner request or approved policy.
- Legal, privacy, payment, advertising, and client-commitment risk must pass compliance gates.
- Pull requests must be small, reviewable, scoped, and linked to issues.
- BureauOS should be useful enough for freelancers, entrepreneurs, small agencies, and companies to adopt as an open-source standard.

## Repository Status

This repository now contains the BureauOS operating model plus a working local-first kernel: structured memory, registries, policy gates, artifacts, audit logs, provider auth with separate OAuth/API routes, provider-routed agent drafting, GitHub issue workflows, daemon scheduling foundations, local API endpoints, and the ElectronJS Operating Room. Several external integrations are still draft-first or adapter-level, but the core AAAS loop is executable locally.
