#!/usr/bin/env bash
# Native Apple source and simulator verification; never archives or uploads.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
command -v xcodegen >/dev/null || { echo 'Install XcodeGen before running Apple checks.' >&2; exit 1; }
DERIVED_DATA="${NATIVE_APPLE_DERIVED_DATA:-$ROOT/apps/apple/DerivedData}"
swift test --enable-xctest --enable-swift-testing --package-path apps/apple -Xswiftc -warnings-as-errors
xcodegen generate --spec apps/apple/project.yml
xcodebuild -project apps/apple/LatrLink.xcodeproj -scheme LatrLink -configuration Release \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$DERIVED_DATA" \
  CODE_SIGNING_ALLOWED=NO build

# Explicit destination overrides are useful for local and CI simulator matrices.
if [ -n "${NATIVE_APPLE_DESTINATION:-}" ]; then
  destinations=("$NATIVE_APPLE_DESTINATION")
else
  devices="$(xcrun simctl list devices available --json)"
  ids="$(printf '%s' "$devices" | python3 -c '
import json,re,sys
all_devices=json.load(sys.stdin)["devices"]
for family in ("iPhone", "iPad"):
    matches=[d for runtime, ds in all_devices.items() if (version := re.search(r"iOS-(\d+)", runtime)) and int(version.group(1)) >= 18 for d in ds if d.get("isAvailable") and family in d["name"]]
    if not matches: raise SystemExit("No available " + family + " simulator")
    print(matches[-1]["udid"])
')"
  destinations=()
  while IFS= read -r identifier; do destinations+=("platform=iOS Simulator,id=$identifier"); done <<< "$ids"
fi
for destination in "${destinations[@]}"; do
  xcodebuild -project apps/apple/LatrLink.xcodeproj -scheme LatrLink -configuration Debug \
    -destination "$destination" -derivedDataPath "$DERIVED_DATA" \
    -parallel-testing-enabled NO -collect-test-diagnostics never CODE_SIGN_IDENTITY=- test
done
