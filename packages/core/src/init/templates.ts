import { CapabilityRegistry } from "@bureauos/capabilities";
import type { BureauConfig } from "../config/schema.js";

/**
 * Static content for the files produced by `bureau init`.
 * Markdown is kept ASCII-only for maximum portability.
 */

export function rootMemory(orgName: string, isoDate: string): string {
  return `# BureauOS Root Memory

> Workspace: ${orgName}
> Generated: ${isoDate}

This file is the always-loaded executive index. It is intentionally compact.

It is the **map** of memory, not memory itself. Deeper context lives in:
- COMPANY.md, CLIENTS.md, PROJECTS.md, DECISIONS.md
- BRAND.md, OFFERS.md, CHANNELS.md, LEADS.md, CAMPAIGNS.md
- PRICING.md, PROPOSALS.md, COMPLIANCE.md, APPROVALS.md, PUBLIC_CLAIMS.md
- clients/<slug>/, projects/<slug>/, runs/<id>.md
- memory/<YYYY-MM-DD>.md (daily notes)

## Active Context

(empty)

## Active Clients

(none)

## Active Projects

(none)

## Current Priorities

(none)

## Blockers

(none)

## Recent Decisions

(none)

## Standing Policies

See POLICIES.md.

## Risk Register

(empty)

## Topics Index

(empty)

## Retrieval Map

- Company facts: COMPANY.md
- Per-client memory: clients/<slug>/
- Per-project memory: projects/<slug>/
- Daily operational notes: memory/<YYYY-MM-DD>.md
- Durable decisions: DECISIONS.md
- Active approvals: APPROVALS.md
- Brand and offers: BRAND.md, OFFERS.md
- Growth pipeline: LEADS.md, CAMPAIGNS.md, CONVERSION_NOTES.md
- Commercial: PRICING.md, PROPOSALS.md
`;
}

export function companyMemory(orgName: string, isoDate: string): string {
  return `# Company Memory

> Workspace: ${orgName}
> Generated: ${isoDate}

Global operating knowledge for the company.

## Owner Preferences

(to be filled by the owner)

## Communication Rules

(default: drafts only, no external send without approval)

## Delivery Standards

(default: small scoped PRs, tests required for code changes, security review for auth and payments)

## Active Offers

See OFFERS.md.

## Active Channels

See CHANNELS.md.

## Brand Positioning

See BRAND.md.

## Agency Priorities

(none yet)
`;
}

export function policies(config: BureauConfig): string {
  const a = config.autonomy;
  const g = config.growth_autonomy;
  const l = config.limits;
  return `# Standing Policies

Generated from bureauos.yaml. Edit the YAML and re-run \`bureau config validate\` to update.

## Autonomy

- observe_signals: ${a.observe_signals}
- start_triage_runs: ${a.start_triage_runs}
- create_issues: ${a.create_issues}
- comment_on_issues: ${a.comment_on_issues}
- create_branches: ${a.create_branches}
- push_commits: ${a.push_commits}
- open_pull_requests: ${a.open_pull_requests}
- merge_pull_requests: ${a.merge_pull_requests}
- deploy_production: ${a.deploy_production}
- contact_clients_directly: ${a.contact_clients_directly}

## Growth Autonomy

- draft_content: ${g.draft_content}
- draft_campaigns: ${g.draft_campaigns}
- draft_proposals: ${g.draft_proposals}
- publish_public_content: ${g.publish_public_content}
- send_client_messages: ${g.send_client_messages}
- run_paid_ads: ${g.run_paid_ads}
- send_final_proposals: ${g.send_final_proposals}
- accept_projects: ${g.accept_projects}
- launch_ad_campaigns: ${g.launch_ad_campaigns}
- change_ad_budget: ${g.change_ad_budget}

## Limits

- max_retries_per_task: ${l.max_retries_per_task}
- max_files_changed_without_human_review: ${l.max_files_changed_without_human_review}
- require_tests_for_code_changes: ${l.require_tests_for_code_changes}
- require_security_review_for_auth_changes: ${l.require_security_review_for_auth_changes}
- require_security_review_for_payment_changes: ${l.require_security_review_for_payment_changes}
- require_human_for_destructive_actions: ${l.require_human_for_destructive_actions}
`;
}

export function emptyIndex(title: string, hint: string): string {
  return `# ${title}

${hint}

(none yet)
`;
}

export function emptyDailyNote(isoDate: string): string {
  return `# ${isoDate}

## Events

(none yet)

## Runs

(none yet)

## Decisions

(none yet)

## Follow-ups

(none yet)
`;
}

function yamlString(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function renderStringList(values: readonly string[], indent: string): string {
  if (values.length === 0) return `${indent}[]`;
  return values.map((value) => `${indent}- ${yamlString(value)}`).join("\n");
}

function capabilityConfigYaml(config: BureauConfig): string {
  const capabilities = CapabilityRegistry.fromConfig(config.capabilities).list();
  return `capabilities:
${capabilities
  .map((capability) => {
    const actions = Object.entries(capability.actions);
    return `  ${capability.id}:
    name: ${yamlString(capability.name)}
    description: ${yamlString(capability.description)}
    type: "${capability.type}"
    allowed_agents:
${renderStringList(capability.allowed_agents, "      ")}
    actions:
${actions.map(([action, enabled]) => `      ${action}: ${enabled}`).join("\n") || "      {}"}
    required_approvals:
${renderStringList(capability.required_approvals, "      ")}
    risk_class: "${capability.risk_class}"
    audit_required: ${capability.audit_required}
    status: "${capability.status}"${
      capability.connector ? `\n    connector: ${yamlString(capability.connector)}` : ""
    }`;
  })
  .join("\n")}`;
}

export function defaultConfigYaml(config: BureauConfig, orgName: string): string {
  // We render YAML by hand instead of using js-yaml's dump so that the
  // output stays close to examples/bureauos.example.yaml and human-readable.
  const a = config.autonomy;
  const g = config.growth_autonomy;
  const l = config.limits;
  const m = config.memory;
  return `organization:
  name: "${orgName.replace(/"/g, '\\"')}"

setup:
  preset: "${config.setup.preset}"
  mode: "${config.setup.mode}"
  generated_by: "bureau init"
  advanced_config_required: false

interface:
  enabled: ${config.interface.enabled}
  mode: "${config.interface.mode}"
  mobile_first: ${config.interface.mobile_first}

supreme_coordinator:
  provider: "${config.supreme_coordinator.provider}"
  model: "${config.supreme_coordinator.model}"
  user_facing: ${config.supreme_coordinator.user_facing}
  always_on: ${config.supreme_coordinator.always_on}

autonomy:
  observe_signals: ${a.observe_signals}
  start_triage_runs: ${a.start_triage_runs}
  create_internal_reports: ${a.create_internal_reports}
  create_issues: ${a.create_issues}
  comment_on_issues: ${a.comment_on_issues}
  create_branches: ${a.create_branches}
  push_commits: ${a.push_commits}
  open_pull_requests: ${a.open_pull_requests}
  merge_pull_requests: ${a.merge_pull_requests}
  deploy_production: ${a.deploy_production}
  contact_clients_directly: ${a.contact_clients_directly}

growth_autonomy:
  draft_content: ${g.draft_content}
  draft_campaigns: ${g.draft_campaigns}
  draft_replies: ${g.draft_replies}
  draft_proposals: ${g.draft_proposals}
  update_internal_pipeline: ${g.update_internal_pipeline}
  publish_public_content: ${g.publish_public_content}
  send_client_messages: ${g.send_client_messages}
  run_paid_ads: ${g.run_paid_ads}
  change_pricing: ${g.change_pricing}
  send_final_proposals: ${g.send_final_proposals}
  accept_projects: ${g.accept_projects}
  publish_social_posts: ${g.publish_social_posts}
  generate_public_creatives: ${g.generate_public_creatives}
  launch_ad_campaigns: ${g.launch_ad_campaigns}
  change_ad_budget: ${g.change_ad_budget}
  allow_one_off_owner_approval: ${g.allow_one_off_owner_approval}
  require_action_sensitive_memory_for_approval: ${g.require_action_sensitive_memory_for_approval}

provider: {}
disabled_providers: []

${capabilityConfigYaml(config)}

limits:
  max_retries_per_task: ${l.max_retries_per_task}
  max_files_changed_without_human_review: ${l.max_files_changed_without_human_review}
  require_tests_for_code_changes: ${l.require_tests_for_code_changes}
  require_security_review_for_auth_changes: ${l.require_security_review_for_auth_changes}
  require_security_review_for_payment_changes: ${l.require_security_review_for_payment_changes}
  require_human_for_destructive_actions: ${l.require_human_for_destructive_actions}

memory:
  coordinator_has_global_access: ${m.coordinator_has_global_access}
  isolate_projects: ${m.isolate_projects}
  write_decision_records: ${m.write_decision_records}
  verify_live_state_when_cheap: ${m.verify_live_state_when_cheap}
  retain_raw_history: ${m.retain_raw_history}
  promote_daily_notes_to_durable_memory: ${m.promote_daily_notes_to_durable_memory}
  root_memory_always_loaded: ${m.root_memory_always_loaded}
`;
}

export function executiveReport(orgName: string, isoDate: string): string {
  return `# Executive Report

<!-- bureauos:artifact type="executive-report" -->

> Workspace: ${orgName}
> Period: ${isoDate} (initialization)

## Completed

- BureauOS workspace initialized via \`bureau init\`.

## Revenue / Opportunities

(none yet)

## In Progress

(none yet)

## Blocked

(none yet)

## Risks

(none yet)

## Decisions Needed

- Connect OpenAI Codex through the desktop OAuth flow or explicitly choose a separate API-key provider.
- Connect GitHub if you want delivery operations to flow through PRs (\`bureau github connect\`).
- Define the first offer (edit BRAND.md and OFFERS.md).

## Approvals Needed

(none yet)

## Next Autonomous Actions

- Once a provider is connected, the supreme coordinator will draft the first business operating report.
`;
}
