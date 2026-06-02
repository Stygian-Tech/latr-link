#!/usr/bin/env bash
# Web, extension, and latr-packages JS checks (CI + local via scripts/ci.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bun install --frozen-lockfile
bun run turbo run typecheck lint test build --filter=web... --filter=extension...
bun --cwd node_modules/latr-packages test
