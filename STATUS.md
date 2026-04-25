# Project status

_Last updated: 2026-04-25 after M8. Update this file at the end of each milestone._

## Milestones

| # | Status | Summary |
|---|---|---|
| M1 | ✅ | Scaffold + gstack + GitHub (`NSDodgers/travel-logger`) |
| M2 | ✅ | Docker stack + Authelia (all 6 containers healthy) |
| M3 | ✅ | `travel.myhometech.app` live, login works on iPhone |
| M4 | ✅ | 5,515 airports seeded |
| M5 | ✅ | Historical import: 231 trips + 536 milestones loaded (2017-08 → 2026-04). 14 addresses, 8 sources reconciled. See `docs/M5_INVENTORY.md` + `docs/M5_QUIZ*.md`; re-run via `./scripts/load-legacy.sh` |
| M6 | ✅ | PWA shell + address book. 14 legacy labels renamed to human-readable. Mapbox Search REST + static-image pin; add/edit/archive wired through PostgREST. Caddy shim exposes `/config.js` from the `mapbox_token` secret at startup. Cloudflare cache bypassed for the hostname so iteration loop stays fast. QA driver added (`scripts/qa.ts`, Playwright persistent profile). See `docs/M6_BRIEF.md` for spec. |
| M7 | ✅ | Departure log flow live: empty hero → trip-start sheet (origin, dep+arr airport pickers, sched dep/arr datetime, bags/party/transit/TSA/international toggles, DST validation) → 2×2 hero+strip grid with one-tap milestone progression → "All milestones logged" gate → tap-to-finish. Long-press (touch ≥500ms or contextmenu) opens edit-time/void sheet. 60s undo toast on every tap; undoing the final tap reopens an auto-completed trip. Two migrations: 003 splits the audit trigger (BEFORE-touch + AFTER-audit, SECURITY DEFINER) so PostgREST can write through it; 004 persists the `international` flag on trips. Layout: hero + 4-tile strip (Nick chose this over fixed 2×4 since dep/arr both have 5 kinds). Customs visibility: manual flag in trip-start sheet. |
| M8 | ✅ | Offline queue. `web/queue.js` is an IndexedDB outbox with head-only drain + foreground retry (online / visibilitychange / 15s interval). `web/api.js` is now a `fetchJSON()` primitive (`redirect: 'manual'`, JSON-shape check, status taxonomy: success / duplicate (23505) / fk_missing (23503) / auth_required (3xx + non-JSON 2xx) / dead_letter / retriable / network_error). `api.post`/`api.patch` enqueue and return `[body]` so optimistic UI keeps working; `api.get` is direct. Sync strip above `<main>` color-coded by state (amber pending, blue syncing, amber retrying, red dead-letter). Dead-letter sheet has Retry/Discard per entry. Auth-expired modal pauses the queue and bounces to `/auth/`. `navigator.storage.persist()` requested at boot. Caps: 5000 entries / 10MB. `getQueuedActiveTrip()` + `getQueuedFor(trip_id)` merge queue state on log-screen mount so reload mid-trip doesn't drop optimistic taps. One small migration (`005`) — the addresses BEFORE-UPDATE `updated_at` trigger that pre-M7 STATUS had flagged. `scripts/qa.ts` adds `offline on/off` (Playwright `setOffline`). E2E airplane-mode test passes: 3 enqueues offline → strip "Offline · 3 taps pending" → online → drain → DB reflects all three. UI-driven test (offline edit Home label → save → online → drain) confirmed end-to-end through the real screens. |
| **M9** | **⏳ next** | Arrival flow + trip history list. See `implementation_plan.md` §8. |
| M10–M13 | planned | See `implementation_plan.md` §8 |

## Currently running on Mac Studio

```bash
cd ~/Code/travel-logger
docker compose ps
```

Expected — 6 containers all `Up` and healthy:
- `travel-caddy` — reverse proxy on `127.0.0.1:8090`
- `travel-authelia` — auth portal at `/auth/`
- `travel-postgres` — source of truth (db `travel`)
- `travel-postgrest` — REST API at `/api/*` (via `api.*` views)
- `travel-predict` — Bun skeleton at `/api/predict/*` (real logic lands in M10)
- `travel-pgbackup` — nightly `pg_dump` cron at 03:00 local

Public URL: **<https://travel.myhometech.app>**
Local URL: **<http://127.0.0.1:8090>** (bypasses Cloudflare, still gated by Authelia)

## Quick ops

| Task | Command |
|---|---|
| Bring stack up | `docker compose up -d --build` |
| Stop stack | `docker compose down` (preserves volumes) |
| Wipe + rebuild from scratch | `docker compose down -v && docker compose up -d --build` |
| Full health check | `./scripts/preflight.sh` |
| Tail logs | `docker compose logs -f` |
| Enter Postgres | `docker compose exec postgres psql -U postgres -d travel` |
| Re-seed airports | `./scripts/load-airports.sh` |
| Re-generate airports seed | `bun run db/seeds/generate-airports.ts` |
| Re-load legacy data | `./scripts/load-legacy.sh` (idempotent — wipes + reloads `source='legacy'` rows) |
| Re-generate legacy SQL only | `bun run db/seeds/import-legacy.ts` |
| Browser-driven QA (one-time) | `bun run qa login` (sign in once to Authelia) |
| Browser-driven QA (ongoing) | `bun run qa goto /#/addresses` / `bun run qa screenshot` / `bun run qa eval "{...}"` — see `scripts/qa.ts` header |

## Secrets inventory (on-disk, never in git)

Every file in `./secrets/` is `chmod 0600`, gitignored. Regenerated via `./scripts/bootstrap.sh` if missing.

| File | Purpose |
|---|---|
| `secrets/pg_password.txt` | Postgres superuser |
| `secrets/authelia_db_password.txt` | `authelia_user` role |
| `secrets/postgrest_db_password.txt` | `postgrest_user` role |
| `secrets/predict_db_password.txt` | `predict_user` role |
| `secrets/authelia_session.txt` | Session cookie signing |
| `secrets/authelia_storage.txt` | Authelia storage-at-rest encryption |
| `secrets/authelia_reset_jwt.txt` | Authelia's required reset_password JWT (even though feature is unused) |
| `secrets/mapbox_token.txt` | Mapbox public token (URL-restricted — used in M6) |
| `secrets/b2_key_id.txt` | Backblaze B2 key ID (used in M12) |
| `secrets/b2_application_key.txt` | Backblaze B2 application key (used in M12) |
| `authelia/users.yml` | User database with Argon2id password hash |

## Key git refs

| Commit | What |
|---|---|
| `5f6c51f` | Initial scaffold (M1) |
| `2d506d4` | Plan rewrite after `/autoplan` review |
| `aaf3732` | B2 endpoint locked to `us-west-000` |
| `0cfcb26` | M2 Docker stack scaffold |
| `044db23` | Authelia reset_password JWT + predict URL parsing fixes |
| `7a8c738` | Bootstrap Authelia hash command correction |
| `610107a` | Predict healthcheck uses 127.0.0.1 (Alpine IPv6 localhost issue) |
| `826a8fe` | Authelia `/auth` path prefix fix (white-screen bug) |
| `c494e4e` | M4 airport dataset (5,515 rows) |
| `cedd470` | M5 docs + 14-address registry |
| `0cc4256` | M5 schema migration (party enum 3-way + customs kinds) |
| `f1c4895` | M5 narrative source — 59 resolved trip entries |
| `4c25dfe` | M5 parser — narrative + CSV → trip rows + SQL |
| `52245d6` | M5 loader script |
| `e6c4cb5` | M5 milestones_history FK fix (deferrable for bulk loads) |
| `2d62c20` | M5 marked complete |
| `40f90b4` | M6 legacy address rename migration (+ loader sync) |
| `aec8e08` | M6 Caddy `/config.js` startup shim |
| `1ce79f4` | M6 PWA shell scaffold |
| `81bb543` | M6 address list view |
| `f110cdc` | M6 add-address flow (Mapbox Search REST + static image) |
| `0958667` | M6 edit + archive flows |
| `4ead4a8` | M6 post-QA fixes (async render, header grid, /api strip, no-store) |
| `e33e830` | QA driver — Playwright persistent profile (scripts/qa.ts) |
| `ede6de7` | M8 migration 005 — addresses BEFORE-UPDATE updated_at trigger |
| `b00f69d` | M8 IndexedDB outbox (web/queue.js) + fetchJSON wrapper (web/api.js) |
| `351298b` | M8 sync strip + auth-expired modal + CSS |
| `6416b9c` | M8 migrate log.js writes to queue + reload-merge helpers |
| `a3bd650` | M8 migrate addresses.js writes to queue |
| `3a6f6a0` | scripts/qa.ts offline on/off subcommand |

Diff against `main` (what changed since last push): `git log --oneline origin/main..HEAD` — should be empty if everything's pushed.

## Known small things

- `bun-predict` skeleton only has `/api/predict/health`. `POST /api/predict` returns 501. Real percentile + widening math lands in M10.
- `walg` container is stubbed in `compose.yml` (commented out). Gets activated in M12.
- `web/index.html` is the real PWA shell (M6). M7 added the trip-logging grid; M8 added the sync strip + auth-expired modal.
- `web/icon.svg` is a placeholder (amber "T" on black). Nick can design real icons + an Apple-touch PNG before M11 "first real trip."
- Mapbox token must have `https://travel.myhometech.app/*` and `http://127.0.0.1:8090/*` in its URL restriction before M6 is reachable end-to-end.
- A Cloudflare Cache Rule bypasses CDN caching for `travel.myhometech.app` (see Rules → Cache Rules in the dashboard). Don't add aggressive caching headers without removing that rule first — the iteration loop depends on it.
- No tests exist yet. Plan's §4 test diagram needs to start getting filled in alongside M9–M10.
- M8 outbox: orphaned dependents (e.g. milestone POST whose parent trip POST dead-lettered) cap at `MAX_ATTEMPTS` (8) and dead_letter naturally. The dead-letter sheet exposes Retry/Discard but no "Edit before retry" yet — flagged as deferrable in the brief, skipped to keep scope tight.
- M8 uses `redirect: 'manual'`. If Cloudflare/Authelia ever returns a 200 with HTML (login page proxied behind a quirky chain), `fetchJSON()` classifies it as `auth_required` via the JSON content-type check.

## Schema additions from M5

- `trips.party` enum expanded from `solo|family` → `solo|group_with_kids|group_without_kids`. Existing app code that hardcoded `family` should migrate to `group_with_kids`.
- New milestone kinds: `dep_customs` (departure-side, e.g. YYZ US preclearance) and `arr_customs` (arrival-side, between off-plane and bags). Order_seq for existing arrival kinds bumped by 1.
- `milestones_history.milestone_id` FK is now `deferrable initially immediate` so bulk loaders can use `set constraints deferred`.

## Schema changes in M6

- 14 legacy addresses renamed from `legacy:<slug>` → clean labels (Home, Mom's, Steppenwolf, etc.) via `db/migrations/002-rename-legacy-addresses.sql`. `import-legacy.ts` carries the slug→label map so a wipe+reload reproduces the renamed state; its wipe still sweeps `legacy:%` as a defensive fallback.

## Schema changes in M7

- Migration `003-milestones-audit-security-definer.sql` splits the original `BEFORE INSERT OR UPDATE` trigger on `public.milestones` into two: `milestones_touch_trg` (BEFORE UPDATE) just bumps `updated_at`; `milestones_audit_trg` (AFTER INSERT OR UPDATE) writes to `public.milestones_history`. The audit function is `SECURITY DEFINER` with a locked `search_path` so PostgREST's `postgrest_user` (no grants on `public.*`) can still write through the trigger. The original BEFORE trigger crashed because the milestones row hadn't been inserted yet when the immediate FK on `milestones_history.milestone_id` was checked.
- Migration `004-trips-international-flag.sql` adds `public.trips.international boolean default false` and re-creates `api.trips` (drop+create — `replace view` can't reorder columns). Drives the M7 dep_customs tile visibility and survives page reload mid-trip.

## Schema changes in M8

- Migration `005-addresses-updated-at-trigger.sql` adds `addresses_touch_trg` (BEFORE UPDATE) on `public.addresses`. Mirrors the milestones BEFORE-touch trigger. Pays down the pre-M7 STATUS TODO so the queue rewrite can drop client-side `updated_at` from address PATCH bodies and still get list-resort behavior.

## External accounts / dashboards

| Service | What | Where |
|---|---|---|
| Cloudflare | DNS, tunnel, Zero Trust | `dash.cloudflare.com` + `one.dash.cloudflare.com` |
| GitHub | Source backup | `github.com/NSDodgers/travel-logger` |
| Mapbox | Geocoding (M6) | `account.mapbox.com` |
| Backblaze B2 | Offsite backup (M12) | `secure.backblaze.com/b2_buckets.htm`, bucket `travel-logger-wal`, endpoint `s3.us-west-000.backblazeb2.com` |

## If Claude is starting a fresh session

1. Read this file first.
2. Read `implementation_plan.md` §8 (M9 row) — arrival flow + trip history is next.
3. Read the rest of `implementation_plan.md` for surrounding context (Flow A/B in §7, UI spec in §10).
4. Read `CLAUDE.md` — project brief + skill routing.
5. Memory at `~/.claude/projects/-Users-nicksolyom-Library-Mobile-Documents-com-apple-CloudDocs-travel-time-sheet-project/memory/MEMORY.md` has cross-session context (decisions, gotchas, Cloudflare bypass, QA driver).
6. For UI patterns, study `web/screens/log.js` (M7 — primary screen, sheet primitive, optimistic UI) and `web/screens/addresses.js` (M6 — list/form/toast).
7. For the queue, study `web/queue.js` (M8 — IndexedDB outbox, head-only drain, status taxonomy) and `web/api.js` (`fetchJSON()` primitive). Every write goes through `api.post`/`api.patch` which enqueue rather than awaiting the network.
8. For browser-driven QA: `bun run qa login` once, then `bun run qa <cmd>` (see `scripts/qa.ts` header). Tip: Caddy serves `Cache-Control: no-store` but the Playwright persistent profile still caches; force-bust with `location.href = '/?_=' + Date.now() + '#/whatever'` before each verification round. Airplane-mode tests: `bun run qa offline on|off`.
9. M8 reference: `docs/M8_BRIEF.md` for the spec; `web/queue.js` + `web/sync-strip.js` for the implementation.
10. M7 reference: `docs/M7_BRIEF.md` for what was scoped; `web/screens/log.js` for the implementation.
11. M6 reference (if M6 context is needed): `docs/M6_BRIEF.md`.
12. M5 reference (only if historical data context is needed): `docs/M5_INVENTORY.md`, `docs/M5_QUIZ.md`, `docs/M5_QUIZ_2.md`.
