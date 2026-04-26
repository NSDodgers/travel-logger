// History screen — M9. Two views:
//   /history          → list of all trips, newest first, with source badge
//   /history/:id      → timeline of one trip's milestones
//
// Long-press a milestone in the timeline view → edit time / void. The edit
// and void writes go through the queue same as the log screen — server
// truth re-fetches when the queue drains.

import { api, ApiError } from '../api.js';

let kindsCache = null;

// ── List ───────────────────────────────────────────────────────────────────

export async function historyListScreen(root) {
  root.innerHTML = `<section class="screen"><div class="loading">Loading history…</div></section>`;

  let trips;
  try {
    if (!kindsCache) kindsCache = await api.get('/milestone_kinds?order=direction.asc,order_seq.asc');
    // Sort by trip date desc (sched_dep_date for deps, sched_arr_date for
    // arrs). Fall back to created_at for any rows missing both.
    // PostgREST `order` accepts comma-separated keys with .nullslast.
    trips = await api.get('/trips?order=sched_dep_date.desc.nullslast,sched_arr_date.desc.nullslast,created_at.desc&limit=200');
    if (!Array.isArray(trips)) trips = [];
  } catch (err) {
    renderError(root, err);
    return chrome();
  }

  renderList(root, trips);
  return chrome();
}

function chrome(extra = {}) {
  return { title: 'History', tab: 'history', primary: null, ...extra };
}

function renderList(root, trips) {
  if (!trips.length) {
    root.innerHTML = `
      <section class="screen">
        <div class="placeholder">
          <h2>No trips yet</h2>
          <p>Logged trips will show up here, newest first.</p>
        </div>
      </section>
    `;
    return;
  }

  root.innerHTML = `
    <section class="screen">
      <ul class="history-list">
        ${trips.map(rowHtml).join('')}
      </ul>
    </section>
  `;

  root.querySelectorAll('.history-row').forEach((el) => {
    el.addEventListener('click', () => {
      location.hash = `/history/${el.dataset.id}`;
    });
  });
}

function rowHtml(trip) {
  // The arrow always reads dep → arr (journey direction); the arrival/departure
  // distinction is conveyed by the source badge + status in metadata.
  const route = `${trip.dep_airport ?? '?'} → ${trip.arr_airport ?? '?'}`;
  const date = trip.sched_dep_date || trip.sched_arr_date || dateOnly(trip.created_at);
  const sourceClass = trip.source === 'app' ? 'src-app' : 'src-legacy';
  const statusBadge = trip.status === 'in_progress'
    ? '<span class="history-badge in-progress">in progress</span>'
    : trip.status === 'abandoned'
    ? '<span class="history-badge abandoned">incomplete</span>'
    : '';
  const testBadge = trip.test ? '<span class="history-badge test">test</span>' : '';
  return `
    <li class="history-row" data-id="${escapeAttr(trip.id)}" role="button" tabindex="0">
      <div class="history-row-main">
        <div class="history-row-route">${escapeHtml(route)}</div>
        <div class="history-row-meta">
          ${escapeHtml(date)} ${statusBadge} ${testBadge}
        </div>
      </div>
      <div class="history-row-side">
        <span class="history-source ${sourceClass}">${escapeHtml(trip.source)}</span>
        <span class="history-row-chevron" aria-hidden="true">›</span>
      </div>
    </li>
  `;
}

// ── Timeline ───────────────────────────────────────────────────────────────

export async function historyTimelineScreen(root, params) {
  root.innerHTML = `<section class="screen"><div class="loading">Loading trip…</div></section>`;
  let trip, milestones, depTz = null;
  try {
    if (!kindsCache) kindsCache = await api.get('/milestone_kinds?order=direction.asc,order_seq.asc');
    const tripRes = await api.get(`/trips?id=eq.${encodeURIComponent(params.id)}`);
    trip = Array.isArray(tripRes) ? tripRes[0] : null;
    if (!trip) throw new Error('Trip not found');
    const msRes = await api.get(`/milestones?trip_id=eq.${encodeURIComponent(params.id)}&void=eq.false&order=client_seq.asc`);
    milestones = Array.isArray(msRes) ? msRes : [];
    // Buffer-to-boarding needs the dep airport's tz to convert
    // sched_dep_local + sched_dep_date into a UTC instant. Fetched
    // separately because /trips doesn't carry tz.
    if (trip.direction === 'departure' && trip.dep_airport) {
      const apt = await api.get(`/airports?iata=eq.${encodeURIComponent(trip.dep_airport)}&select=iata,tz`).catch(() => []);
      depTz = Array.isArray(apt) && apt[0]?.tz ? apt[0].tz : null;
    }
  } catch (err) {
    renderError(root, err);
    return chrome({ showBack: true });
  }

  renderTimeline(root, trip, milestones, depTz);
  return chrome({ title: tripTitle(trip), showBack: true });
}

function tripTitle(trip) {
  return `${trip.dep_airport ?? '?'} → ${trip.arr_airport ?? '?'}`;
}

function renderTimeline(root, trip, milestones, depTz) {
  // Choose tz for display: airport the user was AT during this trip.
  const iata = trip.direction === 'arrival' ? trip.arr_airport : trip.dep_airport;
  const tz = inferTzFromMilestones(milestones) || null;

  const date = trip.sched_dep_date || trip.sched_arr_date || dateOnly(trip.created_at);
  const dirLabel = trip.direction === 'departure' ? 'Departure' : 'Arrival';
  const bufferLine = bufferLineHtml(trip, milestones, depTz);

  root.innerHTML = `
    <section class="screen">
      <div class="trip-header">
        <div class="trip-header-line">${escapeHtml(dirLabel)} · ${escapeHtml(date)}</div>
        <div class="trip-header-meta">
          ${escapeHtml(formatVar('Bags', trip.bags))} ·
          ${escapeHtml(formatVar('Party', trip.party))} ·
          ${escapeHtml(formatVar('Transit', trip.transit))} ·
          TSA ${trip.tsa_precheck ? 'Yes' : 'No'}
          ${trip.international ? ' · International' : ''}
        </div>
        <div class="trip-header-meta">
          Source: ${escapeHtml(trip.source)} · Status: ${escapeHtml(prettyStatus(trip.status))}${trip.test ? ' · <strong style="color:var(--warning)">TEST</strong>' : ''}
        </div>
        ${bufferLine}
      </div>
      ${milestones.length === 0
        ? '<div class="placeholder"><p>No milestones logged for this trip.</p></div>'
        : `<ol class="timeline">${milestones.map((m, i) => timelineRow(m, milestones[i - 1], iata, tz)).join('')}</ol>`}
    </section>
  `;
}

// "Buffer to boarding" = boarding_anchor - dep_security.logged_at. Boarding
// anchor is sched_dep_board_local when set, else sched_dep_local - 30 min
// (the universal "boarding closes ~30 min before takeoff" assumption).
// Returns empty string when not applicable (arrival, no dep_security, missing
// sched_dep, missing tz).
function bufferLineHtml(trip, milestones, depTz) {
  if (trip.direction !== 'departure') return '';
  if (!trip.sched_dep_local || !trip.sched_dep_date || !depTz) return '';
  const security = milestones.find((m) => m.kind === 'dep_security');
  if (!security) return '';
  const inferred = !trip.sched_dep_board_local;
  const boardingMs = computeBoardingUtcMs(trip, depTz);
  if (boardingMs == null) return '';
  const securityMs = new Date(security.logged_at).getTime();
  if (!Number.isFinite(securityMs)) return '';
  const bufferS = (boardingMs - securityMs) / 1000;
  const text = bufferS >= 0
    ? `Buffer to boarding: <strong>${escapeHtml(humanDuration(bufferS))}</strong>`
    : `Cleared security <strong>${escapeHtml(humanDuration(-bufferS))}</strong> after boarding`;
  const badge = inferred
    ? ' <span class="history-badge inferred" title="Boarding inferred as 30 min before takeoff">inferred</span>'
    : '';
  return `<div class="trip-header-meta">${text}${badge}</div>`;
}

// Compute the boarding UTC instant for a trip row. Mirrors the
// computeBoardingUtcMs() in web/screens/predict.js but works off API field
// names. Returns null when inputs are missing.
function computeBoardingUtcMs(trip, tz) {
  const dateStr = trip.sched_dep_date;
  const flightLocal = trip.sched_dep_local;
  const explicitBoard = trip.sched_dep_board_local;
  if (!dateStr || !flightLocal || !tz) return null;
  const flightMs = localDateTimeToUtcMs(dateStr, flightLocal, tz);
  if (flightMs == null) return null;
  if (explicitBoard) {
    let ms = localDateTimeToUtcMs(dateStr, explicitBoard, tz);
    // Red-eye: boarding > flight on same date → boarding is yesterday.
    if (ms != null && ms > flightMs) {
      ms = localDateTimeToUtcMs(addDays(dateStr, -1), explicitBoard, tz);
    }
    return ms;
  }
  // Inferred — 30 min before takeoff. PostgreSQL TIME columns serialize as
  // "HH:MM:SS" so a 30-min subtract is just date arithmetic on the UTC ms.
  return flightMs - 30 * 60 * 1000;
}

// Convert "YYYY-MM-DD" + "HH:MM[:SS]" + tz → UTC epoch ms. Same algorithm as
// services/predict's localToUtc and web/dst.js's localInputValueToUtcIso.
function localDateTimeToUtcMs(dateStr, timeStr, tz) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi, s] = timeStr.split(':').map(Number);
  if (![y, mo, d, h, mi].every(Number.isFinite)) return null;
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  const offsetMs = tzOffsetMs(new Date(asUtc), tz);
  return asUtc - offsetMs;
}

function tzOffsetMs(d, tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      timeZone: tz,
    }).formatToParts(d);
    const m = {};
    parts.forEach((p) => { if (p.type !== 'literal') m[p.type] = p.value; });
    const asIfUtc = Date.UTC(
      +m.year, +m.month - 1, +m.day,
      +(m.hour === '24' ? '0' : m.hour), +m.minute, +m.second,
    );
    return asIfUtc - d.getTime();
  } catch {
    return 0;
  }
}

function addDays(dateStr, n) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d) + n * 86400_000);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function humanDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function timelineRow(ms, prev, iata, tz) {
  const label = kindsCache?.find((k) => k.kind === ms.kind)?.label || ms.kind;
  const time = formatLocalTime(ms.logged_at, tz || iataTz(iata));
  const delta = prev ? humanDelta(prev.logged_at, ms.logged_at) : '';
  return `
    <li class="timeline-row">
      <span class="timeline-dot" aria-hidden="true"></span>
      <div class="timeline-body">
        <div class="timeline-label">${escapeHtml(label)}</div>
        <div class="timeline-time">${escapeHtml(time)}</div>
        ${delta ? `<div class="timeline-delta">+${escapeHtml(delta)} since previous</div>` : ''}
      </div>
    </li>
  `;
}

function inferTzFromMilestones() {
  // We don't have per-milestone tz. Fall back to nothing — let formatLocalTime
  // resolve via airportTzCache (populated by log.js / airport-picker).
  return null;
}

function iataTz(iata) {
  if (!iata) return null;
  // We can't synchronously read the log.js airportTzCache from here, so just
  // return null and let formatLocalTime fall through to UTC formatting. The
  // history view is informational; precision-to-the-minute in airport tz is
  // a follow-up.
  return null;
}

function formatLocalTime(iso, tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit',
      month: 'short', day: 'numeric',
      timeZone: tz || undefined,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

function humanDelta(fromIso, toIso) {
  const diffMs = new Date(toIso).getTime() - new Date(fromIso).getTime();
  if (diffMs < 0) return '';
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return '< 1 min';
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

function prettyStatus(status) {
  // DB stores `abandoned`; Nick prefers "incomplete" in the UI (M10 decision).
  return status === 'abandoned' ? 'incomplete' : status;
}

function formatVar(label, value) {
  if (!value) return `${label}: —`;
  // Unbeautify a few enum values for display.
  const pretty = {
    carry_on: 'Carry-on',
    checked: 'Checked',
    unknown: 'unknown',
    solo: 'Solo',
    group_with_kids: 'With kids',
    group_without_kids: 'No kids',
    car: 'Car',
    public: 'Public',
  }[value] || value;
  return `${label}: ${pretty}`;
}

// ── Errors ─────────────────────────────────────────────────────────────────

function renderError(root, err) {
  const msg = err instanceof ApiError ? `${err.status} ${err.statusText}` : err.message;
  root.innerHTML = `
    <section class="screen">
      <div class="placeholder">
        <h2>Couldn't load history</h2>
        <p>${escapeHtml(msg)}</p>
        <button class="btn btn-secondary" onclick="location.reload()" style="margin-top:16px">Retry</button>
      </div>
    </section>
  `;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function dateOnly(iso) {
  return iso ? iso.slice(0, 10) : '';
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }
