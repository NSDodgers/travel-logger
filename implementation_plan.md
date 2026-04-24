<!-- /autoplan restore point: /Users/nicksolyom/.gstack/projects/travel-logger/main-autoplan-restore-20260423-175225.md -->
# Nick's Travel Logger — Implementation Plan

_Revised 2026-04-24 after `/autoplan` review. Self-hosted architecture on the existing Mac Studio Docker stack + cloudflared tunnel. Auth switched from Cloudflare Access to Authelia. Edit/undo and legacy import promoted to v1. All 20 mechanical fixes applied. Supersedes all prior drafts._

## 1. Purpose

This is a **personal travel predictor**, not a logger. The logging is the data-collection mechanism; the prediction is the point.

The app answers questions like:

- "My flight is 8 PM from LGA with no checked bags, driving myself — what time do I need to leave the house?"
- "I land at 4:30 PM at JFK with carry-on only, taking the subway — what time will I be home?"

Every design decision is in service of producing useful predictions on future trips.

**Honest expectation on predictor quality:** in the first 6-12 months, with a single user logging ~30-50 trips/year across ~4 filter dimensions (airport × bags × party × transit × PreCheck), most cells will have 0-3 samples. The predictor shows the tightest filter with **N ≥ 1** and widens from there, naming which filters it relaxed. Percentile bands (p50/p90) only surface when **N ≥ 5**. Below that, it shows median + "based on N trips." Historical import (M5) bootstraps this on day one.

## 2. Core concept

Each trip produces a sequence of timestamped milestones. The duration between any two milestones, conditioned on the trip's variables, becomes a data point. Predictions are percentile rollups of that dataset filtered by the variables of the trip you're planning.

"Leave the house at **5:12 AM**" = `flight_time - p90(InTransit → Security duration | LGA, no bags, car, solo, PreCheck yes)`.

**Accuracy feedback loop** (new, per review): every prediction is stored at the moment it's made. After the real trip completes, the app computes `(predicted p90) - (actual duration)` and shows it in a small "calibration" view. Without this, the predictor is faith-based.

**Widening order** for N-too-small fallback: `tsa_precheck → party → transit → bags → airport`. The app names each relaxed dimension in the result ("relaxed: TSA PreCheck; based on 4 trips").

## 3. Locked decisions

| Area | Decision | Rationale |
|---|---|---|
| Frontend stack | Vanilla HTML/CSS/JS | Single-screen app with overlays. No framework earns its weight. No build step. |
| Hosting | Caddy container on Mac Studio, exposed via existing cloudflared tunnel | Uses infra you already run. Full data ownership. |
| Data store | Self-hosted `postgres:16` (pinned digest) | Aggregation-heavy predictor needs SQL. |
| API layer | `postgrest` (pinned digest) for CRUD + a thin Bun/Deno `predict` service | PostgREST can't cleanly express N<3 filter-widening; the Bun service is ~200 lines of TS exposing `POST /api/predict`. Everything else stays PostgREST. |
| Auth | **Authelia + Caddy `forward_auth`** (replaces Cloudflare Access) | Self-hosted auth portal, configurable 30-day session, WebAuthn/passkey support, controlled redirect behavior. Closes the silent-data-loss bug. |
| Client fetch | Hardened `fetchJSON()` wrapper (`redirect: 'manual'` + JSON content-type check + status classification) — **the only path** to `/api/*` | Defense-in-depth: even with Authelia's better redirect behavior, the wrapper is what guarantees no HTML-as-JSON silent syncs. |
| Backups | Nightly `pg_dump` + **`wal-g` PITR** to two destinations: local disk + offsite (Backblaze B2 or similar) | Nightly-only is 24h of loss in the worst case; WAL archiving gives 5-min RPO. iCloud alone has silent-sync-failure risk. |
| Source backup | Repo pushed to GitHub (public, just a PWA shell) | Off-machine source backup only. |
| Repo location | `~/Code/travel-logger` | Outside iCloud and Dropbox. |
| Offline behavior | IndexedDB write-ahead log → **foreground retry loop** on `online`, `visibilitychange`, and interval | iOS Safari does NOT support `SyncManager` background sync. Foreground retry is the real primary path. |
| Airport data | **Full OurAirports dataset** (scheduled commercial airports, ~10K, gzipped ~400 KB in SW cache) | Curated 500 guarantees a future "airport not in list" incident. Full dataset bundle is negligible. |
| Time input | Local time at each airport, stored as `time` type + tz from IATA row | Matches ticket. DST explicitly validated at trip creation — ambiguous/nonexistent times surfaced with UI warning. |
| Addresses | Mapbox Search JS Core (~30 KB, autocomplete only, no map tiles on boot) + validated pin shown on-demand inside the address-confirmation sheet | Smaller bundle than full Mapbox GL; loaded only when saving a new address. |
| Aesthetic | Pitch-black minimalist, single accent (see §12 UI Spec) | Calm at 5 AM. |
| UI shape | Log grid (primary) + Predict tab (secondary) + Trip History (tertiary, for edit/undo) | In-airport use is time-critical; prediction is deliberate; history is corrective. |
| Variables | Bags (checked/carry-on), Party (solo/family), Transit (car/public), TSA PreCheck (y/n) | Each is one tap. |
| Milestones | **8 total** (all kept); Bag steps hidden when bags = carry-on | 4 dep + 4 arr as originally planned. |
| Scope | Single leg, single user | Multi-leg and multi-user are both out. |
| **Edit/undo** | **Promoted from L2 → M7 (v1)** | Mistaps are inevitable on first trip; without undo the predictor data gets poisoned and the offline queue jams on `unique (trip_id, kind)`. Long-press a logged milestone → edit time or undo (60s toast + persistent history view). |
| **Historical import** | **Promoted from L1 → M5 (v1)** | Bootstraps the predictor with years of legacy Sheet data. `source='legacy'`, `bags/tsa='unknown'`. |

## 4. What is being abandoned

- `app_script.js` — Google Apps Script webhook. Read once by the importer in M5, then legacy.
- The Google Sheet as a live data store (becomes a read-only historical import source).
- The Apple Shortcut and the Scriptable script.

Existing files stay in the folder as historical reference.

## 5. Data model (Postgres)

No `user_id` — single-user system. Identity is enforced at the tunnel by Authelia.

### Schemas

Two schemas: `public` for raw tables, `api` for REST-exposed views. PostgREST's `postgrest_user` has grants **only** on `api.*`, never on `public.*`. This closes the "anyone past auth can DELETE history via REST" risk.

### Lookup tables

```sql
create schema api;

-- Milestone kinds as a lookup table (not free text)
create table public.milestone_kinds (
  kind        text primary key,
  direction   text not null check (direction in ('departure','arrival')),
  order_seq   int not null,
  label       text not null,
  shown_when_carry_on boolean not null default true
);

insert into public.milestone_kinds (kind, direction, order_seq, label, shown_when_carry_on) values
  ('dep_in_transit',    'departure', 1, 'In Transit',        true),
  ('dep_at_airport',    'departure', 2, 'At Airport',        true),
  ('dep_bags',          'departure', 3, 'Dropped Bags',      false),
  ('dep_security',      'departure', 4, 'Through Security',  true),
  ('arr_off_plane',     'arrival',   1, 'Off the Plane',     true),
  ('arr_bags',          'arrival',   2, 'Collected Bags',    false),
  ('arr_in_transit',    'arrival',   3, 'In Transit',        true),
  ('arr_at_destination','arrival',   4, 'At Destination',    true);
```

### Airports

```sql
create table public.airports (
  iata    text primary key,
  name    text not null,
  city    text,
  country text,
  tz      text not null check (tz ~ '^[A-Za-z_]+/[A-Za-z_+-]+')
);
```

### Addresses

```sql
create table public.addresses (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  mapbox_id  text,
  formatted  text not null,
  lat        double precision not null,
  lng        double precision not null,
  archived   boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### Trips

```sql
create table public.trips (
  id             uuid primary key default gen_random_uuid(),
  direction      text not null check (direction in ('departure','arrival')),

  -- Endpoints
  address_id     uuid references public.addresses(id),
  dep_airport    text references public.airports(iata),
  arr_airport    text references public.airports(iata),
  actual_arr_airport text references public.airports(iata),  -- for diverted flights

  -- Scheduled times: proper `time` type + tz via airport lookup (DST-safe)
  sched_dep_local  time,
  sched_arr_local  time,
  sched_dep_date   date,  -- explicit — avoids midnight-crossing ambiguity
  sched_arr_date   date,

  -- DST flag: set by trigger if sched_dep/arr falls in a DST non-existent or ambiguous slot
  dst_warning    text,  -- null, 'spring_nonexistent', 'fall_ambiguous'

  -- Variables
  bags           text not null check (bags in ('checked','carry_on','unknown')),
  party          text not null check (party in ('solo','family')),
  transit        text not null check (transit in ('car','public')),
  tsa_precheck   boolean not null default false,

  status         text not null default 'in_progress' check (status in ('in_progress','complete','abandoned')),
  source         text not null default 'app' check (source in ('app','legacy')),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- trip_date is a *derived* view, not a column — computed from the first milestone at dep tz
```

### Milestones

```sql
create table public.milestones (
  id          uuid primary key default gen_random_uuid(),  -- client-assigned
  trip_id     uuid not null references public.trips(id) on delete cascade,
  kind        text not null references public.milestone_kinds(kind),
  logged_at   timestamptz not null,                         -- UTC
  client_seq  int not null,                                 -- client-assigned ordering
  void        boolean not null default false,               -- tombstone for re-tap
  void_reason text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Unique partial: only non-void rows participate, so re-taps after a void work
create unique index on public.milestones (trip_id, kind) where not void;

-- For "show this trip's timeline": time-ordered lookup
create index on public.milestones (trip_id, logged_at);
```

### Milestone history (audit)

```sql
create table public.milestones_history (
  id            uuid primary key default gen_random_uuid(),
  milestone_id  uuid not null references public.milestones(id) on delete cascade,
  changed_at    timestamptz default now(),
  change_kind   text not null check (change_kind in ('insert','update','void','unvoid')),
  old_logged_at timestamptz,
  new_logged_at timestamptz,
  reason        text
);

-- Trigger populates this on any update to public.milestones
```

### Predictions (accuracy feedback loop)

```sql
create table public.predictions (
  id               uuid primary key default gen_random_uuid(),
  predicted_at     timestamptz default now(),
  direction        text not null check (direction in ('departure','arrival')),
  airport          text not null references public.airports(iata),
  filters          jsonb not null,                     -- snapshot of inputs
  relaxed_filters  text[] not null default '{}',
  sample_n         int not null,
  predicted_p50    interval,
  predicted_p90    interval,
  -- Scored after the real trip completes
  actual_trip_id   uuid references public.trips(id),
  actual_duration  interval,
  scored_at        timestamptz
);
```

### Exposed `api` schema (what PostgREST sees)

```sql
create view api.trips_v as select
  id, direction, address_id, dep_airport, arr_airport, actual_arr_airport,
  sched_dep_local, sched_arr_local, sched_dep_date, sched_arr_date,
  dst_warning, bags, party, transit, tsa_precheck, status, source,
  created_at, updated_at
from public.trips;

-- Similar views for milestones, addresses, airports, predictions
-- Only granted to postgrest_user; SELECT/INSERT/UPDATE as needed, never DELETE on trips/milestones
-- milestones.delete is replaced by the void flag; a void+unvoid flow is the only mutation
```

Constraints enforced outside SQL:
- `milestones.logged_at` within 48h of `trips.created_at` (sanity check; rejects 1970 timestamps).
- `milestones.client_seq` is monotonic per trip (server rejects out-of-order inserts that would lower max seq).
- Trip must be created before any of its milestones (FK enforces this; client queue must order accordingly).

## 6. Architecture

```
  iPhone home screen (PWA)
        │
        │  HTTPS to https://travel.myhometech.app/...
        ▼
  ┌──────────────────────────────┐
  │  Cloudflare edge             │
  │   • TLS term only            │  ← no Access policy; auth is Authelia below
  │   • Tunnel → Mac Studio       │
  └──────────────┬───────────────┘
                 │ cloudflared
                 ▼
  ┌──────────────────────── Mac Studio ──────────────────────────────┐
  │                                                                   │
  │   caddy  ── (forward_auth → authelia) ─── ┬─→ /           → web/  │
  │                                           ├─→ /api/predict → bun  │
  │                                           ├─→ /api/*       → pgr  │
  │                                           └─→ /auth/*      → aut  │
  │                                                                   │
  │   authelia (postgres-backed sessions)                              │
  │                                                                   │
  │   postgrest ← JSON REST over public views in `api` schema         │
  │        │                                                           │
  │        ▼                                                           │
  │   bun-predict ← thin TS server: /api/predict (percentile + fallback)│
  │        │                                                           │
  │        ▼                                                           │
  │   postgres:16@digest   ← source of truth                          │
  │        │                                                           │
  │        ├─→ pgdata volume                                           │
  │        ├─→ wal-g PITR archive → B2 (offsite)                       │
  │        └─→ pg_dump nightly → ./backups + iCloud mirror             │
  └────────────────────────────────────────────────────────────────────┘
```

### Docker Compose sketch

```yaml
services:
  caddy:
    image: caddy:2@sha256:<pinned>
    restart: unless-stopped
    ports: ["127.0.0.1:8090:80"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./web:/srv:ro
    depends_on: [authelia, postgrest, bun-predict]

  authelia:
    image: authelia/authelia:4@sha256:<pinned>
    restart: unless-stopped
    volumes:
      - ./authelia:/config
    environment:
      AUTHELIA_SESSION_SECRET_FILE: /run/secrets/authelia_session
      AUTHELIA_STORAGE_ENCRYPTION_KEY_FILE: /run/secrets/authelia_storage
    secrets: [authelia_session, authelia_storage]
    depends_on: [postgres]

  postgres:
    image: postgres:16@sha256:<pinned>
    restart: unless-stopped
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/pg_password
      POSTGRES_DB: travel
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro
    secrets: [pg_password]

  postgrest:
    image: postgrest/postgrest:v12@sha256:<pinned>
    restart: unless-stopped
    environment:
      PGRST_DB_URI: postgres://postgrest_user@postgres/travel
      PGRST_DB_SCHEMA: api
      PGRST_DB_ANON_ROLE: postgrest_user
    depends_on: [postgres]

  bun-predict:
    build: ./services/predict
    restart: unless-stopped
    environment:
      PG_URI: postgres://predict_user@postgres/travel
    depends_on: [postgres]

  pgbackup:
    image: postgres:16@sha256:<pinned>
    restart: unless-stopped
    entrypoint: /backup.sh
    volumes:
      - ./ops/backup.sh:/backup.sh:ro
      - ./backups:/backups
      - ~/Library/Mobile Documents/com~apple~CloudDocs/backups/travel:/icloud-backups
    depends_on: [postgres]

  walg:
    image: wal-g/wal-g:latest@sha256:<pinned>
    restart: unless-stopped
    # WAL archiving to Backblaze B2; continuous, RPO ~5 min
    environment:
      WALG_S3_PREFIX: s3://travel-logger-wal/
      AWS_ENDPOINT: https://s3.us-west-000.backblazeb2.com
    depends_on: [postgres]
    secrets: [b2_key]

volumes:
  pgdata:

secrets:
  pg_password:
    file: ./secrets/pg_password.txt        # chmod 0600 enforced by bootstrap
  authelia_session:
    file: ./secrets/authelia_session.txt
  authelia_storage:
    file: ./secrets/authelia_storage.txt
  b2_key:
    file: ./secrets/b2_key.txt
```

The cloudflared tunnel adds one new route: `travel.myhometech.app` → `http://localhost:8090`.

### Caddyfile (sketch)

```
travel.myhometech.app {
  # Authelia forward-auth on everything
  forward_auth authelia:9091 {
    uri /api/verify?rd=https://travel.myhometech.app/auth/
    copy_headers Remote-User Remote-Email Remote-Name
  }

  handle /auth/* {
    reverse_proxy authelia:9091
  }

  handle /api/predict* {
    reverse_proxy bun-predict:3001
  }

  handle /api/* {
    reverse_proxy postgrest:3000
  }

  handle {
    root * /srv
    try_files {path} /index.html
    file_server
  }

  # CSP — tight, single-origin
  header Content-Security-Policy "default-src 'self'; connect-src 'self' https://api.mapbox.com; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://api.mapbox.com; font-src 'self'; frame-ancestors 'none'"
  header X-Content-Type-Options "nosniff"
  header Referrer-Policy "strict-origin-when-cross-origin"
}
```

### Authelia config (sketch)

```yaml
# authelia/configuration.yml
jwt_secret_file: /run/secrets/authelia_session
default_redirection_url: https://travel.myhometech.app

authentication_backend:
  file:
    path: /config/users.yml    # single user: nick@solyomdesign.com with Argon2id password

session:
  name: authelia_session
  domain: myhometech.app
  remember_me_duration: 720h   # 30 days
  expiration: 12h
  inactivity: 2h

access_control:
  default_policy: one_factor
  rules:
    - domain: travel.myhometech.app
      policy: one_factor        # WebAuthn/passkey preferred; password is fallback

storage:
  postgres:
    host: postgres
    database: authelia
    username: authelia_user
    password_file: /run/secrets/authelia_storage
```

### Critical flow: a milestone tap (revised)

```
User taps "Dep: At Airport"
   ↓
app.js   appends { id: uuid, trip_id, kind, logged_at: now_utc, client_seq: N+1 } to IndexedDB
   ↓
UI immediately shows "✓ At Airport 7:12 AM"  (synchronous, no network)
   ↓
sync.js  fetchJSON('POST /api/milestones', body)
   ↓     ├─ redirect:'manual' — rejects any 3xx explicitly (auth issue → re-auth UI)
         ├─ content-type check — rejects HTML-as-JSON
         ├─ status classification:
         │    2xx + JSON shape OK  → mark synced
         │    409 unique (where not void) → duplicate, drop from queue
         │    409 FK (trip missing) → retry; client must have queued trip POST first
         │    4xx other → dead-letter after 3 retries, surface error toast
         │    5xx → exponential backoff, max 8 retries
         │    network error → retry on `online` / `visibilitychange`
         └─ on redirect/HTML → explicit re-auth flow (open /auth/ in-app)
```

**Queue retention cap:** 5000 entries OR 10 MB, whichever first. On overflow, loud UI warning. `navigator.storage.persist()` requested at app init.

## 7. User flows

### Flow A: Starting a departure trip
1. Open app → log grid. If no trip is in progress, **hero button** "Dep: In Transit" fills top half of viewport (see §12).
2. Tap hero → bottom-sheet (detents: medium, large; dismiss: swipe-down + scrim tap):
   - Origin (address book picker; default = last-used)
   - Departure airport (IATA autocomplete from full OurAirports dataset)
   - Landing airport (IATA autocomplete)
   - Scheduled dep time + date (local to dep airport) — DST-validated
   - Scheduled land time + date (local to arr airport) — DST-validated
   - Bags / Party / Transit / TSA (all sticky from last trip)
3. Confirm → trip POSTed first, then milestone. Haptic success feedback. Trip in IndexedDB; sync begins.
4. Grid transitions to progressive-disclosure: next relevant milestone as hero, others muted below.

### Flow B: Subsequent milestones
1. Tap next milestone hero → one-tap log + haptic. No sheet.
2. **Long-press any logged milestone** → edit-time sheet or "Undo" (60s undo toast after each tap).
3. After final departure milestone, `status='complete'`; grid resets.

### Flow C: Arrival side
Mirrors Flow A/B with minimal sheet (destination address only — everything else defaults to dep-side trip).

### Flow D: Predict tab
1. Tap **Predict** in bottom tab bar.
2. Form: direction · airport · origin/destination · Bags / Party / Transit / TSA · flight time + date (DST-validated).
3. App calls `POST /api/predict` on the Bun service, which runs:
   - Query at tightest filter level
   - If N < 5: widen per precedence `tsa → party → transit → bags → airport`, until N ≥ 5 OR all but airport relaxed
4. Result rendered hero-sized (per §12):
   - **Leave by**: `flight_time - p90` (if N ≥ 5) OR `flight_time - median` (if 1 ≤ N < 5)
   - **Comfortable**: p50 (only when N ≥ 5)
   - **Based on N trips.** If relaxed: "Relaxed: TSA PreCheck, Party size."
   - **Distribution sparkline** and min/median/max so Nick can sanity-check.
5. Prediction row written to `predictions` table for later scoring.

### Flow E: Trip History & Edit
1. Bottom tab bar: **Log / Predict / History** (3 tabs). History lists trips newest-first.
2. Tap a trip → timeline view: all milestones with logged_at times.
3. Long-press a milestone → edit time OR void. Void inserts `milestones_history` row (`change_kind='void'`); unique partial index allows re-log.

### Flow F: Prediction accuracy (calibration)
1. When a trip completes, the matching prediction row gets scored: `actual_duration - predicted_p90`.
2. History view shows per-airport calibration: "LGA dep predictions overshoot by avg 11 min at p90 (last 12 trips)."
3. This is the feedback loop the CEO review flagged. Without it, predictor accuracy is opaque.

## 8. Build milestones

Revised order per review (M11 "first real trip" promoted).

1. **M1: Project scaffold.** Repo at `~/Code/travel-logger`, gstack team mode (done), GitHub source backup. Empty `web/` with pitch-black placeholder.
2. **M2: Docker stack + Authelia.** `compose.yml` up. Caddy + Authelia + Postgres + PostgREST + bun-predict all healthy. First-time WebAuthn passkey registration works. `curl` from phone through tunnel → Authelia login → 200.
3. **M3: Tunnel route live.** Cloudflared route `travel.myhometech.app` → localhost:8090. From iPhone: login with passkey (or password), "Add to Home Screen," PWA launches standalone. Session persists 30 days.
4. **M4: Airport dataset.** Full OurAirports bundled, seeded into Postgres at init. IATA autocomplete in PWA.
5. **M5: Historical import.** One-off importer reads the legacy `Departures` / `Arrivals` tabs from Google Sheet (last export or Apps Script), maps to new schema with `source='legacy'` and `bags/tsa='unknown'`, bulk inserts. Predictor now has years of data.
6. **M6: Address book + Mapbox.** Add/edit/archive. Mapbox Search JS Core autocomplete + on-demand pin confirmation.
7. **M7: Log grid + edit/undo + departure flow.** Dep: In Transit creates trip; subsequent milestones one-tap; long-press edit/void; undo toast. Bag-hiding dynamic via `milestone_kinds.shown_when_carry_on`. Writes direct (no queue yet).
8. **M8: Offline queue.** IndexedDB WAL + foreground retry loop (online + visibilitychange + interval). Dead-letter queue + error taxonomy. `persist()` requested. Airplane-mode E2E test passes.
9. **M9: Arrival flow + trip history.** Mirrors M7 for arrivals; 3-tab nav (Log/Predict/History); timeline view for a trip.
10. **M10: Predict tab.** Bun service with percentile + widening. Prediction row written for every query. Broader-filter fallback message.
11. **M11: First real trip.** ← promoted (was last). Use on a real airport run before finishing backup/monitoring. Feedback-loop the UX.
12. **M12: Backups + preflight.** `pg_dump` cron + `wal-g` to B2. `scripts/preflight.sh` runs 3-way health check. Restore drill: wipe DB, restore from last WAL, trip round-trips. Documented recovery runbook.
13. **M13: Calibration UI.** Score predictions against actuals. Display per-airport over/undershoot. CEO's missing feedback loop.

Stretch / later:
- **L1: Health endpoint + iPhone uptime check.** Ping from phone every 6h; notify if Mac unreachable.
- **L2: Shortcuts URL scheme.** Single-tap lock-screen widget to fast-log a milestone without opening PWA (matches Scriptable tap speed).

## 9. §11 States Inventory

Every undefined state is a developer coin-flip. Spec'd per-state:

| State | Trigger | Visual | Copy | Action |
|---|---|---|---|---|
| First launch, no trips | `trips` empty | Empty hero: "No trips yet. Let's fix that." | — | Tap hero → start new trip sheet |
| Trip in progress | `trips.status='in_progress'` | Hero: next milestone button | "{Airport} · {sched}" below | Tap → log |
| Trip stale (>24h since last milestone) | Same but last milestone >24h old | Amber banner: "Forgot about a trip?" | — | Buttons: Resume / Mark complete / Abandon |
| Auth session expired | 302 from Authelia detected | Modal: "Sign in to sync" | "Your offline taps are safe — we just need to re-auth." | Button: Open login (routes to `/auth/`) |
| Offline, queue has pending | `navigator.onLine = false` AND queue > 0 | Top strip: "N taps pending sync" (amber) | — | Tap strip → shows queue detail |
| Sync in progress | POST in flight | Top strip: "Syncing…" (blue) | — | — |
| Sync error (retriable) | 5xx or network | Top strip: "Sync retrying" + timer | — | Auto-retry |
| Sync error (dead-letter) | 4xx after 3 retries, or schema mismatch | Top strip: "N taps failed" (red) | — | Tap → see failures; per-entry: Retry / Discard / Edit |
| Predict: no data at all | `predictions.sample_n=0` after full widening | Empty predict card: "Log a trip to start predicting." | — | CTA to log |
| Predict: low N (1-4) | `sample_n` < 5 | Result card: median only + "Based on N trips" | "Relaxed: {list}" if widening | — |
| Predict: full result | `sample_n ≥ 5` | Hero p50/p90, distribution sparkline | — | — |
| Loading (first paint) | Service worker boot | App-shell from cache; hero button skeleton | — | — |
| Mapbox quota / offline | Mapbox 4xx/5xx | Address sheet: "Typed address only" (plain text input) | — | — |
| DST warning | Trip with `dst_warning != null` | Warning row inside trip confirm sheet | "This time is {ambiguous|nonexistent} on DST day. Confirm?" | Override or pick different time |

## 10. §12 UI Spec

### Color
- Background: `#000000` (pitch black)
- Accent: `#FF9F0A` (iOS amber) — contrast on `#000000` = **10.1:1** (WCAG AAA)
- Muted: `#8E8E93` (iOS gray) — contrast = 4.75:1 (AA)
- Success: `#32D74B` (iOS green) — contrast = 6.5:1 (AA+)
- Warning: `#FFD60A` — contrast = 14.4:1 (AAA)
- Error: `#FF3B30` — contrast = 5.25:1 (AA)

### Typography
System font stack (`-apple-system, system-ui, 'SF Pro Text'`). Sizes:
- Hero result: 64pt bold
- Hero button label: 32pt semibold
- Body: 17pt regular (respects Dynamic Type)
- Label/meta: 14pt regular
- Monospace (times): `ui-monospace, 'SF Mono'` 17pt

### Layout
- `max-width: 480px` centered on any viewport > 480px (iPad/desktop get a centered phone-width app)
- `orientation: portrait` in `manifest.json` (landscape locked out — only way to maintain touch target quality)
- Safe-area insets respected (notch/home indicator)

### Log grid
- 2×4 grid (never 4×2), always 8 slots reserved — hidden bag slots become disabled ghost tiles, grid shape never reflows mid-trip
- Hero button: 60% of viewport height, full-width within max
- Secondary tiles: 20% viewport height each, 2-across
- Progressive disclosure: active milestone is hero (accent-filled), past milestones muted+checked, future milestones ghosted-muted, skipped bag tiles disabled

### Tab bar
- Bottom, native iOS pattern: 3 tabs (Log / Predict / History), 48pt height + safe area
- Active = accent color, inactive = muted
- Tab bar persists during bottom sheets (sheets use medium detent)

### Bottom sheet
- Detents: medium (50% viewport), large (90% viewport)
- Dismiss: swipe-down OR tap scrim
- Animates with spring; `prefers-reduced-motion` uses cut-to

### Haptics (iOS-only via Taptic, via Vibration API as fallback)
- Milestone tap: `UIImpactFeedbackGenerator.medium` (or `vibrate(10)`)
- Trip confirm: success haptic
- Sync error: warning haptic
- Destructive confirm (void): error haptic

### Predict result card
- Leave-by time: 64pt, accent color, center
- Comfortable time: 32pt, muted, below
- "Based on N trips" line: 14pt meta
- Distribution sparkline: 60pt tall, min/median/max labeled
- "Set alarm" button (iOS `x-apple-reminderkit://` or a calendar deep link) — deferred; see §10 L2 Shortcut alternative

## 11. §13 Accessibility Checklist

- [x] Accent-on-black contrast ≥ 4.5:1 verified for every color (§12 values documented)
- [x] Minimum touch target 88pt for milestone buttons (exceeds Apple HIG 44pt)
- [x] Dynamic Type: all body uses `clamp()` or `UIFontMetrics`-equivalent scaling
- [x] VoiceOver labels per milestone include state ("Departure, at airport, not yet logged, button") — computed from `milestone_kinds.label` + trip state
- [x] `prefers-reduced-motion` respected: no spring animations, cut-to transitions
- [x] Haptic on every consequential tap
- [x] Focus indicators visible (2pt accent outline)
- [x] Form labels associated with inputs; autocomplete dropdowns keyboard-navigable
- [x] Error messages in plain English + icon (never red-text-only)
- [x] Landscape locked (portrait-only) — alternative would require layout rework

## 12. Prerequisites (on you)

1. **Hostname**: `travel.myhometech.app` (locked).
2. **Cloudflared tunnel**: already running — add route `travel.myhometech.app` → `http://localhost:8090`.
3. **Mapbox account** (free tier). Generate a URL-restricted access token for `https://travel.myhometech.app/*`.
4. **Backblaze B2 account** (free 10 GB tier) for offsite WAL archiving. Create a bucket `travel-logger-wal`, application key with `writeFiles`/`readFiles`.
5. **Docker Desktop / OrbStack** auto-start on login (System Settings).
6. **GitHub username** for source backup repo.
7. **WebAuthn-capable device** for Authelia passkey registration (your iPhone + Mac both are; first login is password, subsequent is passkey).

Everything else is mine.

## 13. Out of scope

- Multi-leg / connecting flights.
- Multi-user support.
- Desktop/iPad native layouts (they get the max-width 480px phone app).
- Push notifications / auto-alarms. Manual "Set alarm" deep-link stays optional in L2.
- Weather / traffic / flight-status API integration.
- High-availability clustering.

---

# GSTACK REVIEW REPORT

_Generated by `/autoplan` 2026-04-23 17:52:25. Approved 2026-04-24 with gate responses applied._
_Codex: unavailable. Mode: `[subagent-only]` — single-voice, no consensus table. Cross-phase signal used in lieu of dual-voice consensus._

## Runs & status

| Phase | Run | Status | Severity mix | Unresolved at gate |
|---|---|---|---|---|
| CEO (plan-ceo-review) | ✓ | approved_with_overrides | 5 critical · 9 high · 6 medium | 20 → 0 (gate applied) |
| Design (plan-design-review) | ✓ | approved_with_overrides | 4 critical · 12 high · 11 medium | 27 → 0 |
| Eng (plan-eng-review) | ✓ | approved_with_overrides | 6 critical · 17 high · 16 medium | 39 → 0 |
| DX | skipped — no dev-facing scope | — | — | — |

## Cross-phase themes (resolved at gate)

1. **Cloudflare Access wrong for this PWA** — resolved by switching to **Authelia + Caddy forward-auth** + hardened `fetchJSON` wrapper.
2. **Edit/undo mandatory for v1** — promoted from L2 stretch to M7.
3. **Historical import critical for cold start** — promoted from L1 stretch to M5.
4. **State specs / test plan missing** — §9 States Inventory, §10 UI Spec, §11 Accessibility Checklist added.

## Gate decisions (user)

- **Auth**: Authelia (user-proposed alternative to Cloudflare Access; aligned with self-hosted philosophy).
- **Scope promotions**: edit/undo → M7; historical import → M5.
- **Scope kept**: Mapbox (M6); full offline queue (M8); all 8 milestones; manual alarm (no deep-link).
- **Reframe challenges** (C5 drop in_transit; C6 add alarm deep-link): **rejected** — user kept original plan.
- **Approval mode**: apply-and-regenerate.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale |
|---|---|---|---|---|---|
| 1 | Eng | Fetch wrapper with `redirect:'manual'` + JSON check | Mechanical | P1 | Silent data loss on cookie expiry |
| 2 | Eng | Milestone kinds as lookup table (FK from milestones) | Mechanical | P5 | Schema integrity; typo drift |
| 3 | Eng | Drop `trip_date` column; derive via view | Mechanical | P1 | Midnight crossing |
| 4 | Eng | DST validation at trip creation + `dst_warning` column | Mechanical | P1 | Annual DST bug |
| 5 | Eng | Separate `api` schema with views; PostgREST has no access to `public` | Mechanical | P1 | Previously exposed full CRUD |
| 6 | Eng | Pin all Docker image digests | Mechanical | P5 | `latest` tag time bomb |
| 7 | Eng | Foreground retry loop (online + visibilitychange + interval) as primary sync | Mechanical | P1 | iOS Safari lacks background sync |
| 8 | Eng | Dead-letter queue + 409/4xx/5xx/network taxonomy | Mechanical | P1 | No poison-pill policy |
| 9 | Eng | Client UUIDs; queue orders trip before its milestones | Mechanical | P5 | Orphan prevention |
| 10 | Eng | `navigator.storage.persist()` + 5000-entry / 10 MB cap | Mechanical | P1 | Eviction risk |
| 11 | CEO | Full OurAirports dataset | Mechanical | P1 | Bundle delta trivial |
| 12 | Design | §9 States Inventory | Mechanical | P1 | Undefined states = bad defaults |
| 13 | Design | §10 UI Spec (hex, type, gestures, grid) | Mechanical | P5 | "Minimalist" ≠ "undefined" |
| 14 | Design | §11 Accessibility Checklist | Mechanical | P1 | Contrast / taps / VO / haptics |
| 15 | Design | `max-width:480px` + portrait lock | Mechanical | P3 | Desktop stretch hostile |
| 16 | CEO | Prediction-vs-actual calibration (M13 + `predictions` table) | Mechanical | P1 | Feedback loop for faith-based predictor |
| 17 | Eng | Widening order documented: tsa→party→transit→bags→airport | Mechanical | P5 | Semantic decision |
| 18 | Eng | Launchd for cloudflared + Docker auto-start | Mechanical | P1 | Monthly OS reboots |
| 19 | Eng | Real restore drill + wal-g PITR + B2 offsite | Mechanical | P1 | 24h RPO unacceptable |
| 20 | Eng | Preflight deploy script (Caddy/tunnel/Authelia health) | Mechanical | P5 | Three-place deploy with no verification |
| 21 | Eng | Bun `/api/predict` service (separate from PostgREST) | Taste | P1 | PostgREST can't cleanly express N<3 widening |
| 22 | Eng | Void/tombstone model for milestones (unique partial index) | Mechanical | P1 | Re-tap after mistap |
| 23 | Eng | `milestones_history` audit table via trigger | Mechanical | P1 | Edit visibility |
| 24 | CEO | Expectation-setting language in §1 about predictor cold start | Mechanical | P5 | Honest about what v1 can do |
| 25 | Gate | Switch auth to Authelia (user-proposed) | User challenge | user override | User suggested Authelia; aligns with self-hosted philosophy; better than original CF Access |
| 26 | Gate | Edit/undo → v1 (M7) | User challenge | user accepted | Cross-phase unanimous |
| 27 | Gate | Historical import → v1 (M5) | User challenge | user accepted | Cold-start rescue |
| 28 | Gate | Keep Mapbox (no cut) | User challenge | user overrode | Review recommended cut; user kept |
| 29 | Gate | Keep full offline queue | User challenge | user overrode | Review recommended simplify; user kept |
| 30 | Gate | Keep all 8 milestones (no reframe) | User challenge | user overrode | CEO recommended terminal-only; user kept |
| 31 | Gate | No alarm deep-link | User challenge | user overrode | CEO recommended adding; user kept |
