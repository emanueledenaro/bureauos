# Claude Code Brief

You are working on BureauOS, also called BOS.

BureauOS is an open-source Autonomous Agency as a Service: an autonomous AI agency operating system for owner-operators who need to sell, manage clients, deliver software, grow visibility, and protect business risk while staying in control of important decisions.

This repository is currently a protocol and architecture foundation. Do not treat it as a working runtime yet.

## What BureauOS Is

BureauOS models a real software agency.

The owner talks to one user-facing AI: the Supreme Executive Coordinator.

The Supreme Executive Coordinator acts like a CEO, CTO, COO, growth lead, account lead, delivery manager, and portfolio manager. It owns the full company context through structured persistent memory, not through one giant prompt.

Under the coordinator, BureauOS can run:

- project manager agents per client or project
- delivery agents for product, UX, development, QA, security, review, and release
- growth and revenue agents for visibility, content, social, creative, ads, marketing, conversion, sales, pricing, proposals, and client success
- compliance and risk agents for approvals, legal boundaries, privacy, public claims, ads, contracts, billing, and production safety

The owner should not have to manage many agents manually. The coordinator decides what context is needed, creates runs, delegates work, collects artifacts, enforces policy, and reports business outcomes.

## What BureauOS Is Not

BureauOS is not:

- a prompt dump
- a single coding bot
- a chat-only assistant
- an unsafe automation tool
- a promise that AI can run a company without boundaries
- a dashboard without an operating kernel
- a working runtime yet

Do not write public copy that claims BureauOS already fully automates a business. The accurate current framing is: protocol-first, local-first, model-agnostic, policy-driven, open-source foundation.

## Product North Star

The business goal is sustainable owner profit.

BureauOS should help an owner move through the full loop:

```text
visibility
  -> demand
  -> lead
  -> qualification
  -> proposal
  -> approved scope
  -> project kickoff
  -> delivery
  -> payment
  -> retention
  -> case study
  -> referral
  -> upsell
```

It should track clients, projects, revenue, value, risk, relationship health, approvals, delivery state, growth activity, and next actions.

## Current Repository State

The repo currently contains:

- product positioning
- architecture docs
- agent role definitions
- memory model
- executive memory model
- autonomy policy
- risk and compliance policy
- client intelligence model
- growth and revenue model
- owner interface concept
- GitHub-native workflow model
- artifact templates
- issue templates
- pull request template
- example YAML configuration
- project audit
- founder intent transcription
- BOS Kernel infrastructure specification

The repo does not yet contain:

- runtime packages
- CLI implementation
- provider router implementation
- memory engine implementation
- daemon implementation
- ElectronJS desktop interface implementation
- GitHub adapter code
- automated tests

## Read Order

Before making changes, read:

1. `README.md`
2. `docs/founder-intent.md`
3. `docs/audit.md`
4. `docs/bos-kernel-infrastructure.md`
5. `docs/memory-model.md`
6. `docs/autonomy-policy.md`
7. `docs/capabilities-and-integrations.md`
8. `docs/roadmap.md`

For agent responsibilities, read `docs/agents.md`.

For business and growth logic, read:

- `docs/business-objective.md`
- `docs/growth-and-revenue.md`
- `docs/marketing-and-ads-automation.md`
- `docs/client-intelligence.md`

For open-source positioning, read:

- `docs/positioning.md`
- `docs/open-source-growth.md`
- `CONTRIBUTING.md`
- `SECURITY.md`

## Architecture Anchor

The first real implementation should be the BOS Kernel:

```text
Memory + Policy + Providers + Capabilities + Runs + Artifacts + Audit
```

Build order:

1. Config loader
2. Memory initializer
3. Company, client, project, opportunity, run, approval, and capability registries
4. Policy evaluator
5. Artifact writer
6. Audit log writer
7. Provider router
8. Context engine
9. Run engine
10. GitHub adapter
11. CLI
12. Owner interface API
13. ElectronJS desktop Operating Room
14. Always-on daemon
15. External business actions

Do not start from a standalone web dashboard. The owner-facing product is an ElectronJS desktop Operating Room that must visualize kernel state, not become a second source of truth.

## Memory Requirement

The Supreme Executive Coordinator must not forget important company context.

That means structured persistent memory:

- compact root memory always loaded
- company memory
- client memory
- project memory
- daily operational notes
- run reports
- decision records
- approval records
- risk records
- revenue records
- growth memory
- searchable archive
- background consolidation and promotion

Project managers have scoped project memory. Specialist agents receive bounded context packets. Only the Supreme Executive Coordinator has global memory authority by default.

Memory should be local-first and human-readable by default. Markdown files are the source of truth; indexes accelerate retrieval.

## Provider and Capability Model

BureauOS must be model-agnostic.

It should support provider routing inspired by OpenCode-style configuration:

- OpenAI
- Anthropic
- Google
- local models
- OpenRouter-style gateways
- custom provider endpoints

It should also support capabilities:

- Codex runtime
- skills
- MCP servers
- CLIs
- GitHub
- browser automation
- Supabase
- Stripe
- Vercel
- Gmail
- Slack
- Google Drive
- Calendar
- ads platforms when policy allows

Treat Codex as a development execution runtime capability, not just a model provider.

## Autonomy and Safety

BureauOS must be autonomous inside policy, not autonomous without limits.

Allowed by default in early versions:

- observe signals
- classify work
- create internal reports
- create drafts
- create GitHub issues
- prepare proposals
- draft content
- draft ads
- create branches when policy allows
- open pull requests when policy allows
- run tests
- write audit records

Require explicit owner approval or standing policy for:

- contacting clients
- publishing public content
- launching paid ads
- changing ad budgets
- committing to prices
- sending final proposals
- accepting project scope
- using client logos or testimonials
- touching secrets
- changing billing
- deploying production
- merging pull requests
- deleting data
- making legal commitments

Policy enforcement must come before external action automation.

## GitHub Operating Surface

BureauOS should use GitHub as the delivery operating surface:

- issues for work intake and backlog
- labels for routing
- comments for evidence and handoff
- pull requests for delivery
- checks for verification
- actions for automation
- projects and milestones for planning

Every important run should produce an artifact and an audit trail.

## Documentation Standards

The repo is public and open-source.

Keep docs:

- clear
- practical
- accurate about current status
- useful before runtime exists
- safe around money, legal, privacy, ads, public claims, clients, and production
- free of private owner data, secrets, real personal contacts, and unapproved client details

Prefer plain ASCII Markdown unless a file already uses another style.

Do not add hype claims. Do not say BureauOS already works end-to-end until runtime exists and is verified.

## Implementation Standards

When implementing runtime code later:

- keep changes small and scoped
- follow the existing roadmap
- implement kernel pieces before agent complexity
- add tests for policy, memory, config, and run lifecycle behavior
- default to local-first
- keep external actions disabled by default
- write audit records for capability use
- avoid storing credentials in repo
- avoid destructive actions
- separate docs, runtime, examples, and generated artifacts

## First Useful Development Target

The first valuable engineering target is:

```bash
bureau init
```

It should create:

- `.bureauos/bureauos.yaml`
- `.bureauos/memory/ROOT.md`
- company memory files
- client and project folders
- default policies
- artifact folders
- audit folder
- first executive report

The command should not call external providers or take external actions in the first version.

## Tone for Public Work

Use this positioning:

```text
BureauOS is an open-source autonomous AI agency OS for owner-operators who need to sell, deliver, and grow while staying in control of important decisions.
```

Avoid claiming:

```text
BureauOS fully runs your company automatically today.
```

The strongest public angle is safe, inspectable, policy-driven autonomy for real business operations.
