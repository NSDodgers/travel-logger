// Thin PostgREST client. Every call rides the Authelia session cookie that
// Caddy trusts — we never handle JWT or a bearer token here.
// Docs: https://postgrest.org/en/stable/api.html

const BASE = '/api';

export class ApiError extends Error {
  constructor(status, statusText, body) {
    super(`${status} ${statusText}${body ? `: ${body}` : ''}`);
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, body) {
  const init = {
    method,
    credentials: 'same-origin',
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
    throw new ApiError(0, 'Network error', err.message);
  }

  // Authelia redirects unauthenticated requests; `fetch` with default redirect
  // follows them, so we only see 401 if authelia explicitly blocks via header.
  if (res.status === 401) {
    location.href = '/auth/?rd=' + encodeURIComponent(location.href);
    return null;
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new ApiError(res.status, res.statusText, errBody);
  }

  if (res.status === 204 || res.headers.get('Content-Length') === '0') return null;
  const ct = res.headers.get('Content-Type') || '';
  if (!ct.includes('json')) return null;
  return res.json();
}

export const api = {
  get:   (path) => request('GET', path),
  post:  (path, body) => request('POST', path, body),
  patch: (path, body) => request('PATCH', path, body),
};
