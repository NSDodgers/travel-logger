// Log screen — M7. Empty-state hero, trip-start sheet, active 2x2-tile grid,
// long-press edit/void, undo toast.
//
// Direct fetches (no IndexedDB queue yet — that's M8). Optimistic milestone
// taps with a revert on failure. Per-direction milestone progression driven
// by api.milestone_kinds (so customs/bag visibility lives in data, not code).

import { api, ApiError } from '../api.js';
import { mountAirportPicker } from './airport-picker.js';

// ── Module-level state ─────────────────────────────────────────────────────

let state = {
  trip: null,                // active trip row, or null
  milestones: [],            // milestones for the active trip (excludes void)
  kinds: null,               // cached milestone_kinds rows
  addresses: [],             // cached non-archived addresses (for trip start)
  international: false,      // session flag, controls dep_customs visibility
};

let lastTrip = null;         // cached "most recent app trip" for sticky vars

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
  } catch (err) {
    console.error('logScreen failed:', err);
    renderFatal(root, err);
  }
  return { title: 'Travel Logger', tab: 'log',
           primary: { label: 'Addresses', href: '#/addresses' } };
}

async function loadActiveTrip() {
  const rows = await api.get(`/trips?status=eq.in_progress&order=created_at.desc&limit=1`);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function loadMilestones(tripId) {
  const rows = await api.get(`/milestones?trip_id=eq.${tripId}&void=eq.false&order=client_seq.asc`);
  return Array.isArray(rows) ? rows : [];
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
  root.innerHTML = `
    <section class="log-screen">
      <button class="log-hero" id="start-trip-btn">
        Dep: In Transit
        <span class="log-hero-sub">Tap to start a new trip</span>
      </button>
    </section>
  `;
  root.querySelector('#start-trip-btn').addEventListener('click', () => openTripStartSheet());
}

// ── Active state — log grid ────────────────────────────────────────────────

function renderActive(root) {
  const visibleKinds = visibleDepKinds();
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

  root.querySelector('#abandon-trip-btn').addEventListener('click', async () => {
    if (!confirm('Abandon this in-progress trip? Logged milestones stay in history.')) return;
    try {
      await api.patch(`/trips?id=eq.${state.trip.id}`,
        { status: 'abandoned', updated_at: new Date().toISOString() });
      state.trip = null; state.milestones = [];
      window.__toast?.('Trip abandoned', { level: 'info' });
      renderScreen(root);
    } catch (err) {
      console.error(err);
      window.__toast?.(`Abandon failed: ${err.message}`, { level: 'error' });
    }
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
        <span class="log-tile-time">${formatLocalTime(logged.logged_at, state.trip.dep_airport)}</span>
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

function visibleDepKinds() {
  const isCarry = state.trip.bags === 'carry_on';
  return state.kinds
    .filter((k) => k.direction === 'departure')
    .filter((k) => isCarry ? k.shown_when_carry_on : true)
    .filter((k) => k.kind !== 'dep_customs' || state.international)
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
    try {
      await api.patch(`/trips?id=eq.${state.trip.id}`, { status: 'abandoned' });
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
  const optimistic = {
    id: cryptoRandomId(),
    trip_id: state.trip.id,
    kind,
    logged_at: new Date().toISOString(),
    client_seq: nextSeq,
    void: false,
  };
  state.milestones.push(optimistic);
  renderActive(root);

  try {
    const [saved] = await api.post('/milestones', {
      id: optimistic.id,
      trip_id: optimistic.trip_id,
      kind: optimistic.kind,
      logged_at: optimistic.logged_at,
      client_seq: optimistic.client_seq,
    });
    if (saved) {
      const idx = state.milestones.findIndex((m) => m.id === optimistic.id);
      if (idx >= 0) state.milestones[idx] = saved;
    }
    haptic(10);
    showUndoToast(root, optimistic.id, kindLabel(kind));
  } catch (err) {
    console.error(err);
    state.milestones = state.milestones.filter((m) => m.id !== optimistic.id);
    renderActive(root);
    window.__toast?.(`Log failed: ${err.message}`, { level: 'error' });
  }
}

function showUndoToast(root, milestoneId, label) {
  window.__toast?.(`Logged: ${label}`, {
    level: 'success',
    ms: 60_000,
    action: {
      label: 'Undo',
      onClick: () => voidMilestone(root, milestoneId, 'undo'),
    },
  });
}

async function voidMilestone(root, milestoneId, reason) {
  // Look the row up in state, but tolerate it being missing — undo of the
  // FINAL milestone after auto-complete arrives here with state already wiped.
  const ms = state.milestones.find((m) => m.id === milestoneId);
  const label = ms ? kindLabel(ms.kind) : 'milestone';
  if (ms) {
    state.milestones = state.milestones.filter((m) => m.id !== milestoneId);
    renderActive(root);
  }
  try {
    const [updated] = await api.patch(`/milestones?id=eq.${milestoneId}`,
      { void: true, void_reason: reason });
    if (!updated) throw new Error('Void returned no row');
    window.__toast?.(`Removed: ${label}`, { level: 'info' });
    // If the trip was auto-completed by this milestone, reopen it.
    const tripId = updated.trip_id;
    const [trip] = await api.get(`/trips?id=eq.${tripId}`);
    if (trip?.status === 'complete') {
      await api.patch(`/trips?id=eq.${tripId}`,
        { status: 'in_progress', updated_at: new Date().toISOString() });
    }
    // Resync from server and re-render whatever the current screen is.
    state.trip = await loadActiveTrip();
    state.milestones = state.trip ? await loadMilestones(state.trip.id) : [];
    const screenEl = document.getElementById('screen');
    if (screenEl) renderScreen(screenEl);
  } catch (err) {
    console.error(err);
    if (ms) {
      state.milestones.push(ms);
      state.milestones.sort((a, b) => a.client_seq - b.client_seq);
      renderActive(root);
    }
    window.__toast?.(`Undo failed: ${err.message}`, { level: 'error' });
  }
}

async function editMilestoneTime(root, milestoneId, newIsoUtc) {
  const ms = state.milestones.find((m) => m.id === milestoneId);
  if (!ms) return;
  const prevAt = ms.logged_at;
  ms.logged_at = newIsoUtc;
  renderActive(root);
  try {
    await api.patch(`/milestones?id=eq.${milestoneId}`,
      { logged_at: newIsoUtc });
    window.__toast?.('Time updated', { level: 'success' });
  } catch (err) {
    console.error(err);
    ms.logged_at = prevAt;
    renderActive(root);
    window.__toast?.(`Edit failed: ${err.message}`, { level: 'error' });
  }
}

async function completeTrip(root) {
  if (!state.trip || state.trip._completing) return;
  state.trip._completing = true;
  try {
    await api.patch(`/trips?id=eq.${state.trip.id}`, { status: 'complete' });
    window.__toast?.('Trip complete 🎉', { level: 'success', ms: 4000 });
  } catch (err) {
    console.error(err);
    window.__toast?.(`Complete failed: ${err.message}`, { level: 'error' });
  } finally {
    state.trip = null;
    state.milestones = [];
    state.international = false;
    renderScreen(root);
  }
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
  const tz = airportTzCache.get(state.trip.dep_airport) || 'UTC';
  const localValue = utcIsoToLocalInputValue(ms.logged_at, tz);

  openSheet({
    title: kindLabel(kind),
    body: `
      <div class="form" novalidate>
        <div class="form-row">
          <label for="edit-time">Logged at (local to ${escapeHtml(state.trip.dep_airport ?? 'airport')})</label>
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
        voidMilestone(root, milestoneId, 'manual');
      });
    },
  });
}

// ── Trip-start sheet ───────────────────────────────────────────────────────

async function openTripStartSheet() {
  // Fetch sticky vars + address book in parallel before opening the sheet.
  const [addressesRes, lastTripRes] = await Promise.all([
    api.get('/addresses?archived=eq.false&order=updated_at.desc').catch(() => []),
    api.get('/trips?source=eq.app&order=created_at.desc&limit=1').catch(() => []),
  ]);
  state.addresses = Array.isArray(addressesRes) ? addressesRes : [];
  lastTrip = (Array.isArray(lastTripRes) && lastTripRes[0]) || null;

  const initialBags    = stickyBags(lastTrip?.bags);
  const initialParty   = lastTrip?.party   || 'solo';
  const initialTransit = lastTrip?.transit || 'car';
  const initialTsa     = !!lastTrip?.tsa_precheck;
  const initialAddrId  = lastTrip?.address_id || state.addresses[0]?.id || '';

  const draft = {
    address_id: initialAddrId,
    dep_airport: null,        // {iata,name,city,tz}
    arr_airport: null,
    sched_dep_date: '',
    sched_dep_time: '',
    sched_arr_date: '',
    sched_arr_time: '',
    bags: initialBags,
    party: initialParty,
    transit: initialTransit,
    tsa_precheck: initialTsa,
    international: false,
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
            draft[field] = field === 'tsa_precheck' || field === 'international'
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

      // Airport pickers.
      mountAirportPicker(sheetRoot.querySelector('#dep-airport-slot'), {
        id: 'dep-airport',
        label: 'Departure airport',
        placeholder: 'IATA, city, or name',
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

      // Datetime fields.
      const fields = {
        depDate: sheetRoot.querySelector('#sched-dep-date'),
        depTime: sheetRoot.querySelector('#sched-dep-time'),
        arrDate: sheetRoot.querySelector('#sched-arr-date'),
        arrTime: sheetRoot.querySelector('#sched-arr-time'),
      };
      Object.entries(fields).forEach(([k, el]) => {
        el.addEventListener('change', () => {
          draft[`sched_${k.startsWith('dep') ? 'dep' : 'arr'}_${k.endsWith('Date') ? 'date' : 'time'}`] = el.value;
          revalidateDst();
        });
      });

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
  let dst_warning = null;
  const depDst = checkDstCode(d.sched_dep_date, d.sched_dep_time, d.dep_airport.tz);
  const arrDst = checkDstCode(d.sched_arr_date, d.sched_arr_time, d.arr_airport.tz);
  dst_warning = depDst || arrDst;

  const [trip] = await api.post('/trips', {
    direction: 'departure',
    address_id: d.address_id,
    dep_airport: d.dep_airport.iata,
    arr_airport: d.arr_airport.iata,
    sched_dep_local: d.sched_dep_time,
    sched_dep_date: d.sched_dep_date,
    sched_arr_local: d.sched_arr_time,
    sched_arr_date: d.sched_arr_date,
    dst_warning,
    bags: d.bags,
    party: d.party,
    transit: d.transit,
    tsa_precheck: d.tsa_precheck,
    international: d.international,
    status: 'in_progress',
    source: 'app',
  });
  if (!trip) throw new Error('Trip create returned no row');

  const [milestone] = await api.post('/milestones', {
    id: cryptoRandomId(),
    trip_id: trip.id,
    kind: 'dep_in_transit',
    logged_at: new Date().toISOString(),
    client_seq: 1,
  });

  // Rebuild active state from the server's truth.
  state.trip = trip;
  state.milestones = milestone ? [milestone] : [];
  state.international = d.international;
  haptic(15);
  window.__toast?.('Trip started · In Transit logged', { level: 'success' });
  // Re-render the screen.
  const screenEl = document.getElementById('screen');
  if (screenEl) renderScreen(screenEl);
}

function stickyBags(prev) {
  // Legacy trips were imported with bags='unknown' — never sticky that.
  if (prev === 'checked' || prev === 'carry_on') return prev;
  return 'carry_on';
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

// Convert "YYYY-MM-DDTHH:mm" (in tz) → UTC ISO.
function localInputValueToUtcIso(localStr, tz) {
  // Parse as if local-naive then offset-correct via tz.
  const [datePart, timePart] = localStr.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  // Build a UTC instant for the same wall-clock; then subtract the tz offset
  // at that instant.
  const asUtc = Date.UTC(y, m - 1, d, hh, mm);
  const offsetMs = tzOffsetMs(new Date(asUtc), tz);
  return new Date(asUtc - offsetMs).toISOString();
}

function utcIsoToLocalInputValue(iso, tz) {
  const d = new Date(iso);
  // Use Intl to extract local parts.
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: tz,
  }).formatToParts(d);
  const map = {};
  parts.forEach((p) => { if (p.type !== 'literal') map[p.type] = p.value; });
  // Some locales return hour=24; normalize.
  const hour = map.hour === '24' ? '00' : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}`;
}

function tzOffsetMs(date, tz) {
  // Difference between the same wall-clock in tz vs UTC, at the given instant.
  const dtfTz = new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    timeZone: tz,
  });
  const parts = dtfTz.formatToParts(date);
  const map = {};
  parts.forEach((p) => { if (p.type !== 'literal') map[p.type] = p.value; });
  const asIfUtc = Date.UTC(+map.year, +map.month - 1, +map.day,
    +(map.hour === '24' ? '0' : map.hour), +map.minute, +map.second);
  return asIfUtc - date.getTime();
}

// DST check: return null, 'spring_nonexistent', or 'fall_ambiguous'.
function checkDstCode(dateStr, timeStr, tz) {
  if (!dateStr || !timeStr || !tz) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  // Test the instant 30 min before and after; if both map to the same wall
  // clock differently, we're at a DST boundary.
  const wallMs = Date.UTC(y, m - 1, d, hh, mm);
  const offsetNow = tzOffsetMs(new Date(wallMs), tz);
  const utcGuess  = wallMs - offsetNow;
  const offsetCheck = tzOffsetMs(new Date(utcGuess), tz);
  if (offsetNow !== offsetCheck) {
    // Shifted — likely spring forward or fall back.
    // If our wall time round-trips to a different wall, it's "non-existent".
    const reUtcWallParts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz,
    }).formatToParts(new Date(utcGuess));
    const map = {};
    reUtcWallParts.forEach((p) => { if (p.type !== 'literal') map[p.type] = p.value; });
    const roundHh = +(map.hour === '24' ? '0' : map.hour);
    const roundMm = +map.minute;
    if (roundHh !== hh || roundMm !== mm) return 'spring_nonexistent';
    return 'fall_ambiguous';
  }
  return null;
}

function checkDst(dateStr, timeStr, tz) {
  const code = checkDstCode(dateStr, timeStr, tz);
  if (code === 'spring_nonexistent') return 'this time does not exist on DST day (spring forward).';
  if (code === 'fall_ambiguous') return 'this time is ambiguous on DST day (fall back).';
  return null;
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
