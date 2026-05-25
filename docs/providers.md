# Provider Auth

BureauOS is provider-agnostic. Models and runtimes plug into the provider layer through `ProviderAdapter` and `RuntimeAdapter`.

The provider layer follows the OpenCode-style connector pattern:

- provider metadata lives in one connector catalog
- each connector declares its auth methods
- `bureauos.yaml` may override connector metadata, enabled providers, disabled providers, and model names
- the desktop UI asks the API which methods are supported
- credentials are saved by provider id
- runtime routing only uses explicitly connected or environment-backed providers

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

## Connector Config

BureauOS supports the same separation that OpenCode uses: configuration describes which provider connector exists and which models are visible; authentication stays outside the repo.

```yaml
provider:
  openai:
    name: "OpenAI Enterprise"
    env:
      - "OPENAI_ENTERPRISE_KEY"
    options:
      defaultModel: "gpt-5-enterprise"
    models:
      gpt-5-enterprise:
        name: "GPT-5 Enterprise"

disabled_providers:
  - "openrouter"
```

This changes the connector catalog and default model choice, but it does not store an API key. To connect the provider, use `bureau auth login` or a matching environment variable.

## CLI

```sh
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

The command loads stored credentials first, then reads matching environment variables. It reports only real stored or environment-backed connections, plus whether each adapter has enough credentials to run. `openai-codex` and `openai` remain independent routes.

## API and Electron

The local API exposes provider auth for the desktop interface:

- `GET /providers`
- `GET /provider/connectors`
- `GET /provider/auth`
- `POST /provider/openai-codex/oauth/authorize`
- `POST /provider/openai-codex/oauth/callback`
- `POST /providers/auth/login`
- `POST /providers/auth/logout`

The singular `/provider/...` endpoints follow OpenCode's provider auth pattern: the UI asks which connectors exist, which auth methods each provider supports, starts OAuth authorization when needed, then completes the callback. `GET /provider/connectors` applies `provider`, `enabled_providers`, and `disabled_providers` from `bureauos.yaml`; `GET /providers` only returns real stored or environment-backed connections. ElectronJS Settings uses browser OAuth for `openai-codex`; API-key providers still use explicit API-key login. Raw secrets are never returned in renderer responses.

## Current Runtime State

- OpenAI Codex OAuth: separate provider profile, browser PKCE login, token validation, token refresh persistence, live ChatGPT Codex backend requests, SSE streaming, no API-key fallback.
- OpenAI API: SDK-backed `generateText` and `stream`.
- Anthropic: SDK-backed `generateText` and `stream`.
- Google: REST-backed Gemini `generateText` and SSE `stream`.
- OpenRouter: OpenAI-compatible `generateText`, model listing, and SSE `stream`.
- Local: OpenAI-compatible local/Ollama `generateText`, model listing, and SSE `stream`.
- Provider connectors: catalog-backed metadata, config overrides, enabled/disabled provider filtering, auth methods, default models, and env mappings for OpenAI Codex, OpenAI API, Anthropic, Google, OpenRouter, Local, and Custom API.
- Codex runtime: adapter contract exists, execution still stubbed.

## Next Steps

- Add optional device/headless OAuth login.
- Add budget-aware and capability-aware routing.
- Move production-grade secrets to OS keychain as an alternative to the local auth file.
