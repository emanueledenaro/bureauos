# Capabilities and Integrations

BureauOS should not rely only on language model reasoning.

Agents need capabilities:

- Codex-style coding execution
- reusable skills
- MCP servers
- local CLI tools
- GitHub integrations
- Linear work-item tracking
- browser automation
- design/image tools
- database tools
- calendar, email, CRM, ads, and analytics connectors

The capability layer lets BureauOS assign the right tools to the right agents under policy.

## Core Idea

```text
Agent role + memory + policy + capabilities = useful autonomous worker
```

The model provides reasoning. Capabilities provide action.

## Codex Runtime

Codex can act as a development execution runtime.

Useful for:

- reading repositories
- editing code
- running tests
- creating patches
- opening pull requests
- debugging CI failures
- reviewing diffs
- using local tools
- using project-specific skills

Recommended assignment:

```yaml
agents:
  development:
    runtime: codex
    capabilities:
      - filesystem
      - shell
      - git
      - test_runner
      - github
      - skills
      - mcp
```

## Skills

Skills are reusable capability packs.

They can provide:

- instructions
- workflows
- templates
- scripts
- domain-specific procedures
- verification ladders

Examples:

- frontend app building
- GitHub PR review
- security scan
- Supabase work
- Stripe work
- browser QA
- presentation generation
- SEO/content workflows

BureauOS should treat skills as approved operating procedures, not random prompt snippets.

## MCP Servers

MCP servers expose external tools and resources.

Examples:

- GitHub
- Slack
- Google Drive
- Gmail
- Calendar
- Supabase
- Stripe
- Vercel
- browser automation
- local filesystem
- custom business systems

BureauOS should use MCP as a controlled tool bus.

## Capability Registry

Each capability should be registered.

Example:

```yaml
capabilities:
  github:
    type: mcp
    allowed_agents:
      - supreme_coordinator
      - project_manager
      - development
      - reviewer
    actions:
      read_issues: true
      create_issues: true
      comment: true
      open_pr: true
      merge_pr: false

  codex:
    type: runtime
    allowed_agents:
      - development
      - reviewer
      - qa
    actions:
      edit_code: true
      run_tests: true
      open_pr: true
      deploy: false

  linear:
    type: mcp
    allowed_agents:
      - supreme_coordinator
      - project_manager
      - product
      - development
      - qa
      - reviewer
    actions:
      read_issues: true
      create_issues: true
      update_issues: true
      comment: true
      set_issue_state: true
      read_projects: true
      create_projects: false
      update_projects: false

  ads_platform:
    type: mcp
    allowed_agents:
      - ads
      - marketing
      - compliance
    actions:
      read_campaigns: true
      draft_campaigns: true
      launch_campaigns: false
      change_budget: false
```

Runtime status:

- `@bureauos/capabilities` exposes `CapabilityRegistry`.
- `bureauos.yaml` can define or override capability assignments.
- `GET /capabilities` returns the active capability matrix to ElectronJS.
- `bureau capabilities list` prints the same capability boundaries in the CLI.
- `POST /capabilities/check` and `bureau capabilities check` evaluate a requested capability use against registry, policy, and evidence gates before execution.
- Every check writes a `capability-audit` artifact and an audit-log event.
- The ElectronJS Agents view shows assigned capabilities, enabled actions, risk class, and approval gates.
- Linear is modeled as a policy-gated MCP work-item source. BureauOS can inspect or update Linear issues only through the capability boundary; GitHub remains the delivery surface for branches, tests, pull requests, and checks.

## Per-Agent Capability Boundaries

The same tool can mean different permissions for different agents.

Example:

```yaml
development:
  github:
    open_pr: true
    merge_pr: false

release:
  github:
    create_release: true
    deploy_production: false

ads:
  ads_platform:
    draft_campaign: true
    launch_campaign: false

supreme_coordinator:
  all_capabilities:
    inspect: true
    dispatch: true
    override_policy: false
```

The supreme coordinator can inspect and dispatch capabilities, but high-risk execution still requires policy or owner approval.

## Capability Selection

When a run starts, BureauOS should select capabilities based on:

- run type
- project
- agent role
- policy
- risk class
- owner approvals
- available connectors
- required evidence
- model capability metadata
- budget tier limits

Example:

```text
Run type: mobile app proposal

Agents:
- Product: no code tools
- UX: design templates, browser references
- Development: Codex runtime, repo read, architecture estimation
- Pricing: pricing memory, proposal templates
- Compliance: policy memory, client permissions
- Proposal: document templates
```

## Provider Route Controls

Model routing is explicit. BureauOS does not silently move from one billing path to another.

Each provider connector exposes model metadata:

- `capabilities`: examples include `chat`, `reasoning`, `coding`, `vision`, `streaming`, `tool-use`, `oauth`, `local`, and `low-cost`
- `budget_tier`: one of `free`, `low`, `standard`, `high`, `premium`

Agents can request additional model capabilities and budget ceilings:

```yaml
agents:
  social:
    provider: openai
    model: gpt-5.4-nano
    required_model_capabilities:
      - chat
    max_budget_tier: standard
    prefer_low_cost: true

  security:
    provider: anthropic
    model: claude-sonnet-4-6
    required_model_capabilities:
      - reasoning
    max_budget_tier: high
```

The router only evaluates the owner-approved route or explicit chain. `openai-codex` OAuth remains isolated from `openai` API-key billing even when the OAuth route is unavailable or does not match the requested capability.

## Capability Audit

Every capability use should be auditable.

Record:

- agent
- tool
- action
- target
- approval source
- result
- artifact produced
- risk level

This matters for:

- trust
- debugging
- client safety
- legal/compliance review
- repeatability

## Safety Rule

Capabilities increase power.

Therefore:

```text
More capability requires stronger policy.
```

Drafting is usually safe.

External actions, payments, ad spend, client communication, production deployment, secrets, and destructive operations require explicit policy gates.
