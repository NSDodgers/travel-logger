// Saved predictions — client-only, localStorage-backed.
//
// Use case: a prediction is usually run a day or more before the trip.
// `window.__predictHandoff` (M14) is in-memory only, so the form values
// vanish on reload. Saving persists them so the Log screen can offer
// "Resume your trip plan" the next time the app opens.
//
// Storage is one JSON array under `travel:saved-predictions`. We dedupe
// by (airport, direction, flight_date, flight_time) — re-saving the same
// flight overwrites (so changing the buffer or origin updates in place).
// Entries auto-purge once flight_utc has passed by more than 6h.

const KEY = 'travel:saved-predictions';
const EXPIRY_GRACE_MS = 6 * 60 * 60 * 1000;

function readRaw() {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return [];
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(arr) {
  try {
    localStorage.setItem(KEY, JSON.stringify(arr));
  } catch (err) {
    console.warn('saved-predictions: write failed', err);
  }
}

function dedupKey(p) {
  return `${p.direction}|${p.airport?.iata}|${p.flight_date_local}|${p.flight_time_local}`;
}

// Drop entries that are clearly stale. Returns the surviving list.
export function purgeExpired(now = Date.now()) {
  const cutoff = now - EXPIRY_GRACE_MS;
  const all = readRaw();
  const fresh = all.filter((p) => Number.isFinite(p.flight_utc_ms) && p.flight_utc_ms > cutoff);
  if (fresh.length !== all.length) writeRaw(fresh);
  return fresh;
}

// Upsert by dedup key. Returns the saved entry (with id).
export function save(entry) {
  const all = purgeExpired();
  const key = dedupKey(entry);
  const id = entry.id || cryptoId();
  const next = { ...entry, id, saved_at_ms: Date.now() };
  const idx = all.findIndex((p) => dedupKey(p) === key);
  if (idx >= 0) all[idx] = { ...all[idx], ...next };
  else all.push(next);
  all.sort((a, b) => a.flight_utc_ms - b.flight_utc_ms);
  writeRaw(all);
  return next;
}

// Sorted soonest-first, with expired ones already dropped.
export function list() {
  return purgeExpired().sort((a, b) => a.flight_utc_ms - b.flight_utc_ms);
}

// Returns the saved entry whose dedup key matches the given form, or null.
export function findMatch({ direction, airport, flight_date_local, flight_time_local }) {
  if (!airport?.iata || !flight_date_local || !flight_time_local) return null;
  const key = dedupKey({ direction, airport, flight_date_local, flight_time_local });
  return list().find((p) => dedupKey(p) === key) ?? null;
}

export function dismiss(id) {
  const all = readRaw();
  const next = all.filter((p) => p.id !== id);
  writeRaw(next);
  return next;
}

function cryptoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `sp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
