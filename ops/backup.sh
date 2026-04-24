#!/bin/sh
# Nightly pg_dump cron for Travel Logger
# Runs as entrypoint of the pgbackup container (same postgres image).
# Installs a small in-container cron via a sleep loop — avoids a second image.
set -eu

: "${PGHOST:=postgres}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=travel}"
: "${BACKUP_CRON_HOUR:=03}"
: "${RETENTION_DAYS:=30}"

export PGPASSWORD=$(cat "${PGPASSWORD_FILE:-/run/secrets/pg_password}")

mkdir -p /backups
# iCloud backup dir may not be mounted on all hosts — only mirror if present.
ICLOUD_DIR=/icloud-backups
if [ -d "$ICLOUD_DIR" ]; then
  mkdir -p "$ICLOUD_DIR"
fi

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

  # Prune local backups older than retention
  find /backups -name 'travel-*.sql.gz' -type f -mtime +"${RETENTION_DAYS}" -delete || true
  if [ -d "$ICLOUD_DIR" ]; then
    find "$ICLOUD_DIR" -name 'travel-*.sql.gz' -type f -mtime +"${RETENTION_DAYS}" -delete || true
  fi

  echo "[pgbackup] done"
}

# Simple hourly check — if current hour matches BACKUP_CRON_HOUR and no backup today, run it.
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
