#!/usr/bin/env bash
# Restore drill — proves backups can actually restore.
# Pulls a pg_dump (local by default, --from=b2 for the off-site copy),
# spins up an ISOLATED postgres container on port 15432, restores into
# it, and runs row-count sanity checks. Never touches the running
# travel-postgres database.
#
# Usage:
#   ./scripts/restore-drill.sh                # use newest local dump
#   ./scripts/restore-drill.sh --from=local
#   ./scripts/restore-drill.sh --from=b2      # pull newest from Backblaze
#
# Exit: 0 = restore succeeded and counts match the running DB.

set -uo pipefail
cd "$(dirname "$0")/.."

SOURCE=local
case "${1:-}" in
  --from=local) SOURCE=local ;;
  --from=b2)    SOURCE=b2 ;;
  --help|-h)    sed -n '2,12p' "$0"; exit 0 ;;
  '')           ;;
  *)            echo "unknown arg: $1 (use --from=local or --from=b2)" >&2; exit 2 ;;
esac

if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; NC=''
fi
ok()   { printf '%b✓%b %s\n' "$GREEN" "$NC" "$1"; }
fail() { printf '%b✗%b %s\n' "$RED"   "$NC" "$1"; }
note() { printf '%b…%b %s\n' "$YELLOW" "$NC" "$1"; }

PG_TEST_NAME=travel-restore-test
PG_TEST_VOL=travel-restore-test-data
PG_TEST_PORT=15432
TMP_DIR=$(mktemp -d)

cleanup() {
  echo
  note "cleaning up restore-test container + volume"
  docker rm -f "$PG_TEST_NAME" >/dev/null 2>&1 || true
  docker volume rm "$PG_TEST_VOL" >/dev/null 2>&1 || true
  rm -rf "$TMP_DIR"
  # The B2 fetch dropped the dump into backups/restore-from-b2/; remove it
  # so it doesn't get picked up as a "newest local" by the next drill run.
  rm -rf backups/restore-from-b2
}
trap cleanup EXIT

# ── 1. Acquire the dump ───────────────────────────────────────────────────
DUMP_FILE=""
if [ "$SOURCE" = "local" ]; then
  DUMP_FILE=$(ls -1t backups/travel-*.sql.gz 2>/dev/null | head -1)
  if [ -z "$DUMP_FILE" ]; then
    fail "No local pg_dump in ./backups/"
    exit 1
  fi
  ok "using local dump: $DUMP_FILE"
else
  note "fetching newest dump from B2 via pgbackup container"
  if ! docker compose ps pgbackup --format '{{.Name}}' | grep -q travel-pgbackup; then
    fail "pgbackup container not running — start the stack first"
    exit 1
  fi
  # Let the pgbackup container list the B2 bucket and pull the newest object
  # into /backups (the host-mounted backups dir).
  docker compose exec -T pgbackup sh -c '
    set -eu
    RCLONE_CONFIG_B2_TYPE=b2
    RCLONE_CONFIG_B2_ACCOUNT=$(cat /run/secrets/b2_key_id)
    RCLONE_CONFIG_B2_KEY=$(cat /run/secrets/b2_application_key)
    export RCLONE_CONFIG_B2_TYPE RCLONE_CONFIG_B2_ACCOUNT RCLONE_CONFIG_B2_KEY
    if ! command -v rclone >/dev/null 2>&1; then
      apk add --no-cache rclone >/dev/null
    fi
    newest=$(rclone lsf --files-only b2:travel-logger-wal/pg_dumps/ | sort | tail -1)
    [ -n "$newest" ] || { echo "no dumps in B2 bucket" >&2; exit 1; }
    rclone copy --no-traverse "b2:travel-logger-wal/pg_dumps/$newest" /backups/restore-from-b2/
    echo "/backups/restore-from-b2/$newest"
  ' || { fail "B2 fetch failed"; exit 1; }
  # The remote prints the in-container path; map it to the host
  DUMP_FILE=$(ls -1t backups/restore-from-b2/travel-*.sql.gz 2>/dev/null | head -1)
  [ -n "$DUMP_FILE" ] || { fail "B2 dump not landed in ./backups/restore-from-b2/"; exit 1; }
  ok "fetched B2 dump: $DUMP_FILE"
fi

# ── 2. Spin up isolated postgres ──────────────────────────────────────────
note "starting isolated postgres on port $PG_TEST_PORT"
docker rm -f "$PG_TEST_NAME" >/dev/null 2>&1 || true
docker volume rm "$PG_TEST_VOL" >/dev/null 2>&1 || true
docker run -d \
  --name "$PG_TEST_NAME" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=restoretest \
  -e POSTGRES_DB=travel \
  -v "$PG_TEST_VOL":/var/lib/postgresql/data \
  -p "127.0.0.1:$PG_TEST_PORT":5432 \
  postgres:16-alpine >/dev/null

# Wait for healthy
note "waiting for postgres to become ready"
for i in $(seq 1 30); do
  if docker exec "$PG_TEST_NAME" pg_isready -U postgres -d travel >/dev/null 2>&1; then
    ok "postgres up after ${i}s"
    break
  fi
  sleep 1
  if [ "$i" = 30 ]; then
    fail "postgres didn't become ready"
    exit 1
  fi
done

# ── 3. Apply the dump ─────────────────────────────────────────────────────
note "restoring $(basename "$DUMP_FILE") into restore-test"
gunzip -c "$DUMP_FILE" | docker exec -i "$PG_TEST_NAME" psql -U postgres -d travel >"$TMP_DIR/restore.log" 2>&1
RESTORE_RC=$?
if [ "$RESTORE_RC" -ne 0 ]; then
  fail "psql restore exited $RESTORE_RC — last 30 lines:"
  tail -30 "$TMP_DIR/restore.log"
  exit 1
fi
# Surface any ERROR lines (pg_dump --clean emits a few harmless drops on a
# fresh DB; only highlight ones that aren't "does not exist").
errs=$(grep -Ei '^ERROR:' "$TMP_DIR/restore.log" | grep -vE 'does not exist|already exists' || true)
if [ -n "$errs" ]; then
  fail "non-trivial errors in restore — review $TMP_DIR/restore.log"
  echo "$errs" | head -10
  exit 1
fi
ok "dump applied cleanly"

# ── 4. Sanity-check the restored data ─────────────────────────────────────
note "checking row counts vs the running DB"

count_in() {
  local target="$1" sql="$2"
  if [ "$target" = "test" ]; then
    docker exec "$PG_TEST_NAME" psql -U postgres -d travel -tA -c "$sql"
  else
    docker compose exec -T postgres psql -U postgres -d travel -tA -c "$sql"
  fi
}

declare -a CHECKS=(
  "trips           | select count(*) from public.trips"
  "milestones      | select count(*) from public.milestones"
  "addresses       | select count(*) from public.addresses"
  "airports        | select count(*) from public.airports"
  "milestone_kinds | select count(*) from public.milestone_kinds"
  "predictions     | select count(*) from public.predictions"
)

mismatches=0
for entry in "${CHECKS[@]}"; do
  table=$(echo "$entry" | awk -F'|' '{print $1}' | xargs)
  sql=$(echo "$entry"   | awk -F'|' '{print $2}' | xargs)
  prod=$(count_in prod "$sql" 2>/dev/null)
  test=$(count_in test "$sql" 2>/dev/null)
  if [ "$prod" = "$test" ]; then
    ok "$table: $test row(s) match"
  else
    fail "$table: prod=$prod test=$test (drift)"
    mismatches=$((mismatches + 1))
  fi
done

# ── 5. Verdict ────────────────────────────────────────────────────────────
echo
if [ "$mismatches" -eq 0 ]; then
  printf '%bRestore drill PASSED%b — backup is restorable, all row counts match.\n' "$GREEN" "$NC"
  exit 0
else
  printf '%bRestore drill FAILED%b — %d table(s) drifted between prod and the restored copy.\n' "$RED" "$NC" "$mismatches"
  printf 'This usually means the backup is older than the live DB (data was added since 03:00).\n'
  printf 'Run \`docker compose exec pgbackup /ops/backup.sh run-once\` for a fresh dump and re-try.\n'
  exit 1
fi
