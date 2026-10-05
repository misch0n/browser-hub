import { pad2, isValidZone, canonicalZone } from '../core/util.js';
import { shortDate } from '../core/format.js';

export const WORK_START = 9 * 60;
export const WORK_END = 17 * 60;

// Intl formatters are expensive to build; the zones widget asks every second.
const formatters = new Map();
function formatter(zone) {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
    formatters.set(zone, f);
  }
  return f;
}

export function localZone() {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

// Wall-clock parts of `date` in `zone`.
export function partsIn(date, zone) {
  const p = {};
  for (const x of formatter(zone).formatToParts(date)) p[x.type] = x.value;
  return { date: p.year + '-' + p.month + '-' + p.day, minutes: (+p.hour % 24) * 60 + +p.minute };
}

// Minutes `zone` is ahead of UTC at instant `date`.
export function offsetMinutes(date, zone) {
  const p = partsIn(date, zone);
  const [y, m, d] = p.date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, Math.floor(p.minutes / 60), p.minutes % 60);
  const utc = Math.floor(date.getTime() / 60000) * 60000;
  return Math.round((wall - utc) / 60000);
}

// UTC offset of `zone` at `date`, as '+09:00' / '-04:00' / '+00:00'.
export function offsetOf(date, zone) {
  const off = offsetMinutes(date, zone);
  const a = Math.abs(off);
  return (off < 0 ? '-' : '+') + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
}

// The instant at which the wall clock in `zone` shows the given local time.
// Two passes settle the offset, including right after a DST change.
export function zonedToDate(y, mo, d, h, mi, s, zone) {
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = wall - offsetMinutes(new Date(wall), zone) * 60000;
  t = wall - offsetMinutes(new Date(t), zone) * 60000;
  return new Date(t);
}

export const clock = (minutes) => pad2(Math.floor(minutes / 60)) + ':' + pad2(minutes % 60);

// Rows for `instant` in each zone, earliest wall clock first. zones[0] is the
// reference (local) zone: `ref` marks its row, and `date` is filled in only for
// zones whose calendar day differs from it ('Tue 6 Oct').
export function zoneRows(instant, zones) {
  const base = partsIn(instant, zones[0]);
  return zones.map((zone, i) => {
    const p = partsIn(instant, zone);
    const dayDiff = Math.round((Date.parse(p.date) - Date.parse(base.date)) / 86400000);
    return {
      zone,
      ref: i === 0,
      time: clock(p.minutes),
      offset: offsetOf(instant, zone),
      offsetMin: offsetMinutes(instant, zone),
      dayDiff,
      date: dayDiff === 0 ? '' : shortDate(p.date, base.date),
      working: p.minutes >= WORK_START && p.minutes < WORK_END,
    };
  }).sort((a, b) => a.offsetMin - b.offsetMin); // stable: the local row leads its offset
}

// Every IANA zone this browser knows, plus UTC.
let known = null;
export function allZones() {
  if (!known) {
    const list = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    known = list.includes('UTC') ? list.slice() : list.concat('UTC');
  }
  return known;
}

// 'Tokyo' -> 'Asia/Tokyo'. Accepts an IANA name in any case, or a city (the
// last part of a zone name, spaces for underscores). Returns null if unknown.
export function resolveZone(arg) {
  if (!arg) return null;
  if (isValidZone(arg)) return canonicalZone(arg);
  const want = arg.trim().toLowerCase().replace(/\s+/g, '_');
  return allZones().find((z) => z.split('/').pop().toLowerCase() === want) || null;
}

// What a zone is called on screen: the user's name for it, else its city.
export function zoneLabel(zone, names) {
  const own = names && Object.prototype.hasOwnProperty.call(names, zone) ? names[zone] : null;
  return typeof own === 'string' && own ? own : zone.split('/').pop().replace(/_/g, ' ');
}

// Ranges of the local day (as 'HH:MM-HH:MM') when every zone is within 09:00-17:00.
export function workOverlap(day, zones) {
  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const ranges = [];
  const nextMidnight = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  // Labels use the real local wall time, so DST days (23 or 25 hours) stay correct.
  const label = (t) => (t.getTime() >= nextMidnight ? '24:00' : clock(t.getHours() * 60 + t.getMinutes()));
  let start = null;
  for (let ms = midnight.getTime(); ; ms += 15 * 60000) {
    const t = new Date(ms);
    const inDay = ms < nextMidnight;
    const ok = inDay && zones.every((z) => {
      const m = partsIn(t, z).minutes;
      return m >= WORK_START && m < WORK_END;
    });
    if (ok && start === null) start = t;
    if (!ok && start !== null) {
      ranges.push(label(start) + '-' + label(t));
      start = null;
    }
    if (!inDay) break;
  }
  return ranges;
}
