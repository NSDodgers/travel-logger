// Predict tab. Form mirrors the trip-start sheet (toggle groups + airport
// picker + DST-validated date/time). Submit hits the Bun service at
// /api/predict; result card always surfaces sample composition (per Nick's
// 2026-04-25 decision: "always surface an explanation of what data is being
// used and how many trips and matches work").
//
// Filter widening drops in this order: tsa_precheck → party → transit → bags.
// Airport and international are hard filters and never relax — see
// project_m10_decisions.md.
//
// M14: Origin address picker + Mapbox Directions live drive time. Result
// card shows three numbers side by side — today's traffic-aware drive,
// historical drive percentile, historical airport percentile — and anchors
// the leave-by on (live drive + airport p90). User picks which to trust.

import { api, ApiError } from '../api.js';
import { mountAirportPicker } from './airport-picker.js';
import { checkDst, localInputValueToUtcIso } from '../dst.js';
import { drivingDirections } from '../mapbox.js';

// Convert the form's local date+time to a UTC epoch ms via the airport's
// tz. Returns null when any piece is missing.
function computeFlightUtcMs(d) {
  if (!d.flight_date || !d.flight_time || !d.airport?.tz) return null;
  const iso = localInputValueToUtcIso(`${d.flight_date}T${d.flight_time}`, d.airport.tz);
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Module-level draft so values survive re-renders within a single visit.
let draft = null;
let lastResult = null;
let lastDrive = null;       // { duration_s, distance_m } from Mapbox; null if no origin or call failed
let inflightToken = 0;
let cachedAddresses = null; // populated on first form mount

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
    airport: null,           // {iata, name, city, tz, lat, lng}
    origin_id: null,         // address row id; null = no live drive lookup
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

  // Load saved addresses once per session so we can offer them as origins.
  // Order by updated_at desc so the most-recent address is at the top.
  if (!cachedAddresses) {
    try {
      const rows = await api.get('/addresses?archived=eq.false&order=updated_at.desc');
      cachedAddresses = Array.isArray(rows) ? rows : [];
    } catch {
      cachedAddresses = [];
    }
  }
  // Default origin: first (most-recent) saved address, when one exists.
  if (!draft.origin_id && cachedAddresses.length) {
    draft.origin_id = cachedAddresses[0].id;
  }

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

        <div class="form-row">
          <label for="origin-select" id="origin-label">Origin address</label>
          <select id="origin-select">
            <option value="">— Skip live drive time —</option>
            ${cachedAddresses.map((a) => `
              <option value="${escapeHtml(a.id)}" ${a.id === draft.origin_id ? 'selected' : ''}>
                ${escapeHtml(a.label)}
              </option>
            `).join('')}
          </select>
          <p class="hint" id="origin-hint">Used for today's traffic-aware drive estimate via Mapbox.</p>
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
  bindOrigin(root);
  bindSubmit(root);
  applyDirectionLabel(root);

  // Re-render any cached result so Predict tab keeps state across navigation.
  if (lastResult) renderResult(root, lastResult, lastDrive);

  return { title: 'Predict', tab: 'predict', primary: null };
}

function bindOrigin(root) {
  const sel = root.querySelector('#origin-select');
  if (!sel) return;
  sel.addEventListener('change', () => {
    draft.origin_id = sel.value || null;
  });
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
  const originLabel = root.querySelector('#origin-label');
  if (draft.direction === 'departure') {
    labelEl.textContent = 'Scheduled departure (local)';
    hintEl.textContent = '"Leave by" answers when to leave home.';
    if (originLabel) originLabel.textContent = 'Origin address';
  } else {
    labelEl.textContent = 'Scheduled landing (local)';
    hintEl.textContent = '"Arrive by" answers when you\'ll reach the destination.';
    if (originLabel) originLabel.textContent = 'Destination address';
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
      // Resolve the chosen origin address row (if any) — gives us coords
      // for the Mapbox directions call. Only relevant for transit=car;
      // Mapbox doesn't do public transit (we chose Mapbox over Google Maps
      // to avoid GCP billing — see project_decisions.md).
      const origin = draft.origin_id
        ? cachedAddresses?.find((a) => a.id === draft.origin_id) ?? null
        : null;

      // Kick off prediction + (optional) Mapbox in parallel.
      const predictPromise = api.predict({
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

      // Drive direction depends on dep vs arr. For departures, route is
      // origin → dep_airport. For arrivals, airport → destination. The
      // service returns the airport's coords on the response.airport field;
      // here we kick off the Mapbox call optimistically with the airport
      // we already picked client-side, since its coords were loaded by the
      // airport-picker via api.airports.
      //
      // depart_at: We want a typical-traffic estimate for *when the user is
      // actually driving*, not for "now." For a flight 2 days out, the
      // current Saturday-evening traffic is meaningless. Approximate the
      // drive moment as flight_time minus 90 minutes — close enough since
      // Mapbox's typical-traffic patterns aren't minute-granular. Clamp
      // to "now+5min" minimum (depart_at must be in the future) and skip
      // the parameter entirely if the flight is more than ~30 days out
      // (Mapbox doesn't keep typical-traffic data that far ahead).
      let driveDepartAt = null;
      let drivePromise = Promise.resolve(null);
      if (origin && draft.transit === 'car' && draft.airport.lat != null && draft.airport.lng != null) {
        const [oLng, oLat] = [origin.lng, origin.lat];
        const [aLng, aLat] = [draft.airport.lng, draft.airport.lat];
        // For arrivals, route runs airport → destination (still origin→airport
        // semantically by Mapbox terms — we just swap the two endpoints).
        const from = draft.direction === 'departure' ? [oLng, oLat] : [aLng, aLat];
        const to   = draft.direction === 'departure' ? [aLng, aLat] : [oLng, oLat];

        // Compute the depart_at. For departures: flight_time - 90min (when
        // they're driving TO the airport). For arrivals: flight_time +
        // airport_p90_guess (when they'll be done at airport and start
        // driving home — we don't have airport_p90 yet, use 30min default).
        const flightUtcMs = computeFlightUtcMs(draft);
        if (flightUtcMs) {
          const offsetMin = draft.direction === 'departure' ? -90 : 30;
          let candidate = flightUtcMs + offsetMin * 60 * 1000;
          const now = Date.now();
          // depart_at must be in the future.
          if (candidate < now + 5 * 60 * 1000) candidate = now + 5 * 60 * 1000;
          // Mapbox typical-traffic doesn't extend more than ~30 days out.
          if (candidate < now + 30 * 24 * 60 * 60 * 1000) {
            driveDepartAt = new Date(candidate);
          }
        }

        drivePromise = drivingDirections(from[0], from[1], to[0], to[1], { departAt: driveDepartAt }).catch((err) => {
          console.warn('Mapbox directions failed; falling back to historical drive', err);
          return null;
        });
      }

      const [res, drive] = await Promise.all([predictPromise, drivePromise]);
      // Race guard: if a faster click already replaced us, drop this result.
      if (token !== inflightToken) return;
      // Stamp the depart_at on the drive result so the renderer can label
      // the row honestly (e.g. "Drive at Tue 7:35 AM" vs "Right now").
      const driveWithMeta = drive ? { ...drive, depart_at: driveDepartAt } : null;
      lastResult = res;
      lastDrive = driveWithMeta;
      renderResult(root, res, driveWithMeta);
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

function renderResult(root, res, drive) {
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

  // When we have a live Mapbox drive estimate AND an airport-segment p90
  // from history, anchor the leave-by on (live drive + airport p90) instead
  // of the historical full-trip p90. This gives Nick today's traffic, not
  // a Tuesday from 2019.
  const flightLabel = res.direction === 'departure' ? 'before flight' : 'after landing';
  const heroLabel   = res.direction === 'departure' ? 'Leave by'      : 'Arrive by';
  const sign        = res.direction === 'departure' ? -1              : 1;

  const airportSeg = res.segments?.airport;
  const liveAvailable = drive && airportSeg?.p90_s != null;
  let heroOffsetS, heroSource;
  if (liveAvailable) {
    heroOffsetS = drive.duration_s + airportSeg.p90_s;
    heroSource = 'live';                    // live drive + history airport
  } else {
    heroOffsetS = res.leave_by_offset_s;
    heroSource = 'history';                 // pure history fallback
  }

  const flightUtc = new Date(res.flight_utc).getTime();
  const heroDate  = heroOffsetS != null ? new Date(flightUtc + sign * heroOffsetS * 1000) : null;
  const heroTime  = heroDate ? formatLocal(heroDate, res.airport.tz) : '—';
  const heroDelta = heroOffsetS != null ? humanDuration(heroOffsetS) : '';

  // Comfortable line: live drive + airport p50 (when both exist), else
  // historical full-trip p50 (when full sample), else hidden.
  let comfortable = '';
  if (liveAvailable && airportSeg.p50_s != null) {
    const offS = drive.duration_s + airportSeg.p50_s;
    const cDate = new Date(flightUtc + sign * offS * 1000);
    comfortable = `
      <div class="predict-comfortable">
        <span class="predict-comfortable-label">Comfortable:</span>
        <span class="predict-comfortable-time">${escapeHtml(formatLocal(cDate, res.airport.tz))}</span>
        <span class="predict-comfortable-delta">(${escapeHtml(humanDuration(offS))} ${flightLabel})</span>
      </div>
    `;
  } else if (res.kind === 'full' && res.comfortable_local) {
    comfortable = `
      <div class="predict-comfortable">
        <span class="predict-comfortable-label">Comfortable:</span>
        <span class="predict-comfortable-time">${escapeHtml(res.comfortable_local)}</span>
        <span class="predict-comfortable-delta">(${escapeHtml(humanDuration(res.comfortable_offset_s))} ${flightLabel})</span>
      </div>
    `;
  }

  // Side-by-side breakdown of drive + airport so Nick can see what each
  // half contributes. When live drive isn't available, show the historical
  // drive percentile prominently with a "no live drive — using history"
  // hint at the bottom.
  const segmentsBlock = segmentsHtml(res, drive);

  // Sparkline: only when full-trip sample is large (low N is misleading).
  const sparkline = res.kind === 'full' ? sparklineHtml(res) : '';

  // Source tag for the delta line. "typical traffic" when Mapbox used
  // depart_at (estimate is for the actual driving time). "live drive"
  // when Mapbox returned real-time traffic at the request moment.
  const heroSourceTag = heroSource === 'live'
    ? (drive?.depart_at ? ' · typical traffic' : ' · live drive')
    : '';

  slot.innerHTML = `
    <div class="predict-card predict-${res.kind}">
      <div class="predict-hero-label">${escapeHtml(heroLabel)}</div>
      <div class="predict-hero-time">${escapeHtml(heroTime)}</div>
      <div class="predict-hero-delta">${escapeHtml(heroDelta)} ${flightLabel}${heroSourceTag}</div>
      ${comfortable}
      ${segmentsBlock}
      ${sparkline}
      ${breakdownHtml(res)}
      <div class="predict-actions">
        <button type="button" class="btn btn-primary" id="start-trip-from-predict">
          Start this trip →
        </button>
        <p class="hint">Opens the trip-start sheet with these values pre-filled.</p>
      </div>
    </div>
  `;
  // Wire the handoff button. Clicking jumps to /log and opens the
  // trip-start sheet (or arrival-start sheet) with our form values
  // already populated. The user only fills in the bits Predict didn't
  // need: arrival airport (for departures), sched arr time, etc.
  root.querySelector('#start-trip-from-predict')?.addEventListener('click', () => {
    const handoff = {
      direction: draft.direction,
      airport: draft.airport,
      origin_id: draft.origin_id,
      bags: draft.bags,
      party: draft.party,
      transit: draft.transit,
      tsa_precheck: draft.tsa_precheck,
      international: draft.international,
      sched_dep_date: draft.flight_date,
      sched_dep_time: draft.flight_time,
    };
    // Stash on window so log.js can read it on mount. Module-state would be
    // cleaner but log.js doesn't import predict.js (and we don't want it to
    // — circular imports are a smell). The window slot is read-once and
    // cleared by log.js after consumption.
    window.__predictHandoff = handoff;
    location.hash = '/log';
  });
}

// Drive vs airport breakdown. Always shows historical drive percentiles; if
// the Mapbox call returned a live ETA, shows that as a third row alongside.
function segmentsHtml(res, drive) {
  const dep = res.direction === 'departure';
  const driveSeg   = res.segments?.drive   ?? null;
  const airportSeg = res.segments?.airport ?? null;
  if (!driveSeg && !airportSeg && !drive) return '';

  const driveLabel   = dep ? 'Drive (home → airport)' : 'Drive (airport → destination)';
  const airportLabel = dep ? 'At airport' : 'At airport';

  // Drive label honestly reflects when the estimate is for. With a
  // depart_at, Mapbox returns typical-traffic for that future moment
  // ("Tue 7:35 AM is typically X min"). Without one, it returns
  // real-time traffic at the API call moment.
  const driveTimeLabel = drive?.depart_at
    ? `Drive at ${escapeHtml(formatLocal(new Date(drive.depart_at), res.airport.tz))}`
    : `Drive right now`;
  const driveAuxLabel = drive?.depart_at
    ? `Mapbox typical · ${(drive.distance_m / 1000).toFixed(1)} km`
    : `Mapbox live · ${(drive.distance_m / 1000).toFixed(1)} km`;
  const liveRow = drive
    ? `
      <div class="predict-segment-row predict-segment-live">
        <span class="predict-segment-key">${driveTimeLabel}</span>
        <span class="predict-segment-val">${escapeHtml(humanDuration(drive.duration_s))}</span>
        <span class="predict-segment-aux">${driveAuxLabel}</span>
      </div>
    `
    : '';

  const driveHistRow = driveSeg && driveSeg.sample_n > 0
    ? `
      <div class="predict-segment-row">
        <span class="predict-segment-key">${escapeHtml(driveLabel)}, history</span>
        <span class="predict-segment-val">p50 ${escapeHtml(shortDuration(driveSeg.p50_s))} · p90 ${escapeHtml(shortDuration(driveSeg.p90_s))}</span>
        <span class="predict-segment-aux">${driveSeg.sample_n} trip${driveSeg.sample_n === 1 ? '' : 's'}${driveSeg.relaxed_filters.length ? ' · relaxed: ' + driveSeg.relaxed_filters.map(prettyFilterName).join(', ') : ''}</span>
      </div>
    `
    : !drive
    ? `
      <div class="predict-segment-row predict-segment-empty">
        <span class="predict-segment-key">${escapeHtml(driveLabel)}, history</span>
        <span class="predict-segment-val">—</span>
        <span class="predict-segment-aux">no matching trips with both legs logged</span>
      </div>
    `
    : '';

  const airportRow = airportSeg && airportSeg.sample_n > 0
    ? `
      <div class="predict-segment-row">
        <span class="predict-segment-key">${escapeHtml(airportLabel)}, history</span>
        <span class="predict-segment-val">p50 ${escapeHtml(shortDuration(airportSeg.p50_s))} · p90 ${escapeHtml(shortDuration(airportSeg.p90_s))}</span>
        <span class="predict-segment-aux">${airportSeg.sample_n} trip${airportSeg.sample_n === 1 ? '' : 's'}${airportSeg.relaxed_filters.length ? ' · relaxed: ' + airportSeg.relaxed_filters.map(prettyFilterName).join(', ') : ''}</span>
      </div>
    `
    : `
      <div class="predict-segment-row predict-segment-empty">
        <span class="predict-segment-key">${escapeHtml(airportLabel)}, history</span>
        <span class="predict-segment-val">—</span>
        <span class="predict-segment-aux">no airport-side milestone gaps to measure</span>
      </div>
    `;

  const fallbackHint = !drive && (airportSeg?.sample_n ?? 0) > 0
    ? `<p class="predict-segment-hint">No live drive estimate — pick an origin address and set Transit to Car for today's traffic-aware ETA.</p>`
    : '';

  return `
    <div class="predict-segments">
      ${liveRow}
      ${driveHistRow}
      ${airportRow}
      ${fallbackHint}
    </div>
  `;
}

// Format a UTC Date in the airport's tz the same way the predict service
// does on the wire. Matches "Apr 27, 8:11 AM".
function formatLocal(d, tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      timeZone: tz,
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
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

// Compact form for the sparkline axis where the role label (min/p50/p90/max)
// already provides context — drop the "min" unit suffix that collides with
// the "min" role label and read as "min 8 min".
function shortDuration(seconds) {
  if (seconds == null) return '';
  const total = Math.round(seconds / 60);
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h${m}m` : `${h}h`;
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
        <span><span class="predict-axis-key">min</span> ${escapeHtml(shortDuration(min))}</span>
        <span><span class="predict-axis-key">p50</span> ${escapeHtml(shortDuration(res.p50_s))}</span>
        <span><span class="predict-axis-key">p90</span> ${escapeHtml(shortDuration(res.p90_s))}</span>
        <span><span class="predict-axis-key">max</span> ${escapeHtml(shortDuration(max))}</span>
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
