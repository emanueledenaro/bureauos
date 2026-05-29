# Secrets, Credential Rotation, and Local Threat Model

BureauOS is local-first, but local-first does not mean secrets are harmless.
Provider tokens, API keys, OAuth refresh tokens, webhook secrets, and production
credentials can still create real cost, data exposure, or deployment risk.

This guide documents current v1 behavior and the operator rules around it.

## Where Secrets May Live

Allowed locations:

- Environment variables for temporary local sessions or CI jobs.
- `.bureauos/auth/providers.json` for local provider credentials managed by
  `bureau auth login` or the desktop Settings view.
- Future OS keychain storage when implemented for desktop credentials.
- External provider dashboards where keys are created, revoked, and scoped.

Disallowed locations:

- repository files
- `bureauos.yaml`
- `examples/`
- docs, issue comments, PR descriptions, and changelog entries
- memory and artifact files unless the artifact is explicitly a local-only
  credential diagnostic and is never committed
- audit logs
- screenshots or terminal transcripts intended for public issues or PRs

The default provider auth file is:

```text
.bureauos/auth/providers.json
```

The file is written by `ProviderAuthStore` with `0600` permissions. It is local
workspace state, not source code. `.bureauos/` is ignored and must stay out of
public commits.

## Current Auth Store Behavior

Current v1 behavior:

- Provider credentials are not stored in `bureauos.yaml`.
- `bureau auth login` writes credentials to `.bureauos/auth/providers.json`.
- `bureau auth logout` removes the selected credential; if it was the last
  credential, the auth file is removed.
- `bureau auth list`, `bureau providers list`, and provider API responses mask
  API keys and OAuth tokens.
- Audit events record provider id, credential id, and action result; they must
  not include raw secrets.
- Stored credentials are preferred over environment credentials for the same
  provider.
- Environment credentials are loaded only for the matching provider.
- `openai-codex` OAuth and `openai` API-key auth are separate routes. BureauOS
  must not silently fall back from Codex OAuth to OpenAI API billing.

Current v1 non-goals:

- No OS keychain integration yet.
- No encrypted local credential vault yet.
- No team-level secret sharing.
- No hosted credential broker.
- No automatic production credential rotation.

## Environment Variable Fallbacks

Environment variables are useful for short-lived sessions and CI. They are also
easy to leak through shell history, process inspection, logs, or copied command
output.

Supported provider-style environment variables include:

- `OPENAI_CODEX_ACCESS_TOKEN`
- `OPENAI_CODEX_REFRESH_TOKEN`
- `OPENAI_CODEX_EXPIRES_AT`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`
- `OPENROUTER_API_KEY`
- `LOCAL_MODEL_URL`
- `GITHUB_TOKEN`
- `GITHUB_WEBHOOK_SECRET`

Guidance:

- Prefer environment variables for temporary verification and CI.
- Prefer local auth files for single-owner desktop sessions.
- Prefer OS keychain storage once implemented for long-lived desktop secrets.
- Avoid putting secrets in shell aliases, committed scripts, npm scripts, or
  examples.
- Use different credentials for development, staging, and production.

## Credential Rotation

Rotate a credential immediately when:

- it was committed, pasted into a Linear/GitHub issue, or included in a PR body
- it appeared in an artifact, memory file, audit log, screenshot, or terminal
  transcript that may leave the machine
- a laptop, backup, or workspace archive may have been exposed
- a provider account, project, or client relationship changes ownership
- an agent attempted an unexpected external action
- a token has broader scope than the task requires

Suggested rotation process:

1. Revoke or regenerate the credential in the provider dashboard.
2. Remove the local stored credential:

   ```bash
   bureau auth logout --provider openai
   ```

3. Clear any matching environment variable in the current shell.
4. Reconnect with the new scoped credential:

   ```bash
   bureau auth login --provider openai --api-key "$OPENAI_API_KEY"
   ```

5. Run:

   ```bash
   bureau auth list
   bureau providers list
   pnpm run private-context:check
   ```

6. Inspect recent audit logs for unexpected provider use.

For GitHub tokens, prefer the narrowest repository and permission scope that
supports the task. For model providers, use separate keys per environment where
the provider supports it.

## Local Daemon, API, and Electron Threat Model

The v1 daemon/API/Electron boundary assumes a trusted local owner machine. It
does not yet claim hardened multi-user or hostile-host isolation.

### Assets

Protect:

- provider API keys and OAuth refresh tokens
- GitHub tokens and webhook secrets
- local business memory under `.bureauos/memory`
- client/project artifacts
- approval records
- audit logs
- local API control endpoints

### Realistic Local Risks

Credential disclosure:

- shell history captures an API key
- debug output prints a token
- a screenshot includes a masked-but-identifiable secret context
- `.bureauos/` is copied into a public archive

Local API misuse:

- another local process calls the API while it is running
- an Electron renderer bug invokes an unsafe IPC path
- a browser page reaches a development server exposed on a broad host

External action escalation:

- a connector tries to send a message, deploy, change billing, or publish
  content without an approval record
- a provider route silently changes billing path
- a draft PR is treated as permission to merge or deploy

State integrity:

- a daemon restart repeats a trigger
- an audit log is edited after the fact
- stale approval state is reused outside its intended scope

Dependency and desktop risk:

- Electron, Vite, or build tooling vulnerabilities affect local development
- shell commands run with more filesystem access than the user expected
- a malicious workspace file tries to influence generated artifacts

### Current Mitigations

Current v1 mitigations:

- `.bureauos/` is ignored by git.
- Provider auth file is written with `0600` permissions.
- API and CLI provider responses mask raw secrets.
- Audit events for provider auth do not include raw credentials.
- Provider routing keeps `openai-codex` OAuth separate from `openai` API keys.
- The release gate runs `pnpm run private-context:check` and `pnpm audit`.
- Policy gates block merge, deploy, billing, public publishing, client sends,
  paid ads, secret paths, and destructive actions by default.
- Draft PR creation is documented as separate from merge/deploy approval.

Mitigations that still need future hardening:

- OS keychain credential storage.
- Stronger local API authentication for hostile local-user scenarios.
- Tamper-evident audit log signing, rotation, and retention.
- Production-grade daemon lock/recovery and restart diagnostics.
- Per-provider budget enforcement and token/cost accounting.

## Policy Gates for High-Risk Actions

These actions require explicit owner approval or a scoped standing policy:

| Area | Blocked Action |
| --- | --- |
| Billing | change plan, create invoice, issue refund, alter payout, change revenue share |
| Production | deploy production, change environment variables, rotate production credentials |
| Public claims | publish posts, publish ads, use client logos, publish testimonials or case studies |
| Client communication | send email/chat, schedule external meetings, send final proposals |
| Delivery | merge pull requests, mark release final, delete branches, rewrite history |
| Data | destructive database operations, customer data deletion, irreversible migrations |
| Ads | launch campaigns, change budgets, change targeting on live campaigns |

Drafts are allowed when policy permits. Final external actions are separate
approval-gated events.

## Public Evidence Checklist

Before opening a public issue, PR, release note, or support artifact:

```bash
git status --short
pnpm run private-context:check
git diff --cached --check
```

Then review manually for:

- API keys, OAuth tokens, webhook secrets, and bearer tokens
- provider account ids or private workspace ids
- `.bureauos/` memory, artifacts, auth, approvals, or audit files
- local machine paths that disclose private operator context
- terminal output from auth/login commands
- screenshots of settings, provider pages, or credential dashboards

See also:

- [Provider Auth](./providers.md)
- [Local-First Security and Policy Model](./security-and-policy-model.md)
- [Repository Hygiene](./repository-hygiene.md)
- [Release Process](./release-process.md)
