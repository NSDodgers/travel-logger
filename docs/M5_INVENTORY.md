# M5 inventory — historical data sources

_Source of truth for which legacy data sources get imported, which get skipped, and what transform rules apply. Assembled during the M5 session on 2026-04-24._

Related docs: [`M5_BRIEF.md`](./M5_BRIEF.md) sets the goal; [`M5_QUIZ.md`](./M5_QUIZ.md) resolves per-trip ambiguities.

---

## Sources identified

### 1. `imports/2017 - 2022 data` (narrative text file)

- **Format**: plain English, two sections ("Home to airport" / "Airport to home"), 59 entries total
- **Date range**: 2017-08-02 → 2022-08-12
- **Fidelity varies**:
  - 2017–2020: mostly start + end timestamps, occasional duration only
  - Feb 2021 onward: per-milestone timestamps (alarm, car, bag drop, TSA, customs, off-plane, in-car, at-apartment)
- **Decision**: **IMPORT (primary milestone source for every trip it covers)**

### 2. `imports/april 22 - feb 21.csv` (early Google Sheet — manual)

- **Format**: tabular CSV with explicit ORIGIN/DESTINATION/STEP NAME columns
- **Coverage**: 6 trip blocks, 2/13/21 → 4/25/22 (all dates affected by the 2021→2022 year typo per narrative cross-ref)
- **Status**: **REDUNDANT** — every trip overlaps the narrative file (A20-A25). Used as cross-validation only.

### 3. `imports/Travel Timing Bronx - NYC to Airport.csv` (Bronx-era Google Sheet)

- **Format**: tabular CSV, looser fields than #2; per-trip blocks separated by blank rows
- **Coverage**: ~50 trip blocks, 2022-12-19 → 2026-02-12 (Bronx home era)
- **Date format inconsistencies**: `YYYY.MM.DD`, `YYYY.M.DD`, `MM.DD.YYYY` mixed
- **Decision**: **IMPORT (primary milestone source for every trip it covers)**

### 4. `imports/Travel Timing Inwood - Departures.csv` and `imports/Travel Timing Inwood - Arrivals.csv` (current Google Sheet — automated template)

- **Format**: structured CSV with TRUE/FALSE flags + timestamps + computed durations per column
- **Coverage**: 3 trips each (departure + arrival sheets), 2026-04-12 → 2026-04-21 (4778 Broadway / Inwood era)
- **Decision**: **IMPORT (primary milestone source)**

### 5. `imports/FlightyExport-2026-04-24.csv` (Flighty app export)

- **Format**: 33-column CSV
- **Total rows**: 151 flights, 2009-10-09 → 2026-04-27
- **Coverage gap**: zero rows 2012–2018
- **Usage note**: Nick didn't fully use Flighty until after 2020 — pre-2021 rows are partially backfilled and should be treated as supplementary, not authoritative
- **Timezone convention**: each timestamp is in its corresponding airport's local tz (no UTC offset stored). UTC conversion on import via `airports.tz` join.
- **Decision**: **IMPORT FOR ENRICHMENT (flight-level fields only, for trips that also appear in another source's milestones)**

### 6. Apple Calendar + Gmail (reactive)

- **Format**: iCal / email confirmations
- **Decision**: **REACTIVE** — not pulled wholesale. Consulted by Nick per-trip when ambiguities surface (missing destination, missing anchor time, etc.). Resolutions captured in `M5_QUIZ.md`.

---

## Addresses (for `addresses` table)

| # | Address | Role | From | To |
|---|---|---|---|---|
| 1 | 700 W 192nd St, New York NY 10040 | residence | 2013-05-20 | 2022-11-27 |
| 2 | 108 N State St, Chicago IL 60602 | temp stay (Chicago 1) | 2022-02-07 | 2022-04-06 |
| 3 | 210 Victoria St, Toronto ON M5B 2R3 | temp stay (Toronto) | 2022-04-10 | 2022-06-20 |
| 4 | Vogelsanger Str. 206, 50825 Köln, Germany | temp stay (Köln) | 2022-09-07 | 2022-10-28 |
| 5 | 445 W 240th St, Bronx NY 10463 | residence | 2022-11-28 | 2026-02-15 |
| 6 | 88 Ames St, Cambridge MA 02142 | temp stay (Boston) | ~2023-05 | ~2023-05 |
| 7 | 60 E Randolph St, Chicago IL 60601 | temp stay (Parkline) | ~2024-04 | ~2024-04 |
| 8 | 369 W Grand Ave, Chicago IL 60654 | temp stay (Chicago 3) | ~2024-08 | ~2024-08 |
| 9 | 1140 N Wells St, Chicago IL 60610 | temp stay (Level Old Town) | ~2026-04 | ~2026-04 |
| 10 | 4778 Broadway, New York NY 10034 | residence (current) | 2026-02-16 | — |
| 11 | 6246 E Monita St, Long Beach CA 90803 | mother-in-law (recurring visit) | permanent | — |
| 12 | 619 Andover Dr, Burbank CA 91504 | mother (recurring visit) | permanent | — |
| 13 | 1650 N Halsted St, Chicago IL 60614 | Steppenwolf (recurring work venue) | permanent | — |
| 14 | 64 Brattle St, Cambridge MA 02138 | American Repertory Theater (recurring work venue) | permanent | — |

All 14 addresses populated by at least one trip across the 5 import sources. Other venues (Jacobs theater, Mirvish theater, Marquee at Block 37, Chicago Palace, NYU 721 Broadway, hotels like Omni / Kimpton / Allegro / Hampton Inn) are referenced in narratives but **not stored** — trips with these as origin/destination get `address_id=NULL`.

### Date typos corrected during import

All resolved via Flighty / email cross-reference:

| Narrative date | Actual flight date | Evidence |
|---|---|---|
| `2/7/21` (A19) | 2022-02-07 | Flighty DAL 451 LGA T-D → ORD T2 |
| `2/13/21` (A20) | 2022-02-13 | Flighty DAL 564 LGA T-D → ORD T2 |
| `2/28/21` (A21) | 2022-02-28 | Flighty DAL 451 LGA T-0 → ORD diverted to DTW |
| `5-7-23` (B21) | 2022-05-07 | Flighty ACA 8970 YYZ T1 → LGA T-B |
| `12/28/18` (B4) | 2018-12-16 | Melbourne return VA 6668 LAX T2 → JFK T4 |
| `8/18/17` (B1) | 2017-08-17 | DL 2262 landing at 10:46pm with after-midnight home arrival |
| `7/13/18` (B6) | 2018-07-12 | DY 7196 landing 9pm, home at 1:30am next day |
| `08-30-21` (B14) | 2021-08-29 | DL 328 overnight with takeoff at 01:11 EDT |

**General rule:** trip row date = **flight date** (departure date per Flighty / email), not narrative write-up date. Narratives written after midnight home arrivals get dated to the next day in Nick's notes but the flight was prior day.

---

## Source-of-truth rules by era

| Era | Flight-level source | Milestone source |
|---|---|---|
| 2009–2016 | skipped | skipped |
| 2017–2018 | narrative (best-guess) | narrative |
| 2019–2020 | narrative primary, Flighty supplementary | narrative |
| 2021–2022 | Flighty authoritative | narrative |

**Skipped from import:**
- 2009–2011 Flighty backfill (18 flights)
- Flighty-only trips 2019+ (narrative is the spine)

---

## Schema additions required

Two schema changes land via a single reviewed migration before the M5 import script runs:

### New milestone kinds

- `dep_customs` — departure-side border clearance (e.g. US preclearance at Pearson)
- `arr_customs` — arrival-side border clearance at destination

When a single border crossing has multiple sequential events logged (e.g. 04-13-22 "through customs 11:10" + "through work permit 12:00"), use the **last** timestamp — "fully cleared" wins.

### Party enum expansion

Replace `party ('solo'|'family')` with three values: `'solo' | 'group_with_kids' | 'group_without_kids'`.

Rationale: two-way split couldn't distinguish "traveled alone with spouse" (no stroller, no kid dynamics) from "traveled with a 6-month-old" (stroller gate check, gate-check carry-on, etc.). The predictor needs three-way granularity.

---

## Transform rules

### Universal 2-row rule — every flight becomes two trip rows

**Every flight that appears anywhere in the narrative file generates one `direction='departure'` and one `direction='arrival'` trip row**, even when only one side has milestone coverage. The missing-leg row still captures flight data (flight number, sched times, airports) from Flighty / email; it just has no milestones and may have `address_id=NULL` on the unknown end.

- Dual-leg narrative entries (detailed home → security → flight → off-plane → apartment) → both rows get milestones from narrative
- Departure-only narrative entries (A1–A18) → departure row has milestones; arrival row has flight data only
- Arrival-only narrative entries (B1–B15) → arrival row has milestones; departure row has flight data only

Flighty-only trips (no narrative anywhere) are still skipped — narrative remains the spine.

### Low-fidelity synthesis

Entries with only a start + end time pair (most 2017–2020 entries) get two synthesized milestones at the endpoints — first kind (`dep_in_transit` or `arr_off_plane`) and last kind (`dep_security` or `arr_at_destination`). Intermediate kinds are NULL.

Entries with literally zero timestamps (8/2/17, 8/18/17 departures) need a calendar-derived anchor — see `M5_QUIZ.md`.

**No fidelity column is added.** The predictor (M10) infers fidelity from milestone count on the trip.

### Transit binary (`trips.transit`)

Schema is `'car' | 'public'`.

- `public`: A-train, LIRR, NJ Transit, AirTrain, UP Express, Toronto subway
- `car`: Lyft, Uber, yellow cab, Dial 7, Kid Car, car service, generic "cab"
- Mixed trips (e.g. `A→145th→cab`): classified by the **final leg** into the airport. Rationale: subway and car failure modes are different; the last-mile determines which dominates predictability.

### Milestone timestamp conventions

- **`dep_in_transit`** — first logged moment of leaving the origin address (e.g. "in car", "left apartment", anchor time if synthesized)
- **`dep_at_airport`** — when you first arrive at airport grounds. For multi-terminal airports (YYZ T1 → T3 via AirTrain), use the **first terminal** arrival time, not the final terminal.
- **`arr_in_transit`** — timestamp of the **first post-deplane transportation mode** (cab, UP Express, AirTrain). For YYZ arrivals, this is when you board the AirTrain, not when UP Express departs later.

### Terminal-trust rule

When the narrative and Flighty disagree on a terminal, **trust Flighty**. Flighty pulls from live airline data; the narrative is Nick's memory. Exceptions are noted per-trip when Nick has a specific reason to override.

### Party (`trips.party`)

Post-migration schema: `'solo' | 'group_with_kids' | 'group_without_kids'`.

- `group_with_kids` — any child present. "Kid Car" mentions, stroller gate check, explicit child names all trigger this.
- `group_without_kids` — adults only companion (pre-Leo trips with Nikki, trips with mom, etc.)
- `solo` — no companion mentioned.
- Default when narrative doesn't flag a companion: `solo`. Nick has said not to ask trip-by-trip about pre-2019 Nikki presence — just default to solo.

### Bags, TSA Precheck

- Legacy data did not track `bags` or `tsa_precheck` structurally. Import defaults: `bags='unknown'`, `tsa_precheck=false`.
- Flag for M10: legacy rows should be down-weighted when the predictor widens filters on these dimensions.

### Scheduled flight times

- 2021+: `sched_dep_local` / `sched_arr_local` come from Flighty's Gate Departure (Scheduled) and Gate Arrival (Scheduled) columns when a trip matches.
- 2017–2018: parse narrative "scheduled departure" strings where present; otherwise NULL.
- "Scheduled boarding" times — **dropped**; schema has no field for them.

### Timestamps → UTC

- Narrative timestamps are in each airport's local tz.
- Convert to UTC for `milestones.logged_at` using the seeded `airports.tz` join.
- For milestones that occur at/near the home address (before reaching the airport on departure, or after leaving on arrival), use the home airport's tz — or the home address's tz if the predictor needs finer granularity (not required for M5).

### Source tagging

Every imported row gets `trips.source='legacy'`.

### Dedup rule

Per brief: when the same trip appears in multiple sources, tie-break by fewest missing milestones → most recent timestamp → first seen. In this file's scope, Flighty and the narrative overlap by date + departure airport; a match is treated as the same trip (narrative contributes milestones, Flighty contributes flight data).

---

## Date typos resolved

| Written | Correct | Resolution method |
|---|---|---|
| `5-7-23` (in 2022 arrivals section) | `2022-05-07` | Flighty has 2022-05-07 ACA 8970 YYZ→LGA matching the narrative; 2023-05-07 in Flighty is an unrelated BOS→LGA flight, and the Toronto apartment had closed 11 months before |

Remaining typos (to resolve during quiz):
- `6/18/18` end time `10:4pam` — 10:40am or 10:04am?
- `4/25/22` "5:50p through tsa" embedded in an AM timeline — probably 5:50a
- `2/28/21` "6:40 boarding / 6:25 scheduled boarding" — ordering inverted

---

## What's produced at end of M5

1. ✅ This file (`docs/M5_INVENTORY.md`)
2. ⏳ `docs/M5_QUIZ.md` — per-trip Q&A
3. ⏳ Migration adding `dep_customs` + `arr_customs` milestone kinds
4. ⏳ `db/seeds/import-legacy.ts` — transform script
5. ⏳ `scripts/load-legacy.sh` — one-shot loader
6. ⏳ Verification queries (trip counts per year / airport / source)
7. ⏳ Per-source commits so transforms can be bisected
