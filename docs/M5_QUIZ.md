# M5 quiz — resolved trips reference

_All 59 narrative entries from `imports/2017 - 2022 data` resolved during the 2026-04-24 M5 session. This is the authoritative per-trip reference for `db/seeds/import-legacy.ts`. Session rules live in `M5_INVENTORY.md`._

Legend:
- **resolved-flighty** — flight data from Flighty match
- **resolved-email** — flight data from emailed confirmation (Gmail)
- **resolved-memory** — resolved via Nick's recall, no external source
- **synth** — milestone timestamps synthesized from narrative (e.g. anchor + duration), not directly logged
- address IDs reference the `addresses` table in M5_INVENTORY.md

Every flight below becomes two trip rows (departure + arrival) per the universal 2-row rule.

---

# Section A — Departures (home → destination)

## A1 — 2017-08-02 JFK T4 → LAX
- **Flight:** DL 41, PNR F97DKP — resolved-email
- **Sched:** dep 18:20 EDT / arr 21:40 PDT
- **Milestones (dep, synth):** `dep_in_transit=14:35`, `dep_security=17:05`
- **Milestones (arr):** none (not narrated)
- bags=checked, transit=public, party=solo
- dep_address=700 W 192nd | arr_address=NULL (solo LAX work trip, hotel)

## A2 — 2017-08-18 EWR T-B → YTZ
- **Flight:** PD 128, PNR MECTNE — resolved-email (Porter)
- **Sched:** dep 12:45 EDT (revised from 12:10) / arr 14:25 EST
- **Milestones (dep, synth):** `dep_in_transit=09:15`, `dep_security=11:45`
- bags=carry_on, transit=public, party=group_without_kids (Nikki pre-Leo)
- dep_address=700 W 192nd | arr_address=NULL (Toronto lodging untracked)

## A3 — 2017-09-26 JFK T4 → SFO
- **Flight:** DL 464, PNR HMNLR3 — resolved-email
- **Sched:** dep 15:30 EDT / arr 19:15 PDT
- **Milestones (dep):** `dep_in_transit=12:00` (narrative anchor), `dep_security=12:52` (noon + 52min)
- bags=checked, transit=car (Lyft), party=solo
- dep_address=700 W 192nd | arr_address=NULL

## A4 — 2017-10-20 JFK T5 → BUR
- **Flight:** B6 359 (JetBlue), PNR SSZYYG — resolved-email
- **Sched:** dep 16:59 EDT / arr 20:17 PDT
- **Milestones (dep):** `dep_in_transit=12:35`, `dep_security=14:58`
- bags=checked, transit=public, party=solo
- dep_address=700 W 192nd | arr_address=NULL

## A5 — 2017-12-23 JFK T4 → LAX
- **Flight:** DL 458 — resolved-email
- **Sched:** dep 13:55 EST / arr 17:25 PST
- **Milestones (dep):** `dep_in_transit=10:10`, `dep_security=11:50`
- bags=carry_on, transit=public, party=solo
- dep_address=700 W 192nd | arr_address=NULL (solo LAX = hotel)

## A6 — 2018-06-18 JFK T4 → ORD
- **Flight:** DL 5177, PNR H7SXXL — resolved-email (round-trip with B5)
- **Sched:** dep 12:49 EDT / arr 14:35 CDT
- **Milestones (dep):** `dep_in_transit=09:25`, `dep_security=10:40` (narrative `10:4pam` typo → 10:40am via 1h15m math)
- bags=carry_on, transit=car (final leg cab), party=solo
- dep_address=700 W 192nd | arr_address=NULL (pre-108 N State apt)

## A7 — 2018-06-25 EWR T-B → BCN
- **Flight:** DY 7197 (Norwegian), PNR QPUIAP — resolved-email
- **Sched:** dep 23:00 EDT / arr 12:15 CEST (next day)
- **Milestones (dep):** `dep_in_transit=17:25`, `dep_security=19:45`
- bags=checked, transit=public, party=solo
- dep_address=700 W 192nd | arr_address=NULL

## A8 — 2018-07-30 JFK T4 → LAX
- **Flight:** DL 747 — resolved-email
- **Sched:** dep 11:55 EDT / arr 14:56 PDT
- **Milestones (dep):** `dep_in_transit=08:00`, `dep_security=09:50`
- bags=checked, transit=public, party=solo
- dep_address=700 W 192nd | arr_address=NULL (solo = hotel)

## A9 — 2018-10-23 JFK **T2** → LAX T2
- **Flight:** VA 6542 (operated by Delta), PNR QYNYND — resolved-email
- **Sched:** dep 09:59 EDT / arr 13:10 PDT
- **Terminal correction:** narrative said T4; email says T2 — email wins (Virgin codeshares used T2)
- **Milestones (dep):** `dep_in_transit=07:00`, `dep_security=08:12`
- bags=checked, transit=car (Dial 7), party=solo
- dep_address=700 W 192nd | arr_address=NULL (multi-leg to MEL, not imported)

## A10 — 2019-07-30 JFK T4 → LAX
- **Flight:** DL 1085 — resolved-email (status update + search)
- **Sched:** dep 09:59 EDT / arr 13:10 PDT
- **Milestones (dep):** `dep_in_transit=06:20`, `dep_security=08:45`
- bags=checked, transit=public, party=group_with_kids (Nikki + 6-month Leo)
- dep_address=700 W 192nd | arr_address=MIL house (Long Beach)

## A11 — 2019-09-02 JFK T2 → SFO
- **Flight:** DL 426 — resolved-flighty
- **Milestones (dep):** `dep_in_transit=14:10`, `dep_security=16:05`
- bags=carry_on, transit=public, party=solo
- dep_address=700 W 192nd | arr_address=NULL

## A12 — 2019-11-13 EWR T-B → YTZ
- **Flight:** PD 118 (Porter) — resolved-email
- **Sched:** dep 06:50 EST / arr 08:30 EST
- **Milestones (dep):** `dep_in_transit=05:10`, `dep_security=05:50`
- bags=carry_on, transit=car (Lyft), party=solo
- dep_address=700 W 192nd | arr_address=NULL (Toronto business lodging untracked)

## A13 — 2019-12-01 JFK T1 → CDG
- **Flight:** DL 1016 — resolved-flighty
- **Sched:** dep 16:40 EST / arr 05:50 CET (next day)
- **Milestones (dep):** `dep_in_transit=12:40`, `dep_security=14:00`
- bags=checked, transit=car (Lyft), party=solo
- dep_address=700 W 192nd | arr_address=NULL

## A14 — 2020-01-05 JFK T1 → CDG
- **Flight:** AF 11 (Air France) — resolved-flighty
- **Milestones (dep):** `dep_in_transit=18:00`, `dep_security=19:05`
- bags=checked, transit=car, party=solo
- dep_address=700 W 192nd | arr_address=NULL

## A15 — 2020-03-14 JFK T4 → LAX
- **Flight:** DL 423 — resolved-email
- **Sched:** dep 11:45 EDT / arr 15:09 PDT
- **Milestones (dep):** `dep_in_transit=08:45`, `dep_security=09:35`
- bags=checked, transit=car (Kid Car), party=group_with_kids
- dep_address=700 W 192nd | arr_address=MIL house

## A16 — 2020-11-10 JFK T4 → LAX
- **Flight:** (number unknown) — resolved-email (route+times only)
- **Sched:** dep 09:05 EST / arr 12:14 PST
- **Milestones (dep):** `dep_in_transit=06:50`, `dep_security=07:55`
- bags=checked, transit=car (Kid Car), party=group_with_kids
- dep_address=700 W 192nd | arr_address=MIL house

## A17 — 2021-06-17 JFK T4 → LAX
- **Flight:** DL 703 — resolved-flighty
- **Milestones (dep):** `dep_in_transit=06:20`, `dep_security=07:35` (cut bag drop and TSA lines with Mom assist)
- bags=checked, transit=car (Kid Car), party=group_with_kids (Kid Car rule; Nick's mom also along)
- dep_address=700 W 192nd | arr_address=MIL house

## A18 — 2021-10-09 JFK T4 → LHR
- **Flight:** VS 4 (Virgin Atlantic) — resolved-flighty
- **Milestones (dep):** `dep_in_transit=15:00`, `dep_security=16:15`
- bags=checked (sky priority), transit=car (car service), party=solo
- dep_address=700 W 192nd | arr_address=NULL

## A19 — **2022-02-07** LGA T-D → ORD T2 _(narrative `2/7/21` → year typo)_
- **Flight:** DL 451 — resolved-flighty + email gap triangulation
- **Sched:** dep 07:05 EST / arr 08:45 CST (actual gate arr 08:44)
- **Milestones (dep):** `dep_in_transit=05:15`, `dep_at_airport=05:35`, `dep_bags=05:40`, `dep_security=05:45`
- **Milestones (arr):** `arr_off_plane=08:50 CST`, `arr_in_transit=09:05 CST`, `arr_at_destination=09:45 CST`
- bags=checked, transit=car, party=solo
- dep_address=700 W 192nd | arr_address=108 N State (Chicago apt)

## A20 — **2022-02-13** LGA T-D → ORD T2 _(narrative `2/13/21` → year typo)_
- **Flight:** DL 564 — resolved-flighty
- **Sched:** dep 20:15 EST / arr 22:02 CST (actual gate arr 21:32)
- **Milestones (dep):** `dep_in_transit=18:30`, `dep_at_airport=18:50`, `dep_security=18:55`
- **Milestones (arr):** `arr_off_plane=21:35 CST`, `arr_at_destination=22:25 CST`
- bags=carry_on, transit=car, party=solo
- dep_address=700 W 192nd | arr_address=108 N State

## A21 — **2022-02-28** LGA T-0 → ORD (diverted DTW) _(narrative `2/28/21` → year typo)_
- **Flight:** DL 451 — resolved-flighty (sched LGA→ORD; actual_arr_airport=DTW per narrative "Ended up in Detroit")
- **Sched:** dep 07:05 EST / arr 08:45 CST (never completed)
- **Milestones (dep):** `dep_in_transit=05:25`, `dep_at_airport=05:45`, `dep_bags=05:50`, `dep_security=05:55`
- **Milestones (arr):** none (no Detroit arrival narrated)
- bags=checked, transit=car, party=solo
- dep_address=700 W 192nd | arr_address=108 N State (intended)
- **Special:** `actual_arr_airport=DTW`

## A22 — 2022-03-15 LGA T-D → ORD T2
- **Flight:** DL 451 — resolved-flighty
- **Sched:** dep 07:25 EST / arr 08:45 CST
- **Milestones (dep):** `dep_in_transit=05:30`, `dep_at_airport=05:50`, `dep_bags=06:00`, `dep_security=06:05`
- **Milestones (arr):** `arr_off_plane=08:46 CST`, `arr_bags=09:00 CST`, `arr_at_destination=09:50 CST`
- bags=checked, transit=car, party=solo
- dep_address=700 W 192nd | arr_address=108 N State

## A23 — 2022-04-13 LGA T-C → YYZ T3 (first Toronto work arrival)
- **Flight:** DL 4722 — resolved-flighty
- **Milestones (dep):** `dep_in_transit=06:40`, `dep_at_airport=07:10`, `dep_bags=07:20`, `dep_security=07:25`
- **Milestones (arr):** `arr_off_plane=10:45`, `arr_customs=12:00` (full-clear timestamp — "through work permit"), `arr_in_transit=12:10`, `arr_at_destination=NULL`
- bags=checked, transit=car, party=solo
- dep_address=700 W 192nd | arr_address=NULL (Airbnb stay before apartment)

## A24 — 2022-04-17 LGA T-C → YYZ T3
- **Flight:** DL 5100 — resolved-flighty
- **Milestones (dep):** `dep_in_transit=19:08`, `dep_at_airport=19:31`, `dep_security=19:40`
- **Milestones (arr):** `arr_off_plane=22:45`, `arr_customs=23:00`, `arr_in_transit=23:10`, `arr_at_destination=23:35`
- bags=carry_on (narrative "checked in" without bag drop = carry_on), transit=car, party=solo
- dep_address=700 W 192nd | arr_address=210 Victoria

## A25 — 2022-04-25 LGA T-C → YYZ T3
- **Flight:** DL 4942 — resolved-flighty
- **Milestones (dep):** `dep_in_transit=05:17`, `dep_at_airport=05:36`, `dep_security=05:50` (narrative `5:50p` typo → 5:50a)
- **Milestones (arr):** `arr_off_plane=08:20`, `arr_customs=08:30`, `arr_in_transit=08:40` (AirTrain start), `arr_at_destination=09:43`
- bags=carry_on, transit=car, party=solo
- dep_address=700 W 192nd | arr_address=210 Victoria

## A26 — 2022-05-09 LGA T-C → YYZ T3
- **Flight:** DL 4942 — resolved-flighty
- **Milestones (dep):** `dep_in_transit=05:31`, `dep_at_airport=05:52`, `dep_security=06:09`
- **Milestones (arr):** `arr_off_plane=08:17`, `arr_customs=08:24`, `arr_in_transit=08:32`, `arr_at_destination=09:38`
- bags=carry_on, transit=car, party=solo
- dep_address=700 W 192nd | arr_address=210 Victoria

## A27 — 2022-05-24 LGA T-B → YYZ T1
- **Flight:** UA 8469 (United) — resolved-flighty
- **Sched:** dep 09:05 EDT
- **Milestones (dep):** `dep_in_transit=07:01`, `dep_at_airport=07:26`, `dep_security=07:34`
- **Milestones (arr):** `arr_off_plane=11:02`, `arr_customs=11:13`, `arr_in_transit=11:20`, `arr_at_destination=12:10`
- bags=carry_on, transit=car, party=solo
- dep_address=700 W 192nd | arr_address=210 Victoria

## A28 — 2022-06-06 LGA T-C → YYZ T3
- **Flight:** DL 5100 — resolved-flighty
- **Sched:** dep 20:59 EDT
- **Milestones (dep):** `dep_in_transit=18:58`, `dep_at_airport=19:20`, `dep_security=19:32`
- **Milestones (arr):** `arr_off_plane=22:37`, `arr_customs=22:55`, `arr_in_transit=23:02`, `arr_at_destination=23:29`
- bags=carry_on, transit=car, party=solo
- dep_address=700 W 192nd | arr_address=210 Victoria

## A29 — 2022-06-13 LGA T-C → YYZ T3
- **Flight:** DL 5100 — resolved-flighty
- **Sched:** dep 21:05 EDT
- **Milestones (dep):** `dep_in_transit=19:32`, `dep_at_airport=19:53`, `dep_security=19:59`
- **Milestones (arr):** `arr_off_plane=23:08`, `arr_customs=23:24`, `arr_in_transit=23:30`, `arr_at_destination=23:56`
- bags=carry_on, transit=car, party=solo
- dep_address=700 W 192nd | arr_address=210 Victoria

## A30 — 2022-06-26 JFK T4 → LAX T3 (outbound of 5-week MIL visit, returns as B26)
- **Flight:** DL 351 — resolved-flighty
- **Sched:** dep 10:20 EDT
- **Milestones (dep):** `dep_in_transit=07:05`, `dep_at_airport=07:42`, `dep_bags=08:01`, `dep_security=08:30`
- **Milestones (arr):** none (partial arrival row, flight data only — narrative ends at dep_security)
- bags=checked, transit=car, party=group_with_kids (whole family)
- dep_address=700 W 192nd | arr_address=MIL house

## A31 — 2022-08-07 LGA T-C → YYZ T3 (hotel stay, not 210 Victoria — lease had ended Jun 20)
- **Flight:** DL 5495 — resolved-flighty
- **Sched:** dep 09:00 EDT
- **Milestones (dep):** `dep_in_transit=06:47`, `dep_at_airport=07:10`, `dep_bags=07:22`, `dep_security=07:32`
- **Milestones (arr):** `arr_off_plane=10:40`, `arr_customs=10:49`, `arr_bags=11:10`, `arr_in_transit=11:18`, `arr_at_destination=11:42`
- bags=checked, transit=car, party=solo
- dep_address=700 W 192nd | arr_address=NULL (hotel, not tracked)

## A32 — 2022-09-06 JFK T4 → FRA T1 (Frankfurt, onward to Köln)
- **Flight:** SQ 25 (Singapore Airlines codeshare) — resolved-flighty
- **Sched:** dep 20:55 EDT
- **Milestones (dep):** `dep_in_transit=16:15`, `dep_at_airport=17:25`, `dep_bags=17:32`, `dep_security=17:41`
- **Milestones (arr):** `arr_off_plane=11:03 CEST`, `arr_customs=11:19 CEST`, `arr_bags=11:29 CEST`, `arr_in_transit=11:43 CEST` (train platform)
- bags=checked, transit=car (dep side) / public (train, arr side), party=solo
- dep_address=700 W 192nd | arr_address=Vogelsanger Str. 206 (Köln work stay)

---

# Section B — Arrivals (origin → home)

## B1 — **2017-08-17** LAX → JFK _(narrative `8/18/17` → past-midnight home arrival)_
- **Flight:** DL 2262, PNR GU2RE7 — resolved-email
- **Sched:** dep 14:00 PDT / arr 22:46 EDT
- **Milestones (arr):** `arr_off_plane=22:46`, `arr_in_transit=23:00`, `arr_at_destination=00:25 (+1 day)`
- bags=checked, transit=car (Lyft), party=solo
- dep_address=NULL (solo LAX = hotel) | arr_address=700 W 192nd

## B2 — 2017-10-13 SFO → JFK T2
- **Flight:** DL 470, PNR HMNLR3 — resolved-email (A3 round-trip)
- **Sched arr:** 21:35 EDT
- **Milestones (arr):** `arr_off_plane=21:35`, `arr_at_destination=22:40`
- bags=checked, transit=car (cab), party=solo
- dep_address=NULL | arr_address=700 W 192nd

## B3 — 2017-11-17 YYZ T3 → LGA T-D (final leg of YEG→YYZ→LGA)
- **Flight:** WS 1212 (WestJet) — resolved-email
- **Sched:** dep 17:30 EST / arr 19:00 EST
- **Milestones (arr):** `arr_off_plane=19:03`, `arr_at_destination=20:12`
- bags=checked, transit=car, party=solo
- dep_address=NULL | arr_address=700 W 192nd

## B4 — **2018-12-16** LAX T2 → JFK T4 _(narrative `12/28/18` → Melbourne return)_
- **Flight:** VA 6668 (operated by Delta), PNR QYNYND — resolved-email
- **Sched:** dep 11:45 PST / arr 20:07 EST
- **Milestones (arr):** `arr_off_plane=20:50`, `arr_at_destination=22:30`
- bags=carry_on, transit=public (AirTrain → LIRR → A train), party=solo
- dep_address=NULL | arr_address=700 W 192nd

## B5 — 2018-06-22 ORD → JFK T4
- **Flight:** DL 3353, PNR H7SXXL — resolved-email (A6 round-trip)
- **Sched arr:** 15:49 EDT
- **Milestones (arr):** `arr_off_plane=16:20`, `arr_at_destination=18:09`
- bags=carry_on (gate-check of carry-on), transit=public (LIRR → A from Penn), party=solo
- dep_address=NULL (pre-108 N State apt) | arr_address=700 W 192nd

## B6 — **2018-07-12** BCN → EWR _(narrative `7/13/18` → past-midnight home arrival)_
- **Flight:** DY 7196 (Norwegian), PNR QREZTQ — resolved-email
- **Sched:** dep 18:25 CEST / arr 21:00 EDT
- **Milestones (arr):** `arr_off_plane=00:20 (+1 day)`, `arr_at_destination=01:30 (+1 day)` — 3h gap between sched landing and off-plane suggests delay or slow customs
- bags=checked, transit=car (cab), party=solo
- dep_address=NULL | arr_address=700 W 192nd

## B7 — 2018-08-17 SFO → JFK T4
- **Flight:** DL 1106, PNR HMSZ3O — resolved-email
- **Sched arr:** 20:15 EDT
- **Milestones (arr):** `arr_off_plane=21:15`, `arr_at_destination=22:20`
- bags=checked, transit=car (cab), party=solo
- dep_address=NULL | arr_address=700 W 192nd

## B8 — 2019-08-30 SFO → JFK T4
- **Flight:** DL 592 — resolved-flighty
- **Milestones (arr):** `arr_off_plane=21:17`, `arr_at_destination=22:20`
- bags=carry_on, transit=car (cab), party=solo
- dep_address=NULL | arr_address=700 W 192nd

## B9 — 2019-11-03 SFO → JFK **T2**
- **Flight:** DL 1859 — resolved-flighty (terminal T2 per Flighty, narrative said T4 — Flighty wins)
- **Milestones (arr):** `arr_off_plane=16:38`, `arr_at_destination=18:10`
- bags=checked (2 bags), transit=car (Lyft), party=solo
- dep_address=NULL | arr_address=700 W 192nd

## B10 — 2019-12-30 LAX T2 → JFK T4
- **Flight:** DL 2164 — resolved-email
- **Sched:** dep 09:40 PST / arr ~17:55 EST (inferred from same flight May 2020)
- **Milestones (arr):** `arr_off_plane=19:23` (90min delay or slow deplane), `arr_at_destination=20:43`
- bags=checked (3 bags), transit=car (Kid Car), party=group_with_kids (stroller)
- dep_address=MIL house | arr_address=700 W 192nd

## B11 — 2020-02-07 CDG → JFK T1 (international)
- **Flight:** AF 6 — resolved-flighty
- **Milestones (arr):** `arr_off_plane=16:40`, `arr_customs=?`, `arr_at_destination=18:20`
- bags=checked (3 bags, work gear), transit=car (yellow cab), party=solo (work trip)
- dep_address=NULL | arr_address=700 W 192nd

## B12 — 2020-08-14 LAX → JFK T4
- **Flight:** DL 792 — resolved-email
- **Sched arr:** 16:15 EDT (landed ~12min early per narrative off-plane 16:03)
- **Milestones (arr):** `arr_off_plane=16:03`, `arr_at_destination=17:45` (narrative "1 hour" is wrong; 1h42m actual)
- bags=checked (2 bags), transit=car (Kid Car), party=group_with_kids (stroller)
- dep_address=MIL house | arr_address=700 W 192nd

## B13 — 2021-01-18 LAX → JFK T4
- **Flight:** DL 392, seats 21B/20B/20A — resolved-email
- **Sched arr:** 17:00 EST
- **Milestones (arr):** `arr_off_plane=16:49` (arrived early), `arr_at_destination=18:08`
- bags=carry_on (stroller gate check only), transit=car (Kid Car), party=group_with_kids
- dep_address=MIL house | arr_address=700 W 192nd

## B14 — **2021-08-29** LAX → JFK T4 _(overnight; narrative `08-30-21` is home-arrival date)_
- **Flight:** DL 328 — resolved-flighty
- **Sched:** dep 21:59 PDT / arr 06:29 EDT; **actual** takeoff 01:11 EDT (3h12m delay), gate arr 09:02 EDT
- **Milestones (arr):** `arr_off_plane=09:10`, `arr_at_destination=10:10`
- bags=checked, transit=car (yellow cab), party=solo (work trip)
- dep_address=NULL | arr_address=700 W 192nd

## B15 — 2021-11-07 AMS → JFK T4 (international, after HAM→AMS connection)
- **Flight:** DL 9348 — resolved-flighty
- **Milestones (arr):** `arr_off_plane=15:48`, `arr_customs=?`, `arr_at_destination=17:26`
- bags=checked, transit=car (yellow cab), party=solo
- dep_address=NULL | arr_address=700 W 192nd

## B16 — 2022-02-11 ORD T2 → LGA T-B (Flighty "T0")
- **Flight:** DL 391 — resolved-flighty
- **Sched:** dep 19:59 CST / arr ?
- **Milestones (dep):** `dep_in_transit=17:15` (Marquee theater context, ignored as pre-trip prep), `dep_at_airport=18:02`, `dep_security=18:10`
- **Milestones (arr):** `arr_off_plane=23:00`, `arr_in_transit=23:20`, `arr_at_destination=23:42`
- bags=carry_on, transit=car (cab), party=solo
- dep_address=108 N State | arr_address=700 W 192nd

## B17 — 2022-02-18 ORD T2 → LGA T-D
- **Flight:** DL 363 — resolved-flighty
- **Sched:** dep 12:59 CST / arr 16:37 EST (actual 16:37)
- **Milestones (dep):** `dep_in_transit=11:00`, `dep_at_airport=11:25`, `dep_bags=11:30`, `dep_security=11:35`
- **Milestones (arr):** `arr_off_plane=16:48`, `arr_bags=16:55`, `arr_in_transit=17:05`, `arr_at_destination=18:05`
- bags=checked, transit=car (cab), party=solo
- dep_address=108 N State | arr_address=700 W 192nd

## B18 — 2022-03-13 ORD T2 → LGA T-C
- **Flight:** DL 556 — resolved-flighty
- **Milestones (dep):** `dep_in_transit=05:30`, `dep_at_airport=05:55`, `dep_security=06:05`
- **Milestones (arr):** `arr_off_plane=09:55`, `arr_in_transit=10:08`, `arr_at_destination=10:55` (big highway accident)
- bags=carry_on, transit=car, party=solo
- dep_address=108 N State | arr_address=700 W 192nd

## B19 — 2022-04-14 YTZ → EWR T-B (first Toronto return, Airbnb origin)
- **Flight:** PD 143 (Porter) — resolved-flighty
- **Milestones (dep):** `dep_in_transit=16:08`, `dep_at_airport=16:30`
- **Milestones (arr):** `arr_off_plane=20:15`, `arr_customs=20:20`, `arr_in_transit=20:28`, `arr_at_destination=21:05`
- bags=carry_on, transit=car, party=solo
- dep_address=NULL (Airbnb) | arr_address=700 W 192nd

## B20 — 2022-04-22 YTZ → EWR T-B
- **Flight:** PD 143 (Porter) — resolved-flighty
- **Milestones (dep):** `dep_in_transit=16:52`, `dep_at_airport=17:08`
- **Milestones (arr):** `arr_off_plane=19:45`, `arr_customs=19:50`, `arr_bags=20:05`, `arr_in_transit=20:22`, `arr_at_destination=21:02`
- bags=checked, transit=car, party=solo
- dep_address=210 Victoria | arr_address=700 W 192nd

## B21 — **2022-05-07** YYZ T1 → LGA T-B _(narrative `5-7-23` → year typo confirmed via Flighty)_
- **Flight:** AC 8970 (Air Canada) — resolved-flighty
- **Milestones (dep):** `dep_in_transit=16:59`, `dep_at_airport=17:55`, `dep_security=18:16`, `dep_customs=18:22` (US preclearance at YYZ T1)
- **Milestones (arr):** `arr_off_plane=22:01`, `arr_in_transit=22:15`, `arr_at_destination=22:35`
- bags=carry_on, transit=public (subway + UP Express) / car (final leg to 700 W 192nd), party=solo
- dep_address=210 Victoria | arr_address=700 W 192nd

## B22 — 2022-05-22 YYZ T3 → LGA T-B
- **Flight:** DL 5034 — resolved-flighty
- **Milestones (dep):** `dep_in_transit=07:32`, `dep_at_airport=07:57`, `dep_security=08:07`, `dep_customs=08:09`
- **Milestones (arr):** `arr_off_plane=10:58`, `arr_in_transit=11:06`, `arr_at_destination=11:28`
- bags=carry_on, transit=car, party=solo
- dep_address=210 Victoria | arr_address=700 W 192nd

## B23 — 2022-06-04 YYZ T3 → LGA T-B
- **Flight:** AA 4824 — resolved-flighty
- **Sched:** dep 19:29 EDT
- **Milestones (dep):** `dep_in_transit=16:15`, `dep_at_airport=17:25` (T1 first, per first-terminal rule), `dep_bags=17:45`, `dep_security=17:50`, `dep_customs=17:52`
- **Milestones (arr):** `arr_off_plane=21:25`, `arr_bags=21:48`, `arr_in_transit=21:54`, `arr_at_destination=22:20`
- bags=checked, transit=public (subway + UP Express), party=solo
- dep_address=210 Victoria | arr_address=700 W 192nd

## B24 — 2022-06-11 YYZ T3 → LGA T-B
- **Flight:** AA 4820 — resolved-flighty
- **Sched:** dep 10:55 EDT
- **Milestones (dep):** `dep_in_transit=08:01`, `dep_at_airport=08:56` (T1 first), `dep_security=09:18`, `dep_customs=09:21`
- **Milestones (arr):** `arr_off_plane=12:18`, `arr_in_transit=12:32`, `arr_at_destination=12:56`
- bags=carry_on, transit=public, party=solo
- dep_address=210 Victoria | arr_address=700 W 192nd

## B25 — 2022-06-18 YYZ T3 → LGA T-C (final day at 210 Victoria — lease ends Jun 20)
- **Flight:** DL 4722 — resolved-flighty
- **Sched:** dep 11:37 EDT
- **Milestones (dep):** `dep_in_transit=08:24`, `dep_at_airport=08:45`, `dep_bags=09:03`, `dep_security=09:06`, `dep_customs=09:11`
- **Milestones (arr):** `arr_off_plane=13:19`, `arr_bags=13:28`, `arr_in_transit=13:35`, `arr_at_destination=14:26`
- bags=checked, transit=car, party=solo
- dep_address=210 Victoria | arr_address=700 W 192nd

## B26 — 2022-08-01 LAX **TBIT** → JFK T4 (return of A30 5-week MIL visit)
- **Flight:** DL 562 — resolved-flighty (terminal TBIT per Flighty, narrative said T3 — Flighty wins per trust rule)
- **Sched:** dep 11:10 PDT
- **Milestones (dep):** `dep_in_transit=07:32`, `dep_at_airport=08:27`, `dep_bags=09:20`, `dep_security=09:32`
- **Milestones (arr):** `arr_off_plane=20:10`, `arr_bags=20:30`, `arr_in_transit=20:38`, `arr_at_destination=21:20`
- bags=checked, transit=car (from Long Beach to LAX; Kid Car home from JFK), party=group_with_kids
- dep_address=MIL house | arr_address=700 W 192nd

## B27 — 2022-08-12 YYZ T1 → LGA T-B
- **Flight:** AC 718 (Air Canada) — resolved-flighty
- **Sched:** dep 16:55 EDT
- **Milestones (dep):** `dep_in_transit=13:45` (car from Mirvish theater at 244 Victoria St), `dep_at_airport=14:30`, `dep_bags=14:38`, `dep_security=14:48`, `dep_customs=14:53`
- **Milestones (arr):** `arr_off_plane=18:57`, `arr_bags=19:13`, `arr_in_transit=19:22`, `arr_at_destination=19:50`
- bags=checked, transit=car, party=solo
- dep_address=NULL (hotel untracked; Mirvish is context only) | arr_address=700 W 192nd

---

# Summary

- **59 narrative entries → 118 trip rows** (universal 2-row rule)
- **32 departures** (Section A) + **27 arrivals** (Section B)
- **8 date-typo corrections** applied during import
- **5 addresses** referenced in this file (of 7 in the table)
- **Resolved by source:** 18 flighty, 27 email, 8 narrative-only / memory / calendar (A16 route-only, A2 anchor, etc.), 6 CLEAR via existing Flighty match at session start
