#!/usr/bin/env bash
# Remove SwiftPM build dirs and spilled incremental outputs (*.swiftmodule, *.swiftdeps, *.d, *.dia).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SWIFT_PACKAGES=(
  services/latr-gateway
  packages/latr-kit
)

for dir in "${SWIFT_PACKAGES[@]}"; do
  [[ -d "$dir" ]] || continue
  echo "Cleaning $dir …"
  # Spilled incremental outputs (Xcode / wrong cwd) live beside Package.swift.
  find "$dir" -maxdepth 1 \
    \( -name '*.swiftmodule' -o -name '*.swiftdeps' -o -name '*.d' -o -name '*.dia' \) \
    -exec rm -f {} + 2>/dev/null || true
  if [[ -f "$dir/Package.swift" ]]; then
    (cd "$dir" && swift package clean 2>/dev/null) || true
  fi
  # swift package clean can leave index-build behind; force-remove the tree.
  rm -rf "$dir/.build" "$dir/.swiftpm" 2>/dev/null || true
done

echo "Swift Build Artifacts Removed."
