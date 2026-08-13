#!/usr/bin/env bash
# Gateway Swift test + release build (CI + local via scripts/ci.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SWIFT_WARNING_FLAGS=(-Xswiftc -warnings-as-errors)

# The suite mixes swift-testing (@Test) and XCTest (RouterTests, LatrXRPCMethodTests).
# Swift 6.4's `swift test` runs only swift-testing unless XCTest is enabled explicitly,
# which would silently skip the XRPC router coverage.
swift test --enable-xctest --enable-swift-testing "${SWIFT_WARNING_FLAGS[@]}" --package-path services/latr-gateway
swift build -c release "${SWIFT_WARNING_FLAGS[@]}" --package-path services/latr-gateway
