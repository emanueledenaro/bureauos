# Founder Intent

This document is the structured transcription of the original BureauOS product intent.

It captures the product, operating model, autonomy expectations, memory requirements, business goal, and open-source direction behind BureauOS. It does not include private biographical details, private contacts, secrets, or personal operational context.

## Product Thesis

BureauOS, abbreviated as BOS, is an Autonomous Agency as a Service.

It is not just an AI coding assistant. It is an autonomous company operating system for owner-operators who need to sell, manage clients, deliver software, grow visibility, and protect business risk while staying in control of important decisions.

The owner should speak to one AI representative of the company. That representative coordinates the rest of the agency.

```text
Owner
  |
  v
Supreme Executive Coordinator
  |
  +-- Client and project teams
  +-- Internal product teams
  +-- Growth and revenue teams
  +-- Risk and compliance teams
  +-- Capability and tool runtimes
```

The owner should not have to manually tell the system every small thing to do.

The system should observe, prioritize, create work, coordinate teams, produce artifacts, open issues, prepare pull requests, draft marketing, classify clients, track value, and report back.

## Core Product Shape

BureauOS behaves like a real software company.

The owner talks to one coordinator. The coordinator acts like CEO, CTO, COO, growth lead, account lead, delivery manager, and portfolio manager.

Every project can have a dedicated project manager agent. That project manager owns project memory, context, backlog, delivery state, and team coordination.

Specialist agents execute bounded work:

- Product
- UX/UI
- Development
- QA
- Security
- Reviewer
- Release
- Visibility
- Content
- Social
- Creative
- Ads
- Marketing
- Conversion
- Sales
- Pricing
- Proposal
- Compliance
- Client Success

The system must be capable of running several teams at the same time. For example, it should be able to keep building BureauOS itself while also managing three clients with two projects each.

## The Owner Experience

The owner may be on a phone, away from the computer, or asleep.

BureauOS should continue to work within policy:

- monitor projects
- classify new signals
- prepare work
- detect blockers
- create issues
- update reports
- draft proposals
- prepare content
- prepare ads
- create pull requests where allowed
- escalate only when a decision needs owner authority

The owner should not see a chaotic multi-agent chat.

The owner sees:

- one conversation with the supreme coordinator
- one command center
- company state
- revenue pipeline
- clients
- projects
- approvals
- risks
- agent activity
- business reports

## Example: Local Restaurant Website

The owner speaks with a restaurant that wants a website with reservations and a design that reflects the identity of the business.

The owner sends BureauOS the information:

- business name
- logo
- location
- brand identity
- existing assets
- desired pages
- booking requirements
- style references
- budget expectations
- legal or privacy constraints

BureauOS should then:

1. Create or update the client profile.
2. Classify the opportunity.
3. Estimate business value and urgency.
4. Create a project.
5. Provision or connect a repository.
6. Create a project manager agent for that project.
7. Build the project memory folder.
8. Create the initial product brief.
9. Route the brief to UX/UI for design specification.
10. Route the specification to development.
11. Create GitHub issues.
12. Prepare tests and acceptance criteria.
13. Monitor progress.
14. Prepare proposal, pricing, and timeline artifacts.
15. Ask for owner approval before external commitments.
16. Draft growth assets and case-study opportunities when appropriate.

The owner should receive useful status, not raw internal chatter.

## Example: Mobile App Client

If a client asks for a mobile app, BureauOS should not need a different manual process.

It should:

- classify the client
- understand the app idea
- ask only for missing high-impact details
- create a scoped opportunity
- define product requirements
- define UX flows
- estimate delivery complexity
- prepare pricing options
- prepare a proposal
- create a repository plan
- assemble a team
- create issues
- draft a delivery plan
- monitor the work
- protect the owner from legal, privacy, budget, and scope risk

The system should be general enough to handle websites, mobile apps, internal tools, SaaS products, client portals, automations, marketing systems, and other software projects.

## Business Objective

The goal of a company is to make money sustainably.

BureauOS should help the owner produce revenue, profit, retention, and visibility.

The system should support the full loop:

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

It should know whether clients are valuable, risky, profitable, late, promising, or good candidates for follow-up.

It should help the owner grow the business, not only complete tickets.

## Client Intelligence

Every client must have persistent memory.

BureauOS should remember:

- who the client is
- what the client does
- stakeholders
- communication style
- projects requested
- projects delivered
- revenue generated
- expected future value
- lifetime value
- margin
- relationship health
- payment status
- risks
- permissions
- follow-up opportunities
- upsell potential
- public proof permissions
- important decisions

The client record should outlive a single project.

A client can have multiple projects. A project belongs to one or more clients or internal initiatives. The supreme coordinator must understand the full portfolio.

## Memory Requirement

The supreme coordinator must not forget.

This does not mean loading every token into one prompt. It means it owns a structured persistent memory system.

The required memory model is:

- compact root memory always loaded
- company memory
- client memory
- project memory
- run memory
- decision records
- approval records
- risk records
- revenue records
- growth memory
- searchable archive
- background consolidation
- human-reviewable promotion into durable memory

Project managers have project-specific memory. Specialist agents receive bounded context packets. The supreme coordinator has global memory authority.

The memory system should be local-first and file-readable by default, with indexes and search added around it.

## External Architecture Inspirations

BureauOS should learn from existing agent systems without becoming a fork of them.

OpenClaw is a useful reference for persistent memory patterns:

- durable Markdown memory
- daily notes
- memory search
- local-first indexing
- compaction-aware memory flush
- optional background consolidation
- reviewable promotion into long-term memory

OpenCode is a useful reference for provider routing:

- provider configuration
- support for many model providers
- local model support
- custom provider endpoints
- separate credential setup
- model selection through config

BureauOS should sit above these patterns as the business and agency operating layer.

## Provider and Runtime Requirement

BureauOS must be model-agnostic.

It should support:

- OpenAI
- Anthropic
- Google
- local models
- OpenRouter-style gateways
- OpenCode-style provider configuration
- Codex as a development execution runtime
- MCP servers
- skills
- CLIs
- browser automation
- GitHub
- Supabase
- Stripe
- Vercel
- Gmail
- Slack
- Google Drive
- Calendar
- ads platforms when policy allows

The coordinator should select providers and capabilities according to role, cost, availability, quality, and policy.

## Autonomy Requirement

BureauOS must be autonomous, but not reckless.

Safe autonomous actions:

- observe signals
- classify work
- create internal reports
- create drafts
- create GitHub issues
- prepare proposals
- draft content
- draft ads
- create branches
- open pull requests when policy allows
- run tests
- write audit records

High-impact actions require explicit owner approval or a standing policy:

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

The system should be capable of working all day, but every action must be auditable.

## Growth and Visibility

The coordinator must be able to help the owner become more visible.

When requested or allowed by policy, BureauOS should:

- write posts
- draft threads
- prepare product updates
- create campaign briefs
- create ad creative briefs
- prepare landing page improvements
- analyze conversion opportunities
- draft proposals
- track published content
- classify leads
- follow up on opportunities
- improve offers
- protect public claims

The default open-source policy should be draft-first. Publishing and spending money should require approval.

## Interface Vision

BureauOS should not look like a 2026 table-heavy dashboard.

The interface should feel like an adaptive company operating room.

The system decides which view matters now:

- if there are urgent approvals, show approvals
- if there are active blockers, show blockers
- if there is a new opportunity, open command intake
- if the business is stable, show company goals and portfolio health

Primary views:

- Portfolio View
- Client Room
- Project Room
- Internal Product Room
- Approval Room
- Command Mode
- Reports
- Settings

The style direction is minimal, calm, and OpenAI-like. It should be powerful without feeling like a cluttered enterprise admin panel.

## GitHub-Native Operating Surface

BureauOS should use GitHub as the operating surface for software delivery.

GitHub provides:

- issues
- labels
- comments
- pull requests
- checks
- actions
- projects
- milestones
- review history

BureauOS should generate structured issues and artifacts, then use pull requests and checks as the delivery mechanism.

The repo itself should become useful before the runtime exists. The first release should be a strong open-source protocol, templates, policies, examples, and architecture.

## Open-Source Ambition

BureauOS should be useful to many people:

- freelancers
- independent developers
- consultants
- small agencies
- founders
- owner-operators
- companies building internal AI operations

The project should earn adoption through:

- clear docs
- safe defaults
- useful templates
- easy setup
- model-agnostic design
- local-first memory
- GitHub-native workflows
- practical examples
- transparent risk boundaries

It should not promise magic. It should show how to build a safe autonomous agency layer that helps real businesses operate better.

## Non-Negotiables

- The owner speaks to one coordinator.
- The coordinator has global structured memory.
- Project managers have scoped project memory.
- Specialist agents have bounded responsibility.
- The system can run multiple projects in parallel.
- The system supports both client work and BureauOS self-development.
- Client intelligence includes revenue, value, risk, and relationship state.
- The business goal is sustainable owner profit.
- Growth, ads, content, and visibility are part of the company system.
- Important external actions require approval or policy.
- Everything important produces artifacts.
- Everything important is auditable.
- Setup must be easy.
- The interface must show the whole company.
- The project must remain open-source friendly.

