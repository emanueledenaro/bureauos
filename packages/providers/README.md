# @bureauos/providers

Model-agnostic provider router for BureauOS.

Implemented adapter surfaces (see [docs/capabilities-and-integrations.md](../../docs/capabilities-and-integrations.md)):

- OpenAI
- Anthropic
- Google (Gemini)
- Local models (Ollama or compatible)
- OpenRouter / gateway
- Codex runtime (treated as a capability, not a generic provider)

The router selects providers per agent role with fallback chains. Credentials live in environment variables or the gitignored workspace auth store (`.bureauos/auth/providers.json`), never in the repository. Agent drafting uses authenticated providers when available and falls back to deterministic templates when no approved provider can run.

## Status

Provider auth, validation, role routing, and model-backed artifact drafting are implemented. Budget-aware routing, structured generation, and full capability-aware routing remain future work.
