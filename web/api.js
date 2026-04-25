// PostgREST client + the fetchJSON primitive every write rides through.
//
// After M8: `api.get` still calls the network directly (reads aren't queued),
// but `api.post` and `api.patch` enqueue the write into the IndexedDB outbox
// and return synchronously. The body is treated as the optimistic row so the
// existing `[saved] = await api.post(...)` shape still works — the body must
// carry a client-generated `id` for any row downstream code FKs against.

const BASE = '/api';

export const AUTH_REQUIRED = 'auth_required';

export class ApiError extends Error {
  constructor(status, statusText, body) {
    super(`${status} ${statusText}${body ? `: ${body}` : ''}`);
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

// ── fetchJSON: the only path to /api/* ─────────────────────────────────────

export async function fetchJSON(method, path, body) {
  const init = {
    method,
    credentials: 'same-origin',
    redirect: 'manual',
    headers: {
      'Accept': 'application/json',
      'Prefer': 'return=representation',
    },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(BASE + path, init);
  } catch (err) {
    return { ok: false, classification: 'network_error', error: err.message };
  }

  // `redirect: 'manual'` produces an opaqueredirect response (status 0) when
  // the server tries to bounce us. Authelia does this when the session is
  // expired or the cookie is missing.
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    return { ok: false, classification: AUTH_REQUIRED, error: `redirect (${res.status})` };
  }

  // Some Authelia/proxy chains serve an HTML login page with a 200. Treat any
  // non-JSON 2xx body as auth_required too — JSON shape is part of "success".
  const ct = res.headers.get('Content-Type') || '';
  const isJson = ct.includes('json');

  if (res.status >= 200 && res.status < 300) {
    if (res.status === 204 || res.headers.get('Content-Length') === '0') {
      return { ok: true, classification: 'success', data: null };
    }
    if (!isJson) {
      return { ok: false, classification: AUTH_REQUIRED, error: `non-json 2xx (${ct})` };
    }
    let data;
    try { data = await res.json(); }
    catch (err) { return { ok: false, classification: 'dead_letter', error: `bad json: ${err.message}` }; }
    return { ok: true, classification: 'success', data };
  }

  // Read body once for diagnostics + PostgREST error code.
  const errText = await res.text().catch(() => '');

  if (res.status === 409) {
    // PostgREST surfaces Postgres SQLSTATE in the JSON body when JSON.
    // 23505 = unique_violation. 23503 = foreign_key_violation.
    if (/"code"\s*:\s*"23505"/.test(errText)) {
      return { ok: false, classification: 'duplicate', error: errText };
    }
    if (/"code"\s*:\s*"23503"/.test(errText)) {
      return { ok: false, classification: 'fk_missing', error: errText };
    }
    return { ok: false, classification: 'dead_letter', error: errText };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, classification: AUTH_REQUIRED, error: `${res.status} ${res.statusText}` };
  }

  if (res.status >= 500) {
    return { ok: false, classification: 'retriable', error: `${res.status} ${errText}` };
  }

  // 4xx other than the ones above — bad request, validation, etc.
  return { ok: false, classification: 'dead_letter', error: `${res.status} ${errText}` };
}

// ── Public API ─────────────────────────────────────────────────────────────
//
// `get` calls fetchJSON directly and throws ApiError on failure (matches the
// pre-M8 shape so screens don't need rewrites). `post`/`patch` enqueue into
// the outbox and return [body] immediately so optimistic UI keeps working.

// Lazy import to break the api.js ↔ queue.js cycle at module evaluation time.
let _enqueue;
async function enqueue(args) {
  if (!_enqueue) {
    const mod = await import('./queue.js');
    _enqueue = mod.enqueue;
  }
  return _enqueue(args);
}

export const api = {
  async get(path) {
    const result = await fetchJSON('GET', path);
    if (result.ok) return result.data;
    if (result.classification === AUTH_REQUIRED) {
      // Reads block on auth — bounce immediately rather than crash the screen.
      location.href = '/auth/?rd=' + encodeURIComponent(location.href);
      // Return a non-throwing shape so the awaiting code can no-op until the
      // navigation actually happens.
      return null;
    }
    throw new ApiError(result.classification, result.classification, result.error);
  },

  async post(path, body, opts = {}) {
    await enqueue({
      method: 'POST',
      path,
      body,
      intent: opts.intent ?? 'unknown',
      trip_id: opts.trip_id ?? body?.trip_id ?? body?.id ?? null,
      milestone_id: opts.milestone_id ?? null,
    });
    return [body];
  },

  async patch(path, body, opts = {}) {
    await enqueue({
      method: 'PATCH',
      path,
      body,
      intent: opts.intent ?? 'unknown',
      trip_id: opts.trip_id ?? null,
      milestone_id: opts.milestone_id ?? null,
    });
    return [body];
  },

  // Synchronous request/response — predictions are not queued. The user is
  // staring at the screen waiting for the answer. If the network fails or
  // auth dies, we surface the error to the form rather than enqueuing.
  async predict(body) {
    const result = await fetchJSON('POST', '/predict', body);
    if (result.ok) return result.data;
    if (result.classification === AUTH_REQUIRED) {
      location.href = '/auth/?rd=' + encodeURIComponent(location.href);
      return null;
    }
    throw new ApiError(result.classification, result.classification, result.error);
  },
};
