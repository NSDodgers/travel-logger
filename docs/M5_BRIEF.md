# M5 brief — historical data import

_Starting point for a fresh chat session. Read this, then `STATUS.md`, then `implementation_plan.md`._

## What M5 is

Nick has years of airport-milestone data stored across **multiple, possibly messy sources**. M5 inventories them, picks what's worth importing, transforms each source to the new schema, and bulk-loads with `source='legacy'`. After M5, the predictor has historical data to work with on day one instead of waiting a year for fresh data to accumulate.

## Why it's its own session

Per Nick at end of M4: _"I'm expecting to answer a lot of questions about my previous data because it is stored in LOTS of different places."_ This phase is structured Q&A, not code-first. Burning M4's session context on it was wasteful — hence the handoff.

## What you (future Claude) should do first

**Do NOT start coding. Start with inventory.**

Ask Nick to list every place airport-milestone data might live, including:

- The current Google Sheet (`Departures` + `Arrivals` tabs written by the legacy `app_script.js` — already in the repo as historical reference)
- Older versions of that Sheet (different column layouts? different timestamps?)
- Apple Shortcuts history or run-logs (the one in `shortcut.json` / `shortcut.bplist`)
- Scriptable app local data (before it was wired to the Sheet)
- Apple Calendar entries he manually created around flights
- Email: flight confirmations, boarding pass times, Uber/Lyft receipts that bracket airport arrival
- Apple Wallet pass scan events (these have authoritative through-security timestamps)
- Photos with location metadata at airports (can bracket dwell times)
- Health app: "time at location" logs for airport geofences
- Personal notes: Apple Notes, journaling apps, Day One

Nick doesn't need to list them all upfront. Ask what comes to mind first, then use the answers to surface adjacent sources he may have forgotten.

## Target schema reminder

```sql
-- trips: one row per direction (dep OR arr), single leg
public.trips (
  id uuid, direction ('departure'|'arrival'),
  address_id, dep_airport, arr_airport, actual_arr_airport,
  sched_dep_local time, sched_arr_local time,
  sched_dep_date date, sched_arr_date date,
  dst_warning, bags ('checked'|'carry_on'|'unknown'),
  party ('solo'|'family'), transit ('car'|'public'),
  tsa_precheck boolean, status, source ('app'|'legacy'), ...
)

-- milestones: one row per tapped event
public.milestones (
  id, trip_id, kind (FK to milestone_kinds: dep_in_transit, ...),
  logged_at timestamptz UTC, client_seq int, void, void_reason, ...
)
```

**Full 8 milestone kinds:** `dep_in_transit`, `dep_at_airport`, `dep_bags`, `dep_security`, `arr_off_plane`, `arr_bags`, `arr_in_transit`, `arr_at_destination`.

## Known starting constraints

- Variables that didn't exist in legacy data (`bags`, `tsa_precheck`) will be `'unknown'` / `false` on import. Flag this in the predictor's filter-widening so legacy rows get down-weighted appropriately — that's M10's concern, not M5's.
- Timestamps in legacy data are probably local-time strings in the originating airport's tz. Need to convert to UTC for `logged_at` using the seeded `airports.tz` join.
- Missing milestones are normal — old trips often logged only 2-3 of the 8 kinds. Don't fabricate.
- Duplicate trips across sources (e.g. same flight in Sheet and in email) need deduping. Tie-break by fewest missing milestones → most recent timestamp → first seen.

## What to produce at end of M5

1. **A `docs/M5_INVENTORY.md`** describing each data source found, its format, and the decision (import / skip / partial).
2. **A set of `imports/*.csv` or `imports/*.json`** with the raw source data (gitignored — that's Nick's personal data).
3. **A transform script at `db/seeds/import-legacy.ts`** that reads the `imports/` directory, normalizes to the schema, emits SQL.
4. **A one-shot loader at `scripts/load-legacy.sh`** that runs the transform + inserts into Postgres.
5. **A verification query**: trip counts per year, per airport, per source — to confirm the import looks sane.
6. **Commits per source** — each data source gets its own commit so we can bisect if one transform turns out wrong.

## What NOT to do in M5

- Don't modify the active schema. New columns go through proper migrations with a review.
- Don't touch the predictor code (that's M10). The import is raw data only.
- Don't try to be clever about inferring `bags` or `tsa_precheck` from context. "Unknown" is the right answer.
- Don't delete anything from the current Google Sheet until every legacy trip is verified in Postgres.

## Suggested opening question for the next session

> What are all the places airport-milestone data for your trips might live — even weird ones? I want an inventory before we write any transform. Start with what comes to mind first; I'll ask probing follow-ups.
