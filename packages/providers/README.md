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

The router selects the owner-chosen provider per agent role. `openai-codex` and `openai` are intentionally different providers, so OAuth never falls back to API-key billing. Credentials live in environment variables or the gitignored workspace auth store (`.bureauos/auth/providers.json`), never in the repository. If the selected route cannot run, BureauOS may emit an explicitly marked deterministic local draft, but it does not switch to another provider.

## Status

Provider auth, auth-mode validation, role routing, and model-backed artifact drafting are implemented. Browser/device OAuth login, budget-aware routing, structured generation, and full capability-aware routing remain future work.
