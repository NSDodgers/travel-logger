// Travel Logger predict service
// M10: percentile + filter-widening implementation. Computes per-trip durations
// from public.milestones, widens the filter set when sample is too small, and
// persists every prediction to public.predictions for M13 calibration.
//
// Auth: none — this service trusts anything that reaches it via Caddy, which
// has already run the Authelia forward_auth check.

import postgres from "postgres";
import { readFileSync } from "node:fs";

// Read the DB password from the mounted Docker secret directly. URL-encoding
// libpq-style passwords with /, +, = breaks the JS URL parser, so feed the
// driver the password as a separate field.
const pgPassword = readFileSync(
  process.env.PG_PASSWORD_FILE ?? "/run/secrets/predict_db_password",
  "utf8",
).trim();

const sql = postgres({
  host: process.env.PG_HOST ?? "postgres",
  port: Number(process.env.PG_PORT ?? 5432),
  database: process.env.PG_DATABASE ?? "travel",
  username: process.env.PG_USER ?? "predict_user",
  password: pgPassword,
  max: 4,
  idle_timeout: 30,
  connect_timeout: 10,
});

const PORT = Number(process.env.PORT ?? 3001);

// ── Types ────────────────────────────────────────────────────────────────

type Direction = "departure" | "arrival";
type Bags = "carry_on" | "checked";
type Party = "solo" | "group_with_kids" | "group_without_kids";
type Transit = "car" | "public";

interface PredictRequest {
  direction: Direction;
  airport: string;
  bags: Bags;
  party: Party;
  transit: Transit;
  tsa_precheck: boolean;
  international: boolean;
  flight_time_local: string;     // "HH:MM"
  flight_date_local: string;     // "YYYY-MM-DD"
}

interface FilterSet {
  airport: string;            // hard, never relaxes
  international: boolean;     // hard, never relaxes
  bags: Bags | null;
  party: Party | null;
  transit: Transit | null;
  tsa_precheck: boolean | null;
}

interface QueryResult {
  sample_n: number;
  incomplete_n: number;
  complete_n: number;
  p50_s: number | null;
  p90_s: number | null;
  min_s: number | null;
  max_s: number | null;
  durations_s: number[];
}

// Drop precedence: TSA first, then party, transit, bags. Airport and
// international are hard filters and never relax — see project_m10_decisions.md.
const DROP_ORDER: Array<keyof FilterSet> = ["tsa_precheck", "party", "transit", "bags"];

// ── HTTP server ─────────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    // Caddy strips /api before proxying (see Caddyfile). The Docker
    // healthcheck hits the service directly without the strip. Match both
    // shapes so the same handler works in both call paths.
    const path = url.pathname.replace(/^\/api/, "");

    if (path === "/predict/health") {
      try {
        const [{ one }] = await sql`select 1 as one`;
        return json({ status: "ok", db: one === 1 });
      } catch (err) {
        return json({ status: "error", error: String(err) }, 503);
      }
    }

    if (path === "/predict" && req.method === "POST") {
      try {
        const body = (await req.json()) as PredictRequest;
        const validation = validateRequest(body);
        if (validation) return json({ error: "bad_request", message: validation }, 400);
        return await handlePredict(body);
      } catch (err) {
        console.error("predict failed:", err);
        return json({ error: "internal", message: String(err) }, 500);
      }
    }

    return json({ error: "not_found", path: url.pathname }, 404);
  },
});

console.log(`predict service listening on :${server.port}`);

// ── Handler ─────────────────────────────────────────────────────────────

async function handlePredict(req: PredictRequest): Promise<Response> {
  // Look up the airport's tz once. Any unknown IATA is a 400 — the airports
  // table is the source of truth and the form's picker only lists rows from it.
  const airportRows = await sql<{ iata: string; tz: string; name: string; city: string | null }[]>`
    select iata, tz, name, city
    from public.airports
    where iata = ${req.airport}
    limit 1
  `;
  if (airportRows.length === 0) {
    return json({ error: "bad_request", message: `Unknown airport: ${req.airport}` }, 400);
  }
  const airport = airportRows[0];

  // Start at the tightest filter set. Widen by null-ing fields in DROP_ORDER
  // until sample_n ≥ 5 or we've dropped everything we're allowed to.
  const startFilters: FilterSet = {
    airport: req.airport,
    international: req.international,
    bags: req.bags,
    party: req.party,
    transit: req.transit,
    tsa_precheck: req.tsa_precheck,
  };

  const filters: FilterSet = { ...startFilters };
  const relaxed: string[] = [];
  let result = await runQuery(req.direction, filters);

  for (const field of DROP_ORDER) {
    if (result.sample_n >= 5) break;
    if (filters[field] === null) continue;
    (filters as any)[field] = null;
    relaxed.push(field);
    result = await runQuery(req.direction, filters);
  }

  // Classify the result and compute the leave-by offset.
  let kind: "empty" | "low_n" | "full";
  let offset_s: number | null;
  if (result.sample_n === 0) {
    kind = "empty";
    offset_s = null;
  } else if (result.sample_n < 5) {
    kind = "low_n";
    offset_s = result.p50_s;       // median anchors the prediction at low N
  } else {
    kind = "full";
    offset_s = result.p90_s;       // p90 anchors at full sample
  }

  // Anchor time math: for departures the user's anchor is *flight time* and
  // we count BACK by the trip duration to get "leave by"; for arrivals the
  // anchor is *landing time* and we count FORWARD to get "arrive by".
  const flightUtc = localToUtc(req.flight_date_local, req.flight_time_local, airport.tz);
  const sign = req.direction === "departure" ? -1 : 1;
  const leaveByUtc = offset_s !== null ? new Date(flightUtc.getTime() + sign * offset_s * 1000) : null;
  const comfortableUtc = (kind === "full" && result.p50_s !== null)
    ? new Date(flightUtc.getTime() + sign * result.p50_s * 1000)
    : null;

  // Persist the prediction row. Always written, even at sample_n=0, so M13
  // can score every "I asked the predictor" event later.
  const filtersJson = {
    direction: req.direction,
    airport: filters.airport,
    international: filters.international,
    bags: filters.bags,
    party: filters.party,
    transit: filters.transit,
    tsa_precheck: filters.tsa_precheck,
  };
  const p50Interval = result.p50_s !== null ? `${Math.round(result.p50_s)} seconds` : null;
  const p90Interval = result.p90_s !== null ? `${Math.round(result.p90_s)} seconds` : null;

  const [predRow] = await sql<{ id: string }[]>`
    insert into public.predictions
      (direction, airport, filters, relaxed_filters, sample_n, predicted_p50, predicted_p90)
    values
      (${req.direction}, ${req.airport}, ${sql.json(filtersJson)},
       ${relaxed}, ${result.sample_n},
       ${p50Interval}::interval, ${p90Interval}::interval)
    returning id
  `;

  return json({
    kind,
    prediction_id: predRow.id,
    direction: req.direction,
    airport: { iata: airport.iata, name: airport.name, city: airport.city, tz: airport.tz },
    applied_filters: filtersJson,
    relaxed_filters: relaxed,
    sample_n: result.sample_n,
    incomplete_n: result.incomplete_n,
    complete_n: result.complete_n,
    p50_s: result.p50_s,
    p90_s: result.p90_s,
    min_s: result.min_s,
    max_s: result.max_s,
    durations_s: result.durations_s,
    flight_local: `${req.flight_date_local}T${req.flight_time_local}`,
    flight_utc: flightUtc.toISOString(),
    leave_by_utc: leaveByUtc?.toISOString() ?? null,
    leave_by_local: leaveByUtc ? formatLocal(leaveByUtc, airport.tz) : null,
    leave_by_offset_s: offset_s,
    comfortable_utc: comfortableUtc?.toISOString() ?? null,
    comfortable_local: comfortableUtc ? formatLocal(comfortableUtc, airport.tz) : null,
    comfortable_offset_s: kind === "full" ? result.p50_s : null,
  });
}

// ── SQL ─────────────────────────────────────────────────────────────────

async function runQuery(direction: Direction, f: FilterSet): Promise<QueryResult> {
  // Whole-trip duration = (max(logged_at) - min(logged_at)) for non-void
  // milestones, requiring at least 2 milestones. Honest about incomplete
  // legacy data; in_progress trips excluded so the user's active trip
  // doesn't influence their own prediction.
  const airportCol = direction === "departure" ? sql`t.dep_airport` : sql`t.arr_airport`;

  const rows = await sql<{
    sample_n: number;
    incomplete_n: number;
    complete_n: number;
    p50_s: number | null;
    p90_s: number | null;
    min_s: number | null;
    max_s: number | null;
    durations_s: number[] | null;
  }[]>`
    with per_trip as (
      select
        m.trip_id,
        t.status,
        extract(epoch from (max(m.logged_at) - min(m.logged_at)))::float8 as duration_s,
        count(*) as n_milestones
      from public.milestones m
      join public.trips t on t.id = m.trip_id
      where m.void = false
        and t.direction = ${direction}
        and ${airportCol} = ${f.airport}
        and t.international = ${f.international}
        and t.test = false
        and t.status <> 'in_progress'
        and (${f.bags}::text is null or t.bags = ${f.bags}::text)
        and (${f.party}::text is null or t.party = ${f.party}::text)
        and (${f.transit}::text is null or t.transit = ${f.transit}::text)
        and (${f.tsa_precheck}::boolean is null or t.tsa_precheck = ${f.tsa_precheck}::boolean)
      group by m.trip_id, t.status
      having count(*) >= 2
    )
    select
      count(*)::int                                            as sample_n,
      count(*) filter (where status = 'abandoned')::int        as incomplete_n,
      count(*) filter (where status = 'complete')::int         as complete_n,
      percentile_cont(0.50) within group (order by duration_s) as p50_s,
      percentile_cont(0.90) within group (order by duration_s) as p90_s,
      min(duration_s)                                          as min_s,
      max(duration_s)                                          as max_s,
      (array_agg(duration_s order by duration_s))[1:200]       as durations_s
    from per_trip
  `;
  const r = rows[0];
  return {
    sample_n: r.sample_n,
    incomplete_n: r.incomplete_n,
    complete_n: r.complete_n,
    p50_s: r.p50_s,
    p90_s: r.p90_s,
    min_s: r.min_s,
    max_s: r.max_s,
    durations_s: r.durations_s ?? [],
  };
}

// ── Validation ──────────────────────────────────────────────────────────

function validateRequest(b: unknown): string | null {
  if (!b || typeof b !== "object") return "Body must be JSON object";
  const r = b as Partial<PredictRequest>;
  if (r.direction !== "departure" && r.direction !== "arrival") return "direction must be 'departure' or 'arrival'";
  if (typeof r.airport !== "string" || !/^[A-Z]{3}$/.test(r.airport)) return "airport must be a 3-letter IATA";
  if (r.bags !== "carry_on" && r.bags !== "checked") return "bags must be 'carry_on' or 'checked'";
  if (r.party !== "solo" && r.party !== "group_with_kids" && r.party !== "group_without_kids") return "party invalid";
  if (r.transit !== "car" && r.transit !== "public") return "transit must be 'car' or 'public'";
  if (typeof r.tsa_precheck !== "boolean") return "tsa_precheck must be boolean";
  if (typeof r.international !== "boolean") return "international must be boolean";
  if (typeof r.flight_time_local !== "string" || !/^\d{2}:\d{2}$/.test(r.flight_time_local)) return "flight_time_local must be HH:MM";
  if (typeof r.flight_date_local !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.flight_date_local)) return "flight_date_local must be YYYY-MM-DD";
  return null;
}

// ── Time helpers ────────────────────────────────────────────────────────

// Parse "YYYY-MM-DD" + "HH:MM" + tz → UTC instant. Mirror of the same
// helper in web/dst.js so service and frontend agree at DST edges.
function localToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const offsetMs = tzOffsetMs(new Date(asUtc), tz);
  return new Date(asUtc - offsetMs);
}

function tzOffsetMs(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    timeZone: tz,
  }).formatToParts(d);
  const m: Record<string, string> = {};
  parts.forEach((p) => { if (p.type !== "literal") m[p.type] = p.value; });
  const asIfUtc = Date.UTC(
    +m.year, +m.month - 1, +m.day,
    +(m.hour === "24" ? "0" : m.hour), +m.minute, +m.second,
  );
  return asIfUtc - d.getTime();
}

function formatLocal(d: Date, tz: string): string {
  // Returns "Apr 25, 4:50 PM" — same shape as the history timeline.
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    timeZone: tz,
  }).format(d);
}

// ── Response helper ─────────────────────────────────────────────────────

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
