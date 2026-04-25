// Shared timezone + DST helpers. Originally inline in screens/log.js (M7);
// extracted in M10 because the predict screen reuses the same form pattern
// (local date+time → tz validation, DST warnings).

// "YYYY-MM-DDTHH:mm" (in tz) → UTC ISO string.
export function localInputValueToUtcIso(localStr, tz) {
  const [datePart, timePart] = localStr.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, hh, mm);
  const offsetMs = tzOffsetMs(new Date(asUtc), tz);
  return new Date(asUtc - offsetMs).toISOString();
}

export function utcIsoToLocalInputValue(iso, tz) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: tz,
  }).formatToParts(d);
  const map = {};
  parts.forEach((p) => { if (p.type !== 'literal') map[p.type] = p.value; });
  const hour = map.hour === '24' ? '00' : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}`;
}

export function tzOffsetMs(date, tz) {
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

// Returns null, 'spring_nonexistent', or 'fall_ambiguous'.
export function checkDstCode(dateStr, timeStr, tz) {
  if (!dateStr || !timeStr || !tz) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const wallMs = Date.UTC(y, m - 1, d, hh, mm);
  const offsetNow = tzOffsetMs(new Date(wallMs), tz);
  const utcGuess = wallMs - offsetNow;
  const offsetCheck = tzOffsetMs(new Date(utcGuess), tz);
  if (offsetNow !== offsetCheck) {
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

export function checkDst(dateStr, timeStr, tz) {
  const code = checkDstCode(dateStr, timeStr, tz);
  if (code === 'spring_nonexistent') return 'this time does not exist on DST day (spring forward).';
  if (code === 'fall_ambiguous') return 'this time is ambiguous on DST day (fall back).';
  return null;
}
