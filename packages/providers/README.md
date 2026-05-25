# @bureauos/providers

Model-agnostic provider router for BureauOS.

Implemented adapter surfaces (see [docs/capabilities-and-integrations.md](../../docs/capabilities-and-integrations.md)):

- OpenAI Codex OAuth (`openai-codex`, subscription route, no API fallback)
- OpenAI API (`openai`, API-key route)
- Anthropic
- Google (Gemini)
- Local models (Ollama or compatible)
- OpenRouter / gateway
- Codex runtime (treated as a capability, not a generic provider)

The router selects the owner-chosen provider per agent role, then filters that explicit route by required model capabilities and optional budget tier. `openai-codex` and `openai` are intentionally different providers, so OAuth never falls back to API-key billing. Credentials live in environment variables or the gitignored workspace auth store (`.bureauos/auth/providers.json`), never in the repository. If the selected route cannot run, BureauOS may emit an explicitly marked deterministic local draft, but it does not switch to another provider.

The connector catalog follows the OpenCode pattern: built-in provider metadata can be filtered with `enabled_providers` / `disabled_providers` and extended through top-level `provider:` config, while auth remains stored by provider id outside the repo.

## Status

Provider auth, browser PKCE login for OpenAI Codex OAuth, ChatGPT Codex backend generation/streaming with the Codex-compatible `instructions`/`store=false` payload, refresh-token persistence, auth-mode validation, OpenCode-style connector config, role routing, per-model capability/budget metadata, capability-aware and budget-aware route filtering, OpenAI/Anthropic/Google/OpenRouter/Local model calls, and model-backed artifact drafting are implemented. Device/headless OAuth login, structured generation, and runtime execution remain future work.
