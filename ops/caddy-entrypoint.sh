#!/bin/sh
# Caddy container startup shim.
# Reads the Mapbox public token from /run/secrets/mapbox_token and writes a
# tiny /gen/config.js so the PWA can grab it via `<script src="/config.js">`.
# The token is URL-restricted to travel.myhometech.app + localhost:8090
# and Mapbox explicitly treats public tokens as safe to ship to the browser,
# but we still keep the file itself out of git (secrets/ is gitignored).
# Source of truth: secrets/mapbox_token.txt. Rotation = edit file + restart caddy.
set -eu

SECRET_FILE=/run/secrets/mapbox_token
OUT_DIR=/gen
OUT_FILE="$OUT_DIR/config.js"

if [ ! -f "$SECRET_FILE" ]; then
  echo "caddy-entrypoint: $SECRET_FILE missing — refusing to start" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
TOKEN="$(tr -d '\r\n' < "$SECRET_FILE")"

if [ -z "$TOKEN" ]; then
  echo "caddy-entrypoint: $SECRET_FILE is empty — refusing to start" >&2
  exit 1
fi

# Single-quoted JSON-ish — token is a pk.<base64-ish> string, no single quotes.
cat > "$OUT_FILE" <<EOF
// Generated at caddy container start from /run/secrets/mapbox_token.
// Regenerated on every restart; do not edit by hand.
window.TRAVEL_CONFIG = Object.freeze({
  mapboxToken: '$TOKEN'
});
EOF
chmod 0644 "$OUT_FILE"

echo "caddy-entrypoint: wrote $OUT_FILE"
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
