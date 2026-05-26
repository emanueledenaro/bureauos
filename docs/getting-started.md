# Getting Started

This guide takes a fresh clone to a safe local BureauOS demo. It is written for
v1 readiness, where BureauOS is a local-first, policy-driven foundation. The
demo uses drafts, local artifacts, local memory, and policy gates. It does not
send client messages, publish content, launch ads, merge pull requests, or
deploy production systems.

## Prerequisites

- Node.js 20 or newer
- pnpm 9 or newer
- Git
- Optional: a model provider key or local model endpoint
- Optional: a GitHub token for a disposable test repository
- Optional: host-provided Linear MCP access through your assistant/client

## Install

```bash
git clone https://github.com/emanueledenaro/bureauos
cd bureauos
pnpm install
pnpm -r run build
pnpm -r run test
```

The CLI entrypoint after build is:

```bash
node packages/cli/dist/bin/bureau.js --help
```

For shorter commands during local testing:

```bash
export BUREAU="$PWD/packages/cli/dist/bin/bureau.js"
```

## Create A Safe Demo Workspace

Use a separate directory for the demo workspace so generated memory, artifacts,
auth files, and audit logs never mix with repository source files.

```bash
mkdir -p /tmp/bureauos-demo
cd /tmp/bureauos-demo
node "$BUREAU" init --name "Demo Agency" --preset freelancer
node "$BUREAU" status
node "$BUREAU" audit tail -n 5
```

`bureau init` creates a local `.bureauos/` directory with config, memory,
approvals, artifacts, and audit files. It does not call external providers or
take external actions.

## Check Safe Policy Defaults

Open `.bureauos/bureauos.yaml` and keep these defaults disabled for a safe demo:

```yaml
autonomy:
  merge_pull_requests: false
  deploy_production: false
  contact_clients_directly: false

growth_autonomy:
  publish_public_content: false
  send_client_messages: false
  run_paid_ads: false
  change_pricing: false
  send_final_proposals: false
  accept_projects: false
  launch_ad_campaigns: false
  change_ad_budget: false
```

To inspect a policy decision:

```bash
node "$BUREAU" policy explain open_pull_requests --actor supreme_coordinator
node "$BUREAU" policy explain merge_pull_requests --actor supreme_coordinator
node "$BUREAU" policy explain deploy_production --actor supreme_coordinator
```

See [Autonomy Policy](./autonomy-policy.md) for the full boundary model.

## Add Demo Business State

Create a small local client/project/opportunity set:

```bash
node "$BUREAU" client create --name "Acme Demo"
node "$BUREAU" project create \
  --name "Website Refresh" \
  --client acme-demo \
  --stack "Next.js"
node "$BUREAU" opportunity create \
  --title "Booking Flow" \
  --source owner_chat \
  --client acme-demo \
  --value 5000
node "$BUREAU" status
```

Run a safe local planning workflow:

```bash
node "$BUREAU" run new \
  --type planning \
  --scope "Prepare a safe demo delivery plan for Website Refresh" \
  --project website-refresh
node "$BUREAU" run list
node "$BUREAU" audit tail -n 20
```

Without provider credentials, agents use deterministic local fallbacks and write
artifacts instead of claiming live external work.

## Provider Auth

BureauOS keeps provider credentials outside the repository. CLI auth records are
stored in the workspace auth store and secrets are masked in `auth list`.

Examples:

```bash
node "$BUREAU" auth login \
  --provider openai \
  --api-key "$OPENAI_API_KEY" \
  --model gpt-5.5

node "$BUREAU" auth login \
  --provider anthropic \
  --api-key "$ANTHROPIC_API_KEY" \
  --model claude-sonnet-4-6

node "$BUREAU" auth login \
  --provider local \
  --base-url http://localhost:11434 \
  --model qwen3-coder

node "$BUREAU" auth list
node "$BUREAU" providers list
```

OpenAI Codex OAuth is a separate provider route from OpenAI API keys. In the
desktop app, use Settings for browser OAuth. In CLI-only demos, connect
`openai-codex` only when you already have an access token available:

```bash
node "$BUREAU" auth login \
  --provider openai-codex \
  --access-token "$OPENAI_CODEX_ACCESS_TOKEN" \
  --model gpt-5.3-codex
```

See [Providers](./providers.md) for routing and credential details.

## Linear And GitHub Setup

Linear is modeled as a capability boundary. The repository runtime does not
store Linear credentials. For live Linear issue reads/comments/updates, connect
the Linear MCP app in the host assistant/client and let the host perform those
tool calls under BureauOS policy.

Local capability checks can still be inspected:

```bash
node "$BUREAU" capabilities list
node "$BUREAU" capabilities check \
  --agent supreme_coordinator \
  --capability linear \
  --action read_issues
```

GitHub live actions require a token in the shell or a `--token` flag. Use a
disposable test repository for demos.

Safe local draft generation, no token required:

```bash
node "$BUREAU" github draft-issues --project website-refresh
```

Live GitHub test-repo actions:

```bash
export GITHUB_TOKEN="..."
node "$BUREAU" github ensure-labels --owner YOUR_USER --repo bureauos-demo
node "$BUREAU" github create-issues --project website-refresh --owner YOUR_USER --repo bureauos-demo
```

Draft PR creation requires linked work and test evidence. Merge and production
deploy stay separate approval-gated actions.

See [GitHub Native Workflow](./github-native-workflow.md) and
[Phase 8 Linear PR Execution](./phase-8-linear-pr-execution.md).

## Start The Local API

From the demo workspace:

```bash
node "$BUREAU" serve --port 3030
```

The server prints the local API URL. Stop it with `Ctrl+C`.

For daemon mode:

```bash
node "$BUREAU" daemon run --port 3030
```

In another terminal:

```bash
node "$BUREAU" daemon status
node "$BUREAU" daemon stop
```

Daemon behavior is still a local-first foundation. Keep production integrations
off for a safe demo.

## Start The ElectronJS Operating Room

From the repository root:

```bash
cd /path/to/bureauos
BUREAUOS_WORKSPACE=/tmp/bureauos-demo pnpm --filter @bureauos/interface run dev
```

The Electron main process starts the local API against `BUREAUOS_WORKSPACE` and
the renderer displays kernel state from that workspace.

## Safe Demo Flow

Use this sequence for a v1-style demo:

1. Initialize `/tmp/bureauos-demo`.
2. Create one client, one project, and one opportunity.
3. Run `status`, `audit tail`, and a planning run.
4. Generate draft GitHub issues locally.
5. Open the ElectronJS Operating Room against the demo workspace.
6. Inspect memory, artifacts, approvals, reports, provider settings, and audit
   events.
7. Show that merge, deploy, client sends, public publishing, and paid ads are
   disabled by default.

## Troubleshooting

Missing provider credentials:

- Run `node "$BUREAU" auth list`.
- Confirm the provider route in `.bureauos/bureauos.yaml`.
- Use Settings in ElectronJS for browser OAuth where available.
- Without credentials, BureauOS should use local deterministic fallbacks instead
  of claiming provider-backed work.

GitHub token errors:

- Commands such as `github create-issues`, `github ensure-labels`,
  `github sync`, and `github create-pr` need `GITHUB_TOKEN` or `--token`.
- Use a test repository. Do not point the demo at production delivery repos.

Linear MCP auth errors:

- Connect the Linear app in the host assistant/client.
- BureauOS models Linear as a capability boundary; it does not embed a Linear
  token in the repository runtime.
- If the host MCP layer is unavailable, use local run scopes and artifacts
  instead of live Linear updates.

Policy denials:

- Run `node "$BUREAU" policy explain <action>`.
- Check `node "$BUREAU" approvals list`.
- Keep denied actions denied for the safe demo unless you are testing approval
  behavior in a disposable environment.

Daemon already running:

- Run `node "$BUREAU" daemon status`.
- Stop it with `node "$BUREAU" daemon stop`.
- If a stale process exists, restart from a clean terminal and inspect the audit
  log.

Private local files before PR:

- Run `pnpm run private-context:check` from the repository root.
- Review [Repository Hygiene](./repository-hygiene.md).

## Next Reading

- [v1 Acceptance Checklist](./v1-acceptance-checklist.md)
- [Implementation Coverage](./implementation-coverage.md)
- [Capabilities and Integrations](./capabilities-and-integrations.md)
- [Repository Hygiene](./repository-hygiene.md)
