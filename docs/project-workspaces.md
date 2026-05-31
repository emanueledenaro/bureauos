# Project Workspaces and Run Isolation

Status: decided (owner, 2026-05-31). Source of truth for how a development run
gets an isolated place to write real code, and how many can run at once.

This is the architecture that lets the "always-on team" actually build software:
when the owner says "build me X", specialist agents need a real working copy of
the project's code to edit, test, and deliver — separate from the `.bureauos`
agency workspace (the "brain": memory, registries, audit, artifacts) and
separate from every other project.

## Decisions

1. One git repository per project.
   - Each project (a client site, an app, an internal tool) has its own
     dedicated git repository, not a shared folder. Project code never lives
     inside `.bureauos/` (the agency brain); memory and code stay separate.
   - Local-first: the repo is `git init`-ed locally so dogfood and tests need no
     external account.

2. GitHub from the start (provisioning is gated).
   - The model is that each project is backed by a real GitHub repository created
     at project setup, set as the local repo's `origin` remote.
   - Creating the GitHub repo touches a real external account, so it is a
     policy-gated action: the coordinator prepares it and escalates to the owner
     for approval (it is never created silently). Until approved — and always in
     dogfood — the project runs on its local repo only.

3. One git worktree per run ("a fenced area per builder").
   - Every development run operates in its own `git worktree` checked out on a
     dedicated branch `bureauos/<project-slug>/<run-id>`, added off the project's
     base branch.
   - Multiple runs on the *same* project therefore get *different* worktrees and
     branches: agents work in parallel without ever fighting over a shared git
     HEAD. The worktree is removed when the run finishes; the branch survives for
     review/PR.

4. One pull request per branch; merge stays gated.
   - When a run's branch is ready (real edits + passing tests), it is pushed and
     a single PR is opened.
   - Merging to a real project repo touches a real external account and is a
     gated action requiring explicit owner approval. BureauOS's own
     self-development PRs are the only autonomous-merge exception.

## On-disk layout

```text
<root>/                         # the folder the owner runs bureau in
  .bureauos/                    # the agency brain (memory, registries, audit, ...)
    memory/projects/<slug>/     # project MEMORY (Markdown): RUNS.md, RISKS.md, ...
  workspaces/                   # project CODE (configurable: workspace.projects_root)
    <slug>/                     # one git repo per project (origin -> GitHub when approved)
    <slug>/.git/worktrees/...   # ephemeral per-run worktrees live off this repo
```

Project memory (what the agents know and decide) and project code (what they
build) are deliberately in two places: the brain is human-readable Markdown under
`.bureauos`, the code is a normal git repo the owner can open in any editor.

## Concurrency model

- Different projects: fully parallel (separate repos).
- Same project: fully parallel (separate worktrees + branches off one repo).
- The only natural serialization point is the shared base branch a worktree is
  cut from; runs branch off it and integrate back through gated PRs, so they do
  not block each other while working.

## Safety

- Every git invocation is non-shell (`execFile`, no shell string), bounded by a
  timeout and output cap, with branch/ref names slug-validated against an
  allow-list (no leading `-`, no `..`) — the same hardening already used by
  `GitDevelopmentBranchClient`.
- Worktree paths are confined under the project repo and removed on completion,
  so a run cannot leave the tree in a half-checked-out state.
- Repo provisioning (GitHub) and PR merge are policy-gated and escalate to the
  owner; nothing touches a real external account without approval.

## Where this is built (tickets)

- Per-project repo + per-run worktree foundation (`ProjectWorkspaceService`):
  extends the development-run work under SER-238/SER-239.
- Dev agent executes in the run's worktree; QA runs the real test suite there
  and gates the result: SER-239 / SER-240.
- GitHub repo provisioning (gated), branch push, and PR delivery: SER-241.
- Project Manager orchestrates the worktree-isolated dev -> QA -> review loop and
  escalates gated steps: SER-242.
