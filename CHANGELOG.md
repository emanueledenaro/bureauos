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

### Security

- Private-context scan for local agent/operator artifacts before public PRs.
- Security audit is now part of the release gate.
- Electron upgraded to the patched 39.8.x line so the high-severity audit gate
  no longer reports Electron advisories.

### Known Limitations

- v1 packaging is source/build oriented; signed desktop distribution is not yet
  part of the release target.
- Security audit still reports moderate Vite/esbuild dev-server advisories below
  the current high-severity v1 blocking threshold.
