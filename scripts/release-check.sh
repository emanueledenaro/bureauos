#!/usr/bin/env bash
set -euo pipefail

pnpm run private-context:check
pnpm run format
pnpm -r run typecheck
pnpm run lint
pnpm -r run build
pnpm -r run test
pnpm run security:scan
