# Release Process

This document defines the BureauOS v1 release candidate process. It is a
repeatable gate for source releases and local-first builds. It does not approve
autonomous merge, production deployment, client contact, paid ads, billing
changes, or public publishing.

## Release Scope

The v1 release target is:

- source release from the monorepo
- TypeScript package builds for CLI, core, memory, providers, and capabilities
- ElectronJS Operating Room build artifacts from `@bureauos/interface`
- public documentation that distinguishes implemented, partial, designed, and
  blocked behavior

The v1 release target is not:

- signed desktop distribution
- automatic updater
- hosted cloud service
- autonomous merge/deploy workflow
- production connector launch

## Versioning

BureauOS uses SemVer for release tags:

- `0.x`: protocol/runtime foundation before v1.
- `1.0.0`: first v1 release that satisfies `docs/v1-acceptance-checklist.md`
  plus this release process.
- `1.x`: backwards-compatible feature additions.
- `2.x`: breaking changes to workspace config, artifact contracts, public APIs,
  or major CLI behavior.

Use release tags in the form:

```text
v1.0.0
v1.0.1
v1.1.0
```

Commit messages must follow Conventional Commits v1.0.0. Use the commit type to
drive changelog grouping:

- `feat`: user-visible capability or behavior
- `fix`: bug fix
- `docs`: documentation-only change
- `test`: test-only change
- `chore`: repository maintenance, release, security, CI, or tooling
- `refactor`: behavior-preserving code restructuring

Breaking changes must use `!` or a `BREAKING CHANGE:` footer.

## Changelog

Maintain `CHANGELOG.md` with an `Unreleased` section. Before tagging:

1. Move completed entries from `Unreleased` into the new version section.
2. Include the release date.
3. Group entries by `Added`, `Changed`, `Fixed`, `Security`, and `Known
   Limitations`.
4. Link major Linear issues and pull requests where useful.
5. Keep claims aligned with `docs/implementation-coverage.md`.

Do not describe draft-only or partial behavior as complete automation.

## Automated Release Check

Run the release gate from the repository root:

```bash
pnpm run release:check
```

The command runs:

```bash
pnpm run private-context:check
pnpm run format
pnpm -r run typecheck
pnpm run lint
pnpm -r run build
pnpm -r run test
pnpm run security:scan
```

`pnpm run security:scan` currently maps to:

```bash
pnpm audit --audit-level high
```

Any high or critical advisory blocks a v1 release candidate unless the release
notes document a maintainer-approved exception with risk, mitigation, and follow
up issue.

## Manual Smoke Test

Use a clean temporary workspace and the built CLI:

```bash
tmp="$(mktemp -d)"
BUREAU="$PWD/packages/cli/dist/bin/bureau.js"
cd "$tmp"
node "$BUREAU" init --name "Release Smoke" --preset freelancer
node "$BUREAU" client create --name "Acme Demo"
node "$BUREAU" project create --name "Website Refresh" --client acme-demo --stack "Next.js"
node "$BUREAU" opportunity create --title "Booking Flow" --source owner_chat --client acme-demo --value 5000
node "$BUREAU" run new --type planning --scope "Release smoke planning run" --project website-refresh
node "$BUREAU" status
node "$BUREAU" audit tail -n 10
cd -
rm -rf "$tmp"
```

Manual smoke evidence should confirm:

- `.bureauos/bureauos.yaml` exists
- root/company/client/project memory exists
- audit log is written
- planning run completes locally
- generated artifacts are visible
- no external provider, GitHub, Linear, client, ad, billing, merge, or deploy
  action is taken

For UI smoke, run:

```bash
BUREAUOS_WORKSPACE=/tmp/bureauos-demo pnpm --filter @bureauos/interface run dev
```

Verify the Operating Room opens against the intended workspace and shows real
empty/demo state rather than invented data.

## Documentation Gate

Before tagging:

- `README.md` points to getting started, release, and v1 readiness docs.
- `docs/getting-started.md` smoke commands still work.
- `docs/v1-acceptance-checklist.md` matches the current runtime state.
- `docs/implementation-coverage.md` uses the same status language.
- `SECURITY.md`, `docs/repository-hygiene.md`, and provider docs do not expose
  secrets or private operator context.
- All links to local docs resolve.

## Security Gate

The release owner must record:

- output of `pnpm run private-context:check`
- output of `pnpm run security:scan`
- any remaining security exceptions
- credential storage assumptions
- local API trust assumptions
- known Electron/desktop risks

High-risk actions stay blocked by default:

- merge pull requests
- deploy production
- send client messages
- publish public content
- launch paid ads or change ad budgets
- change billing or pricing commitments
- touch secrets or destructive data paths

## Packaging Commands

Build everything:

```bash
pnpm -r run build
```

Build only the interface:

```bash
pnpm --filter @bureauos/interface run build
```

Build only the CLI:

```bash
pnpm --filter @bureauos/cli run build
```

The current package is marked `private: true`, so v1 packaging is source/build
oriented until npm/desktop distribution is explicitly enabled.

## v1 Packaging Decision

BureauOS v1 ships **source-only**. The v1 release artifact is the repository at
a tagged commit, built locally with `pnpm -r run build`. There is no signed
desktop installer, no auto-updater, and no npm/desktop publish target in v1.

An **unsigned, local desktop build** is available **opt-in** for owners who want
a runnable app. It is configured by
[`packages/interface/electron-builder.yml`](../packages/interface/electron-builder.yml),
which deliberately disables code signing, notarization, the auto-updater, and
every publish target. The `pack` and `dist` scripts consume this config.

electron-builder is **not** a committed dependency, so the source-only release
stays lean. Install it only when you want a desktop build:

```bash
# 1. Build the bundles (electron-vite -> packages/interface/out/)
pnpm --filter @bureauos/interface run build

# 2. Add electron-builder locally (not committed to the lockfile)
pnpm --filter @bureauos/interface add -D electron-builder

# 3. Produce an unpacked app in packages/interface/release/
pnpm --filter @bureauos/interface run pack

# Or a full electron-builder build using electron-builder.yml
pnpm --filter @bureauos/interface run dist
```

The resulting app is unsigned: macOS Gatekeeper and Windows SmartScreen will warn
about an unidentified developer. Signed/notarized distribution and an updater are
post-v1 work (see the Distribution track in
[v1 Acceptance Checklist](./v1-acceptance-checklist.md)).

## Release Candidate Steps

1. Create a release branch.
2. Run `pnpm install --frozen-lockfile`.
3. Run `pnpm run release:check`.
4. Run the manual smoke test.
5. Update `CHANGELOG.md`.
6. Update `docs/v1-acceptance-checklist.md` if any status changed.
7. Confirm no ignored/private local artifacts are staged.
8. Create a draft PR with verification evidence.
9. After review, tag the release.

Do not merge, deploy, publish, contact clients, change billing, or launch ads as
part of the v1 release process unless a separate explicit owner approval and
policy gate exists.
