#!/usr/bin/env bash
# Apply services/latr-gateway/migrations/*.sql to Supabase Postgres.
#
# Requires psql and a branch-scoped connection string:
#   GATEWAY_DATABASE_URL_DEV  (dev branch / testing gateway)
#   GATEWAY_DATABASE_URL_PROD (main branch / production gateway)
# Falls back to DATABASE_URL when the branch-specific variable is unset.
#
# Usage: bash scripts/run-gateway-migration.sh dev|main
set -euo pipefail

BRANCH="${1:?usage: run-gateway-migration.sh dev|main}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATION="$ROOT/services/latr-gateway/migrations/001_developer_console.sql"

if [ ! -f "$MIGRATION" ]; then
  echo "::error::Migration File Not Found: $MIGRATION"
  exit 1
fi

if [ "$BRANCH" = "main" ]; then
  DATABASE_URL="${GATEWAY_DATABASE_URL_PROD:-${DATABASE_URL:-}}"
  ENV_LABEL="production"
else
  DATABASE_URL="${GATEWAY_DATABASE_URL_DEV:-${DATABASE_URL:-}}"
  ENV_LABEL="dev"
fi

if [ -z "$DATABASE_URL" ]; then
  if [ "$BRANCH" = "main" ]; then
    echo '::error::Missing Database URL for Production. Set GATEWAY_DATABASE_URL_PROD or DATABASE_URL.'
  else
    echo '::error::Missing Database URL for Dev. Set GATEWAY_DATABASE_URL_DEV or DATABASE_URL.'
  fi
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo '::error::psql Is Required (Install postgresql-client).'
  exit 1
fi

echo "::notice::Applying Latr-Gateway Developer Console Migration (${ENV_LABEL})"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$MIGRATION"
echo '::notice::Gateway Migration Applied Successfully.'
