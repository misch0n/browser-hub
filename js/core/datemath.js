// Date arithmetic for `date`, `days` and `week`. Pure: ISO dates in and out,
// `now` passed in. Dates are read by parseDate (core/util.js), so every form
// it knows works here too.

import { parseDate, parseISO, toISO, addDays, daysBetween, weekdayIndex } from './util.js';

const UNITS = { d: 'd', day: 'd', days: 'd', w: 'w', week: 'w', weeks: 'w', m: 'm', month: 'm', months: 'm',
  y: 'y', year: 'y', years: 'y', wd: 'wd', workday: 'wd', workdays: 'wd', bd: 'wd' };
const STEP_RE = /(?:^|\s)([+-])\s?(\d{1,5})\s?(workdays?|wd|bd|days?|d|weeks?|w|months?|m|years?|y)$/;

const isWeekend = (iso) => { const g = parseISO(iso).getDay(); return g === 0 || g === 6; };

// Calendar months and years keep the day, or the month's last day (31 January + 1m = 28 or 29 February).
function addMonths(iso, n) {
  const d = parseISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return toISO(d);
}

// Monday to Friday; starting on a weekend, +1 workday is the Monday.
function addWorkdays(iso, n) {
  let d = iso;
  const s = Math.sign(n);
  for (let left = Math.abs(n); left > 0;) {
    d = addDays(d, s);
    if (!isWeekend(d)) left--;
  }
  return d;
}

export function step(iso, sign, n, unit) {
  const k = sign === '-' ? -n : n;
  if (unit === 'd') return addDays(iso, k);
  if (unit === 'w') return addDays(iso, 7 * k);
  if (unit === 'm') return addMonths(iso, k);
  if (unit === 'y') return addMonths(iso, 12 * k);
  return addWorkdays(iso, k);
}

// A date read looking back: `fri` is the last Friday (never today), `12 oct` the last 12 October.
export function pastDate(text, now) {
  const s = String(text).trim().toLowerCase();
  const today = toISO(now);
  const d = parseDate(s, now);
  if (!d || /\d{4}/.test(s) || d <= today) return d;
  const wd = /^(?:last )?([a-z]+\.?)$/.exec(s);
  if (wd && weekdayIndex(wd[1]) >= 0) return addDays(today, -((now.getDay() - weekdayIndex(wd[1]) + 7) % 7 || 7)); // never today
  return addMonths(d, -12);
}

// `12 oct`, `oct 12`: a day of a month with no year.
const yearless = (s) => /^(\d{1,2} [a-z]+\.?|[a-z]+\.? \d{1,2})$/.test(s);

// One point in time: `[date] [± N unit]…`, the date defaulting to today.
// opts.past: a date without a year (or a weekday) is the last one, not the next;
// opts.thisYear: a day of a month without a year is this year's.
// -> { date, base, steps: [[sign, n, unit]] } or { error }
export function point(text, now, opts = {}) {
  let s = String(text).trim().toLowerCase().replace(/\s+/g, ' ');
  const steps = [];
  let m;
  while ((m = STEP_RE.exec(s))) {
    steps.unshift([m[1], +m[2], UNITS[m[3]]]);
    s = s.slice(0, m.index).trim();
  }
  // `3 days ago`, `2 weeks ago`
  const ago = /^(\d{1,5}) ?(days?|d|weeks?|w|months?|m|years?|y|workdays?|wd)(?: ago)$/.exec(s);
  if (ago) { steps.unshift(['-', +ago[1], UNITS[ago[2]]]); s = ''; }
  const last = /^last ([a-z]+\.?)$/.exec(s);
  let base;
  if (!s) base = toISO(now);
  else if (last && weekdayIndex(last[1]) >= 0) base = pastDate(last[1], now);
  else base = opts.past ? pastDate(s, now) : parseDate(s, now);
  if (!base) return { error: "don't know the date '" + s + "'" };
  if (opts.thisYear && yearless(s) && base.slice(0, 4) !== toISO(now).slice(0, 4)) base = addMonths(base, -12);
  let date = base;
  for (const [sign, n, unit] of steps) date = step(date, sign, n, unit);
  return { date, base, steps, yearless: yearless(s) };
}

// ISO week (Monday first; week 1 holds the year's first Thursday) -> { year, week }.
export function isoWeek(iso) {
  const d = parseISO(iso);
  const thursday = addDays(iso, 3 - ((d.getDay() + 6) % 7));
  const year = +thursday.slice(0, 4);
  return { year, week: 1 + Math.floor(daysBetween(year + '-01-01', thursday) / 7) };
}
export const weeksIn = (year) => isoWeek(year + '-12-28').week;
export function weekMonday(year, week) {
  const jan4 = year + '-01-04';
  return addDays(jan4, -((parseISO(jan4).getDay() + 6) % 7) + 7 * (week - 1));
}

export const dayOfYear = (iso) => daysBetween(iso.slice(0, 4) + '-01-01', iso) + 1;
export const daysInYear = (y) => (parseISO(y + '-02-29') ? 366 : 365);

// Weekdays after `a` up to and including `b` (negative when b is earlier):
// the N in `a + N workdays = b`, give or take a weekend at either end.
export function workdaysBetween(a, b) {
  const sign = a <= b ? 1 : -1;
  const [from, to] = sign > 0 ? [a, b] : [b, a];
  const total = daysBetween(from, to);
  let n = Math.floor(total / 7) * 5;
  let d = addDays(from, Math.floor(total / 7) * 7);
  while (d < to) { d = addDays(d, 1); if (!isWeekend(d)) n++; }
  return sign * n;
}

// From a to b in calendar terms: { years, months, days } (b on or after a).
export function calendarSpan(a, b) {
  const [from, to] = a <= b ? [a, b] : [b, a];
  let months = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7));
  if (addMonths(from, months) > to) months--;
  const days = daysBetween(addMonths(from, months), to);
  return { years: Math.floor(months / 12), months: months % 12, days };
}

// `a to b`, `a until b`: from a to b. `a - b`: a minus b, so from b to a.
// Days of months without a year read as a calendar would: `1 jan to 25 dec`
// is this year's, and the second is never before the first.
// -> { from, to } or null when `text` isn't a difference.
export function difference(text, now) {
  const s = String(text).trim().toLowerCase();
  const seps = [' to ', ' until ', ' till ', ' → ', ' - ', ' – '];
  for (const sep of seps) {
    let i = s.indexOf(sep);
    while (i > 0) {
      const a = point(s.slice(0, i), now, { thisYear: true });
      const b = point(s.slice(i + sep.length), now, { thisYear: true });
      // `x - 3d` is a step back, not a difference: `3d` alone isn't a date.
      if (!a.error && !b.error && s.slice(i + sep.length).trim()) {
        const minus = sep === ' - ' || sep === ' – ';
        const [first, second] = minus ? [b, a] : [a, b];
        let to = second.date;
        while (second.yearless && !second.steps.length && to < first.date) to = addMonths(to, 12);
        return { from: first.date, to };
      }
      i = s.indexOf(sep, i + 1);
    }
  }
  return null;
}
