// Predict tab — M10. Form mirrors the trip-start sheet (toggle groups + airport
// picker + DST-validated date/time). Submit hits the Bun service at
// /api/predict; result card always surfaces sample composition (per Nick's
// 2026-04-25 decision: "always surface an explanation of what data is being
// used and how many trips and matches work").
//
// Filter widening drops in this order: tsa_precheck → party → transit → bags.
// Airport and international are hard filters and never relax — see
// project_m10_decisions.md.

import { api, ApiError } from '../api.js';
import { mountAirportPicker } from './airport-picker.js';
import { checkDst } from '../dst.js';

// Module-level draft so values survive re-renders within a single visit.
let draft = null;
let lastResult = null;
let inflightToken = 0;

function defaultDraft() {
  const now = new Date();
  // Default flight: same time, 24h from now. Just a starting point — user
  // edits before submitting.
  const dflt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const yyyy = dflt.getFullYear();
  const mm = String(dflt.getMonth() + 1).padStart(2, '0');
  const dd = String(dflt.getDate()).padStart(2, '0');
  const hh = String(dflt.getHours()).padStart(2, '0');
  const mi = String(dflt.getMinutes()).padStart(2, '0');
  return {
    direction: 'departure',
    airport: null,           // {iata, name, city, tz}
    bags: 'carry_on',
    party: 'solo',
    transit: 'car',
    tsa_precheck: false,
    international: false,
    flight_date: `${yyyy}-${mm}-${dd}`,
    flight_time: `${hh}:${mi}`,
  };
}

export async function predictScreen(root) {
  if (!draft) draft = defaultDraft();

  root.innerHTML = `
    <section class="screen predict-screen">
      <form class="form" id="predict-form" novalidate>
        <div class="form-row">
          <label>Direction</label>
          <div class="toggle-group" data-field="direction">
            <button type="button" data-value="departure">Departure</button>
            <button type="button" data-value="arrival">Arrival</button>
          </div>
          <p class="hint" id="direction-hint"></p>
        </div>

        <div id="airport-slot"></div>

        <div class="form-row">
          <label id="flight-time-label">Scheduled departure (local)</label>
          <div class="datetime-row">
            <input id="flight-date" type="date" value="${draft.flight_date}">
            <input id="flight-time" type="time" value="${draft.flight_time}">
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
          <label>International / customs</label>
          <div class="toggle-group" data-field="international">
            <button type="button" data-value="false">No</button>
            <button type="button" data-value="true">Yes</button>
          </div>
        </div>

        <div id="predict-error" class="hint" style="color:var(--error)" hidden></div>
        <div class="form-actions">
          <button type="button" class="btn btn-primary" id="predict-submit">Predict</button>
        </div>
      </form>

      <div id="predict-result" class="predict-result" hidden></div>
    </section>
  `;

  bindToggles(root);
  bindAirport(root);
  bindDateTime(root);
  bindSubmit(root);
  applyDirectionLabel(root);

  // Re-render any cached result so Predict tab keeps state across navigation.
  if (lastResult) renderResult(root, lastResult);

  return { title: 'Predict', tab: 'predict', primary: null };
}

// ── Form bindings ───────────────────────────────────────────────────────

function bindToggles(root) {
  root.querySelectorAll('.toggle-group').forEach((g) => {
    const field = g.dataset.field;
    const current = String(draft[field]);
    g.querySelectorAll('button').forEach((b) => {
      if (b.dataset.value === current) b.setAttribute('aria-pressed', 'true');
      b.addEventListener('click', () => {
        g.querySelectorAll('button').forEach((bb) => bb.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        draft[field] = (field === 'tsa_precheck' || field === 'international')
          ? b.dataset.value === 'true'
          : b.dataset.value;
        if (field === 'direction') applyDirectionLabel(root);
      });
    });
  });
}

function applyDirectionLabel(root) {
  const labelEl = root.querySelector('#flight-time-label');
  const hintEl = root.querySelector('#direction-hint');
  if (draft.direction === 'departure') {
    labelEl.textContent = 'Scheduled departure (local)';
    hintEl.textContent = '"Leave by" answers when to leave home.';
  } else {
    labelEl.textContent = 'Scheduled landing (local)';
    hintEl.textContent = '"Arrive by" answers when you\'ll reach the destination.';
  }
}

function bindAirport(root) {
  mountAirportPicker(root.querySelector('#airport-slot'), {
    id: 'predict-airport',
    label: 'Airport',
    placeholder: 'IATA, city, or name',
    initial: draft.airport || undefined,
    onChange: (a) => {
      draft.airport = a;
      revalidateDst(root);
    },
  });
}

function bindDateTime(root) {
  root.querySelector('#flight-date').addEventListener('change', (e) => {
    draft.flight_date = e.target.value;
    revalidateDst(root);
  });
  root.querySelector('#flight-time').addEventListener('change', (e) => {
    draft.flight_time = e.target.value;
    revalidateDst(root);
  });
}

function revalidateDst(root) {
  const slot = root.querySelector('#dst-slot');
  if (!draft.airport || !draft.flight_date || !draft.flight_time) {
    slot.innerHTML = '';
    return;
  }
  const w = checkDst(draft.flight_date, draft.flight_time, draft.airport.tz);
  slot.innerHTML = w
    ? `<div class="dst-warning">⚠ ${escapeHtml(w)}<br>You can still proceed.</div>`
    : '';
}

function bindSubmit(root) {
  root.querySelector('#predict-submit').addEventListener('click', async () => {
    const errEl = root.querySelector('#predict-error');
    const btn = root.querySelector('#predict-submit');
    if (!draft.airport) { errEl.hidden = false; errEl.textContent = 'Pick an airport.'; return; }
    if (!draft.flight_date || !draft.flight_time) { errEl.hidden = false; errEl.textContent = 'Set the flight date + time.'; return; }
    errEl.hidden = true;

    btn.disabled = true;
    btn.textContent = 'Predicting…';
    const token = ++inflightToken;
    try {
      const res = await api.predict({
        direction: draft.direction,
        airport: draft.airport.iata,
        bags: draft.bags,
        party: draft.party,
        transit: draft.transit,
        tsa_precheck: draft.tsa_precheck,
        international: draft.international,
        flight_time_local: draft.flight_time,
        flight_date_local: draft.flight_date,
      });
      // Race guard: if a faster click already replaced us, drop this result.
      if (token !== inflightToken) return;
      lastResult = res;
      renderResult(root, res);
    } catch (err) {
      if (token !== inflightToken) return;
      const msg = err instanceof ApiError ? err.error || `${err.status}` : err.message;
      errEl.hidden = false;
      errEl.textContent = msg.includes('network')
        ? 'Can\'t predict offline — try again on Wi-Fi.'
        : `Predict failed: ${msg}`;
    } finally {
      if (token === inflightToken) {
        btn.disabled = false;
        btn.textContent = 'Predict';
      }
    }
  });
}

// ── Result rendering ────────────────────────────────────────────────────

function renderResult(root, res) {
  const slot = root.querySelector('#predict-result');
  if (!slot) return;
  slot.hidden = false;

  if (res.kind === 'empty') {
    slot.innerHTML = `
      <div class="predict-card predict-empty">
        <div class="predict-card-title">No data for this airport yet</div>
        <p>Log a trip from <strong>${escapeHtml(res.airport.iata)}</strong> in this configuration to start predicting.</p>
        ${breakdownHtml(res)}
      </div>
    `;
    return;
  }

  // Both low_n and full share the hero "leave by / arrive by" structure.
  const heroLabel = res.direction === 'departure' ? 'Leave by' : 'Arrive by';
  const heroTime = res.leave_by_local ?? '—';
  const heroDelta = res.leave_by_offset_s != null ? humanDuration(res.leave_by_offset_s) : '';
  const flightLabel = res.direction === 'departure' ? 'before flight' : 'after landing';

  // Comfortable line: only when full sample.
  const comfortable = (res.kind === 'full' && res.comfortable_local)
    ? `
      <div class="predict-comfortable">
        <span class="predict-comfortable-label">Comfortable:</span>
        <span class="predict-comfortable-time">${escapeHtml(res.comfortable_local)}</span>
        <span class="predict-comfortable-delta">(${escapeHtml(humanDuration(res.comfortable_offset_s))} ${flightLabel})</span>
      </div>
    `
    : '';

  // Sparkline: only when full sample (low N is misleading per brief).
  const sparkline = res.kind === 'full' ? sparklineHtml(res) : '';

  slot.innerHTML = `
    <div class="predict-card predict-${res.kind}">
      <div class="predict-hero-label">${escapeHtml(heroLabel)}</div>
      <div class="predict-hero-time">${escapeHtml(heroTime)}</div>
      <div class="predict-hero-delta">${escapeHtml(heroDelta)} ${flightLabel}</div>
      ${comfortable}
      ${sparkline}
      ${breakdownHtml(res)}
    </div>
  `;
}

function breakdownHtml(res) {
  // Always surface what data was used. Per Nick's M10 decision: every result
  // card shows N trips, applied filters, relaxed filters, and the count of
  // incomplete trips (formerly "abandoned").
  const tripsLine = res.sample_n === 0
    ? 'Based on 0 matching trips.'
    : `Based on <strong>${res.sample_n}</strong> matching trip${res.sample_n === 1 ? '' : 's'}` +
      (res.incomplete_n > 0
        ? ` <span class="predict-incomplete">(${res.incomplete_n} incomplete · ${res.complete_n} complete)</span>`
        : '') + '.';

  const applied = formatApplied(res.applied_filters, res.relaxed_filters);
  const relaxed = res.relaxed_filters.length
    ? `<div class="predict-breakdown-row"><span class="predict-breakdown-key">Relaxed:</span> ${escapeHtml(res.relaxed_filters.map(prettyFilterName).join(', '))}</div>`
    : '';

  return `
    <div class="predict-breakdown">
      <div class="predict-breakdown-row">${tripsLine}</div>
      <div class="predict-breakdown-row"><span class="predict-breakdown-key">Filters applied:</span> ${applied}</div>
      ${relaxed}
    </div>
  `;
}

function formatApplied(f, relaxedKeys) {
  // List the filters that actually constrained the query — i.e. the ones not
  // in relaxedKeys. Airport and international are always applied.
  const parts = [];
  parts.push(`${escapeHtml(f.airport)}`);
  parts.push(f.international ? 'International' : 'Domestic');
  const dropped = new Set(relaxedKeys);
  if (!dropped.has('bags') && f.bags) parts.push(prettyValue('bags', f.bags));
  if (!dropped.has('party') && f.party) parts.push(prettyValue('party', f.party));
  if (!dropped.has('transit') && f.transit) parts.push(prettyValue('transit', f.transit));
  if (!dropped.has('tsa_precheck') && f.tsa_precheck !== null) {
    parts.push(f.tsa_precheck ? 'PreCheck' : 'No PreCheck');
  }
  return parts.join(' · ');
}

function prettyFilterName(key) {
  return ({
    tsa_precheck: 'TSA PreCheck',
    party: 'Party size',
    transit: 'Transit',
    bags: 'Bags',
  })[key] || key;
}

function prettyValue(field, value) {
  const map = {
    bags: { carry_on: 'Carry-on', checked: 'Checked' },
    party: { solo: 'Solo', group_with_kids: 'With kids', group_without_kids: 'No kids' },
    transit: { car: 'Car', public: 'Public' },
  };
  return map[field]?.[value] || value;
}

function humanDuration(seconds) {
  if (seconds == null) return '';
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// Inline SVG sparkline of the duration distribution (sorted asc). Renders only
// when sample_n ≥ 5; below that the brief calls out that distribution shape
// is misleading.
function sparklineHtml(res) {
  const ds = res.durations_s || [];
  if (ds.length < 2) return '';
  const min = res.min_s ?? ds[0];
  const max = res.max_s ?? ds[ds.length - 1];
  const range = Math.max(max - min, 1);
  const W = 320, H = 60, PAD = 4;
  const points = ds.map((d, i) => {
    const x = PAD + (i / (ds.length - 1)) * (W - 2 * PAD);
    const y = H - PAD - ((d - min) / range) * (H - 2 * PAD);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const p50X = PAD + ((res.p50_s - min) / range) * (W - 2 * PAD);
  const p90X = PAD + ((res.p90_s - min) / range) * (W - 2 * PAD);
  return `
    <div class="predict-sparkline-wrap">
      <svg class="predict-sparkline" viewBox="0 0 ${W} ${H}" role="img" aria-label="Duration distribution">
        <polyline points="${points}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
        <line x1="${p50X.toFixed(1)}" y1="0" x2="${p50X.toFixed(1)}" y2="${H}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="2,2"/>
        <line x1="${p90X.toFixed(1)}" y1="0" x2="${p90X.toFixed(1)}" y2="${H}" stroke="var(--accent)" stroke-width="1" stroke-dasharray="2,2"/>
      </svg>
      <div class="predict-sparkline-axis">
        <span>min ${escapeHtml(humanDuration(min))}</span>
        <span>p50 ${escapeHtml(humanDuration(res.p50_s))}</span>
        <span>p90 ${escapeHtml(humanDuration(res.p90_s))}</span>
        <span>max ${escapeHtml(humanDuration(max))}</span>
      </div>
    </div>
  `;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
