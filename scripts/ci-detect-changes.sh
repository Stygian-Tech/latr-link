#!/usr/bin/env bash
# Detect changed path filters for CI (replaces dorny/paths-filter; no marketplace download).
set -euo pipefail

BASE=""
HEAD="${GITHUB_SHA:?GITHUB_SHA is required}"
MATCH_ALL=0

read_pull_request_base_sha() {
  if [ -n "${GITHUB_EVENT_PULL_REQUEST_BASE_SHA:-}" ]; then
    printf '%s\n' "$GITHUB_EVENT_PULL_REQUEST_BASE_SHA"
    return
  fi

  if [ -n "${GITHUB_EVENT_PATH:-}" ] && [ -f "$GITHUB_EVENT_PATH" ]; then
    python3 - "$GITHUB_EVENT_PATH" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    event = json.load(handle)

print(event.get("pull_request", {}).get("base", {}).get("sha", ""))
PY
    return
  fi
}

case "${GITHUB_EVENT_NAME:-}" in
  pull_request)
    BASE="$(read_pull_request_base_sha)"
    if [ -z "$BASE" ]; then
      echo "Unable to determine pull request base SHA." >&2
      echo "Expected GITHUB_EVENT_PATH to contain pull_request.base.sha." >&2
      exit 1
    fi
    ;;
  push)
    BASE="${GITHUB_EVENT_BEFORE:-}"
    if [ -z "$BASE" ] || [ "$BASE" = "0000000000000000000000000000000000000000" ]; then
      MATCH_ALL=1
    fi
    ;;
  *)
    MATCH_ALL=1
    ;;
esac

to_pathspec() {
  local spec="$1"
  if [[ "$spec" == *"*"* ]]; then
    printf ':(glob)%s' "$spec"
  else
    printf '%s' "$spec"
  fi
}

filter_changed() {
  local name="$1"
  shift
  local out="${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

  if [ "$MATCH_ALL" = "1" ]; then
    echo "${name}=true" >> "$out"
    return
  fi

  local spec pathspec
  for spec in "$@"; do
    pathspec="$(to_pathspec "$spec")"
    if git diff --name-only "$BASE" "$HEAD" -- "$pathspec" | grep -q .; then
      echo "${name}=true" >> "$out"
      return
    fi
  done

  echo "${name}=false" >> "$out"
}

filter_changed gateway \
  'services/latr-gateway/**' \
  'scripts/fly-deploy-gateway.sh' \
  'scripts/run-gateway-migration.sh' \
  '.github/workflows/ci.yml'

filter_changed gateway_migrations \
  'services/latr-gateway/migrations/**' \
  'scripts/run-gateway-migration.sh' \
  '.github/workflows/ci.yml'
