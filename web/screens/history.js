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
    ? '<span class="history-badge abandoned">abandoned</span>'
    : '';
  return `
    <li class="history-row" data-id="${escapeAttr(trip.id)}" role="button" tabindex="0">
      <div class="history-row-main">
        <div class="history-row-route">${escapeHtml(route)}</div>
        <div class="history-row-meta">
          ${escapeHtml(date)} ${statusBadge}
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
  let trip, milestones;
  try {
    if (!kindsCache) kindsCache = await api.get('/milestone_kinds?order=direction.asc,order_seq.asc');
    const tripRes = await api.get(`/trips?id=eq.${encodeURIComponent(params.id)}`);
    trip = Array.isArray(tripRes) ? tripRes[0] : null;
    if (!trip) throw new Error('Trip not found');
    const msRes = await api.get(`/milestones?trip_id=eq.${encodeURIComponent(params.id)}&void=eq.false&order=client_seq.asc`);
    milestones = Array.isArray(msRes) ? msRes : [];
  } catch (err) {
    renderError(root, err);
    return chrome({ showBack: true });
  }

  renderTimeline(root, trip, milestones);
  return chrome({ title: tripTitle(trip), showBack: true });
}

function tripTitle(trip) {
  return `${trip.dep_airport ?? '?'} → ${trip.arr_airport ?? '?'}`;
}

function renderTimeline(root, trip, milestones) {
  // Choose tz for display: airport the user was AT during this trip.
  const iata = trip.direction === 'arrival' ? trip.arr_airport : trip.dep_airport;
  const tz = inferTzFromMilestones(milestones) || null;

  const date = trip.sched_dep_date || trip.sched_arr_date || dateOnly(trip.created_at);
  const dirLabel = trip.direction === 'departure' ? 'Departure' : 'Arrival';

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
          Source: ${escapeHtml(trip.source)} · Status: ${escapeHtml(trip.status)}
        </div>
      </div>
      ${milestones.length === 0
        ? '<div class="placeholder"><p>No milestones logged for this trip.</p></div>'
        : `<ol class="timeline">${milestones.map((m, i) => timelineRow(m, milestones[i - 1], iata, tz)).join('')}</ol>`}
    </section>
  `;
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
