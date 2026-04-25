// Thin Mapbox Search Box API client + static-image URL helper.
// We call the REST API directly rather than pulling in @mapbox/search-js-core
// to keep the CSP tight (`script-src 'self'` with no third-party allowance)
// and dodge adding a dependency for what is, at core, two HTTPS calls.
//
// Docs: https://docs.mapbox.com/api/search/search-box/
//       https://docs.mapbox.com/api/maps/static-images/

const BASE = 'https://api.mapbox.com/search/searchbox/v1';

function token() {
  return window.TRAVEL_CONFIG?.mapboxToken
    ?? (() => { throw new Error('Mapbox token missing — /config.js did not load.'); })();
}

function newSessionToken() {
  // Suggest+retrieve share one session token for billing. Format is a UUID.
  if (crypto?.randomUUID) return crypto.randomUUID();
  // Fallback for older browsers.
  const hex = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

/**
 * Suggest matches the address input as the user types.
 * @param {string} query  free-text search
 * @param {string} sessionToken  share across suggest→retrieve for one pick
 * @returns {Promise<Suggestion[]>}
 */
export async function suggest(query, sessionToken) {
  if (!query.trim()) return [];
  const url = new URL(`${BASE}/suggest`);
  url.searchParams.set('q', query);
  url.searchParams.set('access_token', token());
  url.searchParams.set('session_token', sessionToken);
  url.searchParams.set('language', 'en');
  url.searchParams.set('limit', '6');
  url.searchParams.set('types', 'address,poi');
  url.searchParams.set('proximity', 'ip');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox suggest ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.suggestions ?? [];
}

/**
 * Retrieve converts a suggestion's mapbox_id into a full feature with coords.
 * @returns {Promise<{mapbox_id: string, formatted: string, lat: number, lng: number}>}
 */
export async function retrieve(mapboxId, sessionToken) {
  const url = new URL(`${BASE}/retrieve/${encodeURIComponent(mapboxId)}`);
  url.searchParams.set('access_token', token());
  url.searchParams.set('session_token', sessionToken);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox retrieve ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) throw new Error('Mapbox retrieve: no feature returned');
  const [lng, lat] = feature.geometry.coordinates;
  const p = feature.properties;
  const formatted = p.full_address ?? p.place_formatted ?? p.name;
  return { mapbox_id: mapboxId, formatted, lat, lng };
}

/**
 * Mapbox Directions — driving-traffic profile, traffic-aware ETA from
 * origin → destination. Returns the drive duration in seconds (and the
 * route distance in meters for context).
 *
 * When `departAt` is omitted, the response uses real-time traffic
 * (whatever is happening at the API call moment). When `departAt` is a
 * future Date, Mapbox returns a typical-traffic estimate for that time
 * — equivalent to Google Maps' "Depart at..." prediction, computed from
 * Mapbox's pattern data. Use that for any flight more than a few hours
 * out; "right now" traffic for a Tuesday morning when you're predicting
 * on Saturday evening is actively misleading.
 *
 * Caller is responsible for showing a fallback when this throws (no
 * network, Mapbox down, missing token, depart_at too far out, etc.) —
 * usually fall back to the historical drive p90.
 *
 * Docs: https://docs.mapbox.com/api/navigation/directions/
 */
export async function drivingDirections(originLng, originLat, destLng, destLat, { departAt } = {}) {
  const coords = `${originLng},${originLat};${destLng},${destLat}`;
  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}`);
  url.searchParams.set('access_token', token());
  url.searchParams.set('overview', 'false');         // we only need the duration, not the geometry
  url.searchParams.set('alternatives', 'false');
  url.searchParams.set('annotations', 'duration');
  if (departAt instanceof Date && !isNaN(departAt.getTime())) {
    // Mapbox accepts ISO 8601 in UTC. Drop the milliseconds for a cleaner URL.
    url.searchParams.set('depart_at', departAt.toISOString().replace(/\.\d+Z$/, 'Z'));
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox directions ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) throw new Error('Mapbox directions: no route returned');
  return { duration_s: Math.round(route.duration), distance_m: Math.round(route.distance) };
}

/** Static map image URL for pin confirmation. */
export function staticMapUrl(lat, lng, { width = 600, height = 400, zoom = 15 } = {}) {
  const pin = `pin-s+FF9F0A(${lng},${lat})`;
  return `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/`
       + `${pin}/${lng},${lat},${zoom},0/${width}x${height}@2x`
       + `?access_token=${encodeURIComponent(token())}`;
}

export { newSessionToken };
