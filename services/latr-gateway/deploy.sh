#!/usr/bin/env bash
# Deploy latr-gateway from services/latr-gateway (LatrKit via SwiftPM on Fly build).
#
# Usage: bash deploy.sh dev|main
set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "$0")" && pwd)"
BRANCH="${1:?usage: deploy.sh dev|main}"
shift

if [ "$BRANCH" = "main" ]; then
  APP="${FLY_GATEWAY_APP_PROD:-latr-link-prod-gateway}"
else
  APP="${FLY_GATEWAY_APP_DEV:-latr-link-dev-gateway}"
fi

bash "$SERVICE_DIR/prepare-docker.sh"
cd "$SERVICE_DIR"

if command -v flyctl >/dev/null 2>&1; then
  exec flyctl deploy --config fly.toml --app "$APP" --remote-only "$@"
fi
if command -v fly >/dev/null 2>&1; then
  exec fly deploy --config fly.toml --app "$APP" --remote-only "$@"
fi
echo "Install flyctl to deploy: https://fly.io/docs/flyctl/install/" >&2
exit 1
