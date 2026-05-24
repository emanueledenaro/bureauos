# @bureauos/providers

Model-agnostic provider router for BureauOS.

Planned adapters (see [docs/capabilities-and-integrations.md](../../docs/capabilities-and-integrations.md)):

- OpenAI
- Anthropic
- Google (Gemini)
- Local models (Ollama or compatible)
- OpenRouter / gateway
- Codex runtime (treated as a capability, not a generic provider)

The router selects providers per agent role with fallback chains, budget awareness, and capability awareness. Credentials live in environment variables or a gitignored local secrets file, never in the repository.

## Status

Scaffold only. See [BACKLOG.md](../../BACKLOG.md) Phase 2.
