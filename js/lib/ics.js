import { pad2, toISO, parseISO, isValidZone } from '../core/util.js';
import { zonedToDate } from './zones.js';

function unescapeText(s) {
  return s.replace(/\\([nN,;\\])/g, (m, c) => (c === 'n' || c === 'N' ? ' ' : c));
}

// DTSTART value + its TZID (if any) -> { date, time|null, guessed } in the browser's local time.
//   20261005                         all-day
//   20261005T093000Z                 UTC
//   TZID=America/New_York:...T0900   that zone's wall time
//   20261005T093000                  floating: taken as local
function parseStart(value, tzid) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const date = y + '-' + mo + '-' + d;
  if (!parseISO(date)) return null;
  if (h === undefined) return { date, time: null, guessed: false };
  if (+h > 23 || +mi > 59 || +(s || 0) > 59) return null;
  let dt, guessed = false;
  if (z) dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)));
  else if (tzid && isValidZone(tzid)) dt = zonedToDate(+y, +mo, +d, +h, +mi, +(s || 0), tzid);
  else {
    // Unknown zone names (e.g. Windows ones) fall back to local time.
    guessed = !!tzid;
    dt = new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0));
  }
  if (isNaN(dt.getTime())) return null;
  return { date: toISO(dt), time: pad2(dt.getHours()) + ':' + pad2(dt.getMinutes()), guessed };
}

// -> { events: [{date, time, title}], recurring: n, invalid: n, guessedZones: n }
export function parseICS(text) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let recurring = 0, invalid = 0, guessedZones = 0;
  let cur = null;
  let nested = 0; // depth inside VALARM and other sub-components of an event
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT') { cur = { start: null, title: '', rrule: false, cancelled: false }; nested = 0; continue; }
    if (upper === 'END:VEVENT') {
      if (cur) {
        if (cur.cancelled) { /* skip */ }
        else if (cur.rrule) recurring++;
        else if (!cur.start) invalid++;
        else {
          if (cur.start.guessed) guessedZones++;
          events.push({ date: cur.start.date, time: cur.start.time, title: (cur.title || '(no title)').slice(0, 200) });
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    if (upper.startsWith('BEGIN:')) { nested++; continue; }
    if (upper.startsWith('END:')) { nested = Math.max(0, nested - 1); continue; }
    if (nested) continue; // e.g. a VALARM's SUMMARY is not the event title
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [rawName, ...params] = line.slice(0, colon).split(';');
    const name = rawName.toUpperCase();
    const value = line.slice(colon + 1);
    if (name === 'DTSTART') {
      const tz = params.find((p) => /^TZID=/i.test(p));
      cur.start = parseStart(value, tz ? tz.slice(5).replace(/^"|"$/g, '') : null);
    } else if (name === 'SUMMARY') cur.title = unescapeText(value).trim();
    else if (name === 'RRULE') cur.rrule = true;
    else if (name === 'STATUS' && value.trim().toUpperCase() === 'CANCELLED') cur.cancelled = true;
  }
  return { events, recurring, invalid, guessedZones };
}
