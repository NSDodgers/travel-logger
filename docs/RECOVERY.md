# Recovery runbook

If the Mac Studio dies (drive failure, theft, fire) and you need to bring
Travel Logger back from scratch, this is the procedure. Everything below
assumes the machine running the recovery has a working internet
connection, Docker installed, and access to the GitHub repo + Backblaze B2
account.

**Recovery point objective:** ≤ 24 hours. The nightly `pg_dump` runs at
03:00 local and uploads to B2 immediately. Worst case, you lose anything
logged after 03:00 today.

**Recovery time objective:** ~30 minutes once new hardware is in hand.
Most of that is `docker compose up -d --build` and pulling the airport
seed.

## Inventory of what's backed up where

| Backed up | Where | Recency |
|---|---|---|
| Postgres data (`travel` DB) | `./backups/travel-*.sql.gz` (local) | nightly 03:00 |
| Postgres data | `~/Library/Mobile Documents/com~apple~CloudDocs/backups/travel/` (iCloud) | nightly 03:00 |
| Postgres data | `b2://travel-logger-wal/pg_dumps/` (Backblaze, off-site) | nightly 03:00 |
| Source code | `github.com/NSDodgers/travel-logger` (origin/main) | every push |
| Secrets | **NOT backed up anywhere automated.** Live in `./secrets/` only |
| Authelia user DB (`authelia/db.sqlite3`) | **Not in pg_dump.** Lives next to the repo |

The secrets and the Authelia user DB are the only things that aren't part
of the off-site backup. They're stored in iCloud-synced folders but are
file-permissioned 0600 and gitignored. If the Mac is gone, regenerate
them as below.

## Drill — verify a backup is actually restorable

Run this any time, no destructive effects:

```bash
./scripts/restore-drill.sh             # uses newest local dump
./scripts/restore-drill.sh --from=b2   # pulls newest from Backblaze
```

The drill spins up an isolated postgres container on port 15432 with a
fresh volume, restores the dump, runs row-count assertions against the
live DB, then tears the test container down. PASS = the backup is
trustworthy.

## Recovery walkthrough

### Step 1 — Get the source code

```bash
git clone https://github.com/NSDodgers/travel-logger ~/Code/travel-logger
cd ~/Code/travel-logger
```

The repo MUST live outside iCloud / Dropbox / OneDrive — those file
managers corrupt `.git`.

### Step 2 — Regenerate secrets

```bash
./scripts/bootstrap.sh
```

This prompts you for the Mapbox token and Backblaze B2 keys (paste from
your password manager) and regenerates the rest with `openssl rand`.
Generates fresh Authelia signing keys too.

For Authelia user creds:

```bash
cp authelia/users.yml.example authelia/users.yml
# then run authelia hash command to regenerate your password hash
docker run --rm -it authelia/authelia:4.38 \
  authelia crypto hash generate argon2 -- --random.length 72
# paste the $argon2id$... output into authelia/users.yml
chmod 0600 authelia/users.yml
```

### Step 3 — Pull the latest dump from B2

If iCloud is synced and recent, you can use that copy. Otherwise fetch
from Backblaze:

```bash
# Using the b2 CLI (install: brew install b2-tools)
b2 account authorize "$(cat secrets/b2_key_id.txt)" "$(cat secrets/b2_application_key.txt)"
b2 file download \
  "b2://travel-logger-wal/pg_dumps/$(b2 ls travel-logger-wal pg_dumps/ | sort | tail -1 | awk '{print $NF}')" \
  ./backups/

# OR with rclone (install: brew install rclone), no separate auth step:
RCLONE_CONFIG_B2_TYPE=b2 \
RCLONE_CONFIG_B2_ACCOUNT=$(cat secrets/b2_key_id.txt) \
RCLONE_CONFIG_B2_KEY=$(cat secrets/b2_application_key.txt) \
rclone copy --no-traverse "$(rclone lsf b2:travel-logger-wal/pg_dumps/ \
  --files-only | sort | tail -1 | sed 's|^|b2:travel-logger-wal/pg_dumps/|')" \
  ./backups/
```

### Step 4 — Bring the stack up

```bash
docker compose up -d --build
```

Postgres starts empty (no `pgdata` volume yet) and runs the init scripts
(`db/init/00..05.sql`) which lay down the schema, roles, and seed
airports. The `travel` DB is created fresh and empty.

### Step 5 — Restore the dump

```bash
gunzip -c backups/travel-YYYYMMDDTHHMMSSZ.sql.gz \
  | docker compose exec -T postgres psql -U postgres -d travel
```

This replaces the schema/data with what was in the backup. The init
scripts ran first, but `pg_dump --clean --if-exists` drops + recreates
everything cleanly.

### Step 6 — Sanity-check

```bash
docker compose exec postgres psql -U postgres -d travel -c '
  select count(*) as trips from public.trips;
  select count(*) as milestones from public.milestones;
  select count(*) as airports from public.airports;
'
```

Expected ranges: trips > 200 (legacy + app), milestones > 500, airports
= 5515. If trips/milestones look short, you grabbed a stale dump — try
again from a newer file.

### Step 7 — Re-apply any post-backup migrations

The init scripts in `db/init/` reflect the schema as of the last
release. Any `db/migrations/*.sql` files that were applied to the
running DB *after* that release also need to be replayed:

```bash
for f in db/migrations/*.sql; do
  docker compose exec -T postgres psql -U postgres -d travel < "$f"
done
```

The migrations are idempotent (each guards on `if not exists` /
`if exists`) so this is safe to run repeatedly.

### Step 8 — Re-link the cloudflared tunnel

If the new machine has a different `cloudflared` install, register the
existing tunnel and add the route:

```bash
cloudflared tunnel login                      # browser-based, one-time
cloudflared tunnel list                       # find your tunnel UUID
cloudflared tunnel route dns <UUID> travel.myhometech.app
cloudflared tunnel run <UUID>                 # foreground, or set up service
```

### Step 9 — Verify

```bash
./scripts/preflight.sh
```

All checks should be green. Then open `https://travel.myhometech.app`,
sign in via Authelia (passkey or password), and walk through `/log`,
`/predict`, `/history` — each should render real data.

## What the drill does NOT cover

The restore drill verifies the **dump itself** restores cleanly, but it
doesn't simulate full hardware loss because the cloudflared tunnel,
Authelia user DB, and secrets all live elsewhere. To do a true
end-to-end drill, follow steps 1-9 above on a clean machine
(or VM) and time it.

## When to revisit this approach

This setup chooses 24h RPO over continuous WAL archiving. Layer wal-g on
top if any of these become true:

- You log multiple trips per day and 24h of loss would feel material.
- The Mac Studio's drive starts surfacing SMART errors and you want
  point-in-time recovery to "the moment before the drive failed."
- You start using the app for anything beyond personal travel logging.
