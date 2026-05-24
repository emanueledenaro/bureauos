# Memory Model

The supreme coordinator must remember everything about the agency.

That does not mean putting every detail into one prompt. It means the coordinator owns a structured persistent memory system with compact always-loaded awareness, searchable history, project-scoped memory, and durable decision records.

This is closer to the OpenClaw-style model: persistent Markdown/workspace files, daily notes, long-term memory, memory search, background consolidation, and optional reviewable promotion into durable memory.

## Core Rule

The supreme coordinator has global memory authority.

Project managers have isolated project memory.

Specialist agents receive only the context needed for their task.

```text
Supreme Coordinator
  -> can access company, client, project, run, decision, and archive memory

Project Manager
  -> can access assigned project memory and relevant company policy

Specialist Agent
  -> can access the bounded context packet for the assigned task
```

## Executive Memory Shape

The coordinator memory should be file-readable, searchable, and human-auditable.

Recommended shape:

```text
.bureauos/memory/
  ROOT.md
  COMPANY.md
  CLIENTS.md
  PROJECTS.md
  DECISIONS.md
  ACTIVE_WORK.md
  RISKS.md
  BRAND.md
  OFFERS.md
  CHANNELS.md
  LEADS.md
  CAMPAIGNS.md
  CONVERSION_NOTES.md
  PRICING.md
  PROPOSALS.md
  COMPLIANCE.md
  APPROVALS.md
  PUBLIC_CLAIMS.md
  POLICIES.md
  memory/
    2026-05-24.md
    2026-05-25.md
  clients/
    client-acme/
      CLIENT.md
      REVENUE.md
      RELATIONSHIP.md
      PERMISSIONS.md
      COMMUNICATION.md
      OPPORTUNITIES.md
      DECISIONS.md
      PROJECTS.md
  projects/
    project-webapp/
      PROJECT.md
      ARCHITECTURE.md
      BACKLOG.md
      DECISIONS.md
      RUNS.md
      RISKS.md
      memory/
        2026-05-24.md
  runs/
    run_123.md
  archive/
    raw/
    summaries/
  indexes/
    memory.sqlite
```

## Always-Loaded Root Memory

`ROOT.md` is the coordinator's compact awareness layer.

It should be loaded at startup and before major decisions.

It contains:

- active clients
- active projects
- current priorities
- blocked work
- recent decisions
- major risks
- topic index
- where to retrieve deeper context

`ROOT.md` is not the whole memory. It is the map of memory.

## Memory Levels

### Root Memory

Compact always-loaded executive awareness.

Contains:

- active context
- current portfolio state
- topics index
- recent patterns
- links to deeper files

### Company Memory

Global operating knowledge.

Contains:

- owner preferences
- default communication rules
- autonomy policy
- delivery standards
- technical standards
- escalation rules
- active client list
- active project list
- agency-level priorities
- brand positioning
- active offers
- visibility channels
- marketing campaigns
- sales pipeline
- conversion history
- client success signals

### Growth Memory

Company growth knowledge.

Contains:

- owner and company positioning
- target audiences
- offers and packages
- content already published
- campaign history
- active leads
- proposal status
- pricing logic
- margin assumptions
- payment preferences
- objections
- testimonials
- case studies
- conversion data
- public claims that are allowed or forbidden

### Risk and Compliance Memory

Company risk knowledge.

Contains:

- approval records
- legal/contract boundaries
- privacy constraints
- public claims policy
- client logo/testimonial permissions
- ad budget approvals
- platform/account constraints
- production deployment policy
- external review requirements

### Client Memory

Client-specific knowledge.

Contains:

- client goals
- stakeholders
- communication preferences
- commercial constraints
- deadlines
- approved scope
- known sensitivities
- historical decisions
- project history
- revenue history
- lifetime value
- relationship health
- permissions
- upsell potential
- retention risk

### Project Memory

Project-specific knowledge.

Contains:

- repository URL
- stack
- architecture
- setup commands
- test commands
- deployment process
- conventions
- known risks
- backlog
- roadmap
- open issues
- open pull requests
- project decisions

### Team Memory

Team-specific operating habits.

Contains:

- recurring project workflows
- team-specific quality gates
- known agent strengths and weaknesses
- preferred split patterns
- review history

### Agent Memory

Role-specific lessons.

Examples:

- QA knows recurring flaky tests.
- Security knows recurring auth risks.
- Dev knows common repository patterns.

Agent memory should not override project memory.

### Run Memory

Memory for one active or completed run.

Contains:

- trigger
- scope
- context brief
- assigned agents
- intermediate artifacts
- final artifacts
- decisions
- evidence
- blockers
- final status

### Decision Memory

Durable decision records.

Every important decision should answer:

- what was decided
- why it was decided
- what alternatives were rejected
- what evidence supported it
- what it affects
- when it should be revisited

## Context Assembly

Before acting, the supreme coordinator builds a context brief:

```text
1. Load ROOT.md.
2. Identify intent.
3. Identify client and project.
4. Retrieve company policy.
5. Retrieve client memory.
6. Retrieve project memory.
7. Search historical memory.
8. Check GitHub state.
9. Check active runs.
10. Retrieve recent decisions.
11. Produce a bounded context brief.
12. Dispatch work.
```

## Memory Isolation

Project memory must be isolated for project teams.

The PM for Project A should not automatically see Project B's private context.

The supreme coordinator is the exception. It has global access because it governs the whole company.

Allowed sharing:

- company policy
- reusable technical standards
- anonymized lessons
- explicit cross-project dependency

Blocked sharing:

- client secrets
- private commercial terms
- unrelated project decisions
- unrelated customer data

## Write-Back Rules

After every run, BureauOS should write back:

- final status
- artifacts produced
- decisions made
- risks found
- verification performed
- follow-up tasks
- memory updates

Memory updates should be structured and reviewable.

Write-back should happen at three levels:

1. Daily notes for detailed working context.
2. Project/client memory for durable project facts.
3. Root/company memory for executive awareness.

Raw history should be retained where possible. Compaction creates summaries and indexes; it should not destroy source material.

## Promotion and Compaction

The system should periodically promote high-value material:

```text
raw run notes -> daily notes -> project/client summaries -> company memory -> ROOT.md index
```

Promotion should preserve:

- source
- date
- owner
- authority
- expiry if temporary
- action boundary if it changes future behavior

## Memory Search

Memory search should combine:

- keyword search for exact IDs, issue numbers, file paths, client names, error strings
- semantic search for similar meaning
- direct file retrieval for cited memory ranges
- temporal ranking so recent operational state is not buried

The coordinator should be able to ask:

- what do I know about this project?
- did we decide this before?
- is there an active blocker?
- what was the last successful test command?
- who owns this client?
- what should I avoid doing?

## Anti-Drift Rule

If a decision matters later, it must become a decision record.

If an artifact matters later, it must be stored and linked.

If a fact may have changed, the coordinator should verify the live source when verification is cheap.

## Action-Sensitive Memory

Some memories are not just facts. They change future behavior.

For those, store:

- what future behavior changes
- when it applies
- when it expires
- who authorized it
- what should not be done
- what unlocks action

Examples:

```md
The owner approved agents opening PRs for low-risk documentation changes, but not merging them. This applies to all BureauOS repos until the autonomy policy changes.
```

```md
Client Acme has not approved production deployment automation. Release Agent may prepare release notes and staging checks, but production deployment requires owner approval.
```

```md
The owner explicitly approved publishing campaign post `post_123` on LinkedIn. The approval is one-off, expires after publication, and does not authorize future posts.
```

```md
The owner approved weekly automatic status emails to Client Acme until 2026-06-30. The Client Success Agent may draft and send only status reports; scope changes, pricing, or new commitments still require owner approval.
```
