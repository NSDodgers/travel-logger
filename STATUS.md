# Project status

_Last updated: 2026-04-24 after M5. Update this file at the end of each milestone._

## Milestones

| # | Status | Summary |
|---|---|---|
| M1 | ✅ | Scaffold + gstack + GitHub (`NSDodgers/travel-logger`) |
| M2 | ✅ | Docker stack + Authelia (all 6 containers healthy) |
| M3 | ✅ | `travel.myhometech.app` live, login works on iPhone |
| M4 | ✅ | 5,515 airports seeded |
| M5 | ✅ | Historical import: 231 trips + 536 milestones loaded (2017-08 → 2026-04). 14 addresses, 8 sources reconciled. See `docs/M5_INVENTORY.md` + `docs/M5_QUIZ*.md`; re-run via `./scripts/load-legacy.sh` |
| **M6** | **⏳ next** | Address book + Mapbox. PWA shell scaffold; Mapbox Search JS Core autocomplete; address add/edit/archive. See `docs/M6_BRIEF.md` |
| M7–M13 | planned | See `implementation_plan.md` §8 |

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

Diff against `main` (what changed since last push): `git log --oneline origin/main..HEAD` — should be empty if everything's pushed.

## Known small things

- `bun-predict` skeleton only has `/api/predict/health`. `POST /api/predict` returns 501. Real percentile + widening math lands in M10.
- `walg` container is stubbed in `compose.yml` (commented out). Gets activated in M12.
- `web/index.html` is a placeholder. PWA shell + first feature (address book) lands in M6; trip-logging UI in M7.
- No tests exist yet. Plan's §4 test diagram needs to start getting filled in alongside M7–M10.

## Schema additions from M5

- `trips.party` enum expanded from `solo|family` → `solo|group_with_kids|group_without_kids`. Existing app code that hardcoded `family` should migrate to `group_with_kids`.
- New milestone kinds: `dep_customs` (departure-side, e.g. YYZ US preclearance) and `arr_customs` (arrival-side, between off-plane and bags). Order_seq for existing arrival kinds bumped by 1.
- `milestones_history.milestone_id` FK is now `deferrable initially immediate` so bulk loaders can use `set constraints deferred`.
- 14 legacy addresses live in `public.addresses` with labels prefixed `legacy:` (e.g. `legacy:home_192nd`). The label prefix is a wipe marker — `delete from public.addresses where label like 'legacy:%'` cleans them up before re-loading.

## External accounts / dashboards

| Service | What | Where |
|---|---|---|
| Cloudflare | DNS, tunnel, Zero Trust | `dash.cloudflare.com` + `one.dash.cloudflare.com` |
| GitHub | Source backup | `github.com/NSDodgers/travel-logger` |
| Mapbox | Geocoding (M6) | `account.mapbox.com` |
| Backblaze B2 | Offsite backup (M12) | `secure.backblaze.com/b2_buckets.htm`, bucket `travel-logger-wal`, endpoint `s3.us-west-000.backblazeb2.com` |

## If Claude is starting a fresh session

1. Read this file first.
2. Read `implementation_plan.md` — the canonical plan (M6 details in §8 + §10 UI spec).
3. Read `CLAUDE.md` — project brief + skill routing.
4. Memory at `~/.claude/projects/-Users-nicksolyom-Code-travel-logger/memory/MEMORY.md` has cross-session context (decisions, gotchas).
5. For M6 specifically, read `docs/M6_BRIEF.md`.
6. M5 reference (read only if M5 context is needed): `docs/M5_INVENTORY.md`, `docs/M5_QUIZ.md`, `docs/M5_QUIZ_2.md`.
