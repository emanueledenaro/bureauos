# @bureauos/memory

Structured persistent memory for BureauOS.

Layers (see [docs/memory-model.md](../../docs/memory-model.md) and [docs/executive-memory.md](../../docs/executive-memory.md)):

- Root memory (`ROOT.md`) — always loaded
- Company memory
- Client memory (isolated per client)
- Project memory (isolated per project)
- Run memory
- Daily notes
- Decision records
- Searchable archive

Storage is Markdown-first. Indexes (SQLite FTS5 for keyword, vector index for semantic) accelerate retrieval without becoming a separate source of truth.

`SemanticMemoryIndex` is the stable contract for future embedding backends. The
default `NoopSemanticMemoryIndex` is local, disabled, and returns no matches, so
coordinator context assembly can ask for semantic hits without requiring a model
provider or network access.

## Status

Scaffold only. See [BACKLOG.md](../../BACKLOG.md) Phase 1.3.
