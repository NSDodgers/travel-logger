# M5 quiz #2 — new CSV sources (Bronx + Inwood era)

_All trips in `imports/Travel Timing Bronx - NYC to Airport.csv` (Dec 2022 – Feb 2026) and `imports/Travel Timing Inwood - {Departures,Arrivals}.csv` (Apr 2026) parsed and cross-referenced against Flighty. ~50 trips total. Most resolve automatically — this quiz only asks about the genuine ambiguities. The narrative-file-era resolutions stay in `M5_QUIZ.md`._

Answer inline. "ok" or "✓" accepts my proposal as-is.

---

## Section 1 — Date corrections (Flighty disagrees with CSV date)

These are typos in the CSV; the underlying flight is in Flighty on a different date. Confirm the corrected date is right.

### Q1.1 — CSV `2024.04.27` Parkline → ORD
- CSV has 4/27 (depart Parkline 4:10 AM, sched dep 6 AM)
- Flighty has DAL 2934 ORD→LGA on **2024-04-28**, sched dep 6:00 AM
- Hypothesis: CSV typo, actual date 2024-04-28
- **OK to correct?**

### Q1.2 — CSV `2024.04.28` Home → LGA → Parkline
- CSV has 4/28 (8:30 PM sched dep)
- Flighty has DAL 2215 LGA→ORD on **2024-04-29**, sched dep 8:30 PM
- Hypothesis: CSV typo, actual date 2024-04-29
- **OK to correct?**

### Q1.3 — CSV `2024.08.25` LAX → Omni Hotel
- CSV has this entry under 8/25 alongside the 369 Grand Chicago → ORD → LGA → home trip — but you can't be in both places same day
- Flighty has DAL 738 JFK→LAX on **2024-12-05** sched arr ~6 PM PT, matching the Omni Hotel entry's "6:30 PM off plane"
- **The 2024.08.25 Omni Hotel entry is actually 2024-12-05, the arrival side of the NYU 721 Broadway → JFK → LAX trip.** Confirm?

### Q1.4 — CSV `2025.02.15` JFK T4 → home
- CSV says off plane 5:59 PM on 2/15
- Flighty has nothing for 2/15 but DAL 979 LAX→JFK on **2025-02-16** (sched dep 07:45 PT, sched arr ~16:00 ET — late arrival could be 5:59 PM ET)
- Hypothesis: CSV typo, actual date 2025-02-16
- **OK to correct?**

### Q1.5 — CSV `2025.02.07` (third entry) Kimpton Everly → LAX T3 dep
- The 2/7 block has THREE entries. Two fit DAL 713 JFK→LAX (outbound AM + arrival PM). The third entry "Kimpton Everly → LAX T3 dep at 6:36 AM" can't be 2/7 since you'd just arrived 1 PM.
- Likely the LAX→JFK return from this trip — but Flighty's DAL 979 on 2/16 has sched dep 07:45 PT, not 9:00 AM as narrative shows.
- **What's the actual date of this Kimpton → LAX departure?** (Likely 2/15 or 2/16 — your records?)

### Q1.6 — CSV `2025.07.14` (third entry) JFK → home
- The 7/14 block has THREE entries. Two fit DAL 1146 + DAL 301 (HPN→ATL→LAX, outbound to mom's house in Burbank). The third "JFK off plane 6:07 PM" can't be same day since you just landed at LAX at 6:52 PM.
- Likely a return trip from LA later. Closest Flighty match is DAL 958 LAX→JFK on **2025-08-12** (sched arr ~5:30 PM ET, narrative says off plane 6:07 PM ET — close fit).
- **The third 7/14 entry is actually the 2025-08-12 return?** Or a different date you remember?

### Q1.7 — CSV `2025.08.24` (third entry) JFK → home
- 8/24 has THREE entries. First two fit DAL 5654 LGA→BUF (outbound to BUF, arrival at Hampton Inn Buffalo). Third "JFK off plane 12:54 PM" can't be same day.
- Multi-leg trail in Flighty: BUF→FLL (8/28), FLL→NAS (8/28), NAS→JFK on **2025-08-30** sched arr ~1:30 PM ET. Matches "JFK off plane 12:54 PM" if landed early.
- **The third 8/24 entry is actually 2025-08-30, return from Bahamas?**

---

## Section 2 — Destination interpretations

### Q2.1 — CSV `2023.05.09` destination "ART"
- CSV says destination "ART", trip departs from LGA T-C, lands at 10:31 AM
- Flighty has DAL 2536 LGA→BOS for that date — so destination airport = BOS
- "ART" is likely **American Repertory Theater** (Loeb Drama Center, 64 Brattle St, Cambridge MA — adjacent to Harvard). Recurring theater work like Steppenwolf?
- **Two questions:** (a) confirm "ART" = American Repertory Theater; (b) want it tracked as a recurring work venue in `addresses` like Steppenwolf?

---

## Section 3 — AM/PM typo confirmations

These are clear typos within evening timelines. Confirm I should silently correct.

| CSV row | Written | Should be |
|---|---|---|
| 2023-02-16 arr | "9:16 AM Through customs" between 9:11 PM off plane & 9:31 PM bags | **9:16 PM** |
| 2023-08-19 dep | "6:34p Through security" (no space; ambiguous) | **6:34 PM** |
| 2023-07-20 arr | "9:31 AM Home" after 8:31 PM in car | **9:31 PM** |
| 2024-07-14 arr | "10:00 AM Bags collected" after 9:51 PM off plane | **10:00 PM** |
| 2024-07-14 arr | "10:15 AM In car" / "11:05 AM Home" similarly | **10:15 PM / 11:05 PM** |
| 2025-07-14 arr | "7:14 AM Bags collected" after 6:52 PM off plane | **7:14 PM** |
| 2025-07-14 arr | "7:25 AM In car" similarly | **7:25 PM** |
| 2025-12-09 arr | "4:24 AM At grand central" inside PM timeline | **4:24 PM** |
| 2025-12-21 dep | "7:00 AM At airport" after 6:42 PM in car | **7:00 PM** + entire arrival timeline shifts to PM |
| 2026-02-12 arr | "12:30 PM At home" after 12:06 AM in car (post-midnight) | **12:30 AM** (next day) |

**Q3.1:** OK to silently correct all of these as listed?

---

## Section 4 — Spreadsheet artifacts

### Q4.1 — Row 483-494 (multi-column copy-paste)
- Row 483 has the 2025-09-02 trip data in columns 1-5, then duplicated 4 more times across columns 6-10, 11-15, 16-20, 21-25
- Same for arrival rows 491-494 (with 2025-08-24 BUF data)
- These are stuck spreadsheet formulas. **OK to ignore columns 6-25 and use only columns 1-5?**

### Q4.2 — 2024-04-27 arrival ends at "marble hill train station"
- Narrative: LGA T-C → "marble hill train station" 11:30 AM (no "at home" milestone)
- Reasonable interpretation: you took a cab from LGA to Marble Hill train station, then commuter rail home. The cab drop-off is the last logged milestone.
- **OK to set `arr_at_destination=NULL` for this trip and treat 11:30 AM as `arr_in_transit` (cab drop)?**

---

## Section 5 — Terminal trust (Flighty disagreements)

### Q5.1 — 2024-04-01 Jacobs theater → "LGA terminal 1" (CSV) vs LGA T-C (Flighty DAL 675)
- CSV says LGA T1, Flighty says T-C
- Per terminal-trust rule: use Flighty (T-C). Confirm?

---

## Section 6 — Inferred address date ranges

These are inferred from first/last appearance in CSVs. Override with exact dates if you have them.

| Address | Inferred check-in | Inferred check-out |
|---|---|---|
| 88 Ames St, Cambridge MA (Boston) | 2023-05-07 | 2023-05-07 (1-trip stay; treat as single overnight or ongoing?) |
| 60 E Randolph St, Chicago (Parkline) | 2024-04-05 | 2024-05-16 (last departure; Chicago Palace Theater listed as origin May 16) |
| 369 W Grand Ave, Chicago | 2024-08-13 | 2024-08-25 (Marquee at Block 37 = arrival Aug 13; 369 W Grand = departure Aug 25 — same trip?) |
| 1140 N Wells St, Chicago (Level Old Town) | 2026-04-12 | 2026-04-21 (active during the Inwood-CSV trips) |

**Q6.1:** Are the inferred ranges right? Especially for Parkline (Apr 5–May 16) and 369 W Grand (Aug 13–25 same stay?), where the trips suggest extended/multiple stays.

---

## Section 7 — Same-day round trips

These are unusual but confirmed in Flighty. Flagging for sanity check:

- 2023-06-21: LGA→YYZ→LGA (Toronto day trip, public transit out, ACA 707 + ACA 8994)
- 2023-07-20: 6246 E Monita→LAX→JFK→home (one-way return, NOT round trip)
- 2024-01-06: same pattern (LAX→JFK same day, return-only)

**Q7.1:** Are these all correct as same-day or one-way returns? (Likely yes; just sanity-checking.)

---

# Summary of what's NOT in this quiz

The following resolved automatically from Flighty + CSV agreement and don't need your input:

- ~40 trips with clean Flighty matches (correct date, terminal, airline, sched times)
- All Inwood CSV trips (3 dep + 3 arr, all 2026-04 with clean Flighty matches)
- 6 trips in `april 22 - feb 21.csv` (already locked from narrative file as A20-A25)

Once you answer the ~12 questions above, all sources are ready for the parser.
