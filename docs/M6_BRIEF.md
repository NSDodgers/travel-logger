# M6 brief — address book + Mapbox

> **STATUS: ✅ Done 2026-04-25.** Kept for reference. For the next milestone, read `docs/M7_BRIEF.md`. M6 outcome summarized in `STATUS.md`.

_Starting point for a fresh chat session. Read this, then `STATUS.md`, then `implementation_plan.md` §8 (M6 line) + §10 (UI spec)._

## What M6 is

The first user-facing feature of the Travel Logger PWA. After M5 (which seeded historical trip data into Postgres), M6 builds:

1. A **PWA shell** to replace the `web/index.html` placeholder ("M2 — stack online" landing page).
2. An **address book screen** for managing the addresses that future trips can reference.
3. **Mapbox Search JS Core** integration for autocomplete + on-demand pin confirmation.
4. **Add / edit / archive** flows for addresses.

After M6, the user can manage addresses; M7 then adds the trip-logging UI on top.

## Starting state — what's already in place

### Database

- `public.addresses` table exists with full schema (`id`, `label`, `mapbox_id`, `formatted`, `lat`, `lng`, `archived`, timestamps).
- `api.addresses` view exposes the table to PostgREST (read+write).
- **14 legacy addresses already loaded** with `label` prefixed `legacy:` (e.g. `legacy:home_192nd`). These are Nick's residences, temp work stays, and recurring family/work venues from M5. They surface in the address book unless the UI filters by prefix.

### Backend

- PostgREST runs at `/api/*`. Address operations:
  - `GET  /api/addresses` — list (PostgREST returns JSON)
  - `POST /api/addresses` — create (auth: Authelia session cookie → PostgREST trusts via header)
  - `PATCH /api/addresses?id=eq.<uuid>` — update
  - Archive = `PATCH ... { archived: true }` (no DELETE — addresses are referenced by trips)
- Mapbox token: `secrets/mapbox_token.txt` (URL-restricted public token; safe to expose to the browser per Mapbox guidance).

### Frontend

- `web/index.html` — placeholder. Replace with the real PWA shell.
- `web/manifest.json` — basic PWA manifest exists; verify it has icons and matches the new shell.
- Caddy serves `web/` as static under `/` (after Authelia auth).
- No build system yet. M6 should keep it lean — vanilla JS or minimal bundler. The plan calls for "modern web platform first" — no framework lock-in unless required.

## What to build

### 1. PWA shell

- Replace `web/index.html` with a real shell that hosts the address book screen first, with placeholder navigation for the M7 Log / M10 Predict / M9 History tabs.
- Dark mode default (existing placeholder uses `color-scheme: dark` — keep).
- Match the iOS-style typography already in the placeholder (`-apple-system, system-ui, 'SF Pro Text'`).
- Bottom tab bar — see `implementation_plan.md` §10 UI spec for the visual language.

### 2. Address book screen

- List all addresses where `archived = false`, ordered by most recently used or alphabetically — pick one and confirm with Nick.
- Show: `label`, `formatted`, archive toggle, edit button.
- Empty state ("no addresses yet" — but legacy seed means this won't normally show).
- Add button (FAB or top-right).

### 3. Add / edit flow

- A modal or full-screen form with:
  - **Label** (e.g. "Home", "Mom's house") — free text
  - **Address search** — Mapbox Search JS Core autocomplete; user picks a candidate
  - **On-demand pin confirmation** — show a small map snippet with the picked location for visual sanity check before save
  - On save: `POST` (or `PATCH`) to `/api/addresses` with `label`, `formatted`, `lat`, `lng`, `mapbox_id`
- For the legacy addresses (label prefix `legacy:`), allow editing the label to a clean human name and stripping the prefix on save.

### 4. Archive flow

- Long-press or swipe-to-archive on the list row, OR an archive button in the edit form.
- Sets `archived = true`. UI hides archived by default but offers a "show archived" toggle.

## Locked design decisions (from `implementation_plan.md`)

- **Mapbox Search JS Core** specifically — not the older Search Box web component, not Mapbox GL JS for the input. Core gives the developer maximum control over the UX.
- **No framework** unless M6 surfaces a clear need. Plain modules + fetch + small DOM helpers is the default.
- **Auth** — every fetch must travel under the Authelia session cookie; Caddy injects the auth headers PostgREST trusts. No manual JWT handling in the PWA.
- **Service worker** — defer until M8 (offline queue). For M6, all calls assume online.

## Known small things M6 may need to handle

- Legacy address labels look like `legacy:home_192nd`. UI should either hide the prefix in display OR encourage Nick to rename them in M6.
- 14 addresses include 4 recurring-visit / work-venue entries (mom's house, MIL's house, Steppenwolf, ART) where the date range is null/permanent. UI shouldn't require date ranges.
- Some addresses have foreign tz (`Europe/Berlin` for Köln). UI doesn't need tz at all — that's an airport-driven concern.
- Mapbox token is URL-restricted; verify the production URL `travel.myhometech.app` is in the allowed-referer list before deploying.

## What NOT to do in M6

- Don't build trip-logging UI. That's M7.
- Don't build the Predict tab. That's M10.
- Don't build offline support yet. That's M8.
- Don't add a service worker (yet).
- Don't introduce a build pipeline unless absolutely needed for Mapbox JS Core (their docs say it works fine via CDN script tag).

## Deliverables

1. **`web/index.html`** rewritten as the PWA shell.
2. **`web/app.js`** (or modular) — address book logic.
3. **`web/style.css`** — pulled out of inline styles.
4. **Address book working end-to-end** — list, add (with Mapbox autocomplete), edit, archive.
5. **`web/manifest.json`** — verified, with proper icons.
6. **Per-feature commits** matching M5's pattern: shell scaffold, address list, Mapbox integration, add flow, edit/archive flow.
7. **STATUS update** at end.

## Suggested opening question

> Want to start by sketching the address book screen layout, or should I scaffold the PWA shell first and we'll iterate from there?
