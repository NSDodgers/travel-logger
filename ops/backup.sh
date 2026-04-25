#!/bin/sh
# Travel Logger nightly backup
# Runs as entrypoint of the pgbackup container (postgres:16-alpine).
# Backup targets, in order:
#   1. /backups        — local docker volume bind on the Mac
#   2. /icloud-backups — bind into ~/Library/Mobile Documents/.../backups/travel
#   3. Backblaze B2    — via rclone, if credentials are present (M12)
#
# Usage:
#   /ops/backup.sh            # cron mode — wait for BACKUP_CRON_HOUR, run once a day
#   /ops/backup.sh run-once   # run a single backup immediately and exit (manual trigger)
set -eu

: "${PGHOST:=postgres}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=travel}"
: "${BACKUP_CRON_HOUR:=03}"
: "${RETENTION_DAYS:=30}"
: "${B2_BUCKET:=travel-logger-wal}"
: "${B2_PREFIX:=pg_dumps}"

export PGPASSWORD=$(cat "${PGPASSWORD_FILE:-/run/secrets/pg_password}")

mkdir -p /backups
ICLOUD_DIR=/icloud-backups
[ -d "$ICLOUD_DIR" ] && mkdir -p "$ICLOUD_DIR"

# ── B2 upload helper ──────────────────────────────────────────────────────
# Lazily installs rclone (cached after first run) and uploads $file to
# b2:$B2_BUCKET/$B2_PREFIX/. Touches /backups/.last-b2-upload on success so
# preflight can verify the off-site target without needing B2 credentials.
b2_upload() {
  src="$1"
  if [ ! -f /run/secrets/b2_key_id ] || [ ! -f /run/secrets/b2_application_key ]; then
    echo "[pgbackup] B2 secrets not mounted — skipping off-site upload"
    return 0
  fi

  if ! command -v rclone >/dev/null 2>&1; then
    echo "[pgbackup] installing rclone…"
    apk add --no-cache rclone >/dev/null 2>&1 || {
      echo "[pgbackup] rclone install FAILED — skipping B2 upload"
      return 1
    }
  fi

  RCLONE_CONFIG_B2_TYPE=b2
  RCLONE_CONFIG_B2_ACCOUNT=$(cat /run/secrets/b2_key_id)
  RCLONE_CONFIG_B2_KEY=$(cat /run/secrets/b2_application_key)
  export RCLONE_CONFIG_B2_TYPE RCLONE_CONFIG_B2_ACCOUNT RCLONE_CONFIG_B2_KEY

  if rclone copy --no-traverse "$src" "b2:${B2_BUCKET}/${B2_PREFIX}/"; then
    echo "[pgbackup] mirrored to b2:${B2_BUCKET}/${B2_PREFIX}/$(basename "$src")"
    date -u +%Y-%m-%dT%H:%M:%SZ > /backups/.last-b2-upload
    # Prune anything older than retention from B2 too
    rclone delete --min-age "${RETENTION_DAYS}d" "b2:${B2_BUCKET}/${B2_PREFIX}/" 2>/dev/null || true
    return 0
  else
    echo "[pgbackup] B2 upload FAILED — local + iCloud copies still exist"
    return 1
  fi
}

run_backup() {
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  file="/backups/travel-${ts}.sql.gz"
  echo "[pgbackup] dumping $PGDATABASE → $file"
  pg_dump --clean --if-exists --no-owner --no-privileges "$PGDATABASE" | gzip -9 > "$file"

  if [ -d "$ICLOUD_DIR" ]; then
    cp -p "$file" "$ICLOUD_DIR/"
    echo "[pgbackup] mirrored to $ICLOUD_DIR/"
  else
    echo "[pgbackup] iCloud dir not mounted — skipping mirror"
  fi

  b2_upload "$file" || true

  # Prune local + iCloud copies older than retention
  find /backups -name 'travel-*.sql.gz' -type f -mtime +"${RETENTION_DAYS}" -delete || true
  if [ -d "$ICLOUD_DIR" ]; then
    find "$ICLOUD_DIR" -name 'travel-*.sql.gz' -type f -mtime +"${RETENTION_DAYS}" -delete || true
  fi

  echo "[pgbackup] done"
}

# ── Manual one-shot mode ──────────────────────────────────────────────────
if [ "${1:-}" = "run-once" ]; then
  run_backup
  exit 0
fi

# ── Cron mode (default) ───────────────────────────────────────────────────
echo "[pgbackup] starting; target hour=${BACKUP_CRON_HOUR} retention=${RETENTION_DAYS}d"
LAST_DATE=""
while true; do
  NOW_HOUR=$(date +%H)
  NOW_DATE=$(date +%Y-%m-%d)
  if [ "$NOW_HOUR" = "$BACKUP_CRON_HOUR" ] && [ "$LAST_DATE" != "$NOW_DATE" ]; then
    run_backup && LAST_DATE="$NOW_DATE"
  fi
  sleep 600  # check every 10 minutes
done
