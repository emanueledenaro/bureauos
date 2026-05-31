# CLI Reference

`bureau` is the command-line entry point to the BureauOS kernel. Every command
operates on a local `.bureauos/` workspace and is local-first: no external
provider, GitHub, Linear, client, billing, merge, or deploy action runs unless
you explicitly supply credentials and the policy engine allows it.

This page documents every subcommand and flag derived from
[`packages/cli/src/main.ts`](../packages/cli/src/main.ts). For a guided demo see
[Getting Started](./getting-started.md).

## Invocation

After a build the binary is at `packages/cli/dist/bin/bureau.js`:

```bash
pnpm -r run build
node packages/cli/dist/bin/bureau.js <command> [options]
```

For shorter commands during local testing:

```bash
export BUREAU="$PWD/packages/cli/dist/bin/bureau.js"
node "$BUREAU" --help
```

Most commands require an initialized workspace and run against `process.cwd()`.
`bureau init` is the exception and creates the workspace.

### Global flags

| Flag | Description |
| --- | --- |
| `--help`, `-h`, `help` | Print usage and exit. |
| `--version`, `-v`, `version` | Print the kernel version and exit. |

Flag parsing accepts `--name value` and registered single-letter aliases such as
`-n`. Boolean flags take no value. Unknown options and missing values produce an
error.

## Workspace

### `bureau init`

Initialize a new BureauOS workspace (`.bureauos/`) with config, memory,
approvals, artifacts, audit log, and a first executive report. No external calls.

| Flag | Alias | Type | Description |
| --- | --- | --- | --- |
| `--preset` | `-p` | string | `freelancer`, `agency`, `startup`, or `operator`. |
| `--name` | `-n` | string | Organization name. |
| `--force` | `-f` | boolean | Overwrite an existing workspace. |
| `--help` | `-h` | boolean | Print init-specific usage. |

```bash
node "$BUREAU" init --name "Demo Agency" --preset freelancer
```

### `bureau status`

Show the company pulse: workspace name, preset, mode, and counts of clients,
projects, opportunities, runs, and pending approvals.

### `bureau intake`

Let the Supreme Coordinator turn a natural-language message into client,
project, opportunity, run, artifact, and approval records.

| Flag | Alias | Type | Description |
| --- | --- | --- | --- |
| `--message` | `-m` | string | Required. The opportunity description. |
| `--client` | `-c` | string | Override the inferred client name. |
| `--project` | `-p` | string | Override the inferred project name. |
| `--source` | | string | Intake source label (default `cli`). |
| `--value` | | number | Expected opportunity value. |
| `--margin` | | number | Expected margin. |
| `--industry` | | string | Client industry. |

```bash
node "$BUREAU" intake --message "A restaurant wants a booking website" --value 5000
```

### `bureau config validate [path]`

Validate the local `bureauos.yaml` (or a path argument) against the schema and
print the organization name and preset on success.

## Memory

### `bureau memory search <query>`

Search executive and project memory and print ranked hits with score, path, and
a snippet. Uses the SQLite FTS5 index when the Node runtime exposes `node:sqlite`
and falls back to a Markdown scan otherwise.

### `bureau memory index status` / `bureau memory index rebuild`

Inspect or rebuild the SQLite FTS5 search index over Markdown memory.

- `status` reports whether the index is available, its path, the document count,
  and whether it is stale relative to the Markdown source of truth.
- `rebuild` regenerates the index from the Markdown files and reports the
  document count.

The index lives at the configured `memory.search_index` path (default
`.bureauos/memory/indexes/memory.sqlite`). When `node:sqlite` is unavailable in
the runtime, the command exits cleanly and reports the index as unavailable;
search then falls back to a Markdown scan. Any other subcommand exits non-zero
with `memory index: expected "status" or "rebuild"`.

### `bureau memory consolidate`

Regenerate `ROOT.md` — the Supreme Coordinator's always-loaded executive index —
from current workspace state. Its managed sections (clients in play, active
projects, priorities, blockers, recent decisions, risk register, topics) are
rebuilt deterministically from the registries and `DECISIONS.md`; the static
Retrieval Map and Standing Policies scaffolding is preserved. No model is used,
so it never invents facts. The write is atomic and every run is audited
(`memory.root.consolidated`). The daemon also runs this daily when
`memory.promote_daily_notes_to_durable_memory` is enabled.

### `bureau decision`

Append a decision record to `DECISIONS.md` (and cross-link a run when given).

| Flag | Type | Description |
| --- | --- | --- |
| `--what` | string | Required. What was decided. |
| `--why` | string | Required. Why. |
| `--actor` | string | Actor (default `owner`). |
| `--run` | string | Run id to cross-link. |
| `--affects` | string | Comma-separated list of affected entities. |

### `bureau follow-up`

Append a line to today's daily note under a chosen section.

| Flag | Type | Description |
| --- | --- | --- |
| `--section` | string | `Events`, `Runs`, `Decisions`, or `Follow-ups` (default `Follow-ups`). |
| `--line` | string | Required. The note text. |

## Registries

### Clients

| Command | Description |
| --- | --- |
| `client create --name <n> [--status s] [--industry i]` | Create a client. `--status` is `lead`/`active`/`paused`/`churned`. |
| `client list` | List clients (id, slug, status, name). |
| `client intelligence` | Print value, delivery, and relationship summary per client. |
| `client account-plan [--client slug] [--run id]` | Generate client account plan artifacts from intelligence. |
| `client success-status [--client slug] [--run id]` | Generate client-success status reports and draft follow-ups. |

`client create` also accepts `-n` for `--name`. `--client` has alias `-c` on the
account-plan and success-status subcommands.

### Projects

| Command | Description |
| --- | --- |
| `project create --name <n> --client <slug> [...]` | Create a project linked to a client. |
| `project list` | List projects (id, slug, status, PM, name). |
| `project dispatch --project <slug> [...]` | Create a scoped PM packet and specialist handoffs. |
| `project health [--project slug] [--run id]` | Generate project health review artifacts. |
| `project verify-repositories [--project slug] [...]` | Verify linked repositories without mutating code. |

`project create` flags: `--name`/`-n`, `--client`/`-c`, `--status`, `--repo`,
`--stack`, `--manager-agent`, `--team-agents` (comma-separated). Status is one of
`intake`, `proposal`, `approved`, `in_progress`, `blocked`, `delivered`,
`cancelled`.

`project dispatch` flags: `--project`/`-p`, `--type`/`-t` (a run type, default
`planning`), `--scope`/`-s`, `--briefing`/`-b`.

`project verify-repositories` flags: `--project`/`-p`, `--token`, `--run`,
`--stale-days`. Without a `--token` or `GITHUB_TOKEN`, live GitHub state is not
checked.

### Opportunities

| Command | Description |
| --- | --- |
| `opportunity create --title <t> --source <s> --client <slug> [--value v] [--margin m]` | Create an opportunity. |
| `opportunity list` | List opportunities (id, status, title). |

Aliases: `--title`/`-t`, `--source`/`-s`, `--client`/`-c`, `--value`/`-v`,
`--margin`/`-m`.

### Revenue

`revenue pipeline [--opportunity id] [--max-opportunities n] [--run id]`

Qualify opportunities and draft pricing/proposal work, printing pipeline value
and per-opportunity fit, stage, and generated artifacts. `--opportunity` has
alias `-o`.

### Growth

| Command | Description |
| --- | --- |
| `growth memory` (or `growth memory show`) | Show brand, offer, and channel memory sections. |
| `growth memory set [--brand t] [--offers t] [--channels t]` | Update growth memory sections. |
| `growth content [--max-drafts n] [--focus t] [--run id]` | Generate draft-only social/campaign/creative/ads content. |
| `growth review [--recent-days n] [--run id]` | Generate a growth review artifact with recommendations. |

## Runs and audit

### `bureau run new`

Start a run through the coordinator dispatcher (or a stub).

| Flag | Alias | Type | Description |
| --- | --- | --- | --- |
| `--type` | `-t` | string | Required. A run type (see below). |
| `--scope` | `-s` | string | Required. The run scope. |
| `--client` | `-c` | string | Client slug. |
| `--project` | `-p` | string | Project slug. |
| `--source` | | string | Trigger source label. |
| `--linear-issue` | | string | Link a Linear issue id as the source work item. |
| `--linear-url` | | string | Linear issue URL paired with `--linear-issue`. |
| `--stub` | | boolean | Use a stub dispatcher (no coordinator dispatch). |

Run types: `feature`, `bug`, `review`, `release`, `planning`, `retrospective`,
`visibility`, `content`, `campaign`, `conversion`, `sales`, `social`,
`creative`, `ads`, `compliance`, `client_success`, `intake`, `health_check`.

### `bureau run list`

List runs (id, type, status, source work item, scope).

### `bureau autonomy memory-scan`

Start due follow-up runs from durable memory (`memory_due` triggers) and report
triggered and skipped items.

### `bureau autonomy retry-scan [--max-attempts n]`

Retry failed/blocked runs within policy limits, escalating to approval when the
attempt budget is exhausted. Defaults to `limits.max_retries_per_task` from
config.

### `bureau audit tail [-n N]`

Print the last `N` audit log entries (default 20). `-n` is an alias for
`--limit`.

### `bureau audit search <query>`

Print audit log entries that contain the query string (case-insensitive).

## Reports

`report generate`

Generate executive, cross-project, and business operating reports from the real
registries, printing report ids, pipeline value, and portfolio size.

## Policy

`policy explain <action> [--actor a] [--target t]`

Evaluate an action against the policy engine and print the autonomy level,
outcome, allow/deny result, reason, and any required gates. Actor defaults to
`owner`.

## Approvals

| Command | Description |
| --- | --- |
| `approvals list` | List pending approvals with scope, source, limit, and expiry. |
| `approvals approve <id> [--reason r]` | Approve a pending approval. |
| `approvals reject <id> [--reason r]` | Reject a pending approval. |

## Providers

BureauOS is model-agnostic. Credentials are stored in the workspace auth store
(`.bureauos/auth/providers.json`), never in the repository, and secrets are
masked on display. See [Providers](./providers.md).

### `bureau auth login`

| Flag | Alias | Type | Description |
| --- | --- | --- | --- |
| `--provider` | `-p` | string | Required. `openai-codex`, `openai`, `anthropic`, `google`, `local`, `openrouter`, or `custom`. |
| `--id` | | string | Credential id (defaults to `<provider>-default`). |
| `--mode` | | string | `oauth`, `api-key`, or `local`. |
| `--api-key` | | string | API key for API providers. |
| `--access-token` | | string | OAuth access token (e.g. `openai-codex`). |
| `--refresh-token` | | string | OAuth refresh token. |
| `--expires-at` | | string | Token expiry. |
| `--base-url` | | string | Custom/local endpoint base URL. |
| `--model` | | string | Default model for the route. |

```bash
node "$BUREAU" auth login --provider openai --api-key "$OPENAI_API_KEY" --model gpt-5.5
node "$BUREAU" auth login --provider local --base-url http://localhost:11434 --model qwen3-coder
```

### `bureau auth list`

List stored credentials with masked secrets, mode, endpoint, and default model.

### `bureau auth logout --provider p [--id provider-default]`

Remove a stored credential. `--provider` has alias `-p`.

### `bureau providers list`

List configured provider adapters with type, id, credential source, and
validation status, plus the coordinator's configured provider and model.

## Capabilities

| Command | Description |
| --- | --- |
| `capabilities list` | Show agent tool/runtime capability boundaries, enabled actions, risk class, allowed agents, and required approvals. |
| `capabilities check --agent A --capability C --action X [...]` | Audit a policy-bounded capability-use request and write a `capability-audit` artifact. |

`capabilities check` flags: `--agent`, `--capability`, `--action` (all
required), plus optional `--target`, `--policy-action`, `--issue`, `--test`,
`--approval`.

## Server

| Command | Description |
| --- | --- |
| `serve [--port N]` | Start the local HTTP API server (foreground). |
| `daemon start [--port N]` | Start scheduler + API server in the background. |
| `daemon stop` | Stop the recorded daemon process. |
| `daemon status` | Show daemon PID, API URL, and scheduler heartbeat. |
| `daemon run [--port N]` | Run scheduler + API server in the foreground. |

`--port` has alias `-p`. `daemon` with no subcommand (or only flags) runs the
foreground daemon. The server reads `GITHUB_TOKEN` and `GITHUB_WEBHOOK_SECRET`
from the environment when present.

## GitHub

All live GitHub commands require a token via `--token` or `GITHUB_TOKEN`, and
write actions are policy-gated. Use a disposable test repository for demos. See
[GitHub Native Workflow](./github-native-workflow.md).

| Command | Description |
| --- | --- |
| `github provision-repo --project slug --owner O [...]` | Create and link a policy-gated repository (private by default). |
| `github draft-issues --project slug` | Generate GitHub-ready issue drafts from project artifacts (no token needed). |
| `github create-issues --project slug --owner O --repo R [...]` | Create issues from approved drafts under policy. |
| `github create-pr --project slug --owner O --repo R --head H --title T [...]` | Open a policy-gated pull request. |
| `github ensure-labels --owner O --repo R` | Apply the BureauOS label taxonomy. |
| `github sync --owner O --repo R [...]` | Pull issues, PRs, and check signals into memory and trigger runs. |

`github provision-repo` flags: `--project`/`-p`, `--owner`, `--repo`, `--token`,
`--org`, `--public`, `--private`, `--description`, `--auto-init`. Visibility is
private unless `--public` is passed; `--public` and `--private` are mutually
exclusive.

`github create-issues` flags: `--project`/`-p`, `--owner`, `--repo`, `--token`,
`--no-labels`.

`github create-pr` flags: `--project`/`-p`, `--owner`, `--repo`, `--token`,
`--title`/`-t`, `--body`/`-b`, `--head`, `--base`, `--draft`, `--issue`,
`--test`. Linked issue and test evidence are policy gates for PR creation.

`github sync` flags: `--owner`, `--repo`, `--token`, `--state`
(`open`/`closed`/`all`), `--client`, `--project`, `--stale-days`, `--no-issues`,
`--no-prs`, `--no-checks`.

## Exit codes

Commands return `0` on success and `1` on error. Errors are written to stderr as
`bureau: <message>`.

## See also

- [Getting Started](./getting-started.md)
- [Owner Interface](./owner-interface.md)
- [Providers](./providers.md)
- [Autonomy Policy](./autonomy-policy.md)
- [Capabilities and Integrations](./capabilities-and-integrations.md)
- [Implementation Coverage](./implementation-coverage.md)
