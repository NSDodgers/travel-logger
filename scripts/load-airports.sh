#!/usr/bin/env bash
# Load the airport dataset into the running Postgres container.
# Use this for existing stacks where the db/init/* scripts already ran (those only
# fire on fresh pgdata volumes). Idempotent — safe to re-run.
#
# Prereqs: docker compose stack running; pending schema migrations applied.
#
# Usage: ./scripts/load-airports.sh

set -euo pipefail
cd "$(dirname "$0")/.."

SEED_FILE="db/init/04-airports-seed.sql"
MIGRATION_FILE="db/migrations/001-airports-tz-multi-component.sql"

if [ ! -f "$SEED_FILE" ]; then
  echo "error: $SEED_FILE missing — run 'bun run db/seeds/generate-airports.ts' first" >&2
  exit 1
fi

if ! docker compose ps postgres --format '{{.Health}}' | grep -q healthy; then
  echo "error: postgres container is not healthy" >&2
  exit 1
fi

echo "[1/3] Applying tz-regex migration (idempotent)..."
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d travel < "$MIGRATION_FILE"

echo "[2/3] Loading $SEED_FILE (≈5.5k rows)..."
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d travel < "$SEED_FILE" | tail -5

echo "[3/3] Verifying..."
docker compose exec -T postgres psql -U postgres -d travel -c \
  "select count(*) as airports, count(distinct country) as countries, count(distinct tz) as timezones from public.airports;"

echo
echo "Done."
