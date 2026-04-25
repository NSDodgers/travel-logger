#!/usr/bin/env bash
# M5 legacy data loader.
#
# 1. Re-runs the import parser to refresh imports/legacy-trips.{json,sql}
# 2. Applies the M5 schema migration (party enum + customs kinds) if needed
# 3. Loads the generated SQL into the live travel DB
# 4. Prints verification queries
#
# Idempotent: re-running deletes prior legacy rows before re-inserting.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! docker compose ps --format json travel-postgres 2>/dev/null | grep -q '"State":"running"'; then
  echo "travel-postgres container is not running."
  echo "Start the stack first: docker compose up -d"
  exit 1
fi

echo "── M5 legacy load ──"

echo "[1/4] Regenerating imports/legacy-trips.{json,sql} ..."
bun run db/seeds/import-legacy.ts

MIGRATION="$ROOT/db/init/05-m5-prep.sql"
SQL="$ROOT/imports/legacy-trips.sql"

if [[ ! -f "$SQL" ]]; then
  echo "Expected $SQL after parser run; not found. Aborting."
  exit 1
fi

echo
echo "[2/4] Applying M5 schema migration ..."
docker compose exec -T postgres psql -U postgres -d travel < "$MIGRATION"

echo
echo "[3/4] Loading legacy trips ..."
docker compose exec -T postgres psql -U postgres -d travel < "$SQL"

echo
echo "[4/4] Verification ..."
docker compose exec -T postgres psql -U postgres -d travel -c "
  select count(*) as legacy_trips from public.trips where source = 'legacy';
  select count(*) as legacy_milestones from public.milestones m join public.trips t on t.id = m.trip_id where t.source = 'legacy';
  select extract(year from sched_dep_date)::int as year, count(*) as trips
    from public.trips where source = 'legacy'
    group by year order by year;
  select dep_airport, count(*) from public.trips where source = 'legacy'
    group by dep_airport order by count(*) desc limit 10;
"

echo
echo "Legacy load complete."
