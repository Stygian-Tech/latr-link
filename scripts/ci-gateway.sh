#!/usr/bin/env bash
# Gateway Swift test + release build (CI + local via scripts/ci.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SWIFT_WARNING_FLAGS=(-Xswiftc -warnings-as-errors)

swift test "${SWIFT_WARNING_FLAGS[@]}" --package-path services/latr-gateway
swift build -c release "${SWIFT_WARNING_FLAGS[@]}" --package-path services/latr-gateway
