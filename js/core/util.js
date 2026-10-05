export const SCHEMA = 1;

export const pad2 = (n) => String(n).padStart(2, '0');

const WEEKDAYS = [
  ['sun', 'sunday'],
  ['mon', 'monday'],
  ['tue', 'tues', 'tuesday'],
  ['wed', 'wednesday'],
  ['thu', 'thur', 'thurs', 'thursday'],
  ['fri', 'friday'],
  ['sat', 'saturday'],
];

export function toISO(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

// 'YYYY-MM-DD' -> Date at local midnight, or null if not a real calendar date.
export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

// Whole days from ISO date a to ISO date b (DST-safe: both are calendar dates).
export function daysBetween(a, b) {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

export function todayISO(now) {
  return toISO(now || new Date());
}

function weekdayIndex(s) {
  return WEEKDAYS.findIndex((names) => names.includes(s));
}

// The one date parser: ISO dates, today, tomorrow, weekday names (next
// occurrence, never today), and +Nd / +Nw offsets. Returns 'YYYY-MM-DD' or null.
export function parseDate(str, now) {
  const s = String(str).trim().toLowerCase();
  if (parseISO(s)) return s;
  const today = toISO(now || new Date());
  if (s === 'today') return today;
  if (s === 'tomorrow') return addDays(today, 1);
  const off = /^\+(\d{1,4})([dw])$/.exec(s);
  if (off) return addDays(today, +off[1] * (off[2] === 'w' ? 7 : 1));
  const wd = weekdayIndex(s);
  if (wd >= 0) {
    let diff = (wd - parseISO(today).getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    return addDays(today, diff);
  }
  return null;
}

// 24-hour 'H:MM' / 'HH:MM' -> 'HH:MM', or null.
export function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return pad2(+m[1]) + ':' + m[2];
}

export function isValidZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch (e) {
    return false;
  }
}

export function canonicalZone(zone) {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
}

export function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export function firstLine(s) {
  return String(s).split('\n')[0];
}

export function plural(n, word, many) {
  return n + ' ' + (n === 1 ? word : many || word + 's');
}

// Parses 't3' / '3' (prefix optional) to the canonical id, or null.
export function parseId(prefix, s) {
  const m = new RegExp('^' + prefix + '?(\\d+)$', 'i').exec(s);
  return m ? prefix + +m[1] : null;
}

export const idNum = (id) => parseInt(id.slice(1), 10);
export const byIdNum = (a, b) => idNum(a.id) - idNum(b.id);
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
