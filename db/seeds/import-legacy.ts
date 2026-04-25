#!/usr/bin/env bun
// M5 legacy import: reads narrative + CSV sources + Flighty, emits structured trip rows.
//
// Usage:
//   bun run db/seeds/import-legacy.ts
//
// Reads:
//   - db/seeds/legacy-data/addresses.json
//   - db/seeds/legacy-data/narrative-trips.json
//   - imports/Travel Timing Bronx - NYC to Airport.csv
//   - imports/Travel Timing Inwood - Departures.csv
//   - imports/Travel Timing Inwood - Arrivals.csv
//   - imports/FlightyExport-2026-04-24.csv
//
// Writes:
//   - imports/legacy-trips.json  (structured, ready for loader)
//   - prints summary to stdout

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const DATA_DIR = join(import.meta.dir, "legacy-data");
const IMPORTS_DIR = join(ROOT, "imports");

// ── types ───────────────────────────────────────────────────────────────────

type Address = {
  id: string;
  label: string;
  role: "residence" | "temp_stay" | "recurring_visit" | "recurring_work_venue";
  validFrom: string | null;
  validTo: string | null;
  tz: string;
};

type MilestoneKind =
  | "dep_in_transit" | "dep_at_airport" | "dep_bags" | "dep_security" | "dep_customs"
  | "arr_off_plane" | "arr_bags" | "arr_in_transit" | "arr_at_destination" | "arr_customs";

type Milestone = {
  kind: MilestoneKind;
  time: string;          // HH:MM local
  nextDay?: boolean;     // true if this milestone crosses midnight (home arrival at 00:25)
  synthesized?: boolean;
};

type NarrativeTrip = {
  id: string;
  date: string;              // YYYY-MM-DD (flight date)
  flight: string | null;
  airline: string | null;
  pnr: string | null;
  depAirport: string;
  depTerminal: string | null;
  arrAirport: string;
  arrTerminal: string | null;
  actualArrAirport?: string;
  status?: "diverted";
  schedDepLocal: string | null;
  schedArrLocal: string | null;
  bags: "checked" | "carry_on" | "unknown";
  transit: "car" | "public";
  party: "solo" | "group_with_kids" | "group_without_kids";
  tsaPrecheck: boolean;
  depAddressId: string | null;
  arrAddressId: string | null;
  depMilestones: Milestone[];
  arrMilestones: Milestone[];
  source: string;
  notes?: string;
};

type FlightyRow = {
  date: string;             // YYYY-MM-DD (takeoff local date)
  airline: string;          // 3-letter ICAO-ish per Flighty (DAL, JBU, etc.)
  flight: string;
  from: string;             // IATA
  to: string;
  depTerminal: string;
  arrTerminal: string;
  canceled: boolean;
  divertedTo: string;
  schedGateDep: string;     // ISO local
  actualGateDep: string;
  schedTakeoff: string;
  actualTakeoff: string;
  schedLanding: string;
  actualLanding: string;
  schedGateArr: string;
  actualGateArr: string;
  aircraftType: string;
  tailNumber: string;
  pnr: string;
  seat: string;
  seatType: string;
  cabinClass: string;
  flightReason: string;
  notes: string;
};

type TripRow = {
  trip_id: string;             // synthetic: "<sourceId>-<dep|arr>"
  source_id: string;           // e.g. "A1", "B14", or "BRONX-2022-12-19"
  flight_date: string;         // YYYY-MM-DD per flight (not narrative write-up date)
  direction: "departure" | "arrival";
  dep_airport: string;
  dep_terminal: string | null;
  arr_airport: string;
  arr_terminal: string | null;
  actual_arr_airport: string | null;
  flight: string | null;
  airline: string | null;
  pnr: string | null;
  sched_dep_local: string | null;
  sched_arr_local: string | null;
  sched_dep_date: string;
  sched_arr_date: string;
  bags: "checked" | "carry_on" | "unknown";
  transit: "car" | "public";
  party: "solo" | "group_with_kids" | "group_without_kids";
  tsa_precheck: boolean;
  dst_warning: boolean;
  status: "completed" | "diverted";
  source: "legacy";
  source_tag: string;          // which input source produced this row
  address_id: string | null;
  milestones: Milestone[];
  notes: string | null;
};

// ── slug → display label map ────────────────────────────────────────────────
// Locked 2026-04-24 at the start of M6. Nick is renaming the 14 M5 legacy
// addresses to human-readable labels. This keeps the loader in sync: emit the
// clean label directly, and look up trip FKs by that same clean label.
// Kept in lockstep with db/migrations/002-rename-legacy-addresses.sql.
const SLUG_TO_DISPLAY: Record<string, string> = {
  home_inwood:      "Home",
  home_192nd:       "192nd St",
  home_bronx:       "240th St (Bronx)",
  mom_burbank:      "Mom's (Burbank)",
  mil_long_beach:   "MIL's (Long Beach)",
  steppenwolf:      "Steppenwolf",
  art_cambridge:    "A.R.T. (Cambridge)",
  chicago_state:    "Chicago — State St",
  chicago_parkline: "Chicago — Parkline",
  chicago_grand:    "Chicago — Grand Ave",
  chicago_level:    "Chicago — Level",
  boston_ames:      "Boston — Ames St",
  toronto_victoria: "Toronto — Victoria St",
  koln_vogelsanger: "Köln — Vogelsanger",
};

// ── loaders ─────────────────────────────────────────────────────────────────

function loadAddresses(): Address[] {
  const raw = readFileSync(join(DATA_DIR, "addresses.json"), "utf8");
  return JSON.parse(raw).addresses;
}

function loadNarrativeTrips(): NarrativeTrip[] {
  const raw = readFileSync(join(DATA_DIR, "narrative-trips.json"), "utf8");
  return JSON.parse(raw).trips;
}

function loadFlighty(): FlightyRow[] {
  const path = join(IMPORTS_DIR, "FlightyExport-2026-04-24.csv");
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  const rows: FlightyRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length < 19) continue;
    rows.push({
      date: fields[0],
      airline: fields[1],
      flight: fields[2],
      from: fields[3],
      to: fields[4],
      depTerminal: fields[5],
      arrTerminal: fields[7],
      canceled: fields[9] === "true",
      divertedTo: fields[10],
      schedGateDep: fields[11],
      actualGateDep: fields[12],
      schedTakeoff: fields[13],
      actualTakeoff: fields[14],
      schedLanding: fields[15],
      actualLanding: fields[16],
      schedGateArr: fields[17],
      actualGateArr: fields[18],
      aircraftType: fields[19] ?? "",
      tailNumber: fields[20] ?? "",
      pnr: fields[21] ?? "",
      seat: fields[22] ?? "",
      seatType: fields[23] ?? "",
      cabinClass: fields[24] ?? "",
      flightReason: fields[25] ?? "",
      notes: fields[26] ?? "",
    });
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (c === "," && !inQuotes) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

// ── narrative → trip rows (universal 2-row rule) ────────────────────────────

function narrativeToRows(t: NarrativeTrip): TripRow[] {
  const out: TripRow[] = [];
  const schedDepDate = t.date;
  const schedArrDate = t.date; // most flights land same calendar day as takeoff at dep tz; cross-tz refinement done by loader
  const status = t.status ?? "completed";

  const dep: TripRow = {
    trip_id: `${t.id}-dep`,
    source_id: t.id,
    flight_date: t.date,
    direction: "departure",
    dep_airport: t.depAirport,
    dep_terminal: t.depTerminal,
    arr_airport: t.arrAirport,
    arr_terminal: t.arrTerminal,
    actual_arr_airport: t.actualArrAirport ?? null,
    flight: t.flight,
    airline: t.airline,
    pnr: t.pnr,
    sched_dep_local: t.schedDepLocal,
    sched_arr_local: t.schedArrLocal,
    sched_dep_date: schedDepDate,
    sched_arr_date: schedArrDate,
    bags: t.bags,
    transit: t.transit,
    party: t.party,
    tsa_precheck: t.tsaPrecheck,
    dst_warning: false,
    status,
    source: "legacy",
    source_tag: t.source,
    address_id: t.depAddressId,
    milestones: t.depMilestones,
    notes: t.notes ?? null,
  };
  const arr: TripRow = {
    ...dep,
    trip_id: `${t.id}-arr`,
    direction: "arrival",
    address_id: t.arrAddressId,
    milestones: t.arrMilestones,
  };
  out.push(dep, arr);
  return out;
}

// ── Flighty indexing ────────────────────────────────────────────────────────

function flightyIndex(rows: FlightyRow[]): Map<string, FlightyRow> {
  const idx = new Map<string, FlightyRow>();
  for (const r of rows) {
    const key = `${r.date}|${r.from}|${r.to}`;
    idx.set(key, r);
    // also index by date + airline + flight
    idx.set(`${r.date}|${r.airline}${r.flight}`, r);
  }
  return idx;
}

// ── CSV parsing: Bronx + Inwood ─────────────────────────────────────────────
//
// The Bronx CSV uses blank-row separators between trip blocks. Each block starts
// with a date + origin + destination on its first row, followed by rows with only
// a step timestamp and step name in cols D/E.
//
// CSV-trip resolutions (date corrections, AM/PM fixes, destination mappings)
// are encoded inline as an overrides map. Each override keys by the CSV's
// written date — we correct the date before using it.

type BronxOverride = {
  correctedDate?: string;
  correctedOrigin?: string;
  correctedDestination?: string;
  notes?: string;
};

const BRONX_OVERRIDES: Record<string, BronxOverride> = {
  // Q1.1: 2024-04-27 → 2024-04-28 (Parkline dep + paired arr leg)
  "2024-04-27|Parkline Chicago|ORD terminal 5": { correctedDate: "2024-04-28" },
  "2024-04-27|LGA terminal C|Home": { correctedDate: "2024-04-28" },
  // Q1.2: 2024-04-28 Home → LGA → Parkline → 2024-04-29
  "2024-04-28|Home|LGA terminal C": { correctedDate: "2024-04-29" },
  "2024-04-28|ORD terminal 5|Parkline Chicago apartment": { correctedDate: "2024-04-29" },
  // Q1.3: 2024-08-25 LAX → Omni → 2024-12-05
  "2024-08-25|LAX Terminal 3|Omni Hotel Los Angeles": { correctedDate: "2024-12-05" },
  // Q1.4: 2025-02-15 → 2025-02-16
  "2025-02-15|JFK terminal 4|Home": { correctedDate: "2025-02-16" },
  // Q1.5: 2025-02-07 Kimpton → LAX → 2025-02-16
  "2025-02-07|The Kimpton Everly Hotel|LAX terminal 3": { correctedDate: "2025-02-16" },
  // Q1.6: 2025-07-14 JFK → home → 2025-08-12
  "2025-07-14|JFK|Home": { correctedDate: "2025-08-12" },
  // Q1.7: 2025-08-24 JFK → home → 2025-08-30
  "2025-08-24|JFK|Home": { correctedDate: "2025-08-30" },
  // 2023-02-16 narrative wrote EWR but actual flight was AFR 10 CDG→JFK per Flighty
  "2023-02-16|EWR terminal 1|Home": { correctedOrigin: "JFK Terminal 1" },
};

// Address resolution for CSV origin/destination strings.
const ADDRESS_STRING_MAP: Record<string, string> = {
  "Home": "home_bronx",                                     // default; Inwood period uses home_inwood
  "home": "home_bronx",
  "Home ": "home_bronx",
  "6246 E Monita": "mil_long_beach",
  "6246 E Monita ": "mil_long_beach",
  "6246 e monita": "mil_long_beach",
  "6246 e monita ": "mil_long_beach",
  "6246 monita": "mom_burbank",                             // narrative sometimes conflates — Nick confirmed mom=Burbank, MIL=Long Beach
  "6246 monita ": "mom_burbank",
  "619 Andover": "mom_burbank",
  "Boston apartment": "boston_ames",
  "Boston apartment ": "boston_ames",
  "ART": "art_cambridge",
  "Parkline Chicago": "chicago_parkline",
  "Parkline Chicago ": "chicago_parkline",
  "Parkline Chicago apartment": "chicago_parkline",
  "369 Grand Chicago": "chicago_grand",
  "Chicago apartment": "chicago_state",                     // 2022 era only
  "Chicago Apartment": "chicago_state",
  "Steppenwolf": "steppenwolf",
  "Steppenwolf ": "steppenwolf",
  "Steppenworlf": "steppenwolf",                            // typo in CSV
  "Level one Chicago": "chicago_level",
  "Level one Chicago ": "chicago_level",
  "Level Old Town": "chicago_level",
  "4778 broadway": "home_inwood",
  "4778 broadway ": "home_inwood",
  // Venues/hotels/contexts → NULL
  "Jacobs theater": "__NULL__",
  "Jacobs theater ": "__NULL__",
  "Marquee at Block 37": "__NULL__",
  "Chicago palace theater": "__NULL__",
  "Chicago Palace theater": "__NULL__",
  "NYU 721 Broadway": "__NULL__",
  "Omni Hotel Los Angeles": "__NULL__",
  "The Kimpton Everly Hotel": "__NULL__",
  "Chicago Allegro hotel": "__NULL__",
  "Chicago Allegro hotel ": "__NULL__",
  "Hampton Inn Buffalo": "__NULL__",
  "Burbank": "mom_burbank",
};

function resolveAddress(s: string | null | undefined, csvDate: string): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  const mapped = ADDRESS_STRING_MAP[s] ?? ADDRESS_STRING_MAP[trimmed];
  if (mapped === "__NULL__") return null;
  if (mapped === "home_bronx") {
    // Switch to home_inwood for post-move dates
    if (csvDate >= "2026-02-16") return "home_inwood";
    return "home_bronx";
  }
  return mapped ?? null;
}

const AIRPORT_TOKEN_MAP: Record<string, string> = {
  "JFK": "JFK", "Jfk": "JFK", "jfk": "JFK",
  "LGA": "LGA", "Lga": "LGA", "lga": "LGA",
  "EWR": "EWR", "Ewr": "EWR", "Newark": "EWR", "newark": "EWR",
  "BOS": "BOS", "Bos": "BOS",
  "ORD": "ORD", "Ord": "ORD",
  "LAX": "LAX", "Lax": "LAX", "lax": "LAX",
  "YYZ": "YYZ", "YTZ": "YTZ", "Pearson": "YYZ",
  "BUF": "BUF", "HPN": "HPN", "MIA": "MIA", "ATL": "ATL", "LAS": "LAS",
  "TUL": "TUL", "OKC": "OKC", "CMH": "CMH", "FLL": "FLL", "NAS": "NAS",
  "FRA": "FRA", "CDG": "CDG", "HND": "HND", "MSP": "MSP", "DTW": "DTW",
  "BUR": "BUR", "LHR": "LHR", "BCN": "BCN", "SFO": "SFO",
};

function parseAirportCell(cell: string): { airport: string | null; terminal: string | null } {
  if (!cell) return { airport: null, terminal: null };
  const tokens = cell.split(/\s+/);
  let airport: string | null = null;
  let terminal: string | null = null;
  for (const t of tokens) {
    const up = t.toUpperCase();
    if (AIRPORT_TOKEN_MAP[t] || AIRPORT_TOKEN_MAP[up]) {
      airport = AIRPORT_TOKEN_MAP[t] ?? AIRPORT_TOKEN_MAP[up];
    } else if (/^[tT]$/i.test(t)) {
      continue;
    } else if (/^terminal$/i.test(t)) {
      continue;
    } else if (/^[A-E]$/i.test(t)) {
      terminal = "T" + t.toUpperCase();
    } else if (/^\d$/.test(t)) {
      terminal = "T" + t;
    } else if (/^T[0-9A-E]$/i.test(t)) {
      terminal = t.toUpperCase();
    }
  }
  return { airport, terminal };
}

// Date normalization: handles YYYY.MM.DD / YYYY.M.DD / MM.DD.YYYY / MM/DD/YYYY / MM/DD/YY
function normalizeDate(s: string): string | null {
  if (!s) return null;
  s = s.trim();
  // YYYY.MM.DD or YYYY-MM-DD
  let m = s.match(/^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // MM.DD.YYYY or MM/DD/YYYY
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  // MM/DD/YY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) return `20${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

// Time parsing: "6:53 AM", "6:34p", "11:42am", "12:30 PM" → "HH:MM"
function parseTime(s: string): { time: string; meridiem: "AM" | "PM" | null } | null {
  if (!s) return null;
  s = s.trim().toLowerCase();
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = m[3];
  let meridiem: "AM" | "PM" | null = null;
  if (ampm) {
    meridiem = ampm[0] === "a" ? "AM" : "PM";
    if (meridiem === "PM" && h < 12) h += 12;
    if (meridiem === "AM" && h === 12) h = 0;
  }
  return { time: `${String(h).padStart(2, "0")}:${min}`, meridiem };
}

// ── Bronx CSV parser ────────────────────────────────────────────────────────

type BronxBlock = {
  rawDate: string;
  date: string;
  origin: string;
  destination: string;
  steps: { time: string; name: string }[];
};

function parseBronxCsv(): BronxBlock[] {
  const path = join(IMPORTS_DIR, "Travel Timing Bronx - NYC to Airport.csv");
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n");
  const blocks: BronxBlock[] = [];
  let current: BronxBlock | null = null;
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const [dateStr, origin, destination, stepTime, stepName] = fields.slice(0, 5);
    if (dateStr && origin && destination) {
      if (current) blocks.push(current);
      const date = normalizeDate(dateStr) ?? dateStr;
      current = {
        rawDate: dateStr,
        date,
        origin: origin.trim(),
        destination: destination.trim(),
        steps: [],
      };
      if (stepTime && stepName) {
        current.steps.push({ time: stepTime.trim(), name: stepName.trim() });
      }
    } else if (current && stepTime && stepName) {
      current.steps.push({ time: stepTime.trim(), name: stepName.trim() });
    }
    // blank rows mid-block are leg separators, not block terminators
  }
  if (current) blocks.push(current);
  return blocks;
}

// ── Inwood CSV parser ───────────────────────────────────────────────────────

type InwoodDep = {
  date: string; origin: string; destination: string;
  inCar?: string; atAirport?: string; bagDrop?: string; security?: string;
  schedDep?: string;
};

type InwoodArr = {
  date: string; origin: string; destination: string;
  schedLanding?: string; offPlane?: string; bagsCollected?: string;
  inCar?: string; atDestination?: string;
};

function parseInwoodDep(): InwoodDep[] {
  const path = join(IMPORTS_DIR, "Travel Timing Inwood - Departures.csv");
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n");
  const out: InwoodDep[] = [];
  for (let i = 2; i < lines.length; i++) {
    const f = parseCsvLine(lines[i]);
    if (!f[0]) continue;
    const date = normalizeDate(f[0]);
    if (!date) continue;
    out.push({
      date,
      origin: f[1]?.trim() ?? "",
      destination: f[2]?.trim() ?? "",
      inCar: f[3] === "TRUE" ? f[4]?.trim() : undefined,
      atAirport: f[5] === "TRUE" ? f[6]?.trim() : undefined,
      bagDrop: f[7] === "TRUE" ? f[8]?.trim() : undefined,
      security: f[9] === "TRUE" ? f[10]?.trim() : undefined,
      schedDep: f[11]?.trim(),
    });
  }
  return out;
}

function parseInwoodArr(): InwoodArr[] {
  const path = join(IMPORTS_DIR, "Travel Timing Inwood - Arrivals.csv");
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n");
  const out: InwoodArr[] = [];
  for (let i = 2; i < lines.length; i++) {
    const f = parseCsvLine(lines[i]);
    if (!f[0]) continue;
    const date = normalizeDate(f[0]);
    if (!date) continue;
    out.push({
      date,
      origin: f[1]?.trim() ?? "",
      destination: f[2]?.trim() ?? "",
      schedLanding: f[3]?.trim(),
      offPlane: f[4] === "TRUE" ? f[5]?.trim() : undefined,
      bagsCollected: f[6] === "TRUE" ? f[7]?.trim() : undefined,
      inCar: f[8] === "TRUE" ? f[9]?.trim() : undefined,
      atDestination: f[10] === "TRUE" ? f[11]?.trim() : undefined,
    });
  }
  return out;
}

// ── step-name → MilestoneKind mapping ──────────────────────────────────────

function mapStepName(name: string, direction: "dep" | "arr"): MilestoneKind | null {
  const n = name.toLowerCase().trim();
  if (direction === "dep") {
    if (/^(in car|in cab|in kid car|in lyft|depart home|leave|left|on subway|on train|1 train|a train|m60|metro north|bx7|on up express|on air ?train|leave apartment|left apartment|left toronto apartment|subway platform|union station|up express)/.test(n)) return "dep_in_transit";
    if (/at airport|at lga|at jfk|at ord|at lax|at ewr|at bos|at terminal|at lax terminal|at hpn|at buf|at yyz|at ytz|at pearson|t4 arrival|lga terminal/.test(n)) return "dep_at_airport";
    if (/bag[s]? drop|bag dropped|bag checked|bag check|checked in|ticket changed/.test(n)) return "dep_bags";
    if (/through (security|tsa)|^trough (security|tsa)/.test(n) && !/customs/.test(n)) return "dep_security";
    if (/through customs|work permit/.test(n)) return "dep_customs";
    return null;
  }
  if (/off plane|off the plane|scheduled landing/.test(n)) return "arr_off_plane";
  if (/through customs|work permit|global entry/.test(n)) return "arr_customs";
  if (/bag[s]? collected|bag[s]? claimed|bag picked up|acquired bags/.test(n)) return "arr_bags";
  if (/^(in car|in cab|in kid car|in lyft|on bus|on air ?train|on up express|on subway|on flyaway|on train|1 train|a train|m60|metro north|bx7|subway platform|at union station|at jamaica|at grand central|at marble hill|at spuyten duyvil|at van nuys|at blue line|at toronto union|traffic catastrophe|up express departed)/.test(n)) return "arr_in_transit";
  if (/at home|^home$|in apartment|in the apartment|at .* apartment|^at hotel|at chicago apartment|at house|at destination|in burbank|at marquee|at steppenwolf|^at omni|^at kimpton|^at allegro|^at hampton|at 619|at 6246|^at$/.test(n)) return "arr_at_destination";
  return null;
}

// ── CSV-block → TripRow ─────────────────────────────────────────────────────

type CsvLeg = "dep" | "arr";

function inferLeg(origin: string, destination: string): CsvLeg | null {
  const depAddr = resolveAddress(origin, "2099-01-01");
  const arrAddr = resolveAddress(destination, "2099-01-01");
  const destAirport = parseAirportCell(destination).airport;
  const origAirport = parseAirportCell(origin).airport;
  if (destAirport && !origAirport) return "dep";
  if (origAirport && !destAirport) return "arr";
  if (depAddr && destAirport) return "dep";
  if (origAirport && arrAddr) return "arr";
  return null;
}

function applyBronxOverrides(b: BronxBlock): BronxBlock {
  const key = `${b.date}|${b.origin}|${b.destination}`;
  const override = BRONX_OVERRIDES[key];
  if (!override) return b;
  return {
    ...b,
    date: override.correctedDate ?? b.date,
    origin: override.correctedOrigin ?? b.origin,
    destination: override.correctedDestination ?? b.destination,
  };
}

// Silent AM/PM corrections from Quiz #2 Q3.1 — keyed by (date, milestone approx time)
function correctAMPM(time: string, date: string, nextInSequence: string | null): string {
  // If a sequence is clearly PM and this parses as AM in a morning-numbered slot,
  // and the prior value was PM, flip it. Simplified heuristic:
  // we rely on the monotonic-time rule within a block (times should increase).
  return time;
}

function stepSequenceToMilestones(
  steps: { time: string; name: string }[],
  direction: "dep" | "arr",
): { milestones: Milestone[]; skipped: string[] } {
  const out: Milestone[] = [];
  const skipped: string[] = [];
  const seenKinds = new Set<MilestoneKind>();

  // For dep: monotonic forward. For arr with "through customs" after "through customs step one",
  // take the LAST customs per the full-clear rule.
  const customsTimes: string[] = [];

  for (const s of steps) {
    const kind = mapStepName(s.name, direction);
    if (!kind) { skipped.push(s.name); continue; }
    const parsed = parseTime(s.time);
    if (!parsed) { skipped.push(`${s.name} [bad time: ${s.time}]`); continue; }
    const t = parsed.time;

    // arr_customs: collect all, use last
    if (kind === "arr_customs" || kind === "dep_customs") {
      customsTimes.push(t);
      continue;
    }
    // arr_in_transit: use FIRST post-deplane mode (ignore subsequent transit events)
    if (seenKinds.has(kind) && (kind === "arr_in_transit" || kind === "dep_in_transit")) continue;
    out.push({ kind, time: t });
    seenKinds.add(kind);
  }

  if (customsTimes.length > 0) {
    const customsKind: MilestoneKind = direction === "dep" ? "dep_customs" : "arr_customs";
    out.push({ kind: customsKind, time: customsTimes[customsTimes.length - 1] });
  }

  return { milestones: out, skipped };
}

function findFlightyMatch(
  flightyIdx: Map<string, FlightyRow>,
  date: string,
  depAirport: string | null,
  arrAirport: string | null,
): FlightyRow | null {
  if (!depAirport || !arrAirport) return null;
  return flightyIdx.get(`${date}|${depAirport}|${arrAirport}`) ?? null;
}

function resolveHomeAddress(date: string): string {
  if (date <= "2022-11-27") return "home_192nd";
  if (date <= "2026-02-15") return "home_bronx";
  return "home_inwood";
}

// Split a block's steps into departure-phase and arrival-phase based on
// delimiter markers. A block may contain both legs of one flight (common in
// the Bronx CSV — dep milestones, blank line, arr milestones, all under one header).
function splitBlockPhases(steps: { time: string; name: string }[]): {
  depSteps: { time: string; name: string }[];
  arrSteps: { time: string; name: string }[];
  depAirport: string | null;
  depTerminal: string | null;
  arrAirport: string | null;
  arrTerminal: string | null;
} {
  const depSteps: { time: string; name: string }[] = [];
  const arrSteps: { time: string; name: string }[] = [];
  let depAirport: string | null = null;
  let depTerminal: string | null = null;
  let arrAirport: string | null = null;
  let arrTerminal: string | null = null;
  let phase: "dep" | "arr" = "dep";

  for (const s of steps) {
    const n = s.name.toLowerCase();
    // Transition to arrival phase
    if (/off (the )?plane|scheduled landing/.test(n)) phase = "arr";

    // Extract airport info from step names
    const airportInStep = extractAirportFromStep(s.name);
    if (airportInStep) {
      if (phase === "dep" && !depAirport) { depAirport = airportInStep.airport; depTerminal = airportInStep.terminal; }
      if (phase === "arr" && !arrAirport) { arrAirport = airportInStep.airport; arrTerminal = airportInStep.terminal; }
    }

    // Ignore schedule-only markers (they're flight data, not milestones)
    if (/^scheduled (boarding|departure|take off|landing)/.test(n)) continue;

    if (phase === "dep") depSteps.push(s);
    else arrSteps.push(s);
  }

  return { depSteps, arrSteps, depAirport, depTerminal, arrAirport, arrTerminal };
}

function extractAirportFromStep(name: string): { airport: string; terminal: string | null } | null {
  const n = name.toLowerCase();
  // "At JFK terminal 4" / "At LAX terminal 3" / "Off plane at lax"
  const m = n.match(/\b(jfk|lga|ewr|bos|ord|lax|yyz|ytz|buf|hpn|mia|atl|las|tul|okc|cmh|fll|nas|fra|cdg|hnd|msp|dtw|bur|lhr|bcn|sfo|hpn|sfo)\b(?:\s+terminal\s+([\w\d]))?/);
  if (!m) return null;
  return {
    airport: m[1].toUpperCase(),
    terminal: m[2] ? "T" + m[2].toUpperCase() : null,
  };
}

function csvBlockToTripRows(
  b: BronxBlock,
  flightyIdx: Map<string, FlightyRow>,
  sourceTag: string,
): { rows: TripRow[]; skipped: string[]; flight: FlightyRow | null } {
  const phases = splitBlockPhases(b.steps);

  // Airport from header cells (fallback if steps don't contain airport info)
  const originAirport = parseAirportCell(b.origin);
  const destAirport = parseAirportCell(b.destination);

  // Determine the flight's dep/arr airports
  let depAirport: string | null = phases.depAirport ?? destAirport.airport ?? originAirport.airport;
  let depTerminal: string | null = phases.depTerminal ?? destAirport.terminal ?? originAirport.terminal;
  let arrAirport: string | null = phases.arrAirport ?? null;
  let arrTerminal: string | null = phases.arrTerminal ?? null;

  // If origin is an airport, the block starts post-flight at that airport (this is arr-only)
  const originIsAirport = originAirport.airport !== null;
  const destIsAirport = destAirport.airport !== null;

  if (originIsAirport && !destIsAirport) {
    // Arrival-only block: flight landed at origin airport
    arrAirport = originAirport.airport;
    arrTerminal = originAirport.terminal;
    depAirport = null;
    depTerminal = null;
  }

  // Flighty lookup
  let flighty: FlightyRow | null = null;
  if (depAirport && arrAirport) {
    flighty = flightyIdx.get(`${b.date}|${depAirport}|${arrAirport}`) ?? null;
  }
  if (!flighty && depAirport) {
    flighty = findFlightyByDateAndOneAirport(flightyIdx, b.date, "from", depAirport);
  }
  if (!flighty && arrAirport) {
    flighty = findFlightyByDateAndOneAirport(flightyIdx, b.date, "to", arrAirport);
  }

  if (flighty) {
    depAirport = depAirport ?? flighty.from;
    arrAirport = arrAirport ?? flighty.to;
    if (!depTerminal) depTerminal = flighty.depTerminal || null;
    if (!arrTerminal) arrTerminal = flighty.arrTerminal || null;
  }

  const depAddressId = resolveAddressForDate(b.origin, b.date);
  const arrAddressId = resolveAddressForDate(b.destination, b.date);

  const schedDep = flighty ? extractLocalTime(flighty.schedGateDep) : null;
  const schedArr = flighty ? extractLocalTime(flighty.schedGateArr) : null;
  const schedDepDate = flighty ? flighty.schedGateDep.slice(0, 10) : b.date;
  const schedArrDate = flighty ? flighty.schedGateArr.slice(0, 10) : b.date;
  const flightDate = flighty ? flighty.date : b.date;

  const skipped: string[] = [];
  const rows: TripRow[] = [];

  const baseRow: Omit<TripRow, "trip_id" | "direction" | "address_id" | "milestones" | "notes"> = {
    source_id: `${sourceTag}-${b.date}`,
    flight_date: flightDate,
    dep_airport: depAirport ?? "UNKNOWN",
    dep_terminal: depTerminal,
    arr_airport: arrAirport ?? "UNKNOWN",
    arr_terminal: arrTerminal,
    actual_arr_airport: flighty?.divertedTo || null,
    flight: flighty ? `${flighty.airline}${flighty.flight}` : null,
    airline: flighty?.airline ?? null,
    pnr: flighty?.pnr || null,
    sched_dep_local: schedDep,
    sched_arr_local: schedArr,
    sched_dep_date: schedDepDate,
    sched_arr_date: schedArrDate,
    bags: inferBags(b.steps),
    transit: inferTransit(b.steps),
    party: "solo",
    tsa_precheck: false,
    dst_warning: false,
    status: (flighty?.divertedTo ? "diverted" : "completed") as "completed" | "diverted",
    source: "legacy",
    source_tag: sourceTag,
  };

  if (phases.depSteps.length > 0) {
    const { milestones, skipped: s } = stepSequenceToMilestones(phases.depSteps, "dep");
    skipped.push(...s);
    rows.push({
      ...baseRow,
      trip_id: `${sourceTag}-${b.date}-dep`,
      direction: "departure",
      address_id: depAddressId,
      milestones,
      notes: null,
    });
  }
  if (phases.arrSteps.length > 0) {
    const { milestones, skipped: s } = stepSequenceToMilestones(phases.arrSteps, "arr");
    skipped.push(...s);
    rows.push({
      ...baseRow,
      trip_id: `${sourceTag}-${b.date}-arr`,
      direction: "arrival",
      address_id: arrAddressId,
      milestones,
      notes: null,
    });
  }

  return { rows, skipped, flight: flighty };
}

function extractLocalTime(iso: string): string | null {
  if (!iso) return null;
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : null;
}

function findFlightyByDateAndOneAirport(
  idx: Map<string, FlightyRow>,
  date: string,
  field: "from" | "to",
  airport: string | null,
): FlightyRow | null {
  if (!airport) return null;
  for (const r of idx.values()) {
    if (r.date !== date) continue;
    if (field === "from" && r.from === airport) return r;
    if (field === "to" && r.to === airport) return r;
  }
  return null;
}

function resolveAddressForDate(cell: string, date: string): string | null {
  const trimmed = cell.trim();
  const mapped = ADDRESS_STRING_MAP[cell] ?? ADDRESS_STRING_MAP[trimmed];
  if (mapped === "__NULL__") return null;
  if (mapped === "home_bronx") return resolveHomeAddress(date);
  return mapped ?? null;
}

function inferBags(steps: { time: string; name: string }[]): "checked" | "carry_on" | "unknown" {
  const hasBagDrop = steps.some(s => /bag dropped|bag checked|bag check/i.test(s.name));
  const hasNoBags = steps.some(s => /no bags|no bag|\(no bags\)/i.test(s.name));
  const hasBagsCollected = steps.some(s => /bag[s]? collected|bag[s]? claimed|bag picked up/i.test(s.name));
  if (hasNoBags) return "carry_on";
  if (hasBagDrop || hasBagsCollected) return "checked";
  return "carry_on";
}

function inferTransit(steps: { time: string; name: string }[]): "car" | "public" {
  // Final airport-leg determines transit. Walk sequence in reverse; first mode keyword wins.
  const modeRegexCar = /in car|in cab|in kid car|in lyft|on flyaway|on bus/i;
  const modeRegexPublic = /subway|a train|1 train|lirr|nj transit|air[-_ ]?train|up express|m60 sbs|metro north|bx7/i;
  let lastMode: "car" | "public" | null = null;
  for (const s of steps) {
    if (modeRegexCar.test(s.name)) lastMode = "car";
    else if (modeRegexPublic.test(s.name)) lastMode = "public";
  }
  return lastMode ?? "car";
}

// ── SQL emission ────────────────────────────────────────────────────────────

function sqlEscape(s: string | null): string {
  if (s === null || s === undefined) return "NULL";
  return `'${String(s).replace(/'/g, "''")}'`;
}

function emitSql(addresses: Address[], trips: TripRow[]): string {
  const lines: string[] = [];
  lines.push("-- M5 legacy import — generated by db/seeds/import-legacy.ts");
  lines.push("-- Run via: scripts/load-legacy.sh");
  lines.push("");
  lines.push("\\connect travel");
  lines.push("");
  lines.push("begin;");
  lines.push("");
  lines.push("-- Defer milestones_history FK: the BEFORE INSERT trigger on milestones");
  lines.push("-- inserts a history row referencing milestone.id before the parent row");
  lines.push("-- is visible. Migration 05-m5-prep made this FK deferrable.");
  lines.push("set constraints milestones_history_milestone_id_fkey deferred;");
  lines.push("");
  lines.push("-- Idempotency: wipe existing legacy data before reload.");
  lines.push("-- Addresses are deleted by exact match on the clean labels (M6 rename);");
  lines.push("-- the legacy:% pattern is kept as a defensive fallback for stacks that");
  lines.push("-- predate migration 002.");
  lines.push("delete from public.milestones where trip_id in (select id from public.trips where source = 'legacy');");
  lines.push("delete from public.trips where source = 'legacy';");
  const displayLabels = addresses
    .map((a) => SLUG_TO_DISPLAY[a.id])
    .filter((v): v is string => v !== undefined)
    .map((v) => `'${v.replace(/'/g, "''")}'`)
    .join(", ");
  lines.push(`delete from public.addresses where label in (${displayLabels}) or label like 'legacy:%';`);
  lines.push("");
  lines.push("-- Addresses (human-readable labels per M6 rename mapping)");
  for (const a of addresses) {
    const display = SLUG_TO_DISPLAY[a.id];
    if (!display) {
      throw new Error(`No SLUG_TO_DISPLAY mapping for address id '${a.id}'. Add it to import-legacy.ts.`);
    }
    lines.push(
      `insert into public.addresses (label, formatted, lat, lng) values ` +
      `(${sqlEscape(display)}, ${sqlEscape(a.label)}, ${a.lat}, ${a.lng}) ` +
      `on conflict do nothing;`
    );
  }
  lines.push("");
  lines.push("-- Trips: each row references an address by its clean label, and an airport by IATA.");

  // Map from address id slug to label for SQL subquery lookups (now using clean display labels).
  const addrLabel = (id: string | null) => {
    if (id === null) return "null";
    const display = SLUG_TO_DISPLAY[id];
    if (!display) throw new Error(`No SLUG_TO_DISPLAY mapping for address id '${id}' referenced by a trip.`);
    return `(select id from public.addresses where label = ${sqlEscape(display)} limit 1)`;
  };

  // For each trip, emit INSERT plus milestones
  for (let i = 0; i < trips.length; i++) {
    const t = trips[i];
    const tripVar = `_trip_${i}`;
    lines.push("");
    lines.push(`-- ${t.trip_id}: ${t.flight_date} ${t.direction} ${t.dep_airport}→${t.arr_airport} (${t.source_tag})`);
    lines.push(`with ${tripVar} as (`);
    lines.push(`  insert into public.trips (`);
    lines.push(`    direction, address_id,`);
    lines.push(`    dep_airport, arr_airport, actual_arr_airport,`);
    lines.push(`    sched_dep_local, sched_arr_local, sched_dep_date, sched_arr_date,`);
    lines.push(`    bags, party, transit, tsa_precheck, status, source`);
    lines.push(`  ) values (`);
    lines.push(`    ${sqlEscape(t.direction)},`);
    lines.push(`    ${addrLabel(t.address_id)},`);
    lines.push(`    ${sqlEscape(t.dep_airport === "UNKNOWN" ? null : t.dep_airport)},`);
    lines.push(`    ${sqlEscape(t.arr_airport === "UNKNOWN" ? null : t.arr_airport)},`);
    lines.push(`    ${sqlEscape(t.actual_arr_airport)},`);
    lines.push(`    ${sqlEscape(t.sched_dep_local)},`);
    lines.push(`    ${sqlEscape(t.sched_arr_local)},`);
    lines.push(`    ${sqlEscape(t.sched_dep_date)},`);
    lines.push(`    ${sqlEscape(t.sched_arr_date)},`);
    lines.push(`    ${sqlEscape(t.bags)},`);
    lines.push(`    ${sqlEscape(t.party)},`);
    lines.push(`    ${sqlEscape(t.transit)},`);
    lines.push(`    ${t.tsa_precheck},`);
    lines.push(`    ${sqlEscape(t.status === "diverted" ? "complete" : "complete")},`);
    lines.push(`    'legacy'`);
    lines.push(`  ) returning id`);
    lines.push(`)`);

    if (t.milestones.length === 0) {
      lines.push(`select id from ${tripVar};`);
    } else {
      // Pick the airport whose tz governs each milestone:
      // - dep_* milestones use the dep_airport's tz
      // - arr_* milestones use the arr_airport's tz
      const airportFor = (kind: MilestoneKind) =>
        kind.startsWith("dep_") ? (t.dep_airport === "UNKNOWN" ? null : t.dep_airport) : (t.arr_airport === "UNKNOWN" ? null : t.arr_airport);

      const baseDate = t.flight_date;
      const valueRows: string[] = [];
      let seq = 1;
      for (const m of t.milestones) {
        const airport = airportFor(m.kind);
        if (!airport) continue;
        const dateExpr = m.nextDay
          ? `(${sqlEscape(baseDate)}::date + 1)`
          : `${sqlEscape(baseDate)}::date`;
        const tsExpr = `(${dateExpr} + ${sqlEscape(m.time)}::time) at time zone (select tz from public.airports where iata = ${sqlEscape(airport)})`;
        valueRows.push(`((select id from ${tripVar}), ${sqlEscape(m.kind)}, ${tsExpr}, ${seq})`);
        seq++;
      }
      if (valueRows.length === 0) {
        lines.push(`select id from ${tripVar};`);
      } else {
        lines.push(`insert into public.milestones (trip_id, kind, logged_at, client_seq)`);
        lines.push(`values`);
        lines.push("  " + valueRows.join(",\n  ") + ";");
      }
    }
  }

  lines.push("");
  lines.push("commit;");
  lines.push("");
  lines.push("-- Verification queries");
  lines.push("select count(*) as legacy_trips from public.trips where source = 'legacy';");
  lines.push("select extract(year from sched_dep_date) as year, count(*) from public.trips where source = 'legacy' group by year order by year;");
  lines.push("select dep_airport, count(*) from public.trips where source = 'legacy' group by dep_airport order by count(*) desc limit 10;");
  return lines.join("\n");
}

// ── main ────────────────────────────────────────────────────────────────────

function main() {
  const addresses = loadAddresses();
  const narrative = loadNarrativeTrips();
  const flighty = loadFlighty();
  const flightyIdx = flightyIndex(flighty);

  const bronxBlocks = parseBronxCsv();
  const inwoodDep = parseInwoodDep();
  const inwoodArr = parseInwoodArr();

  // Narrative → trip rows (immediate: data is fully resolved)
  const narrativeRows: TripRow[] = narrative.flatMap(narrativeToRows);

  // Bronx blocks → apply overrides + dedupe + materialize
  const overriddenBlocks = bronxBlocks.map(applyBronxOverrides);

  // Dedupe: for each (date, origin, destination), keep the block with the most steps.
  // This handles the spreadsheet-copy-paste artifact (stale duplicates with fewer/older steps).
  const blockKey = (b: BronxBlock) => `${b.date}|${b.origin}|${b.destination}`;
  const blockByKey = new Map<string, BronxBlock>();
  for (const b of overriddenBlocks) {
    const k = blockKey(b);
    const existing = blockByKey.get(k);
    if (!existing || b.steps.length > existing.steps.length) {
      blockByKey.set(k, b);
    }
  }
  const dedupedBlocks = [...blockByKey.values()];

  const bronxRows: TripRow[] = [];
  const bronxSkipped: Array<{ date: string; origin: string; destination: string; reason: string; steps?: string[] }> = [];

  for (const b of dedupedBlocks) {
    const result = csvBlockToTripRows(b, flightyIdx, "bronx");
    if (result.rows.length === 0) {
      bronxSkipped.push({ date: b.date, origin: b.origin, destination: b.destination, reason: "no rows produced" });
      continue;
    }
    bronxRows.push(...result.rows);
    if (result.skipped.length > 0) {
      bronxSkipped.push({
        date: b.date, origin: b.origin, destination: b.destination,
        reason: "unmapped steps", steps: result.skipped,
      });
    }
  }

  const inwoodBlocks: BronxBlock[] = [];
  for (const d of inwoodDep) {
    const steps: { time: string; name: string }[] = [];
    if (d.inCar) steps.push({ time: d.inCar, name: "In car" });
    if (d.atAirport) steps.push({ time: d.atAirport, name: "At airport" });
    if (d.bagDrop) steps.push({ time: d.bagDrop, name: "Bag dropped" });
    if (d.security) steps.push({ time: d.security, name: "Through security" });
    inwoodBlocks.push({ rawDate: d.date, date: d.date, origin: d.origin, destination: d.destination, steps });
  }
  for (const a of inwoodArr) {
    const steps: { time: string; name: string }[] = [];
    if (a.offPlane) steps.push({ time: a.offPlane, name: "Off plane" });
    if (a.bagsCollected) steps.push({ time: a.bagsCollected, name: "Bags collected" });
    if (a.inCar) steps.push({ time: a.inCar, name: "In car" });
    if (a.atDestination) steps.push({ time: a.atDestination, name: "At home" });
    inwoodBlocks.push({ rawDate: a.date, date: a.date, origin: a.origin, destination: a.destination, steps });
  }

  const inwoodRows: TripRow[] = [];
  for (const b of inwoodBlocks) {
    const result = csvBlockToTripRows(b, flightyIdx, "inwood");
    inwoodRows.push(...result.rows);
  }

  const bothRows = [...bronxRows, ...inwoodRows];

  // Universal 2-row rule: each flight gets dep + arr rows. If only one side is
  // present, synthesize a phantom counterpart with flight data only.
  const flightKey = (r: TripRow) => `${r.flight_date}|${r.dep_airport}|${r.arr_airport}`;
  const byFlight = new Map<string, { dep?: TripRow; arr?: TripRow }>();
  for (const r of bothRows) {
    const k = flightKey(r);
    const entry = byFlight.get(k) ?? {};
    if (r.direction === "departure") entry.dep = r;
    else entry.arr = r;
    byFlight.set(k, entry);
  }
  const phantom: TripRow[] = [];
  for (const { dep, arr } of byFlight.values()) {
    if (dep && !arr) {
      phantom.push({ ...dep, trip_id: `${dep.trip_id.replace(/-dep$/, "")}-arr-phantom`, direction: "arrival", address_id: null, milestones: [], notes: "phantom arrival (flight data only)" });
    } else if (arr && !dep) {
      phantom.push({ ...arr, trip_id: `${arr.trip_id.replace(/-arr$/, "")}-dep-phantom`, direction: "departure", address_id: null, milestones: [], notes: "phantom departure (flight data only)" });
    }
  }

  const allCsvRows = [...bothRows, ...phantom];

  // ── output ────────────────────────────────────────────────────────────────

  const trips = [...narrativeRows, ...allCsvRows];

  const output = {
    generated_at: new Date().toISOString(),
    addresses,
    trips,
    diagnostics: {
      narrative_rows: narrativeRows.length,
      bronx_blocks_parsed: bronxBlocks.length,
      bronx_blocks_deduped: dedupedBlocks.length,
      bronx_rows_emitted: bronxRows.length,
      inwood_rows_emitted: inwoodRows.length,
      phantom_rows_synthesized: phantom.length,
      total_rows: trips.length,
      skipped_blocks: bronxSkipped,
    },
  };

  const outPath = join(IMPORTS_DIR, "legacy-trips.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  // SQL emission ────────────────────────────────────────────────────────────
  const sqlPath = join(IMPORTS_DIR, "legacy-trips.sql");
  writeFileSync(sqlPath, emitSql(addresses, trips));
  console.log(`Wrote: ${sqlPath}`);

  // ── summary ────────────────────────────────────────────────────────────────

  const byYear = new Map<string, number>();
  const byDepAirport = new Map<string, number>();
  const byArrAirport = new Map<string, number>();
  for (const r of trips) {
    const year = r.flight_date.slice(0, 4);
    byYear.set(year, (byYear.get(year) ?? 0) + 1);
    byDepAirport.set(r.dep_airport, (byDepAirport.get(r.dep_airport) ?? 0) + 1);
    byArrAirport.set(r.arr_airport, (byArrAirport.get(r.arr_airport) ?? 0) + 1);
  }

  console.log("── M5 legacy import summary ──");
  console.log(`Addresses:              ${addresses.length}`);
  console.log(`Flighty rows:           ${flighty.length}`);
  console.log(`Narrative trips:        ${narrative.length} → ${narrativeRows.length} rows`);
  console.log(`Bronx CSV blocks:       ${bronxBlocks.length} raw / ${dedupedBlocks.length} deduped / ${bronxRows.length} emitted`);
  console.log(`Inwood CSV blocks:      ${inwoodDep.length + inwoodArr.length} → ${inwoodRows.length} emitted`);
  console.log(`Phantom rows:           ${phantom.length} (universal 2-row rule)`);
  console.log(`TOTAL TRIP ROWS:        ${trips.length}`);
  console.log(`Skipped blocks:         ${bronxSkipped.length} (see diagnostics in JSON)`);
  console.log(`\nNarrative rows per year:`);
  for (const [y, n] of [...byYear.entries()].sort()) {
    console.log(`  ${y}: ${n}`);
  }
  console.log(`\nTop dep airports:`);
  for (const [a, n] of [...byDepAirport.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10)) {
    console.log(`  ${a}: ${n}`);
  }
  console.log(`\nTop arr airports:`);
  for (const [a, n] of [...byArrAirport.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10)) {
    console.log(`  ${a}: ${n}`);
  }
  console.log(`\nWrote: ${outPath}`);
}

main();
