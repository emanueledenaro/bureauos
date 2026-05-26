# Changelog

All notable changes to BureauOS are tracked here.

This project uses SemVer release tags and Conventional Commits for commit
messages. Keep public claims conservative and aligned with
`docs/implementation-coverage.md`.

## Unreleased

### Added

- v1 acceptance checklist for release-readiness decisions.
- Safe getting-started guide for local demos.
- Release process and automated release check command.
- Repository hygiene guard for private local agent context.
- Phase 8 PR execution path with fake-runtime E2E coverage.
- Daemon lifecycle supervisor with CLI/API start, stop, status, lock, and
  startup diagnostics coverage.
- Codex-style Coordinator chat rendering for paragraphs, lists, inline code,
  and fenced code blocks.
- SSE-backed Coordinator chat streaming for the Operating Room with durable
  final-message persistence.
- SSE-backed Live Operations Timeline updates with compact typed event icons
  and audit fallback dedupe.

### Fixed

- Low-context Coordinator greetings such as `ciao` are now concise and natural
  instead of returning an operating-status policy report.
- Coordinator provider calls now time out into a local-memory fallback instead
  of leaving the Operating Room chat stuck in a sending state.

### Security

- Private-context scan for local agent/operator artifacts before public PRs.
- Security audit is now part of the release gate.
- Coordinator chat messages are sanitized so hidden reasoning, prompts, and
  provider traces are not shown or persisted as user-visible replies.
- Electron upgraded to the patched 39.8.x line so the high-severity audit gate
  no longer reports Electron advisories.
- Vite, Vitest, electron-vite, and the React Vite plugin upgraded to a patched
  toolchain so the current Vite/esbuild audit advisories are cleared.

### Known Limitations

- v1 packaging is source/build oriented; signed desktop distribution is not yet
  part of the release target.
