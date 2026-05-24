# BOS Kernel Infrastructure

This document defines the first technical infrastructure for BureauOS.

The goal is to build the smallest local-first kernel that can support persistent memory, provider routing, policy-bounded autonomy, capability execution, artifacts, audit logs, and later an owner interface.

## Design Position

BureauOS should not begin as a dashboard.

BureauOS should begin as a kernel.

The kernel is the layer that makes the company reliable:

```text
Memory + Policy + Providers + Capabilities + Runs + Artifacts + Audit
```

Without this kernel, the interface would only visualize unstable activity. With the kernel, the interface becomes a view over a real operating system.

## Architecture Goals

The first infrastructure should be:

- local-first
- easy to initialize
- model-agnostic
- provider-agnostic
- GitHub-native
- artifact-driven
- auditable
- policy-bounded
- ready for always-on operation
- ready for a future cloud mode

The first version should work for one owner on one machine. The design should not prevent future teams, hosted deployment, or multi-owner accounts.

## External References

BureauOS should learn from existing systems without becoming a fork.

OpenClaw memory documentation is a useful reference for persistent agent memory. Its public docs describe durable Markdown memory, daily notes, memory search, local SQLite-style indexing, compaction-aware memory flush, and optional background consolidation.

Reference:

- https://github.com/openclaw/openclaw/blob/main/docs/concepts/memory.md
- https://docs.openclaw.ai/reference/memory-config

OpenCode provider documentation is a useful reference for model-provider configuration. Its public docs describe provider setup, `/connect`, model/provider config, local models, custom endpoints, and broad provider support.

Reference:

- https://opencode.ai/docs/providers/

BureauOS should use these as design references:

- OpenClaw-style memory principles
- OpenCode-style provider routing principles
- Codex-style repository execution capability
- MCP-style tool bus

## Package Layout

Recommended initial monorepo layout:

```text
packages/
  core/
    src/
      config/
      kernel/
      policy/
      runs/
      artifacts/
      audit/
      registries/
  memory/
    src/
      stores/
      search/
      promotion/
      compaction/
      schemas/
  providers/
    src/
      router/
      adapters/
      credentials/
      models/
  capabilities/
    src/
      registry/
      github/
      codex/
      mcp/
      shell/
      browser/
  cli/
    src/
      commands/
  interface/
    src/
      api/
      dashboard/
```

The first working implementation can be smaller, but the boundaries should stay clear.

## Runtime Data Layout

The local workspace should create a `.bureauos` folder.

```text
.bureauos/
  bureauos.yaml
  memory/
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
      YYYY-MM-DD.md
    clients/
      client-slug/
        CLIENT.md
        PROJECTS.md
        REVENUE.md
        RELATIONSHIP.md
        PERMISSIONS.md
        COMMUNICATION.md
        OPPORTUNITIES.md
        DECISIONS.md
        RISKS.md
    projects/
      project-slug/
        PROJECT.md
        ARCHITECTURE.md
        BACKLOG.md
        RUNS.md
        RISKS.md
        DECISIONS.md
        memory/
          YYYY-MM-DD.md
    runs/
      run-id.md
    artifacts/
      artifact-id.md
    indexes/
      memory.sqlite
  audit/
    audit.log
  approvals/
    pending/
    resolved/
```

Markdown stays the human-readable source of truth. Indexes exist to accelerate retrieval, not to hide state.

## Core Modules

### Config Loader

Reads and validates `bureauos.yaml`.

Responsibilities:

- load organization settings
- load autonomy level
- load provider config
- load agent config
- load capability config
- load policy config
- load paths
- expose typed config to the kernel

### Company Registry

Tracks global company state.

Entities:

- company profile
- owner preferences
- active offers
- active channels
- current goals
- global risks
- business metrics

### Client Registry

Tracks every client as a durable business object.

Fields:

- client id
- name
- industry
- status
- relationship owner
- active projects
- completed projects
- total revenue
- expected revenue
- margin estimate
- lifetime value
- relationship health
- payment status
- permissions
- risks
- next follow-up

### Project Registry

Tracks software and business projects.

Fields:

- project id
- client id or internal owner
- repository
- status
- stack
- current milestone
- assigned project manager
- assigned agents
- open issues
- open pull requests
- blockers
- risks
- latest run

### Opportunity Registry

Tracks revenue opportunities.

Fields:

- opportunity id
- source
- client or lead
- expected value
- expected margin
- qualification status
- proposal status
- pricing status
- next action
- approval requirement

### Agent Registry

Tracks available agent roles.

Fields:

- agent id
- role
- provider
- model
- memory scope
- capabilities
- allowed actions
- risk threshold

### Capability Registry

Tracks tools and integrations.

Examples:

- GitHub
- Codex runtime
- MCP servers
- skills
- shell
- browser
- Supabase
- Stripe
- Vercel
- Gmail
- Slack
- Google Drive
- ads platforms

Each capability declares:

- allowed agents
- allowed actions
- required approvals
- risk class
- audit requirements

### Policy Engine

The policy engine decides whether an action is allowed.

Input:

- requested action
- requesting agent
- target object
- capability
- autonomy level
- approval state
- risk class
- organization policy
- project policy
- client permissions

Output:

- allow
- deny
- require approval
- require more context
- escalate to owner

The policy engine must exist before external actions are automated.

### Provider Router

The provider router selects models and runtimes.

It should support:

- default provider per agent
- explicit provider routes, without automatic API fallback
- local providers
- provider-specific options
- custom base URLs
- budget-aware routing
- capability-aware routing
- model availability checks

Provider adapter contract:

```text
ProviderAdapter
  id
  type
  listModels()
  validateCredentials()
  generateText(request)
  generateStructured(request, schema)
  stream(request)
```

Runtime adapter contract:

```text
RuntimeAdapter
  id
  type
  canExecute(capability)
  prepare(context)
  execute(task)
  collectEvidence()
  writeReport()
```

Codex should be treated as a runtime capability, not just a model provider.

### Memory Engine

The memory engine owns structured retrieval and persistence.

Responsibilities:

- initialize memory files
- load root memory
- read company/client/project/run memory
- write daily notes
- write durable decisions
- write run reports
- search memory
- generate context packets
- promote important facts
- prevent raw transcript pollution
- maintain auditability

Memory layers:

- root memory
- company memory
- client memory
- project memory
- growth memory
- risk memory
- run memory
- archive

Search should combine exact lookup and semantic retrieval when providers are available.

### Context Engine

Builds the briefing for each run.

Input:

- trigger
- target project or client
- requested action
- active goals
- memory search result
- GitHub state
- policy state
- available capabilities

Output:

- context packet for the coordinator
- context packet for project manager
- context packet for specialist agents

The context packet is the boundary between memory and execution.

### Run Engine

Runs are the basic unit of work.

Run lifecycle:

```text
detected
  -> classified
  -> scoped
  -> policy_checked
  -> context_built
  -> dispatched
  -> artifact_written
  -> verified
  -> reported
  -> memory_updated
```

Every run should have:

- trigger
- owner or autonomous source
- scope
- assigned agents
- capabilities used
- policy decisions
- artifacts
- evidence
- outcome
- next action

### Artifact Store

Artifacts are the shared language between agents.

Examples:

- feature spec
- bug report
- design brief
- pricing brief
- proposal brief
- run report
- compliance review
- capability audit
- client account plan
- business operating report

Artifacts should be stored as Markdown first. Later they can be rendered in the dashboard.

### Audit Log

The audit log records action evidence.

Each event should include:

- timestamp
- actor
- action
- target
- capability
- policy result
- approval id
- artifact id
- result
- error if any

Audit logs are mandatory for trust.

## Owner Interface API

The first dashboard should read kernel state. It should not become a second source of truth.

API surfaces:

- company pulse
- clients
- projects
- opportunities
- approvals
- runs
- agents
- reports
- coordinator messages
- settings

The adaptive interface can then decide which view to foreground.

## Local-First, Cloud-Ready

The first implementation should run locally.

Local-first advantages:

- easier setup
- lower trust barrier
- private by default
- no hosted infrastructure required
- easier open-source adoption
- inspectable memory files

Cloud-ready design means:

- paths are abstracted
- registries have stable IDs
- audit logs are append-only
- provider credentials are not stored in repo
- memory can later sync
- interface can later be hosted
- multi-owner permissions can be added later

## First CLI Commands

Recommended first commands:

```bash
bureau init
bureau status
bureau memory search "query"
bureau intake
bureau run
bureau report
bureau audit
```

`bureau init` should create:

- `.bureauos/bureauos.yaml`
- memory folder
- default policies
- artifact folders
- initial company profile
- first executive report

## Minimum Viable Kernel

The first real milestone should prove:

1. A workspace can be initialized.
2. The coordinator root memory can be loaded.
3. A client can be created.
4. A project can be created.
5. An opportunity can be created.
6. A run can be started.
7. Policy can allow, deny, or require approval.
8. An artifact can be written.
9. A run report can be stored.
10. Memory can be updated.
11. Audit events are recorded.

No paid ads, client messages, production deploys, merges, or billing changes should be automated in the first kernel.

## Implementation Boundary

Do not implement the full company at once.

Implement the kernel first. Then add agents as consumers of the kernel.

Correct order:

```text
Kernel first
Agents second
GitHub automation third
Interface fourth
Always-on daemon fifth
External business actions last
```
