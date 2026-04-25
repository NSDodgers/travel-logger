# M8 brief — offline queue

_Starting point for a fresh chat session. Read this, then `STATUS.md`, then `implementation_plan.md` §3 (fetch wrapper row), §6 ("Critical flow: a milestone tap"), §8 (M8 line), §9 (offline + sync states)._

## What M8 is

The first **offline-capable** version of the app. After M7 (which built the
in-airport logging surface with direct PostgREST writes), M8 turns every
write into a queued operation that survives airplane mode, captive-portal
WiFi, lost cell, and Authelia session expiry. By the end:

1. Every `POST /api/trips`, `POST /api/milestones`, `PATCH /api/milestones`,
   `PATCH /api/trips` is appended to an **IndexedDB write-ahead log** before
   the network call.
2. A **foreground retry loop** drains the queue when `online` fires, when the
   tab regains visibility, and on a periodic interval. iOS Safari does NOT
   support `SyncManager` background sync — foreground retry IS the primary
   path, not a fallback.
3. A hardened `fetchJSON()` wrapper (`redirect: 'manual'` + JSON
   content-type check + status taxonomy) replaces the M6/M7 `api.js`
   primitive. It's the **only** path to `/api/*` after M8.
4. Each queue entry transitions through `pending → in_flight → synced` (drop)
   or `failed (retriable) → in_flight → ...` or `dead_letter` (4xx after
   3 retries / schema mismatch). Per-entry actions: Retry / Discard / Edit.
5. Per §9 States Inventory, the top of the screen shows a sync strip:
   - `N taps pending sync` (amber) when offline + queue > 0
   - `Syncing…` (blue) during a flight
   - `Sync retrying` (amber + timer) on retriable errors
   - `N taps failed` (red) on dead-letter, tap → list with per-entry actions
6. Auth session expiry is a **first-class state**: if `fetchJSON()` sees a
   3xx (Authelia redirect) or HTML-as-JSON, the queue pauses and a modal
   pops "Sign in to sync — your offline taps are safe." Tap to open `/auth/`,
   queue resumes on return.
7. `navigator.storage.persist()` requested at app init so iOS doesn't evict
   the IndexedDB store under storage pressure.
8. Queue retention cap: 5000 entries OR 10 MB, whichever first. Loud UI
   warning on overflow.
9. **End-to-end airplane-mode test passes**: take 3 milestones with WiFi
   off, observe the strip, re-enable WiFi, observe drain.

After M8, M7's logging is correct under bad-network conditions. M9 (arrival
flow + trip history) and M10 (predict tab) get to assume the queue exists.

## Starting state — what's already in place

### Database (live, no schema changes needed for M8)

- M7 schema is solid. `public.milestones` audit trigger is split into
  BEFORE-touch + AFTER-audit (SECURITY DEFINER) — both INSERT and PATCH
  paths through PostgREST work end-to-end. M5's `set constraints deferred`
  bulk-loader trick is unrelated to the live API path.
- `public.trips.international` (M7 migration 004) persists across reload.
- No new migrations expected for M8. If you find yourself adding a
  client-id column to milestones, stop and re-read this brief: client UUIDs
  go in IndexedDB and become the row's `id` on POST. The existing schema
  already supports this — M7 sets `id: cryptoRandomId()` in the request body
  and PostgREST honors it.

### Backend

- PostgREST exposes `api.trips`, `api.milestones`, `api.milestone_kinds`,
  `api.addresses`, `api.airports`, `api.predictions`, `api.trip_timeline`.
  M7 verified INSERT/UPDATE on trips + milestones works through the audit
  trigger. M8 does not need backend changes.
- Caddy strips `/api` before proxying to PostgREST. `Cache-Control: no-store`
  on the static PWA path. Authelia gates everything.

### Frontend (M7 deliverables to build on)

- `web/api.js` — current PostgREST client. Lightweight, follows redirects
  (which is the bug M8 closes). Replace with `fetchJSON()` per §3.
- `web/screens/log.js` — direct fetches. After M8, all four call sites
  (POST trip, POST milestone, PATCH milestone, PATCH trip) go through the
  queue. The optimistic-UI pattern stays; only the network layer changes.
- `web/screens/airport-picker.js` — read-only `GET /airports`, NOT queued
  (queue is for writes).
- `web/screens/addresses.js` — uses POST + PATCH on `/addresses`. After
  M8, also queued. Same optimistic-UI shape works.
- `web/app.js` — owns the toast and the screen router. M8 adds the sync
  strip above `<main id="screen">` and the auth-expired modal as a global
  overlay. Both belong here, not in any screen module.
- `web/style.css` — already has `.toast` (with action button from M7),
  `.scrim`, `.sheet`. M8 adds `.sync-strip` (top, sticky, color-coded by
  level), `.dead-letter-list` (per-entry rows with Retry/Discard buttons).

### Tooling

- `bun run qa <cmd>` is the canonical browser-driven QA tool. M8 needs
  airplane-mode toggling — Playwright supports `context.setOffline(true)`.
  Add a `bun run qa offline on|off` subcommand or call it inline via
  `bun run qa eval`. The QA driver lives at `scripts/qa.ts`.
- Caddy serves `Cache-Control: no-store`, but Playwright's persistent
  profile (`.qa-profile/`) caches CSS/JS on disk anyway. Force-bust with
  `location.href = '/?_=' + Date.now() + '#/whatever'` between iterations
  or you'll spend 10 min wondering why the new code isn't running. (This
  bit me hard during M7.)

## What to build

### 1. IndexedDB write-ahead log

Schema (single object store, e.g. `outbox`):

```ts
type QueueEntry = {
  id: string;                    // queue entry UUID, NOT the row id
  created_at: number;            // Date.now()
  // The HTTP request shape:
  method: 'POST' | 'PATCH';
  path: string;                  // '/trips', '/milestones?id=eq.<uuid>'
  body: Record<string, any>;     // JSON payload
  // Lifecycle:
  status: 'pending' | 'in_flight' | 'failed_retriable' | 'dead_letter' | 'synced';
  attempts: number;
  last_error?: string;
  next_attempt_at?: number;      // for backoff
  // Provenance — used for "edit before retry" and dead-letter UX:
  origin: { screen: 'log' | 'addresses'; intent: 'create_trip' | 'log_milestone' | 'edit_milestone' | 'void_milestone' | 'complete_trip' | 'address_create' | 'address_edit' };
  related?: { trip_id?: string; milestone_id?: string };
};
```

Indexes you'll want: `by_status`, `by_created_at`, optional `by_related_trip`.
Drop entries when `status='synced'` to keep the store small (matched by
the cap rule below).

### 2. fetchJSON() wrapper (THE only path to /api/*)

Per §3:

- `credentials: 'same-origin'`
- `redirect: 'manual'` — any 3xx (Authelia bouncing to `/auth/`) becomes a
  classified `auth_required` error, NOT a follow.
- After fetch: check `Content-Type` for `application/json`; HTML response
  is also `auth_required`. (Authelia sometimes serves a login page with
  302 inlined to a 200 if behind a quirky proxy chain — both shapes need
  to map to `auth_required`.)
- Status classification:
  - `2xx` + JSON shape OK → success
  - `409` unique-violation → `duplicate` (drop from queue)
  - `409` FK-violation → `fk_missing` (retry — the parent op may not have
    drained yet; the queue is order-preserving so this resolves itself)
  - other `4xx` → `dead_letter` after 3 attempts
  - `5xx` → `retriable`, exponential backoff (1s, 2s, 4s, 8s … cap 60s),
    max 8 attempts
  - network error → `retriable`, retry on next `online` /
    `visibilitychange` / interval, attempts not bumped (it's not the
    server's fault)

### 3. Drain loop

A single coordinator (in e.g. `web/sync.js`) that:

1. On `app.js` init, requests `navigator.storage.persist()` and starts the loop.
2. `drain()` walks the outbox in `created_at` order, picking the first
   `pending` or `failed_retriable` whose `next_attempt_at` (if set) is
   past. Marks it `in_flight`, awaits `fetchJSON`, transitions per
   classification, broadcasts a sync-state event for the strip to render.
3. Triggers: `online`, `visibilitychange` (when visible), and
   `setInterval(drain, 15_000)` while a tab is in foreground.
4. **Order-preserving** — if the head of the queue is in `failed_retriable`
   and not yet eligible, do NOT skip it for a later entry that would write
   to the same trip. The simplest correct implementation: only attempt the
   head entry per drain pass. (This sacrifices throughput, but Nick's
   queue is at most ~10 entries deep on a real airport run.)

### 4. Sync strip (top of viewport, sticky)

Per §9. One element above `<main>`, hidden by default. CSS in `style.css`:
amber `pending`, blue `syncing`, amber `retrying` with countdown, red
`dead-letter` with tap-to-open. Tap on amber/red opens a sheet listing
queue entries with per-entry Retry / Discard buttons (and Edit later if
the entry's intent supports it).

### 5. Auth-expired modal

When `fetchJSON()` returns `auth_required`:

- Pause the drain loop (don't re-fire on online/visibility until resumed).
- Show a modal: "Sign in to sync — your offline taps are safe."
  Single button: "Open login" → `location.href = '/auth/?rd=' + encodeURIComponent(location.href)`.
- On return (the page reloads after Authelia bounces back), the queue
  resumes naturally.

### 6. Storage discipline

- `navigator.storage.persist()` at boot. Log to console if denied.
- Cap: 5000 entries OR 10 MB, whichever first. On overflow, set the strip
  to red with "Queue full — sync now or some taps will be lost."
- A drained `synced` entry is deleted, not retained. (Audit history lives
  in `public.milestones_history` server-side already.)

### 7. Migrate every M7 write site

Three call sites in `web/screens/log.js`:

- `startTrip()` — POST trip, then POST milestone. After M8, both go through
  the queue. The trip's UUID is generated client-side (use
  `cryptoRandomId()` for the `id`) so the milestone's `trip_id` is known
  before the trip POST drains.
- `logMilestone()` — POST milestone. Optimistic UI stays; the request is
  enqueued, not awaited.
- `voidMilestone()` and `editMilestoneTime()` — PATCH milestone. Same shape.
- `completeTrip()` — PATCH trip. Same shape.

And the M6 address sites (`web/screens/addresses.js`) — POST + PATCH on
`/addresses`. Don't forget these.

The optimistic-UI pattern (push to in-memory state, render, await POST)
becomes (push to in-memory state, render, enqueue and return). The sync
state isn't directly visible on the tile; that's what the sync strip is
for. Keep the screens dumb about the queue.

### 8. Dead-letter UX

A simple sheet listing each `dead_letter` entry with:

- Method + path summary ("Log Through Security at LGA")
- Last error
- "Retry" button → flips back to `pending`, drain runs.
- "Discard" button → confirms, deletes from queue.
- (Optional, deferrable) "Edit" — for milestone PATCHes with an obvious
  edit (time), open the edit-time sheet pre-filled. Skip if it adds scope.

## Locked design decisions

- **IndexedDB, not localStorage.** The 10 MB cap is real; localStorage
  caps at ~5 MB and is synchronous (blocks the main thread on a 5 AM
  airport tap).
- **Foreground retry, not Service Worker `SyncManager`.** Per the plan:
  iOS Safari doesn't support background sync. The interval+visibility+
  online triad IS the real path.
- **No service worker yet.** Asset caching belongs to a later phase.
  Don't preempt — it interacts badly with the no-store iteration loop.
- **Order-preserving.** Per §6 critical flow: trip POST must drain before
  its milestones, because milestones FK trip. Simplest correct: head-only
  drain.
- **Client UUIDs.** Already in M7's POST bodies. Don't change.
- **Don't surface `client_seq` to the queue.** It's set at enqueue time
  from the in-memory state in `log.js`. The queue treats the body opaquely.
- **No retry on `duplicate`.** A 409 unique-violation means it's already
  on the server (probably from a prior session that got the response we
  missed). Drop from queue.
- **Auth.** Same as M7 — Authelia session via Caddy. The fetch wrapper is
  the only auth-aware code; everything else assumes happy-path.

## Known small things M8 needs to handle

- **Audit trigger writes via M7 migration 003 — order-of-operations.** The
  AFTER trigger writes `milestones_history.milestone_id=new.id` and
  resolves the FK at end-of-statement. Concurrent inserts are fine; just
  don't downgrade to a BEFORE trigger.
- **`updated_at` is server-bumped via M7 trigger.** Don't include
  `updated_at` in PATCH bodies anymore (M7 cleaned this up in `log.js` but
  not in `addresses.js` — fix the latter as part of the migration to the
  queue). Including it isn't wrong, just noise.
- **Mid-trip page reload while queue has pending writes.** The in-memory
  `state.trip` and `state.milestones` will be re-fetched from PostgREST
  on screen mount — but the server only knows about drained entries. The
  log screen needs to merge: server-truth + still-pending optimistic
  entries from the queue. A `getQueuedFor(trip_id)` helper on the queue
  module is the right shape. Skip this and you'll see the UI "lose"
  entries on reload, then have them reappear after drain.
- **Toast collisions with sync strip.** The strip is the persistent
  channel ("N taps pending sync"); the toast is the per-action channel
  ("Logged: At Airport · Undo"). Don't conflate them.
- **Cloudflare cache** is bypassed for the hostname (Cache Rule). Don't
  add aggressive caching headers without removing the rule first — the
  iteration loop depends on it (per memory).

## What NOT to do in M8

- Don't build the arrival flow. That's M9.
- Don't build a Service Worker. That's deferred until after M11.
- Don't build the Predict tab. That's M10.
- Don't add a trip history list. That's M9.
- Don't refactor the screens to subscribe to a global state store. The
  queue module exposes a small event bus (`onSyncStateChange`); screens
  subscribe to it for the strip render only.
- Don't widen the fetch wrapper into an SDK. It's a primitive — wrap,
  classify, return. Keep it under 100 lines.
- Don't introduce a framework or a state library. Plain modules + fetch +
  IndexedDB + small DOM helpers, same as M6/M7.

## Deliverables

1. **`web/queue.js`** — IndexedDB outbox + drain loop + event bus.
2. **`web/api.js`** — replace contents with `fetchJSON()` wrapper. Export
   the same shape (`api.get/post/patch`) so screens don't need rewrites,
   but `post` and `patch` enqueue instead of awaiting the network. `get`
   is direct (read-only, never queued).
3. **`web/sync-strip.js`** (or inline in `app.js`) — sticky strip element
   subscribing to the queue's event bus.
4. **`web/style.css`** additions for `.sync-strip`, `.dead-letter-list`,
   `.auth-expired-modal`.
5. **`web/app.js`** — request `navigator.storage.persist()` at boot,
   mount the sync strip, render the auth-expired modal when the queue
   emits `auth_required`.
6. **`web/screens/log.js`** + **`web/screens/addresses.js`** — migrate
   every POST/PATCH to the queue. Add `getQueuedFor(trip_id)` merge on
   log-screen mount.
7. **`scripts/qa.ts`** — add `offline on|off` subcommand for E2E airplane
   tests (Playwright `context.setOffline()`).
8. **STATUS update** at end. Per-feature commits matching the M6/M7 pattern.
9. **Airplane-mode E2E test** (manual or scripted) demonstrating: 3 taps
   offline → strip shows pending → online → strip drains → DB has all 3
   rows in correct client_seq order.

## Suggested opening question

> Want to lock the queue's order semantics first (head-only drain vs.
> per-trip serial vs. fully parallel), or scaffold the IndexedDB outbox
> + fetchJSON wrapper first and we'll layer the drain policy on top once
> the primitives are in place?
