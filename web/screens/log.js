// Log screen. Empty-state hero, trip-start sheet, active 2x2-tile grid,
// long-press edit/void, undo toast.
//
// Writes go through the IndexedDB outbox (M8): the screen pushes to in-memory
// state, renders, and enqueues — no `await` on the server response. The body
// carries a client-generated `id` so downstream FKs work before the queue
// drains. Per-direction milestone progression driven by api.milestone_kinds
// (so customs/bag visibility lives in data, not code).

import { api, ApiError } from '../api.js';
import { mountAirportPicker } from './airport-picker.js';
import { getQueuedFor, getQueuedActiveTrip } from '../queue.js';
import {
  localInputValueToUtcIso,
  utcIsoToLocalInputValue,
  checkDst,
  checkDstCode,
} from '../dst.js';
import { list as listSavedPredictions, dismiss as dismissSavedPrediction } from '../saved-predictions.js';

// ── Module-level state ─────────────────────────────────────────────────────

let state = {
  trip: null,                // active trip row, or null
  milestones: [],            // milestones for the active trip (excludes void)
  kinds: null,               // cached milestone_kinds rows
  addresses: [],             // cached non-archived addresses (for trip start)
  international: false,      // session flag, controls dep_customs visibility
};

let lastTrip = null;         // cached "most recent app trip" for sticky vars

// Trips this session has queued a complete_trip PATCH for, by trip id. Used
// so undoing the final milestone after the user tapped Finish queues a
// reopen (status='in_progress') instead of leaving the trip frozen complete.
const completedThisSession = new Set();

// ── Entry ──────────────────────────────────────────────────────────────────

export async function logScreen(root) {
  root.innerHTML = `<div class="loading">Loading…</div>`;
  try {
    if (!state.kinds) state.kinds = await api.get('/milestone_kinds?order=direction.asc,order_seq.asc');
    state.trip = await loadActiveTrip();
    if (state.trip) {
      state.milestones = await loadMilestones(state.trip.id);
      // Restore the international flag if any customs was logged or if any
      // future-customs path was previously chosen. We persist this on the
      // trip's transit field? No — we just infer from the airport country
      // mismatch as a soft default. The user can flip a later toggle if needed.
      state.international = inferInternational(state.trip);
    } else {
      state.milestones = [];
      state.international = false;
    }
    renderScreen(root);

    // M14: Predict→Log handoff. If the user just hit "Start this trip" on
    // a prediction, window.__predictHandoff carries the form values they
    // typed; auto-open the matching start sheet pre-filled. Read-once.
    const handoff = window.__predictHandoff;
    if (handoff && !state.trip) {
      window.__predictHandoff = null;
      if (handoff.direction === 'departure') {
        openDepStartSheet(handoff);
      } else {
        openArrivalStartSheet(handoff);
      }
    }
  } catch (err) {
    console.error('logScreen failed:', err);
    renderFatal(root, err);
  }
  return { title: 'Travel Logger', tab: 'log',
           primary: { label: 'Addresses', href: '#/addresses' } };
}

async function loadActiveTrip() {
  // First check the outbox: a still-queued create_trip is the active trip
  // even though the server doesn't know about it yet. Survives page reload
  // mid-airport-WiFi.
  const queued = await getQueuedActiveTrip();
  if (queued) return { ...queued.body, _queued: true };

  const rows = await api.get(`/trips?status=eq.in_progress&order=created_at.desc&limit=1`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function loadMilestones(tripId) {
  // Server truth (excludes void). Merge in any still-queued POST /milestones
  // and apply pending PATCH /milestones (edit-time, void) on top — otherwise
  // a reload during a tap drops the optimistic row until the queue drains.
  let serverRows = [];
  try {
    const rows = await api.get(`/milestones?trip_id=eq.${tripId}&void=eq.false&order=client_seq.asc`);
    serverRows = Array.isArray(rows) ? rows : [];
  } catch (err) {
    // If the trip is queue-only (server doesn't have it), GET /milestones?trip_id=eq.<uuid>
    // succeeds with []. So this catch is for true network errors — log and
    // continue with [] so queued entries can still render.
    console.warn('loadMilestones: server fetch failed', err);
  }

  const byId = new Map(serverRows.map((m) => [m.id, m]));
  const queued = await getQueuedFor(tripId);
  for (const q of queued) {
    if (q.intent === 'log_milestone') {
      const id = q.body?.id;
      if (id && !byId.has(id)) byId.set(id, { ...q.body, _queued: true });
    } else if (q.intent === 'void_milestone' && q.related_milestone_id) {
      byId.delete(q.related_milestone_id);
    } else if (q.intent === 'edit_milestone' && q.related_milestone_id) {
      const target = byId.get(q.related_milestone_id);
      if (target) Object.assign(target, q.body);
    }
  }

  return [...byId.values()].sort((a, b) => a.client_seq - b.client_seq);
}

function inferInternational(trip) {
  // Persisted on the trip row (M7 migration 004). Defaults to false.
  return !!trip?.international;
}

// ── Render dispatch ────────────────────────────────────────────────────────

function renderScreen(root) {
  if (!state.trip) {
    renderEmpty(root);
  } else {
    renderActive(root);
  }
}

function renderFatal(root, err) {
  const msg = err instanceof ApiError ? `${err.status} ${err.statusText}` : err.message;
  root.innerHTML = `
    <section class="screen">
      <div class="placeholder">
        <h2>Couldn't load Log</h2>
        <p>${escapeHtml(msg)}</p>
        <button class="btn btn-secondary" onclick="location.reload()" style="margin-top:16px">Retry</button>
      </div>
    </section>
  `;
}

// ── Empty state ────────────────────────────────────────────────────────────

function renderEmpty(root) {
  // Saved predictions (M15): if Nick saved a prediction earlier, surface it
  // as a banner above the empty heroes so the trip plan can be resumed even
  // after a reload or a day passing. The banner taps into the same handoff
  // path that "Start this trip →" uses on the Predict tab.
  const saved = listSavedPredictions();
  const savedHtml = saved.map(savedBannerHtml).join('');

  root.innerHTML = `
    <section class="log-screen log-screen-empty${saved.length ? ' log-screen-with-banners' : ''}">
      ${savedHtml}
      <button class="log-hero log-hero-dep" id="start-dep-btn">
        Dep: In Transit
        <span class="log-hero-sub">Tap to start a departure</span>
      </button>
      <button class="log-hero log-hero-arr" id="start-arr-btn">
        Arr: Off Plane
        <span class="log-hero-sub">Tap when you've just landed</span>
      </button>
    </section>
  `;
  root.querySelector('#start-dep-btn').addEventListener('click', () => openDepStartSheet());
  root.querySelector('#start-arr-btn').addEventListener('click', () => openArrivalStartSheet());

  // Wire each saved-prediction banner. Tap body → resume into the trip-start
  // sheet with the saved values pre-filled. Tap × → drop the entry only.
  root.querySelectorAll('.saved-prediction-banner').forEach((el) => {
    const id = el.dataset.id;
    el.querySelector('[data-resume]')?.addEventListener('click', () => {
      const entry = listSavedPredictions().find((p) => p.id === id);
      if (!entry) { renderEmpty(root); return; }
      const handoff = handoffFromSaved(entry);
      // Consume on resume — once the trip starts logging, the saved entry
      // has done its job. (If the user backs out of the start sheet without
      // confirming, they can re-save from Predict.) Re-render so the banner
      // is gone if the user cancels the sheet rather than confirming.
      dismissSavedPrediction(id);
      renderEmpty(root);
      if (entry.direction === 'departure') openDepStartSheet(handoff);
      else openArrivalStartSheet(handoff);
    });
    el.querySelector('[data-dismiss]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissSavedPrediction(id);
      renderEmpty(root);
    });
  });
}

function handoffFromSaved(p) {
  return {
    direction: p.direction,
    airport: p.airport,
    origin_id: p.origin_id,
    bags: p.bags,
    party: p.party,
    transit: p.transit,
    tsa_precheck: p.tsa_precheck,
    international: p.international,
    sched_dep_date: p.flight_date_local,
    sched_dep_time: p.flight_time_local,
    sched_dep_board_time: p.flight_board_time_local || '',
    sched_arr_date: p.landing_date_local || '',
    sched_arr_time: p.landing_time_local || '',
    segments_snapshot: p.segments_snapshot || null,
  };
}

function savedBannerHtml(p) {
  const sign = p.direction === 'departure' ? -1 : 1;
  const leaveByMs = p.hero_anchor_utc_ms + sign * p.hero_offset_s * 1000;
  const tz = p.airport?.tz;
  const heroTime = formatBannerTime(leaveByMs, tz);
  const flightTime = formatBannerFlight(p.flight_utc_ms, tz);
  const dirTag = p.direction === 'departure' ? 'Dep' : 'Arr';
  const fromTo = p.origin_label
    ? (p.direction === 'departure' ? `from ${p.origin_label}` : `to ${p.origin_label}`)
    : '';
  return `
    <div class="saved-prediction-banner" data-id="${escapeAttr(p.id)}">
      <button class="saved-prediction-resume" type="button" data-resume>
        <span class="saved-prediction-action">${escapeHtml(p.hero_action)} ${escapeHtml(heroTime)}</span>
        <span class="saved-prediction-sub">
          <span class="saved-prediction-dir">${dirTag}</span>
          <span class="saved-prediction-iata">${escapeHtml(p.airport?.iata ?? '')}</span>
          <span class="saved-prediction-flight">${escapeHtml(flightTime)}</span>
          ${fromTo ? `<span class="saved-prediction-origin">${escapeHtml(fromTo)}</span>` : ''}
        </span>
      </button>
      <button class="saved-prediction-dismiss" type="button" data-dismiss aria-label="Dismiss saved prediction">×</button>
    </div>
  `;
}

function formatBannerTime(ms, tz) {
  if (!Number.isFinite(ms)) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit',
      timeZone: tz,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

function formatBannerFlight(ms, tz) {
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      timeZone: tz,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

// ── Active state — log grid ────────────────────────────────────────────────

function renderActive(root) {
  const visibleKinds = visibleKindsForTrip();
  const loggedByKind = new Map(state.milestones.map((m) => [m.kind, m]));
  const nextKind = visibleKinds.find((k) => !loggedByKind.has(k.kind));

  // No "next" — every visible milestone is logged. Show a "trip complete"
  // tile as the hero so the user has 60s to long-press / undo before we PATCH
  // the trip to status='complete'. The actual completion happens from the
  // logMilestone tap path, not here, to keep ordering deterministic.
  if (!nextKind) {
    renderAllDone(root, visibleKinds, loggedByKind);
    return;
  }

  const heroKind = nextKind;
  const otherKinds = visibleKinds.filter((k) => k.kind !== heroKind.kind);

  const route = `${state.trip.dep_airport ?? '?'} → ${state.trip.arr_airport ?? '?'}`;

  root.innerHTML = `
    <section class="log-screen">
      <div class="log-trip-meta">
        <span class="log-trip-route">${escapeHtml(route)}</span>
        <div class="log-trip-actions">
          <button id="abandon-trip-btn">Abandon</button>
        </div>
      </div>
      <div class="log-grid">
        <button class="log-hero-tile" id="hero-tile" data-kind="${escapeAttr(heroKind.kind)}">
          ${escapeHtml(heroKind.label)}
          <span class="log-hero-tile-sub">Tap to log now</span>
        </button>
        <div class="log-tile-strip">
          ${otherKinds.map((k) => tileHtml(k, loggedByKind.get(k.kind))).join('')}
        </div>
      </div>
    </section>
  `;

  root.querySelector('#hero-tile').addEventListener('click', () => logMilestone(root, heroKind.kind));
  attachLongPressHandlers(root);

  root.querySelector('#abandon-trip-btn').addEventListener('click', () => {
    if (!confirm('Abandon this in-progress trip? Logged milestones stay in history.')) return;
    const tripId = state.trip.id;
    api.patch(`/trips?id=eq.${tripId}`, { status: 'abandoned' },
      { intent: 'abandon_trip', trip_id: tripId });
    clearSegmentsForTrip(tripId);
    state.trip = null; state.milestones = [];
    window.__toast?.('Trip abandoned', { level: 'info' });
    renderScreen(root);
  });
}

function tileHtml(kind, logged) {
  // Future bags tile when bags=carry_on, dep_customs when not international.
  if (logged) {
    return `
      <button class="log-tile" data-state="done" data-kind="${escapeAttr(kind.kind)}"
              data-milestone-id="${escapeAttr(logged.id)}">
        <span class="log-tile-mark">✓ Done</span>
        <span class="log-tile-label">${escapeHtml(kind.label)}</span>
        <span class="log-tile-time">${formatLocalTime(logged.logged_at, currentAirportIata())}</span>
      </button>
    `;
  }
  return `
    <button class="log-tile" data-state="future" data-kind="${escapeAttr(kind.kind)}" disabled>
      <span class="log-tile-mark">Next</span>
      <span class="log-tile-label">${escapeHtml(kind.label)}</span>
      <span class="log-tile-time">—</span>
    </button>
  `;
}

// The airport the user is physically AT during the active state — used to
// pick which tz to format milestone times in. For a departure trip, it's the
// dep airport (where you're checking in); for arrival, the arr airport
// (where you just landed).
function currentAirportIata(trip = state.trip) {
  if (!trip) return null;
  return trip.direction === 'arrival' ? trip.arr_airport : trip.dep_airport;
}

function visibleKindsForTrip() {
  const direction = state.trip.direction;
  const isCarry = state.trip.bags === 'carry_on';
  return state.kinds
    .filter((k) => k.direction === direction)
    .filter((k) => isCarry ? k.shown_when_carry_on : true)
    // Customs tile (dep or arr) hides unless the trip flagged international.
    .filter((k) => (k.kind !== 'dep_customs' && k.kind !== 'arr_customs') || state.international)
    .sort((a, b) => a.order_seq - b.order_seq);
}

// "All done" view — every visible milestone is logged but the trip is still
// in_progress. Lets the user long-press to edit/void or tap "Finish" to lock
// it as complete. Auto-completes on next render after a short grace if the
// user navigates away.
function renderAllDone(root, visibleKinds, loggedByKind) {
  const route = `${state.trip.dep_airport ?? '?'} → ${state.trip.arr_airport ?? '?'}`;
  root.innerHTML = `
    <section class="log-screen">
      <div class="log-trip-meta">
        <span class="log-trip-route">${escapeHtml(route)}</span>
        <div class="log-trip-actions">
          <button id="abandon-trip-btn">Abandon</button>
        </div>
      </div>
      <div class="log-grid">
        <button class="log-hero-tile" id="finish-tile" style="background:var(--success);color:#000">
          ✓ All milestones logged
          <span class="log-hero-tile-sub">Tap to finish trip</span>
        </button>
        <div class="log-tile-strip">
          ${visibleKinds.map((k) => tileHtml(k, loggedByKind.get(k.kind))).join('')}
        </div>
      </div>
    </section>
  `;
  root.querySelector('#finish-tile').addEventListener('click', () => completeTrip(root));
  root.querySelector('#abandon-trip-btn').addEventListener('click', async () => {
    if (!confirm('Abandon this in-progress trip? Logged milestones stay in history.')) return;
    const tripId = state.trip.id;
    try {
      await api.patch(`/trips?id=eq.${tripId}`, { status: 'abandoned' });
      clearSegmentsForTrip(tripId);
      state.trip = null; state.milestones = [];
      window.__toast?.('Trip abandoned', { level: 'info' });
      renderScreen(root);
    } catch (err) {
      console.error(err);
      window.__toast?.(`Abandon failed: ${err.message}`, { level: 'error' });
    }
  });
  attachLongPressHandlers(root);
}

// ── Milestone tap ──────────────────────────────────────────────────────────

async function logMilestone(root, kind) {
  const nextSeq = (state.milestones.reduce((m, x) => Math.max(m, x.client_seq), 0)) + 1;
  const tripId = state.trip.id;
  const optimistic = {
    id: cryptoRandomId(),
    trip_id: tripId,
    kind,
    logged_at: new Date().toISOString(),
    client_seq: nextSeq,
    void: false,
  };
  state.milestones.push(optimistic);
  renderActive(root);

  api.post('/milestones', {
    id: optimistic.id,
    trip_id: optimistic.trip_id,
    kind: optimistic.kind,
    logged_at: optimistic.logged_at,
    client_seq: optimistic.client_seq,
  }, { intent: 'log_milestone', trip_id: tripId, milestone_id: optimistic.id });

  haptic(10);
  const comparison = segmentComparisonLine(tripId, kind, optimistic.logged_at);
  showUndoToast(root, optimistic.id, tripId, kindLabel(kind), comparison);
}

function showUndoToast(root, milestoneId, tripId, label, comparison = '') {
  const msg = comparison ? `Logged: ${label} · ${comparison}` : `Logged: ${label}`;
  window.__toast?.(msg, {
    level: 'success',
    ms: 60_000,
    action: {
      label: 'Undo',
      onClick: () => voidMilestone(root, milestoneId, tripId, 'undo'),
    },
  });
}

async function voidMilestone(root, milestoneId, tripId, reason) {
  // ms may be missing if undo fired after the user tapped Finish (state.trip
  // and state.milestones are wiped at that point). The toast captures tripId
  // in its closure so we can still queue the void + reopen.
  const ms = state.milestones.find((m) => m.id === milestoneId);
  const label = ms ? kindLabel(ms.kind) : 'milestone';
  if (ms) {
    state.milestones = state.milestones.filter((m) => m.id !== milestoneId);
    renderActive(root);
  }

  api.patch(`/milestones?id=eq.${milestoneId}`,
    { void: true, void_reason: reason },
    { intent: 'void_milestone', trip_id: tripId, milestone_id: milestoneId });
  window.__toast?.(`Removed: ${label}`, { level: 'info' });

  // If the user already tapped Finish on this trip, re-open it. Tracked
  // client-side via completedThisSession (the queue may not have drained).
  if (tripId && completedThisSession.has(tripId)) {
    api.patch(`/trips?id=eq.${tripId}`,
      { status: 'in_progress' },
      { intent: 'reopen_trip', trip_id: tripId });
    completedThisSession.delete(tripId);
    // Re-mount the active state so the user can keep editing.
    state.trip = await loadActiveTrip();
    state.milestones = state.trip ? await loadMilestones(state.trip.id) : [];
    const screenEl = document.getElementById('screen');
    if (screenEl) renderScreen(screenEl);
  }
}

function editMilestoneTime(root, milestoneId, newIsoUtc) {
  const ms = state.milestones.find((m) => m.id === milestoneId);
  if (!ms) return;
  ms.logged_at = newIsoUtc;
  renderActive(root);
  api.patch(`/milestones?id=eq.${milestoneId}`,
    { logged_at: newIsoUtc },
    { intent: 'edit_milestone', trip_id: state.trip?.id, milestone_id: milestoneId });
  window.__toast?.('Time updated', { level: 'success' });
}

function completeTrip(root) {
  if (!state.trip || state.trip._completing) return;
  state.trip._completing = true;
  const tripId = state.trip.id;
  api.patch(`/trips?id=eq.${tripId}`, { status: 'complete' },
    { intent: 'complete_trip', trip_id: tripId });
  completedThisSession.add(tripId);
  clearSegmentsForTrip(tripId);
  window.__toast?.('Trip complete 🎉', { level: 'success', ms: 4000 });
  state.trip = null;
  state.milestones = [];
  state.international = false;
  renderScreen(root);
}

// ── Long-press → edit/void sheet ───────────────────────────────────────────

function attachLongPressHandlers(root) {
  root.querySelectorAll('.log-tile[data-state="done"]').forEach((tile) => {
    let pressTimer = null;
    let fired = false;
    const start = () => {
      fired = false;
      pressTimer = setTimeout(() => {
        fired = true;
        haptic(20);
        openEditVoidSheet(root, tile.dataset.milestoneId, tile.dataset.kind);
      }, 500);
    };
    const cancel = () => clearTimeout(pressTimer);
    tile.addEventListener('touchstart', start, { passive: true });
    tile.addEventListener('touchend', cancel);
    tile.addEventListener('touchmove', cancel);
    tile.addEventListener('touchcancel', cancel);
    tile.addEventListener('mousedown', start);
    tile.addEventListener('mouseup', cancel);
    tile.addEventListener('mouseleave', cancel);
    tile.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      cancel();
      if (!fired) openEditVoidSheet(root, tile.dataset.milestoneId, tile.dataset.kind);
    });
    tile.addEventListener('click', (e) => { if (fired) e.preventDefault(); });
  });
}

function openEditVoidSheet(root, milestoneId, kind) {
  const ms = state.milestones.find((m) => m.id === milestoneId);
  if (!ms) return;
  const iata = currentAirportIata();
  const tz = airportTzCache.get(iata) || 'UTC';
  const localValue = utcIsoToLocalInputValue(ms.logged_at, tz);

  openSheet({
    title: kindLabel(kind),
    body: `
      <div class="form" novalidate>
        <div class="form-row">
          <label for="edit-time">Logged at (local to ${escapeHtml(iata ?? 'airport')})</label>
          <input id="edit-time" type="datetime-local" value="${escapeAttr(localValue)}">
          <p class="hint">Stored as UTC; displayed in the airport's local time.</p>
        </div>
        <div class="action-list">
          <button type="button" id="save-time-btn" class="btn btn-primary">Save time</button>
          <button type="button" id="void-btn" class="danger">Remove this milestone</button>
        </div>
      </div>
    `,
    onMount: (sheetRoot, close) => {
      sheetRoot.querySelector('#save-time-btn').addEventListener('click', () => {
        const v = sheetRoot.querySelector('#edit-time').value;
        if (!v) return;
        const utc = localInputValueToUtcIso(v, tz);
        close();
        editMilestoneTime(root, milestoneId, utc);
      });
      sheetRoot.querySelector('#void-btn').addEventListener('click', () => {
        close();
        voidMilestone(root, milestoneId, state.trip.id, 'manual');
      });
    },
  });
}

// ── Trip-start sheet ───────────────────────────────────────────────────────

async function openDepStartSheet(handoff = null) {
  // Fetch sticky vars + address book in parallel before opening the sheet.
  const [addressesRes, lastTripRes] = await Promise.all([
    api.get('/addresses?archived=eq.false&order=updated_at.desc').catch(() => []),
    api.get('/trips?source=eq.app&order=created_at.desc&limit=1').catch(() => []),
  ]);
  state.addresses = Array.isArray(addressesRes) ? addressesRes : [];
  lastTrip = (Array.isArray(lastTripRes) && lastTripRes[0]) || null;

  // Handoff (M14: predict→trip) overrides sticky-from-last-trip defaults so
  // the values the user just typed into Predict are preserved exactly.
  const initialBags    = handoff?.bags          ?? stickyBags(lastTrip?.bags);
  const initialParty   = handoff?.party         ?? lastTrip?.party   ?? 'solo';
  const initialTransit = handoff?.transit       ?? lastTrip?.transit ?? 'car';
  const initialTsa     = handoff?.tsa_precheck  ?? !!lastTrip?.tsa_precheck;
  const initialIntl    = handoff?.international ?? false;
  const initialAddrId  = handoff?.origin_id     ?? lastTrip?.address_id ?? state.addresses[0]?.id ?? '';

  const draft = {
    address_id: initialAddrId,
    dep_airport: handoff?.airport ?? null,    // {iata,name,city,tz,lat,lng}
    arr_airport: null,
    sched_dep_date: handoff?.sched_dep_date ?? '',
    sched_dep_time: handoff?.sched_dep_time ?? '',
    sched_dep_board_time: handoff?.sched_dep_board_time ?? '',
    sched_arr_date: handoff?.sched_arr_date ?? '',
    sched_arr_time: handoff?.sched_arr_time ?? '',
    bags: initialBags,
    party: initialParty,
    transit: initialTransit,
    tsa_precheck: initialTsa,
    international: initialIntl,
    test: false,              // M11: never sticky — always re-confirm per trip
  };

  openSheet({
    title: 'Start trip',
    body: `
      <form class="form" novalidate>
        <div class="form-row">
          <label for="origin-select">Origin address</label>
          <select id="origin-select" class="form-row" style="padding:12px 14px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-md);font-size:16px">
            ${state.addresses.length ? '' : '<option value="">— No saved addresses —</option>'}
            ${state.addresses.map((a) => `
              <option value="${escapeAttr(a.id)}" ${a.id === initialAddrId ? 'selected' : ''}>
                ${escapeHtml(a.label)}
              </option>
            `).join('')}
          </select>
          <p class="hint">
            <a href="#/addresses/new" id="add-addr-link">+ Add a new address</a>
          </p>
        </div>

        <div id="dep-airport-slot"></div>
        <div id="arr-airport-slot"></div>

        <div class="form-row">
          <label>Scheduled departure (local)</label>
          <div class="datetime-row">
            <input id="sched-dep-date" type="date">
            <input id="sched-dep-time" type="time">
          </div>
        </div>
        <div class="form-row">
          <label for="sched-dep-board-time">Scheduled boarding (local) — optional</label>
          <input id="sched-dep-board-time" type="time">
          <p class="hint">Date matches the flight; red-eyes (boarding after takeoff time) infer the previous day.</p>
        </div>
        <div class="form-row">
          <label>Scheduled arrival (local)</label>
          <div class="datetime-row">
            <input id="sched-arr-date" type="date">
            <input id="sched-arr-time" type="time">
          </div>
        </div>
        <div id="dst-slot"></div>

        <div class="form-row">
          <label>Bags</label>
          <div class="toggle-group" data-field="bags">
            <button type="button" data-value="carry_on">Carry-on</button>
            <button type="button" data-value="checked">Checked</button>
          </div>
        </div>
        <div class="form-row">
          <label>Party</label>
          <div class="toggle-group" data-field="party">
            <button type="button" data-value="solo">Solo</button>
            <button type="button" data-value="group_without_kids">No kids</button>
            <button type="button" data-value="group_with_kids">With kids</button>
          </div>
        </div>
        <div class="form-row">
          <label>Transit</label>
          <div class="toggle-group" data-field="transit">
            <button type="button" data-value="car">Car</button>
            <button type="button" data-value="public">Public</button>
          </div>
        </div>
        <div class="form-row">
          <label>TSA PreCheck</label>
          <div class="toggle-group" data-field="tsa_precheck">
            <button type="button" data-value="false">No</button>
            <button type="button" data-value="true">Yes</button>
          </div>
        </div>
        <div class="form-row">
          <label>International / preclearance</label>
          <div class="toggle-group" data-field="international">
            <button type="button" data-value="false">No</button>
            <button type="button" data-value="true">Yes</button>
          </div>
          <p class="hint">Yes shows the Customs tile (e.g. YYZ US preclearance).</p>
        </div>
        <div class="form-row">
          <label>Test trip</label>
          <div class="toggle-group" data-field="test">
            <button type="button" data-value="false">No</button>
            <button type="button" data-value="true">Yes</button>
          </div>
          <p class="hint">Test trips show a TEST badge in history and never feed predictions.</p>
        </div>

        <div id="trip-error" class="hint" style="color:var(--error)" hidden></div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" id="trip-cancel-btn">Cancel</button>
          <button type="button" class="btn btn-primary" id="trip-start-btn">Start trip</button>
        </div>
      </form>
    `,
    onMount: (sheetRoot, close) => {
      const errEl = sheetRoot.querySelector('#trip-error');
      const startBtn = sheetRoot.querySelector('#trip-start-btn');

      // Toggle groups → draft state.
      sheetRoot.querySelectorAll('.toggle-group').forEach((g) => {
        const field = g.dataset.field;
        const current = String(draft[field]);
        g.querySelectorAll('button').forEach((b) => {
          if (b.dataset.value === current) b.setAttribute('aria-pressed', 'true');
          b.addEventListener('click', () => {
            g.querySelectorAll('button').forEach((bb) => bb.setAttribute('aria-pressed', 'false'));
            b.setAttribute('aria-pressed', 'true');
            draft[field] = (field === 'tsa_precheck' || field === 'international' || field === 'test')
              ? b.dataset.value === 'true'
              : b.dataset.value;
          });
        });
      });

      // Origin select.
      const originSel = sheetRoot.querySelector('#origin-select');
      originSel.addEventListener('change', () => { draft.address_id = originSel.value || null; });
      sheetRoot.querySelector('#add-addr-link').addEventListener('click', () => {
        // Closing the sheet preserves the user's intent; they'll come back to /log.
        close();
      });

      // Airport pickers — handoff from Predict pre-fills dep_airport.
      mountAirportPicker(sheetRoot.querySelector('#dep-airport-slot'), {
        id: 'dep-airport',
        label: 'Departure airport',
        placeholder: 'IATA, city, or name',
        initial: draft.dep_airport || undefined,
        onChange: (a) => {
          draft.dep_airport = a;
          if (a?.iata && a?.tz) airportTzCache.set(a.iata, a.tz);
          revalidateDst();
        },
      });
      mountAirportPicker(sheetRoot.querySelector('#arr-airport-slot'), {
        id: 'arr-airport',
        label: 'Arrival airport',
        placeholder: 'IATA, city, or name',
        onChange: (a) => {
          draft.arr_airport = a;
          if (a?.iata && a?.tz) airportTzCache.set(a.iata, a.tz);
          revalidateDst();
        },
      });

      // Datetime fields — handoff pre-fills the dep half.
      const fields = {
        depDate: sheetRoot.querySelector('#sched-dep-date'),
        depTime: sheetRoot.querySelector('#sched-dep-time'),
        arrDate: sheetRoot.querySelector('#sched-arr-date'),
        arrTime: sheetRoot.querySelector('#sched-arr-time'),
      };
      if (draft.sched_dep_date) fields.depDate.value = draft.sched_dep_date;
      if (draft.sched_dep_time) fields.depTime.value = draft.sched_dep_time;
      if (draft.sched_arr_date) fields.arrDate.value = draft.sched_arr_date;
      if (draft.sched_arr_time) fields.arrTime.value = draft.sched_arr_time;
      Object.entries(fields).forEach(([k, el]) => {
        el.addEventListener('change', () => {
          draft[`sched_${k.startsWith('dep') ? 'dep' : 'arr'}_${k.endsWith('Date') ? 'date' : 'time'}`] = el.value;
          revalidateDst();
        });
      });

      // Optional boarding time — separate from the depDate/depTime pair.
      const boardEl = sheetRoot.querySelector('#sched-dep-board-time');
      if (draft.sched_dep_board_time) boardEl.value = draft.sched_dep_board_time;
      boardEl.addEventListener('change', () => { draft.sched_dep_board_time = boardEl.value; });

      // DST validation. Shows a warning banner under the times.
      const dstSlot = sheetRoot.querySelector('#dst-slot');
      function revalidateDst() {
        const warnings = [];
        if (draft.dep_airport && draft.sched_dep_date && draft.sched_dep_time) {
          const w = checkDst(draft.sched_dep_date, draft.sched_dep_time, draft.dep_airport.tz);
          if (w) warnings.push(`Departure: ${w}`);
        }
        if (draft.arr_airport && draft.sched_arr_date && draft.sched_arr_time) {
          const w = checkDst(draft.sched_arr_date, draft.sched_arr_time, draft.arr_airport.tz);
          if (w) warnings.push(`Arrival: ${w}`);
        }
        dstSlot.innerHTML = warnings.length
          ? `<div class="dst-warning">⚠ ${warnings.map(escapeHtml).join('<br>')}<br>You can still proceed.</div>`
          : '';
      }

      sheetRoot.querySelector('#trip-cancel-btn').addEventListener('click', close);

      startBtn.addEventListener('click', async () => {
        const err = validateDraft(draft);
        if (err) { errEl.hidden = false; errEl.textContent = err; return; }
        errEl.hidden = true;
        startBtn.disabled = true;
        startBtn.textContent = 'Starting…';
        try {
          await startTrip(draft);
          stashSegmentsForTrip(state.trip?.id, handoff?.segments_snapshot);
          close();
        } catch (err) {
          console.error(err);
          errEl.hidden = false;
          errEl.textContent = err instanceof ApiError
            ? `${err.status}: ${err.body || err.statusText}`
            : err.message;
          startBtn.disabled = false;
          startBtn.textContent = 'Start trip';
        }
      });
    },
  });
}

function validateDraft(d) {
  if (!d.address_id) return 'Pick or add an origin address first.';
  if (!d.dep_airport) return 'Pick a departure airport.';
  if (!d.arr_airport) return 'Pick an arrival airport.';
  if (!d.sched_dep_date || !d.sched_dep_time) return 'Set scheduled departure date + time.';
  if (!d.sched_arr_date || !d.sched_arr_time) return 'Set scheduled arrival date + time.';
  return null;
}

async function startTrip(d) {
  // Compute DST flag (one warning recorded per trip; departure takes precedence).
  const depDst = checkDstCode(d.sched_dep_date, d.sched_dep_time, d.dep_airport.tz);
  const arrDst = checkDstCode(d.sched_arr_date, d.sched_arr_time, d.arr_airport.tz);
  const dst_warning = depDst || arrDst;

  // Client-generate the trip id so the first milestone's trip_id resolves
  // before either POST drains.
  const tripId = cryptoRandomId();
  const tripBody = {
    id: tripId,
    direction: 'departure',
    address_id: d.address_id,
    dep_airport: d.dep_airport.iata,
    arr_airport: d.arr_airport.iata,
    sched_dep_local: d.sched_dep_time,
    sched_dep_board_local: d.sched_dep_board_time || null,
    sched_dep_date: d.sched_dep_date,
    sched_arr_local: d.sched_arr_time,
    sched_arr_date: d.sched_arr_date,
    dst_warning,
    bags: d.bags,
    party: d.party,
    transit: d.transit,
    tsa_precheck: d.tsa_precheck,
    international: d.international,
    test: d.test,
    status: 'in_progress',
    source: 'app',
  };
  // IMPORTANT: enqueue the trip BEFORE the milestone, and await the trip's
  // enqueue first. api.post returns after the IDB write commits, so awaiting
  // it ensures the trip entry's created_at is older than the milestone's
  // when both land in the outbox. The drain loop reads head by created_at
  // ASC, so the trip POST always attempts first. Without the await, the two
  // enqueue tasks race through their own IDB transactions; whichever
  // commits first gets the older effective ordering, and a milestone-first
  // commit triggers FK violations until the trip eventually arrives — see
  // /qa pre-M11 sweep, where dep_in_transit dead-lettered on its own trip.
  await api.post('/trips', tripBody, { intent: 'create_trip', trip_id: tripId });

  const milestoneId = cryptoRandomId();
  const milestoneBody = {
    id: milestoneId,
    trip_id: tripId,
    kind: 'dep_in_transit',
    logged_at: new Date().toISOString(),
    client_seq: 1,
    void: false,
  };
  await api.post('/milestones', milestoneBody,
    { intent: 'log_milestone', trip_id: tripId, milestone_id: milestoneId });

  // Mount active state from our optimistic bodies — they're the source of
  // truth until the queue drains.
  state.trip = tripBody;
  state.milestones = [milestoneBody];
  state.international = d.international;
  haptic(15);
  window.__toast?.('Trip started · In Transit logged', { level: 'success' });
  const screenEl = document.getElementById('screen');
  if (screenEl) renderScreen(screenEl);
}

function stickyBags(prev) {
  // Legacy trips were imported with bags='unknown' — never sticky that.
  if (prev === 'checked' || prev === 'carry_on') return prev;
  return 'carry_on';
}

// ── Arrival start sheet ────────────────────────────────────────────────────
//
// Per Flow C: minimal sheet — destination address required; arrival airport
// auto-fills from the most-recent completed *departure* trip's arr_airport
// (with a "Change" affordance); everything else (bags/party/transit/tsa/
// international) is sticky from the same dep trip.
async function openArrivalStartSheet(handoff = null) {
  const [addressesRes, lastDepRes] = await Promise.all([
    api.get('/addresses?archived=eq.false&order=updated_at.desc').catch(() => []),
    api.get('/trips?direction=eq.departure&status=eq.complete&order=created_at.desc&limit=1').catch(() => []),
  ]);
  state.addresses = Array.isArray(addressesRes) ? addressesRes : [];
  const lastDep = (Array.isArray(lastDepRes) && lastDepRes[0]) || null;

  // Auto-fill from last departure trip OR from a Predict→trip handoff.
  // Handoff wins for the airport, address, and trip vars; lastDep still
  // carries forward the originating dep_airport silently.
  let depAirport = null, arrAirport = null;
  if (handoff?.airport) {
    arrAirport = handoff.airport;
    if (arrAirport.iata && arrAirport.tz) airportTzCache.set(arrAirport.iata, arrAirport.tz);
  } else if (lastDep?.arr_airport) {
    arrAirport = await fetchAirport(lastDep.arr_airport);
    if (arrAirport?.iata && arrAirport?.tz) airportTzCache.set(arrAirport.iata, arrAirport.tz);
  }
  if (lastDep?.dep_airport) {
    depAirport = await fetchAirport(lastDep.dep_airport);
  }

  const draft = {
    address_id: handoff?.origin_id ?? state.addresses[0]?.id ?? '',
    dep_airport: depAirport,        // carried forward silently
    arr_airport: arrAirport,        // editable
    bags:           handoff?.bags          ?? stickyBags(lastDep?.bags),
    party:          handoff?.party         ?? lastDep?.party   ?? 'solo',
    transit:        handoff?.transit       ?? lastDep?.transit ?? 'car',
    tsa_precheck:   handoff?.tsa_precheck  ?? !!lastDep?.tsa_precheck,
    international:  handoff?.international ?? !!lastDep?.international,
    test:           false,        // M11: never sticky — always re-confirm per trip
  };

  openSheet({
    title: 'Start arrival',
    body: `
      <form class="form" novalidate>
        <div class="form-row">
          <label for="dest-select">Destination address</label>
          <select id="dest-select" class="form-row" style="padding:12px 14px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-md);font-size:16px">
            ${state.addresses.length ? '' : '<option value="">— No saved addresses —</option>'}
            ${state.addresses.map((a) => `
              <option value="${escapeAttr(a.id)}" ${a.id === draft.address_id ? 'selected' : ''}>
                ${escapeHtml(a.label)}
              </option>
            `).join('')}
          </select>
          <p class="hint">
            <a href="#/addresses/new" id="add-addr-link">+ Add a new address</a>
          </p>
        </div>

        <div class="form-row">
          <label>Arrival airport</label>
          <div id="arr-airport-display"></div>
        </div>
        <div id="arr-airport-slot" hidden></div>

        <div class="form-row">
          <label>Bags</label>
          <div class="toggle-group" data-field="bags">
            <button type="button" data-value="carry_on">Carry-on</button>
            <button type="button" data-value="checked">Checked</button>
          </div>
        </div>
        <div class="form-row">
          <label>Party</label>
          <div class="toggle-group" data-field="party">
            <button type="button" data-value="solo">Solo</button>
            <button type="button" data-value="group_without_kids">No kids</button>
            <button type="button" data-value="group_with_kids">With kids</button>
          </div>
        </div>
        <div class="form-row">
          <label>Transit</label>
          <div class="toggle-group" data-field="transit">
            <button type="button" data-value="car">Car</button>
            <button type="button" data-value="public">Public</button>
          </div>
        </div>
        <div class="form-row">
          <label>TSA PreCheck</label>
          <div class="toggle-group" data-field="tsa_precheck">
            <button type="button" data-value="false">No</button>
            <button type="button" data-value="true">Yes</button>
          </div>
        </div>
        <div class="form-row">
          <label>International / customs</label>
          <div class="toggle-group" data-field="international">
            <button type="button" data-value="false">No</button>
            <button type="button" data-value="true">Yes</button>
          </div>
          <p class="hint">Yes shows the Customs tile in the active grid.</p>
        </div>
        <div class="form-row">
          <label>Test trip</label>
          <div class="toggle-group" data-field="test">
            <button type="button" data-value="false">No</button>
            <button type="button" data-value="true">Yes</button>
          </div>
          <p class="hint">Test trips show a TEST badge in history and never feed predictions.</p>
        </div>

        <div id="arr-error" class="hint" style="color:var(--error)" hidden></div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" id="arr-cancel-btn">Cancel</button>
          <button type="button" class="btn btn-primary" id="arr-start-btn">Start arrival</button>
        </div>
      </form>
    `,
    onMount: (sheetRoot, close) => {
      const errEl = sheetRoot.querySelector('#arr-error');
      const startBtn = sheetRoot.querySelector('#arr-start-btn');
      const arrAirportSlot = sheetRoot.querySelector('#arr-airport-slot');
      const arrDisplay = sheetRoot.querySelector('#arr-airport-display');

      // Toggle groups → draft state.
      sheetRoot.querySelectorAll('.toggle-group').forEach((g) => {
        const field = g.dataset.field;
        const current = String(draft[field]);
        g.querySelectorAll('button').forEach((b) => {
          if (b.dataset.value === current) b.setAttribute('aria-pressed', 'true');
          b.addEventListener('click', () => {
            g.querySelectorAll('button').forEach((bb) => bb.setAttribute('aria-pressed', 'false'));
            b.setAttribute('aria-pressed', 'true');
            draft[field] = (field === 'tsa_precheck' || field === 'international' || field === 'test')
              ? b.dataset.value === 'true'
              : b.dataset.value;
          });
        });
      });

      // Destination select.
      const destSel = sheetRoot.querySelector('#dest-select');
      destSel.addEventListener('change', () => { draft.address_id = destSel.value || null; });
      sheetRoot.querySelector('#add-addr-link').addEventListener('click', close);

      // Arrival airport: render auto-filled pill + Change affordance.
      function renderArrAirportDisplay() {
        if (draft.arr_airport) {
          arrDisplay.innerHTML = `
            <div class="iata-pill">
              <strong>${escapeHtml(draft.arr_airport.iata)}</strong>
              <span class="iata-pill-name">${escapeHtml(draft.arr_airport.name || draft.arr_airport.city || '')}</span>
              <button type="button" class="btn-link" id="change-arr-btn" style="padding:0 8px;font-size:14px">Change</button>
            </div>
          `;
          arrDisplay.querySelector('#change-arr-btn').addEventListener('click', () => {
            arrDisplay.innerHTML = '<p class="hint">Pick the airport you just landed at:</p>';
            arrAirportSlot.hidden = false;
            mountAirportPicker(arrAirportSlot, {
              id: 'arr-airport',
              label: 'Arrival airport',
              placeholder: 'IATA, city, or name',
              onChange: (a) => {
                draft.arr_airport = a;
                if (a?.iata && a?.tz) airportTzCache.set(a.iata, a.tz);
                renderArrAirportDisplay();
                arrAirportSlot.innerHTML = '';
                arrAirportSlot.hidden = true;
              },
            });
          });
        } else {
          arrDisplay.innerHTML = '';
          arrAirportSlot.hidden = false;
          mountAirportPicker(arrAirportSlot, {
            id: 'arr-airport',
            label: 'Arrival airport',
            placeholder: 'IATA, city, or name',
            onChange: (a) => {
              draft.arr_airport = a;
              if (a?.iata && a?.tz) airportTzCache.set(a.iata, a.tz);
              renderArrAirportDisplay();
              arrAirportSlot.innerHTML = '';
              arrAirportSlot.hidden = true;
            },
          });
        }
      }
      renderArrAirportDisplay();

      sheetRoot.querySelector('#arr-cancel-btn').addEventListener('click', close);

      startBtn.addEventListener('click', async () => {
        if (!draft.address_id) { errEl.hidden = false; errEl.textContent = 'Pick or add a destination address.'; return; }
        if (!draft.arr_airport) { errEl.hidden = false; errEl.textContent = 'Pick the airport you just landed at.'; return; }
        errEl.hidden = true;
        startBtn.disabled = true;
        startBtn.textContent = 'Starting…';
        try {
          await startArrivalTrip(draft);
          stashSegmentsForTrip(state.trip?.id, handoff?.segments_snapshot);
          close();
        } catch (err) {
          console.error(err);
          errEl.hidden = false;
          errEl.textContent = err.message;
          startBtn.disabled = false;
          startBtn.textContent = 'Start arrival';
        }
      });
    },
  });
}

async function startArrivalTrip(d) {
  const tripId = cryptoRandomId();
  const tripBody = {
    id: tripId,
    direction: 'arrival',
    address_id: d.address_id,
    // dep_airport carries the originating airport from the corresponding dep
    // trip if we found one — matches the legacy convention. arr_airport is
    // where the user is now.
    dep_airport: d.dep_airport?.iata ?? d.arr_airport.iata,
    arr_airport: d.arr_airport.iata,
    bags: d.bags,
    party: d.party,
    transit: d.transit,
    tsa_precheck: d.tsa_precheck,
    international: d.international,
    test: d.test,
    status: 'in_progress',
    source: 'app',
  };
  // Same ordering rule as startTrip — await the trip's enqueue first so its
  // created_at is older than the milestone's when both land in the outbox.
  await api.post('/trips', tripBody, { intent: 'create_trip', trip_id: tripId });

  const milestoneId = cryptoRandomId();
  const milestoneBody = {
    id: milestoneId,
    trip_id: tripId,
    kind: 'arr_off_plane',
    logged_at: new Date().toISOString(),
    client_seq: 1,
    void: false,
  };
  await api.post('/milestones', milestoneBody,
    { intent: 'log_milestone', trip_id: tripId, milestone_id: milestoneId });

  state.trip = tripBody;
  state.milestones = [milestoneBody];
  state.international = d.international;
  haptic(15);
  window.__toast?.('Arrival started · Off Plane logged', { level: 'success' });
  const screenEl = document.getElementById('screen');
  if (screenEl) renderScreen(screenEl);
}

// One-shot airport lookup for sheet pre-fill (autocomplete UI handles the
// interactive case). PostgREST returns an array; we want at most one row.
async function fetchAirport(iata) {
  if (!iata) return null;
  try {
    const rows = await api.get(`/airports?iata=eq.${encodeURIComponent(iata)}&select=iata,name,city,tz&limit=1`);
    return Array.isArray(rows) ? rows[0] : null;
  } catch (err) {
    console.warn('fetchAirport failed:', err);
    return null;
  }
}

// ── Sheet primitive ────────────────────────────────────────────────────────

let openSheetCloser = null;
function openSheet({ title, body, onMount }) {
  // Tear down any prior sheet first.
  openSheetCloser?.();

  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `
    <span class="sheet-grab" aria-hidden="true"></span>
    <div class="sheet-header">
      <h2>${escapeHtml(title)}</h2>
      <button type="button" class="sheet-close" aria-label="Close">Close</button>
    </div>
    <div class="sheet-body"></div>
  `;
  sheet.querySelector('.sheet-body').innerHTML = body;
  document.body.appendChild(scrim);
  document.body.appendChild(sheet);

  // Force layout, then animate open.
  // eslint-disable-next-line no-unused-expressions
  scrim.offsetHeight;
  scrim.dataset.open = 'true';
  sheet.dataset.open = 'true';

  function close() {
    if (openSheetCloser !== close) return;
    openSheetCloser = null;
    scrim.dataset.open = 'false';
    sheet.dataset.open = 'false';
    setTimeout(() => {
      scrim.remove();
      sheet.remove();
    }, 240);
  }
  openSheetCloser = close;

  scrim.addEventListener('click', close);
  sheet.querySelector('.sheet-close').addEventListener('click', close);

  onMount?.(sheet, close);
  return close;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const airportTzCache = new Map();

function kindLabel(kind) {
  return state.kinds?.find((k) => k.kind === kind)?.label || kind;
}

function formatLocalTime(iso, iata) {
  const tz = airportTzCache.get(iata);
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric', minute: '2-digit',
      timeZone: tz || undefined,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleTimeString();
  }
}

function cryptoRandomId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  // Fallback for older browsers — unlikely in target env but cheap.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function haptic(ms) {
  try { navigator.vibrate?.(ms); } catch {}
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

// ── Predicted-vs-actual per-leg toast ──────────────────────────────────────
//
// At trip start (Predict→Trip handoff or saved-prediction resume) we snapshot
// the drive + airport segment percentiles to localStorage keyed by trip id.
// At each segment-boundary milestone tap, we compare actual leg duration to
// those numbers and show a toast. Pure client-side; doesn't touch the
// predictions table or feed M13 calibration scoring.

const SEGMENT_KEY_PREFIX = 'travel:trip-segments:';

function stashSegmentsForTrip(tripId, snapshot) {
  if (!tripId || !snapshot) return;
  try {
    localStorage.setItem(SEGMENT_KEY_PREFIX + tripId, JSON.stringify(snapshot));
  } catch (err) {
    console.warn('stashSegmentsForTrip: write failed', err);
  }
}

function readSegmentsForTrip(tripId) {
  if (!tripId) return null;
  try {
    const raw = localStorage.getItem(SEGMENT_KEY_PREFIX + tripId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearSegmentsForTrip(tripId) {
  if (!tripId) return;
  try { localStorage.removeItem(SEGMENT_KEY_PREFIX + tripId); } catch {}
}

// Map the just-tapped milestone kind to (segment, prior endpoint kind, label).
// Only segment-boundary kinds appear here — intermediate taps return null.
function segmentForKind(kind) {
  switch (kind) {
    case 'dep_at_airport':    return { segment: 'drive',   prior: 'dep_in_transit',   label: 'Drive' };
    case 'dep_security':      return { segment: 'airport', prior: 'dep_at_airport',   label: 'Airport' };
    case 'arr_in_transit':    return { segment: 'airport', prior: 'arr_off_plane',    label: 'Airport' };
    case 'arr_at_destination': return { segment: 'drive',  prior: 'arr_in_transit',   label: 'Drive' };
    default:                  return null;
  }
}

// Returns a one-line "Drive: 38m · predicted 32m p50 / 45m p90 · ahead of
// plan ✓" string, or '' when no snapshot or no prior endpoint. Folded into
// the undo toast so the user sees comparison + Undo without one stomping
// the other (toast container is single-instance).
function segmentComparisonLine(tripId, kind, loggedAtIso) {
  const map = segmentForKind(kind);
  if (!map) return '';
  const snap = readSegmentsForTrip(tripId);
  const seg = snap?.[map.segment];
  if (!seg || seg.p50_s == null || seg.p90_s == null) return '';
  const prior = state.milestones.find((m) => m.kind === map.prior);
  if (!prior) return '';
  const actualS = (new Date(loggedAtIso).getTime() - new Date(prior.logged_at).getTime()) / 1000;
  if (!Number.isFinite(actualS) || actualS <= 0) return '';

  const verdict = actualS < seg.p50_s ? ' · ahead of plan ✓'
                : actualS > seg.p90_s ? ' · running long'
                : '';
  return `${map.label}: ${formatMins(actualS)} · predicted ${formatMins(seg.p50_s)} p50 / ${formatMins(seg.p90_s)} p90${verdict}`;
}

function formatMins(seconds) {
  if (seconds == null) return '';
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h${m}m` : `${h}h`;
}
