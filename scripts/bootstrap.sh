#!/usr/bin/env bash
# Travel Logger bootstrap — run once on a fresh checkout (or whenever secrets are missing).
# Prompts for any missing secret file, generates random values where possible,
# and verifies 0600 permissions on everything sensitive.
#
# Usage: ./scripts/bootstrap.sh

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

# ── Colors ───────────────────────────────────────────────────────────
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; NC=''
fi

log()    { printf '%b[bootstrap]%b %s\n' "$BLUE" "$NC" "$1"; }
ok()     { printf '%b✓%b %s\n' "$GREEN" "$NC" "$1"; }
warn()   { printf '%b!%b %s\n' "$YELLOW" "$NC" "$1"; }
fail()   { printf '%b✗%b %s\n' "$RED" "$NC" "$1" >&2; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { fail "missing command: $1"; exit 1; }
}

need_cmd openssl
need_cmd docker

mkdir -p "$ROOT/secrets" "$ROOT/authelia" "$ROOT/backups" "$ROOT/web"

# ── Auto-generated secrets (random values) ──────────────────────────
autogen_hex() {
  local file="$1" bytes="$2" label="$3"
  if [ ! -s "$ROOT/secrets/$file" ]; then
    openssl rand -hex "$bytes" > "$ROOT/secrets/$file"
    ok "generated $file ($label)"
  else
    ok "$file exists"
  fi
  chmod 0600 "$ROOT/secrets/$file"
}

autogen_b64() {
  local file="$1" bytes="$2" label="$3"
  if [ ! -s "$ROOT/secrets/$file" ]; then
    openssl rand -base64 "$bytes" | tr -d '\n' > "$ROOT/secrets/$file"
    ok "generated $file ($label)"
  else
    ok "$file exists"
  fi
  chmod 0600 "$ROOT/secrets/$file"
}

log "Creating/checking auto-generated secrets..."
autogen_b64 pg_password.txt           48 "Postgres superuser password"
autogen_b64 authelia_db_password.txt  48 "authelia_user role password"
autogen_b64 postgrest_db_password.txt 48 "postgrest_user role password"
autogen_b64 predict_db_password.txt   48 "predict_user role password"
autogen_hex authelia_session.txt      64 "Authelia session cookie secret"
autogen_hex authelia_storage.txt      64 "Authelia storage encryption key"
autogen_hex authelia_reset_jwt.txt    64 "Authelia reset-password JWT secret (required even if unused)"

# ── User-provided secrets (require manual paste) ────────────────────
prompt_file() {
  local file="$1" label="$2" hint="${3:-}"
  if [ -s "$ROOT/secrets/$file" ]; then
    ok "$file exists"
  else
    warn "$file is missing"
    printf "   %s\n" "$label"
    [ -n "$hint" ] && printf "   hint: %s\n" "$hint"
    printf "   Paste the value now (input hidden), then press Enter:\n   > "
    stty -echo
    read -r val
    stty echo
    printf "\n"
    if [ -z "$val" ]; then
      fail "empty input, aborting"
      exit 1
    fi
    printf '%s' "$val" > "$ROOT/secrets/$file"
    ok "$file saved"
  fi
  chmod 0600 "$ROOT/secrets/$file"
}

log "Checking user-provided secrets (paste hidden)..."
prompt_file mapbox_token.txt         "Mapbox public token (pk.*)"                "URL-restricted to travel.myhometech.app + localhost:8090"
prompt_file b2_key_id.txt            "Backblaze B2 keyID (short alphanumeric)"   "M12 uses this; safe to paste now"
prompt_file b2_application_key.txt   "Backblaze B2 applicationKey"               "M12 uses this; safe to paste now"

# ── Authelia users.yml ──────────────────────────────────────────────
if [ ! -s "$ROOT/authelia/users.yml" ] || grep -q REPLACE_ME "$ROOT/authelia/users.yml" 2>/dev/null; then
  warn "authelia/users.yml is missing or still has REPLACE_ME"
  printf "   To create/fix it:\n"
  printf "     1. Generate an Argon2id hash (enter your password twice when prompted):\n"
  printf "          docker run --rm -it authelia/authelia:4.38 authelia crypto hash generate argon2\n"
  printf "     2. Copy the full \$argon2id\$... string from the 'Digest:' line.\n"
  printf "     3. cp authelia/users.yml.example authelia/users.yml  (if not already copied)\n"
  printf "     4. Edit authelia/users.yml and replace the REPLACE_ME placeholder(s) with the hash.\n"
  printf "\n"
  printf "   Want me to run the hash command now? (You will still need to edit users.yml manually.) [y/N]: "
  read -r answer
  if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
    if [ ! -f "$ROOT/authelia/users.yml" ]; then
      cp "$ROOT/authelia/users.yml.example" "$ROOT/authelia/users.yml"
      ok "copied users.yml.example → users.yml"
    fi
    printf "\n   Running Authelia hash generator — enter your password twice.\n"
    printf "   Keep the password in your password manager (no recovery).\n\n"
    # Capture output so we can echo the hash prominently at the end
    docker run --rm -it authelia/authelia:4.38 authelia crypto hash generate argon2 || {
      warn "hash generation failed or was cancelled"
      warn "run it manually, edit users.yml, then re-run this script"
      exit 1
    }
    printf "\n   Edit authelia/users.yml to replace REPLACE_ME with the Digest hash above.\n"
    printf "   Press Enter when done: "
    read -r _
    if grep -q REPLACE_ME "$ROOT/authelia/users.yml" 2>/dev/null; then
      fail "users.yml still contains REPLACE_ME — re-run bootstrap.sh after editing"
      exit 1
    fi
  else
    warn "skipping — re-run bootstrap.sh after you've created authelia/users.yml"
    exit 1
  fi
fi
chmod 0600 "$ROOT/authelia/users.yml"
ok "authelia/users.yml looks good"

# ── Sanity checks ────────────────────────────────────────────────────
log "Sanity-checking permissions..."
bad=0
for f in "$ROOT"/secrets/*.txt "$ROOT/authelia/users.yml"; do
  [ -e "$f" ] || continue
  mode=$(stat -f '%Lp' "$f" 2>/dev/null || stat -c '%a' "$f")
  if [ "$mode" != "600" ]; then
    fail "$(basename "$f"): expected 600, got $mode"
    bad=$((bad + 1))
  fi
done
if [ "$bad" -gt 0 ]; then
  fail "$bad file(s) have wrong permissions"
  exit 1
fi
ok "all secret files are 0600"

# ── Docker / OrbStack running? ───────────────────────────────────────
if ! docker info >/dev/null 2>&1; then
  fail "Docker (OrbStack) is not running. Start it and re-run bootstrap.sh."
  exit 1
fi
ok "Docker daemon reachable"

# ── iCloud backup dir exists? ────────────────────────────────────────
ICLOUD_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/backups/travel"
if [ ! -d "$ICLOUD_DIR" ]; then
  mkdir -p "$ICLOUD_DIR"
  ok "created iCloud backup mirror: $ICLOUD_DIR"
else
  ok "iCloud backup mirror exists"
fi

printf '\n%bBootstrap complete.%b Next:\n' "$GREEN" "$NC"
printf "  1. Review Caddyfile + compose.yml if you want to understand the wiring.\n"
printf "  2. Bring the stack up:  docker compose up -d --build\n"
printf "  3. Watch logs:           docker compose logs -f\n"
printf "  4. Health check:         ./scripts/preflight.sh\n\n"
