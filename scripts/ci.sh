#!/usr/bin/env bash
# Shared CI entrypoint (GitHub Actions: .github/workflows/ci.yml).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SWIFT_WARNING_FLAGS=(-Xswiftc -warnings-as-errors)

bun install --frozen-lockfile
swift test "${SWIFT_WARNING_FLAGS[@]}" --package-path packages/latr-kit
swift build -c release "${SWIFT_WARNING_FLAGS[@]}" --package-path packages/latr-kit
swift test "${SWIFT_WARNING_FLAGS[@]}" --package-path services/latr-gateway
swift build -c release "${SWIFT_WARNING_FLAGS[@]}" --package-path services/latr-gateway
bun run turbo run typecheck lint test build --filter=web...
bun --cwd packages/lexicons test
