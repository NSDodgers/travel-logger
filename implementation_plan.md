# Nick's Travel Logger — Implementation Plan

_Revised 2026-04-23. Self-hosted architecture on the existing Mac Studio Docker stack + cloudflared tunnel. Supersedes all prior drafts._

## 1. Purpose

This is a **personal travel predictor**, not a logger. The logging is the data-collection mechanism; the prediction is the point.

The app answers questions like:

- "My flight is 8 PM from LGA with no checked bags, driving myself — what time do I need to leave the house?"
- "I land at 4:30 PM at JFK with carry-on only, taking the subway — what time will I be home?"

Every design decision is in service of producing useful predictions on future trips. Anything that doesn't contribute to that (multi-leg routing, rich reporting, collaborative features) is out of scope.

## 2. Core concept

Each trip produces a sequence of timestamped milestones. The duration between any two milestones, conditioned on the trip's variables (airport, bags, transit method, party size, TSA PreCheck, origin/destination, time of day), becomes a data point in a growing personal dataset. Predictions are percentile rollups of that dataset filtered by the variables of the trip you're planning.

"Leave the house at **5:12 AM**" = `flight_time - p90(InTransit → Security duration | LGA, no bags, car, solo, PreCheck yes)`.

## 3. Locked decisions

| Area | Decision | Rationale |
|---|---|---|
| Frontend stack | Vanilla HTML/CSS/JS | Single-screen app with overlays. No framework earns its weight. No build step, no `node_modules`. |
| Hosting | Caddy container on your Mac Studio, exposed via existing cloudflared tunnel at a subdomain | Uses infra you already run. Full data ownership. Fits the "one more Compose file" pattern. |
| Data store | Self-hosted `postgres:16` container | Predictor is aggregation-heavy (percentiles by filter). Postgres is the right shape. Same choice as the Supabase plan, minus the vendor. |
| API layer | `postgrest` container (≈20 MB) exposing Postgres as REST | Zero-code REST over the DB. Same underlying tech Supabase uses. |
| Auth | Cloudflare Access, email allowlist = `Nick@solyomdesign.com` | Handled at the edge before requests reach the Mac. Simpler than in-app auth. Single-user makes this sufficient. |
| Backups | Nightly `pg_dump` cron container → local disk + a copy to iCloud Drive | Self-hosting means backups are your job. One small container handles it. |
| Source backup | Repo pushed to GitHub (public or private, either works — not used for hosting) | Code is safe to expose; this is just off-machine source backup. |
| Repo location | `~/Code/travel-logger` | Outside iCloud and Dropbox (both corrupt `.git`). |
| Offline behavior | IndexedDB queue → background sync to the tunnel URL | Airport Wi-Fi is flaky; the Mac Studio also occasionally isn't reachable. Taps log locally, sync opportunistically. |
| Airport data | Curated ~500 IATA + IANA timezones, bundled JSON (~25 KB) | Covers realistic travel with a trivial bundle. |
| Time input | Local time at each airport | Matches the ticket. Tz from IATA dataset for normalization. |
| Addresses | Mapbox Autocomplete + validated pin, saved to an address book | Geocoding quality matters; self-hosting this (Nominatim) is a rabbit hole. Mapbox free tier is plenty. |
| Aesthetic | Pitch-black minimalist, single accent color | Calm at 5 AM. |
| UI shape | Log grid (primary) + Predict tab (secondary) | In-airport use is time-critical; prediction is deliberate. |
| Variables | Bags (checked/carry-on), Party (solo/family), Transit (car/public), TSA PreCheck (y/n) | All materially affect durations. Each is one tap. |
| Milestones | 8 total; Bag steps hidden when bags = carry-on | Keeps the grid honest (no pointless taps). |
| Scope | Single leg, single user | Multi-leg and multi-user are both out. |
| Migration | Start fresh | Historical Sheet import is a follow-up project; legacy data lacks bags/TSA. |

## 4. What is being abandoned

- `app_script.js` — Google Apps Script webhook.
- The Google Sheet as a data store.
- The Apple Shortcut and the Scriptable script.

The existing files stay in the folder as historical reference until the new system is proven in the field.

## 5. Data model (Postgres)

No `user_id` — single-user system. Identity is enforced at the tunnel by Cloudflare Access.

```sql
-- Airports: seeded from bundled JSON at container boot via init SQL
create table airports (
  iata        text primary key,        -- 'LGA'
  name        text not null,           -- 'LaGuardia'
  city        text,
  country     text,
  tz          text not null            -- 'America/New_York' (IANA)
);

-- Saved origins/destinations (home, office, hotels, etc.)
create table addresses (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,           -- 'Home', 'Marriott JFK', etc.
  mapbox_id   text,                    -- Mapbox feature id for re-validation
  formatted   text not null,           -- full display string
  lat         double precision not null,
  lng         double precision not null,
  archived    boolean not null default false,
  created_at  timestamptz default now()
);

-- One row per journey (one direction)
create table trips (
  id             uuid primary key default gen_random_uuid(),
  direction      text not null check (direction in ('departure','arrival')),
  trip_date      date not null,

  -- Endpoints
  address_id     uuid references addresses(id),      -- origin for dep, destination for arr
  dep_airport    text references airports(iata),
  arr_airport    text references airports(iata),

  -- Scheduled times, stored as local wall-clock strings + tz looked up from airport
  sched_dep_local  text,                              -- '06:45'
  sched_arr_local  text,                              -- '09:10'

  -- Variables
  bags           text not null check (bags in ('checked','carry_on','unknown')),
  party          text not null check (party in ('solo','family')),
  transit        text not null check (transit in ('car','public')),
  tsa_precheck   boolean not null default false,

  status         text not null default 'in_progress' check (status in ('in_progress','complete','abandoned')),
  source         text not null default 'app',        -- 'app' | 'legacy'
  created_at     timestamptz default now()
);

-- One row per milestone tap
create table milestones (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id) on delete cascade,
  kind        text not null,        -- 'dep_in_transit' | 'dep_at_airport' | 'dep_bags' |
                                    -- 'dep_security'  | 'arr_off_plane'  | 'arr_bags' |
                                    -- 'arr_in_transit'| 'arr_at_destination'
  logged_at   timestamptz not null, -- real tap timestamp, UTC
  edited      boolean not null default false,
  unique (trip_id, kind)
);

-- Helpful indexes for the predictor
create index on trips (dep_airport, bags, transit, party, tsa_precheck);
create index on trips (arr_airport, bags, transit, party, tsa_precheck);
create index on milestones (trip_id, kind);
```

### Why this shape

- **No `user_id`.** Single-user app behind Cloudflare Access. Adding a column "just in case" would be dead weight.
- **`trips` is direction-specific.** Departures and arrivals are logged independently. A round trip is two `trips` rows, tied only by dates/airports. Matches how travel actually gets logged.
- **Wall-clock times + tz lookup.** `sched_dep_local = '06:45'` plus `airports.tz` lets the app produce a real `timestamptz` for duration math without DST bugs.
- **`milestones.logged_at` is UTC.** Real observed events; no ambiguity.
- **`source = 'legacy'`** future-proofs the eventual historical Sheet import.

## 6. Architecture

```
  iPhone home screen (PWA)
        │
        │  HTTPS request to https://travel.myhometech.app/...
        ▼
  ┌─────────────────────────────┐
  │  Cloudflare edge            │
  │   • Terminates TLS          │
  │   • Cloudflare Access check │  ← email allowlist = Nick@solyomdesign.com
  │   • Tunnel to Mac Studio    │
  └──────────────┬──────────────┘
                 │ cloudflared
                 ▼
  ┌────────────────────────────── Mac Studio ──────────────────────────────┐
  │                                                                         │
  │   caddy  ─── reverse proxy ───┬─→  /           → static PWA files       │
  │                               └─→  /api/*      → postgrest :3000        │
  │                                                                         │
  │   postgrest   ← JSON REST over Postgres                                 │
  │        │                                                                │
  │        ▼                                                                │
  │   postgres:16   ← source of truth                                       │
  │        │                                                                │
  │        ▼                                                                │
  │   pg_backup cron   ← nightly pg_dump → /backups + iCloud Drive copy     │
  │                                                                         │
  └─────────────────────────────────────────────────────────────────────────┘
```

### Docker Compose sketch

```yaml
# compose.yml (lives in ~/Code/travel-logger)
services:
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["127.0.0.1:8080:80"]   # cloudflared routes to this
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./web:/srv:ro              # the PWA static files

  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/pg_password
      POSTGRES_DB: travel
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro
    secrets: [pg_password]

  postgrest:
    image: postgrest/postgrest:latest
    restart: unless-stopped
    environment:
      PGRST_DB_URI: postgres://postgrest_user@postgres/travel
      PGRST_DB_SCHEMA: public
      PGRST_DB_ANON_ROLE: postgrest_user
    depends_on: [postgres]

  pgbackup:
    image: postgres:16
    restart: unless-stopped
    entrypoint: /backup.sh
    volumes:
      - ./ops/backup.sh:/backup.sh:ro
      - ./backups:/backups
      - ~/Library/Mobile Documents/com~apple~CloudDocs/backups/travel:/icloud-backups
    depends_on: [postgres]

volumes:
  pgdata:

secrets:
  pg_password:
    file: ./secrets/pg_password.txt
```

The cloudflared tunnel (already running on the Mac) gets one new route: `travel.myhometech.app` → `http://localhost:8080`. Cloudflare Access policy is created in the Cloudflare dashboard and gates the hostname.

### Critical flow: a milestone tap

```
User taps "Dep: At Airport"
   ↓
app.js   appends { trip_id, kind, logged_at: now_utc } to IndexedDB
   ↓
UI immediately shows "✓ At Airport 7:12 AM"  (synchronous, no network)
   ↓
sync.js  POSTs the pending write to /api/milestones
   ↓  (if online & Mac reachable) row inserted, IndexedDB entry marked synced
   ↓  (if offline OR Mac/tunnel down) retry on next connectivity event;
        queue persists across app launches
```

The user never sees a spinner. Connectivity and Mac availability are entirely the app's problem.

## 7. User flows

### Flow A: Starting a departure trip
1. Open app → log grid. If no trip is in progress, "Dep: In Transit" is highlighted.
2. Tap **Dep: In Transit** → bottom-sheet appears:
   - Origin (address book picker; default = last-used)
   - Departure airport (IATA autocomplete)
   - Landing airport (IATA autocomplete)
   - Scheduled dep time (local to dep airport)
   - Scheduled land time (local to arr airport)
   - Bags (checked / carry-on) — sticky
   - Party (solo / family) — sticky
   - Transit (car / public) — sticky
   - TSA PreCheck (toggle) — sticky
3. Confirm → trip created in IndexedDB, milestone `dep_in_transit` logged, sync begins.
4. Grid now shows only the next relevant milestones. Bag milestones are hidden if carry-on.

### Flow B: Subsequent milestones
1. Tap next milestone (e.g. "Dep: At Airport") → one-tap log, no sheet. Timestamp captured.
2. Repeat through Security.
3. After Security the trip is marked `complete` (departure side). Grid resets.

### Flow C: Arrival side
1. Land. Open app, tap **Arr: Off Plane** → minimal sheet: pick destination address.
2. Subsequent arrival milestones one-tap through to At Destination.

### Flow D: Predict tab
1. Tap **Predict** in tab bar.
2. Form: direction · airport · origin/destination · Bags / Party / Transit / TSA · flight time.
3. App shows:
   - **Leave by**: `flight_time - p90(segment_durations | filters)`
   - **Comfortable**: `flight_time - p50(…)`
   - **Based on N past trips.** If N < 3, fall back to broader filters and say which ones were relaxed.

## 8. Build milestones

Each is an independently shippable step.

1. **M1: Project scaffold.** Move files to `~/Code/travel-logger`, git init, push to GitHub for source backup. Empty `web/` directory with a pitch-black `index.html` placeholder.
2. **M2: Local stack.** `compose.yml` up on Mac Studio. Caddy serves `web/`, Postgres is initialized with the schema, PostgREST exposes it. `curl http://localhost:8080/api/airports` returns `[]`.
3. **M3: Tunnel + Access.** Cloudflared route `travel.myhometech.app` → localhost:8080. Cloudflare Access policy requires your email. Hitting the URL from your phone shows the PWA placeholder after Access login. **Add to Home Screen.**
4. **M4: Airport dataset.** `airports.json` bundled; seed script inserts into Postgres at init. Autocomplete field in the PWA works.
5. **M5: Address book + Mapbox.** Add/edit/archive addresses. Mapbox autocomplete with pin confirmation.
6. **M6: Log grid + departure flow.** Dep: In Transit creates a trip; subsequent milestones one-tap log. Bag-step hiding based on `bags`. No offline queue yet — writes go directly.
7. **M7: Offline queue.** IndexedDB write-ahead log + service worker background sync. Airplane-mode test passes.
8. **M8: Arrival flow.** Mirrors M6 for the arrival side.
9. **M9: Predict tab.** Query + percentile math. Broader-filter fallback when N < 3.
10. **M10: Backups.** `pg_backup` container runs nightly, writes to `./backups/` and mirrors to iCloud Drive. Restore drill: wipe DB, restore from backup, verify integrity.
11. **M11: First real trip.** Use on an actual airport run, note bugs.

Stretch / later:
- **L1: Historical Sheet data import.** Read legacy `Departures` / `Arrivals` tabs, map to new schema with `source = 'legacy'` and `bags/tsa = 'unknown'`, bulk insert.
- **L2: Edit/undo UI.** Toast undo + history view for mistake fixes.
- **L3: Health endpoint + iPhone uptime check.** Periodic ping so you know if the Mac is unreachable *before* you're at the airport.

## 9. Prerequisites (on you)

Before I start building:

1. **Hostname**: `travel.myhometech.app` (locked).
2. **Cloudflared tunnel**: already running on the Mac Studio for other services — we just add a new public-hostname route for `travel.myhometech.app` → `http://localhost:8080`.
3. **Cloudflare Access**: add a Zero Trust application for `travel.myhometech.app` with an email-allowlist policy containing `Nick@solyomdesign.com`. If you already use Access for other services, this is a one-minute addition; if not, enabling Zero Trust on the zone is a 5-minute first-time setup.
4. **Mapbox account** at mapbox.com (free tier). Generate an access token; I'll domain-restrict it once we have the hostname.
5. **Docker Desktop or OrbStack** running on the Mac Studio (you almost certainly already have this).
6. **GitHub username** so I can create the source-backup repo.

Everything else is mine.

## 10. Out of scope

- Multi-leg / connecting flights.
- Multi-user support.
- Desktop or iPad polish (works on them, but design is iPhone-first).
- Push notifications / alarms from the predictor. You read the number, you set your own alarm.
- Weather / traffic / flight-status API integration. The predictor learns from history only.
- High-availability clustering. One Mac, one Postgres, one tunnel. The offline queue is the HA story.
