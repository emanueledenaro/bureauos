# Provider Auth

BureauOS is provider-agnostic. Models and runtimes plug into the provider layer through `ProviderAdapter` and `RuntimeAdapter`.

## Auth Model

Provider credentials are not stored in `bureauos.yaml`.

The default local auth file is:

```text
.bureauos/auth/providers.json
```

The workspace `.bureauos/` directory is gitignored. The auth file is written with `0600` permissions so only the local user can read it.

Provider identity and auth mode are separate. `openai-codex` is the OAuth/subscription route. `openai` is the API-key route. BureauOS must not fall back from `openai-codex` to `openai`; API usage only happens when the owner explicitly chooses the API provider for that agent or run.

Environment variables still work only for their matching provider:

- `OPENAI_CODEX_ACCESS_TOKEN`
- `OPENAI_CODEX_REFRESH_TOKEN`
- `OPENAI_CODEX_EXPIRES_AT`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`
- `OPENROUTER_API_KEY`
- `LOCAL_MODEL_URL`

## CLI

```sh
bureau auth login --provider openai-codex --access-token "$OPENAI_CODEX_ACCESS_TOKEN" --refresh-token "$OPENAI_CODEX_REFRESH_TOKEN" --model gpt-5
bureau auth login --provider openai --api-key "$OPENAI_API_KEY" --model gpt-5
bureau auth login --provider anthropic --api-key "$ANTHROPIC_API_KEY" --model claude-sonnet-4-6
bureau auth login --provider openrouter --api-key "$OPENROUTER_API_KEY"
bureau auth login --provider local --base-url http://localhost:11434 --model qwen3-coder
bureau auth list
bureau auth logout --provider openai
```

`bureau auth list` masks API keys and OAuth tokens. Audit events record only provider and credential id, never raw secrets.

## Provider Checks

```sh
bureau providers list
```

The command loads stored credentials first, then reads matching environment variables. It reports provider, auth mode, source, and whether each adapter has enough credentials to run. `openai-codex` and `openai` remain independent routes.

## API and Electron

The local API exposes provider auth for the desktop interface:

- `GET /providers`
- `POST /providers/auth/login`
- `POST /providers/auth/logout`

ElectronJS Settings uses those endpoints to connect and disconnect providers without exposing raw secrets in renderer responses.

## Current Runtime State

- OpenAI Codex OAuth: separate provider profile, token validation, no API-key fallback. Live OAuth model bridging remains adapter-level.
- OpenAI API: SDK-backed `generateText` and `stream`.
- Anthropic: SDK-backed `generateText` and `stream`.
- Google, OpenRouter, Local: registered adapters with credential validation, model calls still stubbed.
- Codex runtime: adapter contract exists, execution still stubbed.

## Next Steps

- Add browser/device OAuth login so owners do not paste tokens manually.
- Add budget-aware and capability-aware routing.
- Move production-grade secrets to OS keychain as an alternative to the local auth file.
