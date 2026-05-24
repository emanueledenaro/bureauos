# Executive Memory

BureauOS depends on a supreme coordinator that remembers the whole company.

The coordinator is not just a router. It is the executive memory owner for the agency.

## Design Goal

The supreme coordinator must know:

- all clients
- all projects
- active work
- blocked work
- historical decisions
- owner preferences
- autonomy policies
- brand positioning
- active offers
- visibility channels
- marketing campaigns
- leads and proposals
- pricing and margin assumptions
- risk and compliance boundaries
- approval history
- conversion history
- client success risks
- known risks
- team performance
- project-specific context
- what must not be done

This requires persistent structured memory.

## OpenClaw-Inspired Pattern

BureauOS should use the same core idea that makes persistent agents work:

```text
no hidden state
everything important is written to disk
compact long-term memory is loaded automatically
daily notes preserve working context
search retrieves older/deeper context
background consolidation promotes durable facts
```

For BureauOS, the pattern becomes:

```text
ROOT.md
  compact executive index loaded at startup

COMPANY.md
  durable company operating facts

CLIENTS.md / clients/*
  client-specific memory

PROJECTS.md / projects/*
  project-specific memory

BRAND.md / OFFERS.md / CHANNELS.md
  company positioning, offers, visibility, and growth channels

LEADS.md / CAMPAIGNS.md / CONVERSION_NOTES.md
  revenue pipeline and conversion history

PRICING.md / PROPOSALS.md
  pricing logic, margin notes, proposal status, and commercial approval boundaries

COMPLIANCE.md / APPROVALS.md / PUBLIC_CLAIMS.md
  risk gates, owner approvals, client permissions, and public claim boundaries

DECISIONS.md
  durable decision log

memory/YYYY-MM-DD.md
  daily operational context

runs/*
  per-run reports and evidence

archive/*
  raw or low-level historical material

indexes/*
  SQLite/BM25/vector indexes for retrieval
```

## ROOT.md

`ROOT.md` is not everything. It is the map of everything.

It should stay compact and always available.

Recommended sections:

```md
# BureauOS Root Memory

## Active Context

## Active Clients

## Active Projects

## Current Priorities

## Blockers

## Recent Decisions

## Standing Policies

## Risk Register

## Topics Index

## Retrieval Map
```

## Daily Memory

Daily memory stores operational context that is too detailed for `ROOT.md`.

Example:

```text
memory/2026-05-24.md
```

Use it for:

- what happened today
- run summaries
- agent findings
- temporary context
- follow-up notes
- raw operational observations

## Durable Memory

Durable memory stores facts that should survive across sessions.

Examples:

- owner preferences
- project architecture
- client constraints
- permanent policy
- technical decisions
- accepted delivery standards

## Searchable Archive

The archive preserves raw context so nothing important disappears.

The coordinator should not inject the whole archive into context. It should search it.

Search should support:

- exact keyword retrieval
- semantic retrieval
- date filtering
- project filtering
- client filtering
- direct file and line retrieval

## Promotion Pipeline

```text
raw event / run output
  -> daily note
  -> project/client memory
  -> company memory
  -> ROOT.md index
```

Promotion should happen:

- at the end of a run
- during daily consolidation
- during weekly retrospective
- before context compaction

## Action-Sensitive Memory

Some memories affect future behavior.

Those must include:

- source
- authority
- expiry
- allowed action
- forbidden action
- unlock condition

Example:

```md
Production deployment is not approved for Client Acme. Release Agent may prepare staging release notes, but production deploy requires owner approval. Source: owner policy. Expires: when project policy changes.
```

One-off approval example:

```md
Owner approved sending follow-up `followup_042` to Lead Beta today. This approval expires after the message is sent and does not authorize future outreach.
```

## Project Isolation

Project teams should not see each other's private memory.

The supreme coordinator can access all project memory because it governs the whole company.

This creates the correct hierarchy:

```text
Supreme Coordinator: global memory
Project Manager: project memory
Specialist Agent: task context only
```

## Memory Integrity

Memory must be reviewable.

Rules:

- write important facts to disk
- keep raw history when possible
- do not promote untrusted claims without source
- mark stale or temporary information
- record decisions separately from observations
- keep root memory compact
- use search for deep recall
