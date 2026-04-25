#!/usr/bin/env bash
# 3-way health check: Caddy (local) → cloudflared (tunnel) → Authelia (auth)
# Run after bringing the stack up, and after any Caddy / tunnel / Access change.
#
# Usage: ./scripts/preflight.sh
# Exit: 0 = all green; non-zero = something's wrong (count of failures).

set -uo pipefail

cd "$(dirname "$0")/.."

if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; NC=''
fi

ok()   { printf '%b✓%b %s\n' "$GREEN" "$NC" "$1"; }
fail() { printf '%b✗%b %s\n' "$RED"   "$NC" "$1"; }
warn() { printf '%b!%b %s\n' "$YELLOW" "$NC" "$1"; }

FAILED=0

# ── 1. Caddy reachable on localhost:8090 ─────────────────────────────
printf "Checking Caddy on 127.0.0.1:8090 ... "
if curl -fsS -o /dev/null --max-time 5 http://127.0.0.1:8090/auth/; then
  ok "Caddy responds on 8090 (/auth/ reachable)"
else
  fail "Caddy not responding on 127.0.0.1:8090"
  FAILED=$((FAILED + 1))
fi

# ── 2. Postgres healthy via compose ──────────────────────────────────
printf "Checking Postgres healthcheck ... "
if docker compose ps --format '{{.Name}} {{.Health}}' 2>/dev/null | grep -q 'travel-postgres healthy'; then
  ok "Postgres container is healthy"
else
  fail "Postgres not reporting healthy"
  FAILED=$((FAILED + 1))
fi

# ── 3. PostgREST responds to /api ────────────────────────────────────
printf "Checking PostgREST via Caddy ... "
# This is gated by Authelia, so we expect a redirect (302) to /auth.
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -I http://127.0.0.1:8090/api/airports || echo "000")
if [ "$code" = "302" ] || [ "$code" = "200" ] || [ "$code" = "401" ]; then
  ok "PostgREST reachable (HTTP $code — expected 302/401 due to Authelia gate)"
else
  fail "PostgREST unreachable (HTTP $code)"
  FAILED=$((FAILED + 1))
fi

# ── 4. Bun predict /health ───────────────────────────────────────────
printf "Checking bun-predict /api/predict/health ... "
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 -I http://127.0.0.1:8090/api/predict/health || echo "000")
if [ "$code" = "302" ] || [ "$code" = "200" ] || [ "$code" = "401" ]; then
  ok "Bun predict reachable (HTTP $code — expected 302/401 due to Authelia gate)"
else
  fail "Bun predict unreachable (HTTP $code)"
  FAILED=$((FAILED + 1))
fi

# ── 5. Cloudflared tunnel reachable (public URL) ─────────────────────
printf "Checking public URL https://travel.myhometech.app ... "
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -I https://travel.myhometech.app/ 2>/dev/null || true)
[ -z "$code" ] && code="000"
case "$code" in
  200|302|401)
    ok "Public URL reachable (HTTP $code)"
    ;;
  000)
    warn "Public URL not reachable — cloudflared tunnel route may not be configured yet (expected until M3)"
    ;;
  *)
    fail "Public URL unexpected status (HTTP $code)"
    FAILED=$((FAILED + 1))
    ;;
esac

# ── 6. Backup recency (M12) ──────────────────────────────────────────
printf "Checking recent local pg_dump ... "
latest=$(ls -1t backups/travel-*.sql.gz 2>/dev/null | head -1)
if [ -z "$latest" ]; then
  fail "No pg_dump file in ./backups/"
  FAILED=$((FAILED + 1))
else
  # macOS stat differs from Linux — branch on uname
  if [ "$(uname)" = "Darwin" ]; then
    age=$(( $(date +%s) - $(stat -f %m "$latest") ))
  else
    age=$(( $(date +%s) - $(stat -c %Y "$latest") ))
  fi
  if [ "$age" -gt 90000 ]; then  # 25h grace
    fail "Latest pg_dump is $((age / 3600))h old (>25h): $latest"
    FAILED=$((FAILED + 1))
  else
    ok "Latest pg_dump is $((age / 3600))h old: $(basename "$latest")"
  fi
fi

printf "Checking B2 off-site upload marker ... "
marker=backups/.last-b2-upload
if [ ! -f "$marker" ]; then
  warn "No B2 upload marker yet — run \`docker compose exec pgbackup /ops/backup.sh run-once\` to seed"
else
  if [ "$(uname)" = "Darwin" ]; then
    age=$(( $(date +%s) - $(stat -f %m "$marker") ))
  else
    age=$(( $(date +%s) - $(stat -c %Y "$marker") ))
  fi
  if [ "$age" -gt 90000 ]; then
    fail "Last B2 upload was $((age / 3600))h ago (>25h)"
    FAILED=$((FAILED + 1))
  else
    ok "Last B2 upload was $((age / 3600))h ago"
  fi
fi

# ── 7. Secret file permissions ───────────────────────────────────────
printf "Checking secret file permissions ... "
bad=0
for f in secrets/*.txt authelia/users.yml; do
  [ -e "$f" ] || continue
  mode=$(stat -f '%Lp' "$f" 2>/dev/null || stat -c '%a' "$f")
  if [ "$mode" != "600" ]; then
    fail "  $f: mode $mode (expected 600)"
    bad=$((bad + 1))
  fi
done
if [ "$bad" -eq 0 ]; then
  ok "all secret files are 0600"
else
  FAILED=$((FAILED + bad))
fi

# ── Summary ──────────────────────────────────────────────────────────
echo
if [ "$FAILED" -eq 0 ]; then
  printf '%bAll checks passed.%b\n' "$GREEN" "$NC"
  exit 0
else
  printf '%b%d check(s) failed.%b Check the output above and `docker compose logs`.\n' "$RED" "$FAILED" "$NC"
  exit "$FAILED"
fi
