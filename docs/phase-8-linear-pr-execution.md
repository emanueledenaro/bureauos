# Phase 8 Linear-Backed PR Execution

## Goal

Phase 8 builds the first safe BureauOS delivery loop: a Linear issue becomes bounded run scope, the Development Agent executes scoped work through a runtime boundary, test evidence is captured, and BureauOS opens a draft GitHub pull request.

This is a delivery-control slice. It must prove policy, audit, branch, test, and draft PR gates before BureauOS attempts broader autonomous execution.

## Current Status

BureauOS already has several required foundations:

- `RunEngine` creates run records, writes artifacts, applies policy, and can execute an injected dispatcher while preserving an explicit stub mode.
- `dispatchRun()` can run specialist agents and attach model/provider context; `bureau run new` uses the coordinator dispatcher by default and keeps the local stub path behind `--stub`.
- `DevelopmentAgent` can produce planning artifacts and can invoke a policy-gated runtime when the host supplies a Codex runtime capability.
- `CodexRuntimeAdapter` validates workspace/run context, supports an injected execution runner, normalizes evidence, and blocks merge/deploy/secrets/destructive git actions.
- `CapabilityUseService` gates capability use and includes Linear policy mappings.
- `GitHubPullRequestPublishService` can create policy-gated PRs when linked issue and test evidence are present.

## Non-Goals

Phase 8 must not:

- merge pull requests
- deploy production
- push directly to protected or default branches
- perform destructive git operations
- read, print, rewrite, or commit secrets
- allow Linear to bypass BureauOS policy and audit gates

## Primary Flow

1. The owner or daemon selects a Linear issue from the BureauOS project.
2. BureauOS checks `linear.read_issues` through `CapabilityUseService`.
3. BureauOS maps the Linear issue into a bounded run scope packet.
4. Product and Project Manager agents validate acceptance criteria and scope readiness.
5. Development Agent receives a bounded context packet and runtime execution capability.
6. Runtime creates a deterministic branch for the issue and executes scoped edits.
7. BureauOS checks changed-file count before continuing.
8. BureauOS runs configured project verification commands and stores evidence artifacts.
9. Reviewer, Security, and QA agents produce verification artifacts.
10. BureauOS opens a draft GitHub PR through `GitHubPullRequestPublishService`.
11. BureauOS comments or updates Linear only through policy-gated Linear actions.

## Linear Issue Scope Contract

Core should not depend on a live Linear SDK. The host integration layer fetches Linear data, then passes a normalized issue payload into core.

Required input fields:

- `identifier`, such as `SER-23`
- `title`
- `description`
- `url`
- `labels`
- `projectId`
- `teamKey`

Derived output fields:

- `runType`: `feature`, `bug`, `review`, or `planning`
- `triggerType`: `external_signal`
- `triggerSource`: `linear://issue/<identifier>`
- `scope`: issue title plus acceptance criteria summary
- `externalIssue`: structured issue metadata for artifacts
- `readiness`: `ready` or `needs_clarification`
- `blockers`: explicit reasons when execution is not safe

The mapper must refuse implementation when an issue is too broad, lacks acceptance criteria, or asks for blocked operations such as merge, deploy, billing changes, destructive database operations, or secret handling.

## Runtime Execution Boundary

Codex is treated as an execution runtime, not as a generic chat provider.

Runtime context should include:

- workspace root
- run ID
- project ID
- client ID when available
- branch name
- allowed commands
- maximum changed-file limit

Runtime results should include:

- success or failure status
- artifacts
- evidence
- changed files
- commands run
- branch name
- error or blocker details

The first shippable implementation can use fake runtime tests while the real Codex adapter remains conservative.

## Policy Gates

Phase 8 maps capability actions to existing policy gates:

- `linear.read_issues` -> `observe_signals`
- `linear.comment`, `linear.update_issues`, and `linear.set_issue_state` -> `comment_on_issues`
- `codex.edit_code` -> `push_commits`
- `codex.run_tests` -> `observe_signals`
- `github.open_pr` -> `open_pull_requests`

Draft PR creation requires:

- linked Linear issue identifier and URL
- branch name
- test evidence artifact IDs or explicit blocked-test explanation
- development execution artifact
- QA artifact
- reviewer artifact
- security artifact when sensitive files or risky capabilities were touched

## Branch And Git Safety

Branch names are deterministic and issue-linked:

```text
bureauos/<linear-identifier-lowercase>-<short-title-slug>
```

Execution must refuse to run when:

- the worktree has unrelated dirty files
- the target branch already exists with different run metadata
- changed files exceed `limits.max_files_changed_without_human_review`
- a requested command is not in the configured allow-list
- the diff contains likely secret material

## Draft PR Boundary

All Phase 8 PRs are drafts by default.

The PR body must include:

- Linear source issue link
- BureauOS run ID
- summary of code changes
- acceptance criteria checklist
- test evidence
- agent review evidence
- policy boundary note stating that merge and deploy are separate approval-gated actions

## Linear Status Updates

Linear comments and status updates are useful, but secondary. A failed Linear update must not erase local artifacts or fail a completed code run. It should create a warning artifact and audit event.

Recommended comments:

- run started with run ID
- implementation blocked with blocker reasons
- draft PR opened with PR URL and test evidence
- verification failed with next action

## Acceptance Criteria

- A Linear issue can be normalized into BureauOS run scope only after a Linear capability check.
- Ambiguous or unsafe issues produce clarification or blocker artifacts instead of code execution.
- `RunEngine.start()` can use a real dispatch hook without breaking stub-based tests.
- Development Agent can call a runtime capability and produce execution artifacts.
- Branch, test, and file-limit evidence is captured before draft PR creation.
- Draft PR creation requires linked issue and test evidence gates.
- Merge and deploy remain blocked by default and covered by tests.

## Open Risks

- Real Codex execution details depend on the selected local CLI or API backend.
- Dirty worktree handling must avoid overwriting owner or contributor work.
- Linear MCP calls are host-provided today; core must not assume direct network access.
- Test command detection must be deterministic and owner-configurable.
