# Project status

_Last updated: 2026-04-25 after M14 (pre-M11 polish). Update this file at the end of each milestone._

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
| M9 | ✅ | Arrival flow + 3-tab history. Empty state stacks two heroes — Dep: In Transit (accent) on top, Arr: Off Plane (surface) below. Tapping arr opens a minimal start sheet that auto-fills the arrival airport from the most-recent completed *departure* trip's `arr_airport` (with a Change affordance), carries the dep-side airport forward silently, and pulls sticky bags / party / transit / TSA / international from the same trip. Active state is now direction-agnostic — `visibleKindsForTrip()` filters milestone_kinds by `trip.direction`, applies the carry-on hide rule, and hides `arr_customs` unless international. `currentAirportIata()` picks `dep_airport` for departures vs `arr_airport` for arrivals when formatting milestone times. `web/screens/history.js` exposes `/history` (list, sorted by trip date desc, source badge for app/legacy, status badge for in_progress/abandoned, 200-row cap) and `/history/:id` (per-trip timeline with logged_at + duration delta from previous milestone). `getQueuedActiveTrip()` iterates DESC so a queued arrival wins over an older queued departure. `scripts/qa.ts screenshot --viewport` for non-fullPage shots. UI-verified end-to-end: empty → arr sheet → start → JFK→LAX active grid (4 visible kinds, hero=arr_bags, off-plane done) → abandon → empty. |
| M10 | ✅ | Predict tab live. Form mirrors trip-start sheet (direction toggle / airport picker / bags / party / transit / TSA / international / DST-validated date+time). `services/predict/src/index.ts` replaces the M2 stub: per-trip duration = `extract(epoch from (max(logged_at) - min(logged_at)))` over non-void milestones, `having count(*) >= 2`, status excludes `in_progress`. Filter widening drops `tsa_precheck → party → transit → bags` and stops; airport + international never relax (locked decision 2026-04-25 — cross-airport averages mislead). Result card always surfaces sample composition: N matching · X incomplete (formerly "abandoned" — UI rename only, DB enum unchanged) · applied filters · relaxed filters. Three card shapes: `full` (N≥5, p90 hero + p50 comfortable + sparkline), `low_n` (1≤N<5, median hero, no sparkline), `empty` (N=0 after widening, "log a trip to start predicting"). Math: departure subtracts offset_s from flight time; arrival adds. Every prediction persists to `public.predictions` for M13 calibration. `predict_user` granted SELECT on predictions (migration 006) — needed for `INSERT...RETURNING` and M13 reads. Caddy strips `/api` before proxying to bun-predict so the service handles both `/predict/*` and `/api/predict/*` shapes. DST helpers extracted to `web/dst.js` (shared between log.js and predict.js). `api.predict()` is direct request/response (NOT queued — predictions are synchronous, the user is staring at the screen). UI-verified end-to-end: LGA dep carry-on → 16 trips, p90 46 min, leave-by 1:09 PM. JFK arr checked → 16 trips, p90 6h22m, arrive-by 8:16 PM. TSA=Yes drops → relaxed:[tsa_precheck]. BHX dep → empty after relaxing all 4. |
| **M11** | **⏳ Nick's flight Monday 2026-04-27** | First real trip. Nick uses the app on an actual airport run. /qa pre-M11 sweep shipped 2 critical fixes (`7a419a0` airport picker, `782d064` trip-start enqueue race). Test-trip toggle (`56a6538`) flags dogfood trips. M14 (below) layered live-drive + segment breakdown + handoff into Predict before the flight so the leave-by Nick sees Monday morning isn't pure history. |
| M12 | ✅ | Backups + preflight. Nightly `pg_dump` cron now mirrors to **three** targets: `./backups/` (local Docker volume), `~/Library/.../backups/travel/` (iCloud), and `b2://travel-logger-wal/pg_dumps/` (off-site, via rclone). Scope reduced from continuous wal-g WAL archiving (5-min RPO) to nightly dump→B2 (24h RPO) — single-user app where 24h of trip loss is at most one trip; complexity cost of wal-g on Apple Silicon wasn't worth it. `ops/backup.sh` lazily installs rclone on first run, writes `/backups/.last-b2-upload` marker on success so preflight verifies off-site without needing host-side B2 creds. Two new preflight checks: latest pg_dump < 25h old, last B2 upload < 25h old. `scripts/restore-drill.sh` (new) spins up an isolated postgres-test container on port 15432, restores either the newest local dump (`--from=local`, default) or the newest B2 dump (`--from=b2`), runs row-count assertions vs the live DB (trips/milestones/addresses/airports/milestone_kinds/predictions), then cleans itself up. Both paths PASS — verified 232 trips, 537 milestones, 14 addresses round-trip cleanly. `docs/RECOVERY.md` (new): step-by-step runbook for a from-scratch recovery on new hardware (clone repo → bootstrap secrets → fetch B2 dump → compose up → psql restore → cloudflared route → preflight). One-line trigger for ad-hoc backup: `docker compose exec pgbackup /ops/backup.sh run-once`. |
| M13 | planned | Calibration UI — score `actual_duration - predicted_p90` once Nick's flight produces real-trip data. See `implementation_plan.md` §8. |
| M14 | ✅ | Predict tab v2 — live drive + segment math + handoff, shipped as pre-M11 polish so the Monday flight has the best leave-by we can produce. Migration 008 adds `public.airports.lat/lng` (OpenFlights had them; the M4 generator dropped them) and re-creates `api.airports`; M4 seed regenerated with coords. Predict service decomposes one full-trip query into three: full trip (legacy fallback), drive segment (`in_transit → at_airport` for dep / `in_transit → at_destination` for arr), and airport segment (min/max `logged_at` across airport-side kinds). Each segment runs `withWidening()` independently — drive may hit N≥5 quickly while airport widens further. Response now carries `segments.drive` and `segments.airport` blocks alongside the existing full-trip data; airport object also returns lat/lng so the frontend can call Mapbox Directions without a second round-trip. Predict form gains an **origin/destination picker** above the airport picker (label flips with direction), defaults to most-recently-updated saved address, "— Skip live drive time —" falls back to history-only. On submit, predict + Mapbox driving-traffic fire in parallel; Mapbox failure is non-fatal (falls back to history with a hint banner); public transit always falls back. Mapbox call uses **`depart_at`** = `flight_utc - 90 min` for departures (clamped to `now+5 min`, skipped when flight > 30 days out) so the traffic estimate is "typical for that day-of-week + time" rather than "right now Saturday evening" — actively misleading otherwise. UI honestly labels source: "Drive at Apr 27, 8:05 AM · Mapbox typical" vs "Drive right now · Mapbox live"; hero delta gets `· typical traffic` / `· live drive` suffix. Result card grew a **three-row segment breakdown** (Today's drive live, Drive history p50/p90, At airport history p50/p90) plus a **buffer slider** (0–120 min, 5-min steps, pure UI — does not change the persisted prediction row; sub-label flips by range: "Quick coffee" / "Sit-down meal" / "Long meal" / "Lounge session") and a **past-trips list** (every trip that fed the percentile, newest first, with status/test/legacy badges and milestone count, tappable → `/history/:id`). **Predict→Trip handoff**: "Start this trip →" button on every result card stashes form values on `window.__predictHandoff` and routes to `/log`; `logScreen` reads once on mount and auto-opens the dep or arr start sheet pre-filled with airport, origin address, bags, party, transit, TSA, international, sched dep date+time. Read-once: handoff cleared after consumption. Both `openDepStartSheet` and `openArrivalStartSheet` accept an optional handoff arg with the existing sticky-from-last-trip path as fallback. |

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
- `travel-predict` — Bun service at `/api/predict/*` (M10: percentile + filter widening live)
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
| Manual backup (any time) | `docker compose exec pgbackup /ops/backup.sh run-once` (writes local + iCloud + B2) |
| Restore drill (local dump) | `./scripts/restore-drill.sh` |
| Restore drill (off-site dump) | `./scripts/restore-drill.sh --from=b2` |

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
| `4847e97` | M9 arrival flow — double-hero empty + start sheet + active grid |
| `5de8719` | M9 trip history list + per-trip timeline (web/screens/history.js) |
| `d8cfb93` | M9 CSS + qa.ts screenshot --viewport flag |
| `bff930c` | M10 db migration 006 — predict_user select grant on predictions |
| `ae5cd4f` | M10 predict service — percentile + widening + prediction-row writeback |
| `5cc7e7c` | M10 predict screen + api.predict + route |
| `c377e33` | M10 chore: extract DST helpers to web/dst.js |
| `97864d1` | M10 predict result CSS + history "incomplete" copy |
| `7a419a0` | /qa fix: airport picker — guarantee exact IATA always appears |
| `782d064` | /qa fix: trip-start enqueue race — await api.posts in order |
| `5bda834` | db: trips.test flag for QA/dogfooding trips (migration 007) |
| `66cb7f0` | predict: exclude trips.test=true from percentile sample |
| `56a6538` | test-trip toggle on dep + arr start sheets, TEST pill in history |
| `cc055e9` | M12 backup.sh — B2 nightly mirror + last-upload marker |
| `ae1836d` | M12 preflight backup checks + restore-drill.sh |
| `5d7ac73` | M12 docs/RECOVERY.md + STATUS — mark complete |
| `a007c72` | predict polish — sparkline axis labels + iOS button-underline fix |
| `3957904` | M14 db migration 008 — airports.lat/lng + reseed |
| `a4e6b6c` | M14 predict service — per-segment durations + airport coords |
| `19b4a06` | M14 predict form — origin picker + live drive + segment breakdown |
| `673dd70` | M14 Predict→Trip handoff (window.__predictHandoff) |
| `2d1266b` | predict — Mapbox depart_at for typical-traffic-at-flight-time |
| `ae3bdfd` | predict — Origin hint copy uses flight time, not "today" |
| `dbdb3fe` | predict — past-trips list (every match, sortable, tappable) |
| `76f7e32` | predict — buffer slider for food / lounge / breathing room |
| _next_ | scheduled boarding — predict anchor + trip-start sheet field + migration 009 + handoff |

Diff against `main` (what changed since last push): `git log --oneline origin/main..HEAD` — should be empty if everything's pushed.

## Known small things

- M12 chose 24h RPO (nightly dump→B2) over 5-min RPO (continuous wal-g WAL archiving). Layer wal-g on top later if Nick logs multiple trips per day or wants point-in-time recovery. Reasoning + revisit triggers in `docs/RECOVERY.md`.
- **M14 buffer slider is pure UI.** The slider re-computes hero + Comfortable times on `input` via DOM updates; it does NOT change the prediction row written to `public.predictions`. M13 calibration scores against the unbuffered p90, which is the right reference — buffer is "behavior padding" not a model output.
- **M14 Mapbox `depart_at` requirements.** When the flight is more than 30 days out, depart_at is skipped (Mapbox typical-traffic patterns don't extend that far) and the call falls back to "live" traffic. When the flight is <5 min away, depart_at is clamped to `now+5min`.
- **M14 Predict→Trip handoff is read-once.** `window.__predictHandoff` is consumed and cleared on `/log` mount, so a later visit to `/log` (e.g. after a refresh) doesn't re-open the start sheet. If a fresh handoff is desired, go back through Predict.
- M10 sparkline is dominated by long-tail outliers in the legacy data (e.g. one LGA trip with an 11h+ first-to-last gap from a stale Dep_InTransit log). The math is honest but the visual is muted. Revisit copy/binning after M11 generates real-trip data.
- "Abandoned" trips are now labeled "Incomplete" in the UI (history badge, predict breakdown). DB enum value stays `abandoned` — purely a copy change. The Log screen's Abandon button kept its verb (it's the action; "Incomplete" is the resulting state).
- `predict_user` now has SELECT on `public.predictions` so `INSERT…RETURNING id` works (migration 006). M13 will use the same grant for calibration scoring.
- `web/index.html` is the real PWA shell (M6). M7 added the trip-logging grid; M8 added the sync strip + auth-expired modal.
- `web/icon.svg` is a placeholder (amber "T" on black). Nick can design real icons + an Apple-touch PNG before M11 "first real trip."
- Mapbox token must have `https://travel.myhometech.app/*` and `http://127.0.0.1:8090/*` in its URL restriction before M6 is reachable end-to-end.
- A Cloudflare Cache Rule bypasses CDN caching for `travel.myhometech.app` (see Rules → Cache Rules in the dashboard). Don't add aggressive caching headers without removing that rule first — the iteration loop depends on it.
- No tests exist yet. Plan's §4 test diagram needs to start getting filled in alongside M9–M10.
- M8 outbox: orphaned dependents (e.g. milestone POST whose parent trip POST dead-lettered) cap at `MAX_ATTEMPTS` (8) and dead_letter naturally. The dead-letter sheet exposes Retry/Discard but no "Edit before retry" yet — flagged as deferrable in the brief, skipped to keep scope tight.
- M8 uses `redirect: 'manual'`. If Cloudflare/Authelia ever returns a 200 with HTML (login page proxied behind a quirky chain), `fetchJSON()` classifies it as `auth_required` via the JSON content-type check.
- M9 history timeline is read-only — long-press edit/void on completed-trip milestones is intentionally deferred (the log screen already handles in-progress trips, and editing past trips would mean duplicating the openSheet primitive). Revisit if Nick hits a real "I mistyped 6 months ago" need.
- M9 history list is capped at 200 rows. With 231 legacy + future app trips this almost-renders-everything. Pagination lands when N > 500 (or when load time becomes felt — no infinite scroll in v1).
- M9 active-state route always reads `dep_airport → arr_airport` (journey direction) regardless of trip direction. The arrival flow's "you're at the arr airport now" semantics are conveyed by milestone progression, not arrow direction.

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

## Schema changes in M14

- Migration `008-airports-lat-lng.sql` adds `lat`/`lng` (`double precision`, nullable) to `public.airports` and re-creates `api.airports` (drop+recreate — `replace view` can't reorder columns). OpenFlights already carries these in `airports.dat` cols 6/7; the M4 generator dropped them. The M14 Predict form needs coords on both ends of the route to call Mapbox Directions, so the seed regenerator (`db/seeds/generate-airports.ts`) was updated and `04-airports-seed.sql` re-emitted with coords for all 5,515 rows. The columns are nullable because a small handful of OpenFlights rows lack coords; the frontend handles missing coords by skipping the live-drive call gracefully.

## Schema changes for scheduled boarding

- Migration `009-trips-sched-dep-board-local.sql` adds nullable `sched_dep_board_local` (`time without time zone`) to `public.trips` and re-creates `api.trips` so the column slots next to `sched_dep_local`. Stored as TIME (not TIMESTAMP) to mirror `sched_dep_local`; the boarding date is implicitly `sched_dep_date` with prev-day inferred client-side for red-eyes (boarding > flight on same date → boarding is the previous day). Predict screen anchors "Leave by" on boarding when set (pure UI layer — does not change the persisted prediction row); the dep trip-start sheet has an optional boarding input; Predict→Trip handoff carries `sched_dep_board_time` so the value flows from prediction into the logged trip. Legacy and pre-migration trips carry null — no backfill.

## External accounts / dashboards

| Service | What | Where |
|---|---|---|
| Cloudflare | DNS, tunnel, Zero Trust | `dash.cloudflare.com` + `one.dash.cloudflare.com` |
| GitHub | Source backup | `github.com/NSDodgers/travel-logger` |
| Mapbox | Geocoding (M6) | `account.mapbox.com` |
| Backblaze B2 | Offsite backup (M12) | `secure.backblaze.com/b2_buckets.htm`, bucket `travel-logger-wal`, endpoint `s3.us-west-000.backblazeb2.com` |

## If Claude is starting a fresh session

1. Read this file first.
2. **M11 is the only outstanding milestone before M13 — "first real trip." Nick's flight is Monday 2026-04-27.** Code-side everything is ship-ready: M10 (predict v1) + M12 (backups) + M14 (predict v2 with live drive, segments, buffer, past-trips list, predict→trip handoff) + 2 /qa-found bug fixes + test-trip toggle. M13 (calibration UI) is gated on M11 generating real-trip data.
3. Read `CLAUDE.md` — project brief + skill routing.
4. Memory at `~/.claude/projects/-Users-nicksolyom-Library-Mobile-Documents-com-apple-CloudDocs-travel-time-sheet-project/memory/MEMORY.md` has cross-session context (decisions, gotchas, Cloudflare bypass, QA driver, M10 predict decisions).
5. For UI patterns, study `web/screens/log.js` (M7+M9+M14 handoff — primary screen, sheet primitive, optimistic UI, both directions, predict-handoff consumer) and `web/screens/addresses.js` (M6 — list/form/toast).
6. For the queue, study `web/queue.js` (M8 — IndexedDB outbox, head-only drain, status taxonomy) and `web/api.js` (`fetchJSON()` primitive). Every write goes through `api.post`/`api.patch` which enqueue rather than awaiting the network. Predictions are the one exception — `api.predict()` is direct request/response.
7. For history, study `web/screens/history.js` (M9 — list + timeline, server-only reads, no writes).
8. For prediction, study `services/predict/src/index.ts` (M10 percentile/widening/persist + M14 per-segment + matched-trips queries) and `web/screens/predict.js` (M10+M14 — form, origin picker, live Mapbox drive, segment breakdown, buffer slider, past-trips list, handoff button). DST helpers live in `web/dst.js` (shared by log + predict). Mapbox helpers live in `web/mapbox.js` (`drivingDirections()` accepts `departAt` for typical-traffic prediction).
9. For browser-driven QA: `bun run qa login` once, then `bun run qa <cmd>` (see `scripts/qa.ts` header). Tip: Caddy serves `Cache-Control: no-store` but the Playwright persistent profile still caches; force-bust with `location.href = '/?_=' + Date.now() + '#/whatever'` before each verification round. Airplane-mode tests: `bun run qa offline on|off`. Viewport (non-fullPage) screenshots: `bun run qa screenshot --viewport`.
10. M10 reference: M10 row in this STATUS for what shipped; `services/predict/src/index.ts` (Bun handler) + `web/screens/predict.js` (form + result card) for the implementation.
11. M9 reference: M9 row in this STATUS for what shipped; `web/screens/log.js` (arrival flow + double-hero) and `web/screens/history.js` (list + timeline) for the implementation.
12. M8 reference: `docs/M8_BRIEF.md` for the spec; `web/queue.js` + `web/sync-strip.js` for the implementation.
13. M7 reference: `docs/M7_BRIEF.md` for what was scoped; `web/screens/log.js` for the implementation.
14. M6 reference (if M6 context is needed): `docs/M6_BRIEF.md`.
15. M5 reference (only if historical data context is needed): `docs/M5_INVENTORY.md`, `docs/M5_QUIZ.md`, `docs/M5_QUIZ_2.md`.
