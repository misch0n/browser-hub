export const SCHEMA = 1;

export const pad2 = (n) => String(n).padStart(2, '0');

// Day and month names are matched by any start of the full name, from two
// letters for days (mo, tu, we, th, fr, sa, su) and three for months (jan … dec),
// so fri, frid and friday all work. Always shown in full.
const DAY_FULL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december'];

const byPrefix = (names, min) => (s) => {
  const w = String(s).toLowerCase().replace(/\.$/, '');
  if (w.length < min) return -1;
  const hits = names.map((n, i) => (n.startsWith(w) ? i : -1)).filter((i) => i >= 0);
  return hits.length === 1 ? hits[0] : -1;
};
export const weekdayIndex = byPrefix(DAY_FULL, 2);
export const monthIndex = byPrefix(MONTH_FULL, 3);

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

// The one date parser. Returns 'YYYY-MM-DD' or null. Understands:
//   2026-10-31 · today · tomorrow (tmr) · yesterday
//   friday (fri, fr …): the coming one, never today · next friday: a week after that
//   12 oct · oct 12 · 12 october 2027 (without a year: the next one to come)
//   +3d · +2w · +1m · in 3 days · in 2 weeks · in 1 month
export function parseDate(str, now) {
  const s = String(str).trim().toLowerCase().replace(/\s+/g, ' ').replace(/,/g, '');
  if (!s) return null;
  if (parseISO(s)) return s;
  const today = toISO(now || new Date());
  if (s === 'today' || s === 'now') return today;
  if (s === 'tomorrow' || s === 'tmr' || s === 'tmrw') return addDays(today, 1);
  if (s === 'yesterday') return addDays(today, -1);
  const off = /^(?:\+|in )(\d{1,4}) ?(d|days?|w|weeks?|m|months?)$/.exec(s);
  if (off) {
    const n = +off[1];
    if (off[2][0] === 'm') {
      const d = parseISO(today);
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + n);
      d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
      return toISO(d);
    }
    return addDays(today, n * (off[2][0] === 'w' ? 7 : 1));
  }
  const nx = /^(next )?([a-z]+\.?)$/.exec(s);
  if (nx) {
    const wd = weekdayIndex(nx[2]);
    if (wd >= 0) {
      let diff = (wd - parseISO(today).getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      return addDays(today, diff + (nx[1] ? 7 : 0));
    }
  }
  // 12 oct [2027] · oct 12 [2027]
  const dm = /^(\d{1,2}) ([a-z]+\.?)(?: (\d{4}))?$/.exec(s) || /^([a-z]+\.?) (\d{1,2})(?: (\d{4}))?$/.exec(s);
  if (dm) {
    const [day, mon] = /^\d/.test(dm[1]) ? [+dm[1], dm[2]] : [+dm[2], dm[1]];
    const m = monthIndex(mon);
    if (m < 0) return null;
    const ty = +today.slice(0, 4);
    let y = dm[3] ? +dm[3] : ty;
    let iso = y + '-' + pad2(m + 1) + '-' + pad2(day);
    if (!parseISO(iso)) return null;
    if (!dm[3] && iso < today) { y += 1; iso = y + '-' + pad2(m + 1) + '-' + pad2(day); }
    return parseISO(iso) ? iso : null;
  }
  return null;
}

// The date at the start of `words` (one to three of them, longest first):
// { date, used } with `used` the number of words, or null.
export function leadingDate(words, now) {
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const date = parseDate(words.slice(0, n).join(' '), now);
    if (date) return { date, used: n };
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
