# M7 brief — log grid + departure flow

_Starting point for a fresh chat session. Read this, then `STATUS.md`, then `implementation_plan.md` §7 Flow A/B + §8 (M7 line) + §10 (UI spec)._

## What M7 is

The first **interactive logging UI**. After M6 (which built the PWA shell and address book), M7 turns the Log tab from a placeholder into the primary in-airport surface. By the end:

1. Tap the hero "Dep: In Transit" button on an empty Log tab → bottom sheet to start a trip (origin address, dep airport, arr airport, scheduled times, bags/party/transit/TSA).
2. Trip is POSTed; first milestone is logged; grid transitions to a 2×4 progressive-disclosure layout.
3. Each subsequent milestone is one-tap (At Airport → Dropped Bags → Through Security → Through Customs).
4. Long-press a logged milestone → edit time OR void.
5. After every tap, a 60-second undo toast.
6. When `bags='carry_on'`, the Bags tile is rendered as a disabled ghost — the grid shape never reflows mid-trip.
7. After the final departure milestone, trip status → `complete`; grid resets to the empty hero.

After M7, you can fully log a departure-side trip on a real run. Arrival-side logging lands in M9.

## Starting state — what's already in place

### Database (live, no schema changes needed for M7)

- `public.trips` table: full schema with `direction`, `address_id` (origin), `dep_airport`, `arr_airport`, scheduled times, bags/party/transit/tsa, `status` (`in_progress|complete|abandoned`), `source` (`app|legacy`).
- `public.milestones` table: `(trip_id, kind, logged_at, client_seq, void)` with auto-bumped `updated_at` (the only table with a trigger).
- `public.milestones_history`: change log populated by trigger (`milestones_audit`) on update/void.
- `public.milestone_kinds`: 10 rows. Departure side has 5 kinds in `order_seq` 1–5 (`dep_in_transit`, `dep_at_airport`, `dep_bags`, `dep_security`, `dep_customs`). `shown_when_carry_on=false` for `dep_bags` only.
- `public.addresses`: 14 entries managed via M6 UI.
- `public.airports`: 5,515 entries with `iata`, `name`, `city`, `country`, `tz`.

### Backend

- PostgREST exposes `api.trips`, `api.milestones`, `api.milestone_kinds`, `api.addresses`, `api.airports`. INSERT/UPDATE granted on trips and milestones via `postgrest_user`.
- M6 verified PostgREST end-to-end. POST/PATCH work.
- Caddy strips `/api` before proxying to PostgREST (M6 fix).

### Frontend (M6 deliverables to build on)

- `web/index.html` — shell with header (back/title/primary), `<main id="screen">`, bottom 3-tab bar.
- `web/style.css` — design tokens from §10. Already has `.btn`, `.form`, `.addr-row`, `.placeholder`. Needs new classes for the log grid + bottom sheet.
- `web/app.js` — async hash router with `applyChrome({title, tab, showBack, primary})`. Routes registered: `/log` is the placeholder we replace.
- `web/api.js` — PostgREST fetch wrapper; 401 bounces to `/auth/`.
- `web/screens/placeholder.js` — `logScreen` is the function to replace with the real grid.
- `web/screens/addresses.js` — reuse `escapeHtml`, `escapeAttr`, the form pattern, and the `__toast` global for the trip-start sheet.

### Tooling

- `bun run qa <cmd>` is the canonical browser-driven QA tool. Sign in once with `bun run qa login`, then iterate: `bun run qa goto /#/log`, `bun run qa screenshot`, `bun run qa click "..."`, `bun run qa eval "{...}"`.

## What to build

### 1. Log grid

Per `implementation_plan.md` §10:

- **Empty state** (no `status='in_progress'` trip): single full-width hero "Dep: In Transit" button taking ~60% of viewport height.
- **Active state**: 2×4 grid (always 8 slots reserved — never reflows mid-trip).
  - Active milestone is the hero (accent-filled, 60% height).
  - Past milestones are muted with a checkmark + logged time.
  - Future milestones are ghosted-muted.
  - Bag tile is a disabled ghost when `bags='carry_on'`.
  - Customs tile is rendered when relevant (international); domestic trips can hide it via the same `shown_when_*` pattern (or just skip if Nick decides domestic-only initially).
- Active hero: minimum 88pt touch target (HIG); already covered by 60% viewport height.

Decision points to surface to Nick before building:
- Customs visibility: shown for international (different country IATAs), or always-hidden by default with a manual "international" trip flag, or always-on?
- Layout: 2×4 with hero + 7 small tiles, OR hero + 4-tile strip below for the remaining departure milestones?

### 2. Trip-start bottom sheet

Triggered by tapping the empty-state hero. Per Flow A:

- Origin: address book picker (default = last-used address by `updated_at`).
- Dep airport: IATA autocomplete from `api.airports` (5,515 rows; PostgREST query `?or=(iata.ilike.X*,name.ilike.*X*)`).
- Arr airport: same.
- Scheduled dep time + date (local to dep airport, looked up from airports.tz).
- Scheduled arr time + date (local to arr airport).
- Bags / Party / Transit / TSA — sticky from last trip (read latest `trips` row).

DST handling: per the plan, validate scheduled times against the airport's tz for spring-forward (`spring_nonexistent`) and fall-back (`fall_ambiguous`). Surface a warning banner inside the sheet rather than blocking.

### 3. Trip + first milestone POST

On confirm:
- POST `/api/trips` (returns the row including `id`).
- POST `/api/milestones` with `trip_id`, `kind='dep_in_transit'`, `logged_at=now_utc`, `client_seq=1`.
- M7 writes direct (no queue). M8 will retrofit IndexedDB queue.
- On success: dismiss sheet; render grid in active state; haptic success.

### 4. Subsequent milestones

- One-tap → POST `/api/milestones` with the next `kind` in `order_seq` and `client_seq=N+1`.
- Optimistic UI: tile flips to "logged" state immediately, time stamp shows; if the POST fails, revert + error toast.
- After the final visible milestone, PATCH the trip to `status='complete'`. Grid resets.

### 5. Long-press → edit/void

- Long-press a logged tile (touch: 500ms+; mouse: contextmenu) opens a tiny sheet with two actions:
  - **Edit time**: time picker pre-filled with current `logged_at` (in dep airport tz). PATCH `/api/milestones?id=eq.<uuid>` with new `logged_at`.
  - **Void**: PATCH with `void=true, void_reason='manual'`. Tile flips back to "future" state.
- The `milestones_audit` trigger writes the audit row automatically.

### 6. Undo toast

- After every successful tap, a 60-second toast: "Logged: At Airport, 7:12 AM — Undo". Tap "Undo" → PATCH milestone to void.
- Reuse the existing `window.__toast` from M6 for the visual; extend it with an action button.

## Locked design decisions

- **No queue yet.** Direct fetch. M8 adds IndexedDB. Don't over-engineer M7's network layer.
- **Optimistic UI on milestone taps.** Revert on failure. M8 will replace this with queue semantics.
- **No service worker.** Defer to M8.
- **Sticky variables.** Bags/party/transit/tsa default to the latest `trips` row's values.
- **DST warnings non-blocking.** Surface in the sheet, let Nick override.
- **Auth.** Same as M6 — Authelia session via Caddy, no JWT in app.

## Known small things M7 needs to handle

- **Address book empty.** Already 14 entries from M5; defaultable. Don't require a non-empty list to render the sheet — show a "+ Add address" inline shortcut.
- **Two trips in progress** is impossible by schema — `status='in_progress'` is the active filter. Make the empty state robust to "stale in-progress trip" (>24h since last milestone) per `implementation_plan.md` §9: show an amber banner with Resume / Mark complete / Abandon actions.
- **Server time vs client time.** `logged_at` is set client-side as `now_utc` (`new Date().toISOString()`). The constraint "milestones.logged_at within 48h of trips.created_at" (plan §5) is application-enforced; reject silly values client-side.
- **Customs is real on Nick's runs.** YYZ has US preclearance (`dep_customs`); Köln/CDG have arrival customs (`arr_customs`). The dep_customs tile should be visible on departures from precleared airports.
- **`addresses.updated_at` has no trigger** (M6 known). Continue bumping client-side on PATCHes if you want list re-sort to work; trip-side has the same gap.

## What NOT to do in M7

- Don't build the arrival-side flow. That's M9.
- Don't build IndexedDB queueing or a service worker. That's M8.
- Don't build the Predict tab. That's M10.
- Don't add a trip history list. That's M9.
- Don't add a void-and-relog UI flow yet — single void is enough for M7.
- Don't introduce a framework. Plain modules + fetch + small DOM helpers, same as M6.

## Deliverables

1. **`web/screens/log.js`** — replaces the placeholder. Handles empty + active states + the trip-start sheet + milestone taps + edit/void.
2. **`web/screens/airport-picker.js`** (likely) — IATA autocomplete reused by both dep and arr fields. Could split out for reuse in M9 + M10.
3. **`web/style.css`** additions for the grid + bottom sheet + undo toast.
4. **`web/app.js`** — extend `__toast` with an action button; route changes if needed (probably none — `/log` already exists).
5. **Per-feature commits** matching the M6 pattern: empty hero → trip-start sheet → first milestone POST → subsequent milestones → long-press edit/void → undo toast.
6. **STATUS update** at end.
7. **One real-run dry test** via `bun run qa` to verify the full happy path.

## Suggested opening question

> Want to lock the customs visibility rule first (per-airport based on IATA, manual flag, or always-show), or scaffold the empty-state hero and trip-start sheet first and we'll layer customs in once the basic flow is solid?
