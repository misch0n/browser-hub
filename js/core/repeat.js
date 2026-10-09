// Recurring tasks and events: `t water the plants every:mon,thu`,
// `ev fri 19:00 book club every:week`. A recurring task is never finished;
// `t done` moves its due date to the next occurrence. A recurring event is one
// item whose occurrences are worked out from its date and rule (occursOn, nextOn).
//
// Rules: day, weekday (Mon-Fri), week, month, year, N d|w|m|y (2w, 10d, 3m),
// or a list of weekdays (mon,thu). Stored normalized: 'day', 'weekday',
// 'week', 'month', 'year', '2w', 'mon,thu'.

import { parseISO, toISO } from './util.js';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WORDS = { day: 'day', daily: 'day', weekday: 'weekday', weekdays: 'weekday', week: 'week', weekly: 'week',
  month: 'month', monthly: 'month', year: 'year', yearly: 'year', annually: 'year' };
const UNIT = { d: 'day', w: 'week', m: 'month', y: 'year' };

// -> normalized rule, or null when `s` isn't one.
export function parseRepeat(s) {
  const t = String(s || '').trim().toLowerCase();
  if (WORDS[t]) return WORDS[t];
  const n = /^(\d{1,3})\s*([dwmy])$/.exec(t);
  if (n) {
    const k = +n[1];
    if (k < 1) return null;
    return k === 1 ? UNIT[n[2]] : k + n[2];
  }
  const days = t.split(/[,\s/]+/).filter(Boolean).map((d) => DAYS.indexOf(d.slice(0, 3)));
  if (days.length && days.every((d, i) => d >= 0 && t.split(/[,\s/]+/).filter(Boolean)[i].length >= 2)) {
    return [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAYS[d]).join(',');
  }
  return null;
}

const addDays = (iso, n) => {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const addMonths = (iso, n) => {
  const d = parseISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
};

// The day set a rule fires on, for weekday rules; null for interval rules.
function daySet(rule) {
  if (rule === 'weekday') return new Set([1, 2, 3, 4, 5]);
  if (/^[a-z]{3}(,[a-z]{3})*$/.test(rule) && rule.split(',').every((d) => DAYS.includes(d))) {
    return new Set(rule.split(',').map((d) => DAYS.indexOf(d)));
  }
  return null;
}

function step(rule, iso) {
  if (rule === 'day') return addDays(iso, 1);
  if (rule === 'week') return addDays(iso, 7);
  if (rule === 'month') return addMonths(iso, 1);
  if (rule === 'year') return addMonths(iso, 12);
  const m = /^(\d+)([dwmy])$/.exec(rule);
  if (!m) return null;
  const k = +m[1];
  return m[2] === 'd' ? addDays(iso, k) : m[2] === 'w' ? addDays(iso, 7 * k) : addMonths(iso, m[2] === 'm' ? k : 12 * k);
}

// First day on or after `from` (rule's own days for weekday rules; `from`
// itself for interval rules): the due date of a new recurring task.
export function firstDue(rule, from) {
  const set = daySet(rule);
  if (!set) return from;
  let d = from;
  for (let i = 0; i < 8 && !set.has(parseISO(d).getDay()); i++) d = addDays(d, 1);
  return d;
}

// The due date after completing a task due `due` on `today`: the next
// occurrence after both, so finishing late doesn't leave it overdue and
// finishing early skips the one just done. Interval rules keep their rhythm
// (a weekly Monday task stays on Mondays).
export function nextDue(rule, due, today) {
  const base = due || today;
  const set = daySet(rule);
  if (set) {
    let d = addDays(base > today ? base : today, 1);
    for (let i = 0; i < 8 && !set.has(parseISO(d).getDay()); i++) d = addDays(d, 1);
    return d;
  }
  let d = step(rule, base);
  for (let i = 0; d && d <= today && i < 5000; i++) d = step(rule, d);
  return d;
}

// 'every Mon, Thu' / 'every 2 weeks' / 'every day'.
export function repeatLabel(rule) {
  const set = daySet(rule);
  if (rule === 'weekday') return 'every weekday';
  if (set) return 'every ' + rule.split(',').map((d) => FULL[DAYS.indexOf(d)]).join(', ');
  const m = /^(\d+)([dwmy])$/.exec(rule);
  if (m) return 'every ' + m[1] + ' ' + UNIT[m[2]] + 's';
  return 'every ' + rule;
}

// ---- event series --------------------------------------------------------------------
// A series starts on its event's date and has no end. Month and year rules keep
// the start's day of the month, on the last day of shorter months (31st -> 30 Apr,
// 29 Feb -> 28 Feb).

const dayNo = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
const lastDay = (y, m) => new Date(y, m, 0).getDate(); // m: 1-12

// { kind: 'd' | 'm', n } for interval rules (weeks are 7 days, years 12 months); null for day sets.
function interval(rule) {
  if (rule === 'day') return { kind: 'd', n: 1 };
  if (rule === 'week') return { kind: 'd', n: 7 };
  if (rule === 'month') return { kind: 'm', n: 1 };
  if (rule === 'year') return { kind: 'm', n: 12 };
  const m = /^(\d+)([dwmy])$/.exec(rule);
  if (!m) return null;
  const k = +m[1];
  return { d: { kind: 'd', n: k }, w: { kind: 'd', n: 7 * k }, m: { kind: 'm', n: k }, y: { kind: 'm', n: 12 * k } }[m[2]];
}

// The k-th month after the start, on the start's day (or the month's last).
function monthStep(start, k) {
  const y = +start.slice(0, 4), m = +start.slice(5, 7) - 1 + k, d = +start.slice(8, 10);
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12 + 1;
  return yy + '-' + String(mm).padStart(2, '0') + '-' + String(Math.min(d, lastDay(yy, mm))).padStart(2, '0');
}

// Does the series starting `start` fall on `date`? (Its start always does.)
export function occursOn(rule, start, date) {
  if (date < start) return false;
  if (date === start) return true;
  const set = daySet(rule);
  if (set) return set.has(parseISO(date).getDay());
  const iv = interval(rule);
  if (!iv) return false;
  if (iv.kind === 'd') return (dayNo(date) - dayNo(start)) % iv.n === 0;
  const months = (+date.slice(0, 4) - +start.slice(0, 4)) * 12 + (+date.slice(5, 7) - +start.slice(5, 7));
  return months % iv.n === 0 && monthStep(start, months) === date;
}

// The first occurrence on or after `from`.
export function nextOn(rule, start, from) {
  if (from <= start) return start;
  const set = daySet(rule);
  if (set) {
    let d = from;
    for (let i = 0; i < 8 && !set.has(parseISO(d).getDay()); i++) d = addDays(d, 1);
    return d;
  }
  const iv = interval(rule);
  if (!iv) return null;
  if (iv.kind === 'd') {
    const gap = dayNo(from) - dayNo(start);
    return addDays(start, Math.ceil(gap / iv.n) * iv.n);
  }
  const months = (+from.slice(0, 4) - +start.slice(0, 4)) * 12 + (+from.slice(5, 7) - +start.slice(5, 7));
  for (let k = Math.max(0, Math.floor(months / iv.n) - 1); ; k++) {
    const d = monthStep(start, k * iv.n);
    if (d >= from) return d;
  }
}
