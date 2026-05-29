# Contributing

BureauOS is early. Contributions should strengthen the operating model before expanding runtime complexity.

## Contribution Priorities

Good early contributions:

- clearer agent role definitions
- better artifact templates
- safer autonomy policies
- GitHub label improvements
- memory model refinements
- concrete workflow examples
- small proof-of-concept CLI work

Avoid early contributions that:

- add large autonomous execution without policy gates
- depend on one model provider only
- merge unrelated concerns
- hide decisions in unstructured chat logs
- bypass GitHub as the operational surface

## Pull Request Expectations

Pull requests should be:

- small
- scoped to one topic
- linked to an issue when possible
- documented
- easy to review

Include:

- what changed
- why it changed
- how it was verified
- any risk or follow-up

Before opening a public pull request, run:

```bash
pnpm run private-context:check
```

See `docs/repository-hygiene.md` for the local-only agent files that must not
be committed.

## Design Rule

When in doubt, prefer explicit artifacts over hidden agent behavior.
