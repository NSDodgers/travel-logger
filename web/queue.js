// IndexedDB write-ahead log + drain loop. Every POST/PATCH the screens make
// goes through here on its way to PostgREST. Surviving airplane mode and
// captive-portal WiFi is the whole point of M8.
//
// Lifecycle: pending → in_flight → synced (drop) | failed_retriable → … |
//            dead_letter (manual). 5xx and network errors are retriable;
//            non-409 4xx becomes dead_letter after 3 attempts.
//
// Triggers: app boot, `online` event, `visibilitychange` (visible), 15s
// interval. Order-preserving — only the head entry is attempted per pass,
// because a pending POST /trips must drain before any /milestones FK'd to it.

import { fetchJSON, AUTH_REQUIRED } from './api.js';

const DB_NAME = 'travel-logger-outbox';
const DB_VERSION = 1;
const STORE = 'outbox';

const MAX_ATTEMPTS = 8;
const MAX_DEAD_LETTER_ATTEMPTS = 3;
const DRAIN_INTERVAL_MS = 15_000;
const CAP_ENTRIES = 5_000;
const CAP_BYTES = 10 * 1024 * 1024;

// ── DB ─────────────────────────────────────────────────────────────────────

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('by_status', 'status', { unique: false });
        store.createIndex('by_created_at', 'created_at', { unique: false });
        store.createIndex('by_trip_id', 'related_trip_id', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then((r) => { result = r; }).catch(reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Event bus ──────────────────────────────────────────────────────────────

const listeners = new Set();
export function onSyncStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(state) {
  for (const fn of listeners) {
    try { fn(state); } catch (err) { console.error('queue listener:', err); }
  }
}

// ── Module state ───────────────────────────────────────────────────────────

let draining = false;
let paused = false;          // set true on auth_required
let intervalId = null;
let nextAttemptTimer = null;

// ── Public API ─────────────────────────────────────────────────────────────

export async function init() {
  await openDb();
  // Reset any in_flight entries left over from a tab kill mid-drain.
  await tx('readwrite', async (store) => {
    const cursor = store.index('by_status').openCursor(IDBKeyRange.only('in_flight'));
    return new Promise((resolve, reject) => {
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return resolve();
        const v = c.value;
        v.status = 'pending';
        v.last_error = (v.last_error || '') + ' [reset from in_flight]';
        c.update(v);
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
  });

  if (navigator.storage?.persist) {
    try {
      const granted = await navigator.storage.persist();
      if (!granted) console.warn('navigator.storage.persist() denied — IndexedDB may be evicted under storage pressure');
    } catch (err) {
      console.warn('navigator.storage.persist() threw:', err);
    }
  }

  window.addEventListener('online', () => { paused = false; drain(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') drain();
  });
  intervalId = setInterval(drain, DRAIN_INTERVAL_MS);

  await emitCurrent();
  drain();
}

// Enqueue a write. Returns the entry's id; the body is treated opaquely.
export async function enqueue({ method, path, body, intent, trip_id, milestone_id }) {
  if (method !== 'POST' && method !== 'PATCH') {
    throw new Error(`enqueue: bad method ${method}`);
  }
  await ensureCapacity();
  const entry = {
    id: cryptoRandomId(),
    created_at: Date.now(),
    method,
    path,
    body,
    status: 'pending',
    attempts: 0,
    intent: intent ?? 'unknown',
    related_trip_id: trip_id ?? null,
    related_milestone_id: milestone_id ?? null,
  };
  await tx('readwrite', (store) => reqToPromise(store.add(entry)));
  await emitCurrent();
  drain();
  return entry.id;
}

// Used by the log screen on mount: re-attach queued writes for a trip so
// reloads don't "lose" optimistic taps until they drain.
export async function getQueuedFor(tripId) {
  return tx('readonly', (store) => new Promise((resolve, reject) => {
    const out = [];
    const idx = store.index('by_trip_id');
    const req = idx.openCursor(IDBKeyRange.only(tripId));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) {
        out.sort((a, b) => a.created_at - b.created_at);
        return resolve(out);
      }
      if (c.value.status !== 'synced') out.push(c.value);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  }));
}

// Used by the log screen on mount: find the MOST RECENT still-queued
// create_trip entry. With M9 the user can have a queued dep trip and a
// later queued arr trip; the active screen always wants the newest.
export async function getQueuedActiveTrip() {
  return tx('readonly', (store) => new Promise((resolve, reject) => {
    const req = store.index('by_created_at').openCursor(null, 'prev');
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(null);
      const v = c.value;
      if (v.intent === 'create_trip' && v.status !== 'synced' && v.status !== 'dead_letter') {
        return resolve(v);
      }
      c.continue();
    };
    req.onerror = () => reject(req.error);
  }));
}

export async function getCounts() {
  return tx('readonly', (store) => new Promise((resolve, reject) => {
    const counts = { pending: 0, in_flight: 0, failed_retriable: 0, dead_letter: 0, synced: 0 };
    const req = store.openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(counts);
      counts[c.value.status] = (counts[c.value.status] || 0) + 1;
      c.continue();
    };
    req.onerror = () => reject(req.error);
  }));
}

export async function getDeadLetters() {
  return tx('readonly', (store) => new Promise((resolve, reject) => {
    const out = [];
    const req = store.index('by_status').openCursor(IDBKeyRange.only('dead_letter'));
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      out.push(c.value);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  }));
}

export async function retryEntry(id) {
  await tx('readwrite', async (store) => {
    const entry = await reqToPromise(store.get(id));
    if (!entry) return;
    entry.status = 'pending';
    entry.attempts = 0;
    entry.next_attempt_at = undefined;
    entry.last_error = undefined;
    await reqToPromise(store.put(entry));
  });
  await emitCurrent();
  drain();
}

export async function discardEntry(id) {
  await tx('readwrite', (store) => reqToPromise(store.delete(id)));
  await emitCurrent();
}

export function resumeAfterAuth() {
  paused = false;
  drain();
}

// ── Drain loop ─────────────────────────────────────────────────────────────

async function drain() {
  if (draining || paused) return;
  draining = true;
  try {
    while (true) {
      const head = await readHead();
      if (!head) break;
      if (head.next_attempt_at && head.next_attempt_at > Date.now()) {
        scheduleNextAttempt(head.next_attempt_at - Date.now());
        break;
      }
      await markInFlight(head);
      await emitCurrent({ flying: head });
      const result = await fetchJSON(head.method, head.path, head.body);
      const transitioned = await transition(head, result);
      if (transitioned === 'auth_required') break;  // paused; bail out of loop
      if (transitioned === 'wait') break;           // backoff timer scheduled
    }
  } catch (err) {
    console.error('drain failed:', err);
  } finally {
    draining = false;
    await emitCurrent();
  }
}

function scheduleNextAttempt(ms) {
  clearTimeout(nextAttemptTimer);
  nextAttemptTimer = setTimeout(drain, Math.min(ms, 60_000));
}

async function readHead() {
  return tx('readonly', (store) => new Promise((resolve, reject) => {
    const req = store.index('by_created_at').openCursor(null, 'next');
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(null);
      const v = c.value;
      if (v.status === 'pending' || v.status === 'failed_retriable') return resolve(v);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  }));
}

async function markInFlight(entry) {
  await tx('readwrite', async (store) => {
    const fresh = await reqToPromise(store.get(entry.id));
    if (!fresh) return;
    fresh.status = 'in_flight';
    fresh.attempts = (fresh.attempts || 0) + 1;
    await reqToPromise(store.put(fresh));
  });
}

// Returns 'synced' | 'wait' | 'dead' | 'auth_required'.
async function transition(entry, result) {
  if (result.classification === 'success' || result.classification === 'duplicate') {
    await tx('readwrite', (store) => reqToPromise(store.delete(entry.id)));
    return 'synced';
  }

  if (result.classification === AUTH_REQUIRED) {
    paused = true;
    await tx('readwrite', async (store) => {
      const fresh = await reqToPromise(store.get(entry.id));
      if (!fresh) return;
      fresh.status = 'pending';      // not retriable — we want it tried again on resume
      fresh.last_error = 'auth_required';
      // attempts already bumped in markInFlight; un-bump (auth isn't a real attempt).
      fresh.attempts = Math.max(0, (fresh.attempts || 1) - 1);
      await reqToPromise(store.put(fresh));
    });
    await emitCurrent();
    return 'auth_required';
  }

  if (result.classification === 'fk_missing') {
    // Parent op hasn't drained yet; head-only drain means it'll get its turn.
    // Cap attempts so an orphaned dependent (parent dead_lettered) doesn't
    // retry forever.
    const wait = backoffMs(entry.attempts);
    await tx('readwrite', async (store) => {
      const fresh = await reqToPromise(store.get(entry.id));
      if (!fresh) return;
      if (fresh.attempts >= MAX_ATTEMPTS) {
        fresh.status = 'dead_letter';
      } else {
        fresh.status = 'failed_retriable';
        fresh.next_attempt_at = Date.now() + wait;
      }
      fresh.last_error = result.error || 'fk_missing';
      await reqToPromise(store.put(fresh));
    });
    if (entry.attempts >= MAX_ATTEMPTS) return 'dead';
    scheduleNextAttempt(wait);
    return 'wait';
  }

  if (result.classification === 'retriable' || result.classification === 'network_error') {
    const isNetwork = result.classification === 'network_error';
    const wait = backoffMs(entry.attempts);
    await tx('readwrite', async (store) => {
      const fresh = await reqToPromise(store.get(entry.id));
      if (!fresh) return;
      // Network errors don't count as real attempts.
      if (isNetwork) fresh.attempts = Math.max(0, (fresh.attempts || 1) - 1);
      if (!isNetwork && fresh.attempts >= MAX_ATTEMPTS) {
        fresh.status = 'dead_letter';
      } else {
        fresh.status = 'failed_retriable';
        fresh.next_attempt_at = Date.now() + wait;
      }
      fresh.last_error = result.error || result.classification;
      await reqToPromise(store.put(fresh));
    });
    if (isNetwork) {
      // No timer — wait for online/visibility.
      return 'wait';
    }
    scheduleNextAttempt(wait);
    return 'wait';
  }

  // dead_letter classification (4xx that isn't auth/dup/fk)
  await tx('readwrite', async (store) => {
    const fresh = await reqToPromise(store.get(entry.id));
    if (!fresh) return;
    if (fresh.attempts >= MAX_DEAD_LETTER_ATTEMPTS) {
      fresh.status = 'dead_letter';
    } else {
      fresh.status = 'failed_retriable';
      fresh.next_attempt_at = Date.now() + backoffMs(fresh.attempts);
    }
    fresh.last_error = result.error || 'client_error';
    await reqToPromise(store.put(fresh));
  });
  if (entry.attempts >= MAX_DEAD_LETTER_ATTEMPTS) return 'dead';
  scheduleNextAttempt(backoffMs(entry.attempts));
  return 'wait';
}

function backoffMs(attempt) {
  // 1, 2, 4, 8, 16, 32, 60 (cap)
  return Math.min(60_000, 1000 * Math.pow(2, Math.max(0, attempt - 1)));
}

// ── Storage discipline ─────────────────────────────────────────────────────

async function ensureCapacity() {
  const counts = await getCounts();
  const total = counts.pending + counts.in_flight + counts.failed_retriable + counts.dead_letter;
  if (total >= CAP_ENTRIES) {
    emit({ kind: 'overflow', reason: 'entry_cap', total });
    throw new Error(`Outbox full (${total}/${CAP_ENTRIES} entries)`);
  }
  if (navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      if ((est.usage ?? 0) > CAP_BYTES) {
        emit({ kind: 'overflow', reason: 'byte_cap', usage: est.usage });
        throw new Error(`Storage quota tight (${est.usage} bytes)`);
      }
    } catch { /* estimate is best-effort */ }
  }
}

async function emitCurrent(extras = {}) {
  const counts = await getCounts();
  emit({
    kind: 'state',
    counts,
    online: navigator.onLine,
    paused,
    draining,
    ...extras,
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────

function cryptoRandomId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
