# BureauOS Protocol

The BureauOS protocol defines how an autonomous AI software agency represents work.

It is intentionally provider-agnostic. Any model or runtime can implement an agent if it can consume context, produce artifacts, and respect policy.

## Primitive Types

### Organization

```yaml
id: org_001
name: Example Agency
supreme_coordinator: agent_executive
policies:
  autonomy_level: 2
  merge_pull_requests: false
  deploy_production: false
clients:
  - client_acme
projects:
  - project_webapp
```

### Executive Memory

```yaml
id: executive_memory
owner: agent_executive
scope: global
always_loaded:
  - ROOT.md
retrievable:
  - COMPANY.md
  - CLIENTS.md
  - PROJECTS.md
  - DECISIONS.md
  - ACTIVE_WORK.md
  - RISKS.md
  - memory/*.md
  - clients/*/*.md
  - projects/*/*.md
  - runs/*.md
search_index:
  type: hybrid
  keyword: true
  semantic: true
  direct_get: true
```

### Client

```yaml
id: client_acme
name: Acme
projects:
  - project_webapp
memory_scope: client
communication:
  external_contact_allowed: false
```

### Project

```yaml
id: project_webapp
client_id: client_acme
repository: github.com/acme/webapp
pm_agent: agent_pm_webapp
memory_scope: project
default_branch: main
test_commands:
  - npm test
```

### Offer

```yaml
id: offer_ai_software_team
owner: org_001
audience: funded_startups
status: active
channels:
  - website
  - github
  - linkedin
proof_assets:
  - case_study_relay
conversion_path:
  - landing_page
  - discovery_call
  - proposal
```

### Opportunity

```yaml
id: opportunity_mobile_app_001
source: owner_intake
client_id: client_acme
status: intake
business_need: mobile booking app
expected_value: unknown
delivery_feasibility: pending
pricing_status: pending
proposal_status: draft_required
owner_approval_required:
  - final_scope
  - final_price
  - client_send
```

### Lead

```yaml
id: lead_001
source: linkedin
status: qualified
fit: high
assigned_to: sales
next_action: draft_follow_up
external_contact_allowed: false
```

### Agent

```yaml
id: agent_product
role: product
scope: project
permissions:
  read_context: true
  write_artifacts: true
  edit_code: false
  open_pr: false
```

### Capability

```yaml
id: capability_codex_runtime
type: runtime
provider: codex
allowed_agents:
  - development
  - reviewer
  - qa
actions:
  read_repo: true
  edit_code: true
  run_tests: true
  open_pr: true
  merge_pr: false
audit_required: true
```

### Skill

```yaml
id: skill_frontend_app_builder
type: skill
allowed_agents:
  - development
  - ux
run_types:
  - feature
  - client_project
  - landing_page
requires_approval: false
```

### MCP Tool

```yaml
id: mcp_github
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
```

### Run

A run is one executable unit of agency work.

```yaml
id: run_123
type: feature
status: in_progress
trigger:
  type: event
  source: github_check_failed
project_id: project_webapp
created_by: executive_coordinator
agents:
  - product
  - ux
  - qa
  - security
  - development
artifacts:
  - artifact_feature_spec
  - artifact_design_spec
decisions:
  - decision_split_auth_work
```

### Signal

A signal is an observed event or scheduled check that may become work.

```yaml
id: signal_001
source: github
kind: check_failed
project_id: project_webapp
observed_at: 2026-05-24T14:00:00Z
payload_ref: github_check_123
classified_as: bug
priority: high
run_created: run_123
```

Run types may include software delivery or growth work:

```text
feature
bug
review
release
planning
retrospective
visibility
content
campaign
conversion
sales
social
creative
ads
compliance
client_success
```

Trigger types:

```text
owner_request
event
schedule
threshold
memory_due
health_check
external_signal
```

### Task

```yaml
id: task_456
run_id: run_123
assigned_to: product
status: completed
input_artifacts: []
output_artifacts:
  - artifact_feature_spec
```

### Artifact

```yaml
id: artifact_feature_spec
type: feature_spec
run_id: run_123
created_by: product
location:
  system: github
  url: https://github.com/org/repo/issues/12#issuecomment-...
status: accepted
```

### Decision

```yaml
id: decision_789
run_id: run_123
owner: executive_coordinator
decision: Split Google login into auth setup, UI flow, and test coverage.
reason: The change touches security-sensitive auth and user-facing UX.
rejected:
  - Single broad PR
impact:
  - Create three linked issues
```

### Agent Message

Agent messages are internal protocol events. They are not the primary memory.

```yaml
id: msg_001
run_id: run_123
from: project_manager
to: security
type: assignment
content_ref: artifact_feature_spec
expected_output: security_review
```

## Run Status

```text
created
context_loading
planning
dispatching
in_progress
blocked
needs_human
verifying
completed
failed
cancelled
```

## Task Status

```text
queued
assigned
in_progress
needs_input
completed
failed
skipped
```

## Artifact Status

```text
draft
submitted
accepted
rejected
superseded
```

## Run Lifecycle

```text
1. Intake
2. Project routing
3. Context loading
4. Planning
5. Dispatch
6. Specialist execution
7. Artifact validation
8. Decision logging
9. GitHub update
10. Verification
11. Report
12. Memory write-back
```

## Context Loading Contract

Before an agent acts, it receives a bounded context packet:

```yaml
context_packet:
  run_id: run_123
  role: security
  objective: Review Google login feature for auth and data risks.
  project_brief: artifact_project_brief
  relevant_artifacts:
    - artifact_feature_spec
    - artifact_design_spec
  relevant_decisions:
    - decision_use_existing_auth_layer
  policy:
    require_security_review_for_auth_changes: true
    merge_pull_requests: false
  output_required:
    type: security_review
  capabilities:
    - mcp_github
    - memory_search
    - skill_security_scan
```

## Executive Context Contract

Before routing or deciding, the supreme coordinator receives:

```yaml
executive_context:
  always_loaded:
    - ROOT.md
  required_checks:
    - search_recent_daily_notes
    - search_decisions
    - check_active_work
    - check_project_memory_if_project_is_known
    - check_github_live_state_when_available
  output:
    - routing_decision
    - context_packet
    - policy_check
```

The coordinator is allowed to know everything. The bounded context packet is for downstream agents, not for the coordinator itself.

## Policy Gate Contract

Before any external action, the policy engine should answer:

```yaml
policy_check:
  action: open_pull_request
  actor: development
  project_id: project_webapp
  capability: mcp_github
  allowed: true
  reason: PR creation is enabled at autonomy level 2.
  required_gates:
    - tests_run
    - linked_issue
```

For blocked actions:

```yaml
policy_check:
  action: deploy_production
  actor: release
  allowed: false
  reason: Production deployment requires human approval.
  escalation: needs_human
```

## Conflict Resolution

When agents disagree, the project manager or supreme coordinator creates a decision record.

Example:

```text
Dev Agent: implement in one PR.
Security Agent: split auth work from UI work.
QA Agent: test matrix is too large for one PR.

Decision: split into three issues.
Owner: project manager.
Escalation: not required.
```

## Output Rule

Every run must end with one of:

- completed with artifacts
- blocked with explicit blocker
- failed with evidence
- needs human with a specific question
- cancelled with reason

No run should end as an ambiguous conversation.
