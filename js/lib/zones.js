import { pad2 } from '../core/util.js';

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

// Rows for `instant` in each zone; zones[0] is the reference (local) zone.
export function zoneRows(instant, zones) {
  const base = partsIn(instant, zones[0]);
  return zones.map((zone) => {
    const p = partsIn(instant, zone);
    const dayDiff = Math.round((Date.parse(p.date) - Date.parse(base.date)) / 86400000);
    return {
      zone,
      time: clock(p.minutes),
      offset: offsetOf(instant, zone),
      day: dayDiff === 0 ? '' : (dayDiff > 0 ? '+' : '') + dayDiff + 'd',
      working: p.minutes >= WORK_START && p.minutes < WORK_END,
    };
  });
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
