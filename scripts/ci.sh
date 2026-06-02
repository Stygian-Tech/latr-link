#!/usr/bin/env bash
# Shared CI entrypoint (GitHub Actions: .github/workflows/ci.yml).
# Runs gateway Swift checks and JS monorepo checks in parallel when possible.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SCRIPT_DIR="$(dirname "$0")"

run_job() {
  local label="$1"
  local script="$2"
  if bash "$script"; then
    return 0
  fi
  echo "ci: ${label} failed" >&2
  return 1
}

if [ "${CI_PARALLEL:-1}" = "0" ]; then
  run_job "gateway" "$SCRIPT_DIR/ci-gateway.sh"
  run_job "js" "$SCRIPT_DIR/ci-js.sh"
  exit 0
fi

pids=()
labels=()

run_job "gateway" "$SCRIPT_DIR/ci-gateway.sh" &
pids+=($!)
labels+=("gateway")

run_job "js" "$SCRIPT_DIR/ci-js.sh" &
pids+=($!)
labels+=("js")

status=0
for i in "${!pids[@]}"; do
  if ! wait "${pids[$i]}"; then
    echo "ci: ${labels[$i]} failed" >&2
    status=1
  fi
done

exit "$status"
