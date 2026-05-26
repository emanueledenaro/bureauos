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

### Known Limitations

- v1 packaging is source/build oriented; signed desktop distribution is not yet
  part of the release target.
- Security audit currently blocks v1 until high-severity Electron advisories are
  resolved.
