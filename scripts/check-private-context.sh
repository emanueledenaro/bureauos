#!/usr/bin/env bash
set -euo pipefail

blocked_path_regex='^(AGENTS\.md|docs/superpowers(/|$))'
sensitive_regex='(/Users/[^[:space:]]+|\.codex/|\.agents/|memory_summary|Personal context|Top of mind)'

fail() {
  printf 'private-context: %s\n' "$1" >&2
  exit 1
}

tracked_blocked="$(git ls-files | grep -E "$blocked_path_regex" || true)"
if [[ -n "$tracked_blocked" ]]; then
  printf '%s\n' "$tracked_blocked" >&2
  fail 'blocked local-only path is tracked'
fi

staged_blocked="$(git diff --cached --name-only --diff-filter=ACMR | grep -E "$blocked_path_regex" || true)"
if [[ -n "$staged_blocked" ]]; then
  printf '%s\n' "$staged_blocked" >&2
  fail 'blocked local-only path is staged'
fi

tracked_sensitive="$(git grep -nE "$sensitive_regex" -- . \
  ':!scripts/check-private-context.sh' || true)"
if [[ -n "$tracked_sensitive" ]]; then
  printf '%s\n' "$tracked_sensitive" >&2
  fail 'tracked files contain obvious private local context'
fi

staged_diff="$(git diff --cached --diff-filter=ACMR -U0 -- . \
  ':!scripts/check-private-context.sh' || true)"
if [[ -n "$staged_diff" ]] && grep -E "$sensitive_regex" <<<"$staged_diff" >/dev/null; then
  grep -nE "$sensitive_regex" <<<"$staged_diff" >&2 || true
  fail 'staged diff contains obvious private local context'
fi

printf 'private-context: ok\n'
