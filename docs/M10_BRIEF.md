# M10 brief — Predict tab

_Starting point for a fresh chat session. Read this, then `STATUS.md`, then `implementation_plan.md` §1 (predictor honesty), §5 (predictions table + `api.trip_timeline` view), §7 Flow D + Flow F, §8 (M10 line), §9 (Predict states), §10 (Predict result card spec)._

## What M10 is

The first version of the **prediction surface** — the whole reason the app
exists per §1: "what time should I leave the house for an 8pm flight?"
M9 finished the data-collection side (logging + history); M10 turns the
collected data into answers. By the end:

1. The Predict tab is a real screen (`web/screens/predict.js`) with a form
   for direction + airport + vars + flight time.
2. Submit → `POST /api/predict` (the existing Bun skeleton at
   `services/predict/`) → runs the **percentile + filter-widening** logic
   spec'd in §7 Flow D.
3. The bun service queries `public.milestones` (joined to `public.trips`)
   for matching trips, computes per-trip durations, returns p50/p90 and
   sample_n. If `sample_n < 5`, it widens per the precedence
   `tsa → party → transit → bags → airport` and reports which filters
   were relaxed.
4. Result rendered hero-sized per §10:
   - **Leave by**: `flight_time - p90` (when N ≥ 5) or `flight_time - median`
     (when 1 ≤ N < 5)
   - **Comfortable**: p50 (only when N ≥ 5)
   - **Based on N trips.** + "Relaxed: TSA PreCheck, Party size." if
     widening was applied
   - **Distribution sparkline** + min/median/max so Nick can sanity-check
5. Every prediction is **persisted to `public.predictions`** so M13 can
   score `actual_duration - predicted_p90` after the user logs the
   matching trip.

After M10, the predictor is real. M11 ("first real trip") promotes the
whole stack against actual usage. M13 closes the calibration feedback
loop with the rows M10 writes.

## Starting state — what's already in place

### Database (no schema changes needed for M10)

- `public.predictions` exists per `db/init/01-schema.sql` lines 198-210.
  Columns: `id, predicted_at, direction, airport, filters jsonb,
  relaxed_filters text[], sample_n, predicted_p50 interval,
  predicted_p90 interval, actual_trip_id, actual_duration, scored_at`.
  Indexes: `(airport, direction)` and partial on `actual_trip_id`.
  M13 reads `actual_*` after a trip completes; M10 writes everything else.
- `api.predictions` view exposes the same columns to PostgREST.
- `api.trip_timeline` is a precomputed view of milestones + trip vars +
  kind labels in client_seq order — useful for the duration query if you
  want a one-row-per-milestone shape.
- M9 dataset: 231 legacy trips (115 arr / 116 dep) + 536 milestones,
  spanning 2017-08 → 2026-04. Bags/TSA on legacy = `'unknown'` — those
  trips contribute to widened cells but never to "Carry-on" or "Yes
  PreCheck" filters specifically.
- The active milestones for departure trips are
  `dep_in_transit, dep_at_airport, dep_bags, dep_security, dep_customs`;
  for arrivals, `arr_off_plane, arr_customs, arr_bags, arr_in_transit,
  arr_at_destination` (order_seq has gaps for arrivals — customs is 2,
  bags is 5).

### Backend

- **Bun predict service is wired and healthy.** `services/predict/src/index.ts`
  has `/api/predict/health` returning `{status:'ok',db:true}`. `POST
  /api/predict` returns 501 with a `not_implemented` body — replace this
  handler in M10. The pg client + role + secrets are all set up.
- **Caddy already proxies `/api/predict*` → `bun-predict:3001`** (see
  Caddyfile). Authelia gates the path. The predict service does **not** do
  its own auth — it trusts anything Caddy delivers.
- **DB role**: `predict_user` has SELECT on `public.trips`, `public.milestones`,
  `public.airports`, `public.addresses`, INSERT on `public.predictions`.
  No grants on `api.*` (it's read-only). The predict service writes the
  prediction row directly via the pg client.

### Frontend

- M7's `web/screens/log.js` has all the pieces M10's form will reuse:
  - `mountAirportPicker` (from `airport-picker.js`) — IATA picker, already
    M9-tested for both directions.
  - DST validation (`checkDstCode`, `checkDst`) — same logic the trip-start
    sheet uses for `sched_dep_local + tz`.
  - Toggle group HTML pattern (bags/party/transit/tsa/international).
  - The `cryptoRandomId()` helper.
  - `formatLocalTime` for tz-aware display.
- `web/screens/placeholder.js` still has `predictScreen` rendering a
  "planned" tag. Drop it; replace with the real screen module wired in
  `app.js`.
- `web/api.js` (`api.get`) is the right primitive for issuing
  `POST /api/predict` directly — predictions are **not** queued through
  the outbox. They're synchronous, request/response, and the user is
  staring at the screen. Add an `api.predict(body)` helper that calls
  `fetchJSON('POST', '/predict', body)` and throws on failure (or follow
  the brief's preferred shape — see "Locked design decisions" below).
- Sync strip + queue from M8 are unaffected.

### Tooling

- `bun run qa <cmd>` — Playwright driver, see `scripts/qa.ts`. M10 doesn't
  need new subcommands.
- `docker compose logs -f bun-predict` to tail the predict service while
  iterating. After editing `services/predict/src/index.ts`, rebuild:
  `docker compose up -d --build bun-predict`. The service has no
  hot-reload — rebuild on every change.

## What to build

### 1. The duration query (the heart of M10)

For each candidate trip (matching the user's filters), compute one duration:
the elapsed time from the first logged milestone to the last. This is
intentionally tolerant of incomplete legacy trips (some only have 2
milestones) — duration is still meaningful so they contribute samples.

In SQL terms (illustrative — refine the `where` to match the filter set):

```sql
with per_trip as (
  select
    m.trip_id,
    extract(epoch from (max(m.logged_at) - min(m.logged_at))) as duration_s,
    count(*) as n_milestones
  from public.milestones m
  join public.trips t on t.id = m.trip_id
  where m.void = false
    and t.direction = $1
    and t.dep_airport = $2  -- or arr_airport for arrivals; see "Locked decisions"
    and ($3::text is null or t.bags = $3)
    and ($4::text is null or t.party = $4)
    and ($5::text is null or t.transit = $5)
    and ($6::boolean is null or t.tsa_precheck = $6)
    -- t.status in ('complete','abandoned') — exclude in_progress so you
    -- don't catch the user's own active trip mid-flight
    and t.status != 'in_progress'
  group by m.trip_id
  having count(*) >= 2  -- need ≥2 milestones for a duration
)
select
  count(*)::int as sample_n,
  percentile_cont(0.50) within group (order by duration_s) as p50_s,
  percentile_cont(0.90) within group (order by duration_s) as p90_s,
  min(duration_s) as min_s,
  max(duration_s) as max_s,
  array_agg(duration_s order by duration_s) as durations
from per_trip;
```

The `array_agg` is for the sparkline/histogram. Cap it client-side if the
list grows past, say, 200.

### 2. Widening loop

Per Flow D and §1: "the predictor shows the tightest filter with N ≥ 1
and widens from there." Concretely:

```ts
const tightenedFilters = ['tsa_precheck', 'party', 'transit', 'bags', 'airport'];
// Rightmost is the LAST to drop. The plan's order names the precedence
// of which to drop FIRST (TSA), so reverse this list to get drop order.

const dropOrder = ['tsa_precheck', 'party', 'transit', 'bags']; // never drop airport
let relaxed: string[] = [];
let result = await query(filters);
while (result.sample_n < 5 && dropOrder.length > 0) {
  const next = dropOrder.shift()!;
  filters[next] = null;       // null = "any"
  relaxed.push(next);
  result = await query(filters);
}
```

**Decision call needed (see §"Suggested opening question"):** does
`airport` ever relax? The plan §7 lists it last in the precedence string
but never explicitly says it drops. Two reasonable reads:

- **A. Never drop airport** — predictions are airport-specific by
  definition. If LGA has zero data, the answer is "log a trip to start
  predicting" (sample_n=0 result card). This is the conservative call.
- **B. Drop airport as a last resort** — when N=0 even after relaxing all
  vars, fall through to "all airports" as a desperation shot, named in
  the relaxed list. Honest about the underlying weakness.

My lean: **A**. Cross-airport averages mislead more than they help (LGA
security ≠ JFK security). Surface the empty state instead.

### 3. Result classification (per §1 + Flow D)

```ts
if (sample_n === 0) {
  return { kind: 'empty', sparkline: null };
}
if (sample_n < 5) {
  return { kind: 'low_n', leave_by_offset_s: median_s, sample_n, relaxed };
}
return { kind: 'full', leave_by_offset_s: p90_s, comfortable_offset_s: p50_s, sample_n, relaxed, distribution: { min_s, p50_s, p90_s, max_s, durations } };
```

The frontend renders three different cards from these three shapes.

### 4. Persist the prediction row

After computing, INSERT into `public.predictions`:

```ts
await sql`
  insert into public.predictions
    (direction, airport, filters, relaxed_filters, sample_n, predicted_p50, predicted_p90)
  values (
    ${direction}, ${airport}, ${jsonb(filters)}, ${relaxed},
    ${sample_n},
    ${p50_s ? `${Math.round(p50_s)} seconds` : null}::interval,
    ${p90_s ? `${Math.round(p90_s)} seconds` : null}::interval
  )
  returning id
`;
```

`filters` is the **post-widening** filter set (i.e. what was actually
queried). The original user input lives in the relaxed_filters delta
(if you reconstruct: original = post + relaxed). M13 reads these rows
when the user logs a matching trip.

### 5. Predict screen (`web/screens/predict.js`)

- Form (mirrors trip-start sheet shape — read `web/screens/log.js`'s
  `openDepStartSheet` for the toggle-group + airport-picker patterns):
  - Direction toggle (Departure / Arrival)
  - Airport picker (single airport — for departures it's the dep airport;
    for arrivals, the airport you'll land at)
  - Bags / Party / Transit / TSA / International toggles
  - Flight time + date — DST-validated via the existing helpers
- Submit → `api.predict({ direction, airport: iata, bags, party, transit,
  tsa_precheck, international, flight_time_local: '19:00',
  flight_date_local: '2026-04-25' })`
- Render the result card per §10:
  - **Leave by**: `flight_time - p90` formatted as a local clock time +
    a duration label ("3h 10m before flight"). 64pt accent.
  - **Comfortable**: `flight_time - p50`, 32pt muted (only if N ≥ 5).
  - **Based on N trips.** + "Relaxed: …" line.
  - **Sparkline** (60pt tall) + min/median/max labels.
  - Empty/low_n/full states have distinct copy.

### 6. Wire the route + tab

- `app.js`: replace the `predictScreen` placeholder import with the real
  `predictScreen` from `./screens/predict.js`. The tab bar already has
  the Predict tab wired (M6).
- `web/screens/placeholder.js` becomes empty or gets deleted.

## Locked design decisions

- **Bun service, not PostgREST RPC.** Per the plan's review (line 36),
  PostgREST can't cleanly express N<3 filter-widening as a stored
  procedure invocation. The Bun service is the right abstraction.
- **Predictions are NOT queued through the M8 outbox.** They're
  request/response; the user is waiting on the result. `api.get`-style
  direct call. Persisting the prediction row is a side-effect of the
  service, not the client.
- **Duration = first → last logged milestone of each candidate trip.**
  Tolerant of incomplete legacy data. Excludes in_progress trips.
- **`HAVING count(*) >= 2`** — a trip with one milestone has no
  duration; skip it.
- **Excluded statuses**: `in_progress` (the user's own active trip
  shouldn't influence their own prediction). Include `complete` and
  `abandoned`. (Abandoned trips often still have meaningful partial
  durations — and the user explicitly chose to abandon, the data is
  honest.) If Nick says abandoned trips poison the data, exclude them
  too — easy switch.
- **Airport never drops** (lean A above) unless Nick says otherwise at
  kickoff.
- **Time math**: durations stored as Postgres `interval`. The wire format
  to the frontend should be **seconds** (number) — easier to work with in
  JS than ISO 8601 P-T-H-M strings.
- **flight_time + flight_date are `local` to the airport's tz** — same
  convention as M7. The predict service derives the UTC instant via the
  airport's tz from `public.airports`, then subtracts the offset to
  compute "leave by" wall-clock time at the dep airport.

## Known small things M10 needs to handle

- **Legacy trips have `bags='unknown'` and `tsa_precheck=false` but the
  PreCheck value is meaningless** (data wasn't captured historically).
  The widening order drops TSA first for a reason — it's the fastest to
  relax to recover legacy samples. Don't filter `tsa_precheck=false`
  literally against legacy rows expecting precision.
- **The `bags='unknown'` rows match neither `'carry_on'` nor `'checked'`
  filters.** That's by design — the user explicitly chose carry-on /
  checked, and unknown trips can't honestly contribute. They DO show up
  once `bags` is dropped (relaxed widening).
- **Trips with `direction='arrival'` have BOTH `dep_airport` and
  `arr_airport` set** (M9 confirmed: 115/115 legacy arr trips have both).
  For arrival predictions, filter on `arr_airport` (where you're
  landing). For departure predictions, filter on `dep_airport`.
- **Sparkline at small N is misleading.** When `sample_n < 5`, render
  no sparkline — just the median + "based on N trips" line.
- **DST validation** belongs to the form, not the service. Reuse
  `checkDstCode` from `log.js` (or extract to a shared `web/dst.js` if
  it gets used a third time).
- **Airport tz lookup**: the service should join `public.airports` to
  resolve the IATA's tz once per request (cache or inline). The frontend
  also needs it — pass it back in the response so the result card can
  format "leave by" in the airport's local time without a second
  `api.airports` call.
- **Concurrent predictions race for sparkline data.** A slow query +
  fast tap could render a stale result card. Track an in-flight
  request id; ignore late responses.
- **`predictions.actual_*` columns stay null for now.** M13 fills them.

## What NOT to do in M10

- **Don't build the calibration view.** That's M13. M10 just writes the
  prediction rows.
- **Don't queue predictions through the M8 outbox.** Synchronous call;
  if offline, show "Can't predict offline — try again on WiFi" rather
  than queueing.
- **Don't add a `widening_path` audit column.** The plan's
  `relaxed_filters text[]` already covers this — order doesn't matter
  for calibration.
- **Don't try to predict the duration of individual milestone gaps**
  (in_transit→at_airport, etc.). That's interesting but out of scope —
  v1 is whole-trip duration. Per-segment predictions add UI complexity
  the user didn't ask for.
- **Don't auto-link a prediction row to a future trip.** M13 will do
  the matching by `(direction, airport, filters)` proximity. M10's job
  is just to write the row honestly.

## Deliverables

1. **`services/predict/src/index.ts`** — replace the 501 stub with the
   real handler. Pull request body, validate, query, widen, write
   prediction row, return result.
2. **`web/screens/predict.js`** — form + result card + sparkline.
3. **`web/api.js`** — add a thin `api.predict(body)` helper (synchronous
   POST; throws on failure).
4. **`web/app.js`** — wire `/predict` route to the real screen.
5. **`web/screens/placeholder.js`** — delete (or stub for future tabs).
6. **`web/style.css`** — predict result card hero size + sparkline +
   relaxed-filters hint styles.
7. **STATUS update** at end. Per-feature commits matching the M6/M7/M8/M9
   pattern.
8. **Live verification**: pick a real LGA dep with bags=carry_on against
   the legacy data, run the prediction, sanity-check the p90 against the
   timeline view of an old trip. Then run a query with TSA=Yes (likely
   N=0 since legacy is all `false`/`unknown`) and verify it widens
   correctly with "Relaxed: TSA PreCheck."

## Suggested opening question

> Two calls before I architect:
> 1. **Does airport relax as a last resort, or never?** My lean: never
>    (cross-airport averages mislead). Confirm or override.
> 2. **Are abandoned trips included in the sample?** My lean: yes
>    (their partial durations are honest data). Confirm or override.
