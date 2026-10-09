// The personal collections: timers and stopwatches, birthdays, lists, subscriptions,
// the journal and the meal log. One table says, for each, its collection, id prefix
// and how an item read from outside (an import, a damaged copy) is checked, so the
// store, sync, undo and import code all agree. Pure.
//
//   PERSONAL: [{ col, prefix, label, normalize(x, now) -> clean item without id | null }]
//   personalCols: ['timers', …]

import { parseISO } from './util.js';

const isStamp = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && !Number.isNaN(Date.parse(v));
const str = (v, max) => (typeof v === 'string' && v.trim() && v.length <= max ? v : null);
const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);
const day = (v) => (typeof v === 'string' && parseISO(v) ? v : null);
const stampOr = (v, now) => (isStamp(v) ? v : now().toISOString());

export const LIST_NAME = /^[a-z0-9][a-z0-9._-]{0,39}$/;
export const SUB_RULE = /^(week|month|year|\d{1,2}[wmy])$/;
const MAX_TIMER_MS = 7 * 24 * 3600 * 1000;

export const PERSONAL = [
  {
    col: 'timers', prefix: 'w', label: 'timer',
    normalize(x, now) {
      if (!x || (x.kind !== 'timer' && x.kind !== 'stopwatch') || !isStamp(x.start)) return null;
      const t = { kind: x.kind, name: str(x.name, 40), start: x.start, stop: isStamp(x.stop) ? x.stop : null,
        laps: Array.isArray(x.laps) ? x.laps.filter(isStamp).slice(0, 100) : [] };
      if (x.kind === 'timer') {
        t.duration = num(x.duration, 1000, MAX_TIMER_MS);
        if (t.duration === null) return null;
      }
      t.created = stampOr(x.created, now);
      return t;
    },
  },
  {
    col: 'birthdays', prefix: 'b', label: 'birthday',
    normalize(x, now) {
      const name = x && str(x.name, 100);
      const md = x && typeof x.date === 'string' && /^(\d\d)-(\d\d)$/.exec(x.date);
      if (!name || !md || !parseISO('2000-' + x.date)) return null;
      const year = Number.isInteger(x.year) && x.year >= 1850 && x.year <= now().getFullYear() ? x.year : null;
      return { name, date: x.date, year, created: stampOr(x.created, now) };
    },
  },
  {
    col: 'lists', prefix: 'c', label: 'list',
    normalize(x, now) {
      if (!x || typeof x.name !== 'string' || !LIST_NAME.test(x.name)) return null;
      const entries = (Array.isArray(x.entries) ? x.entries : [])
        .filter((e) => e && str(e.text, 200)).slice(0, 500).map((e) => ({ text: e.text, done: !!e.done }));
      return { name: x.name, entries, created: stampOr(x.created, now), updated: stampOr(x.updated || x.created, now) };
    },
  },
  {
    col: 'subs', prefix: 'p', label: 'subscription',
    normalize(x, now) {
      const name = x && str(x.name, 100);
      const price = x && num(x.price, 0, 1e6);
      if (!name || price === null || typeof x.currency !== 'string' || !/^[A-Z]{3}$/.test(x.currency) ||
        typeof x.every !== 'string' || !SUB_RULE.test(x.every) || !day(x.next)) return null;
      return { name, price, currency: x.currency, every: x.every, next: x.next, created: stampOr(x.created, now) };
    },
  },
  {
    col: 'journal', prefix: 'j', label: 'journal entry',
    normalize(x, now) {
      const text = x && str(x.text, 10000);
      if (!text || !day(x.date)) return null;
      return { date: x.date, text, created: stampOr(x.created, now) };
    },
  },
  {
    col: 'meals', prefix: 'm', label: 'meal',
    normalize(x, now) {
      const food = x && str(x.food, 100);
      const grams = x && num(x.grams, 0.1, 5000);
      const kcal = x && num(x.kcal, 0, 20000);
      if (!food || grams === null || kcal === null || !day(x.date)) return null;
      const m = { date: x.date, time: typeof x.time === 'string' && /^\d\d:\d\d$/.test(x.time) ? x.time : null, food, grams, kcal };
      for (const k of ['protein', 'fat', 'carbs']) m[k] = num(x[k], 0, 5000);
      if (typeof x.label === 'string' && x.label.length <= 60) m.label = x.label;
      m.created = stampOr(x.created, now);
      return m;
    },
  },
];

export const personalCols = PERSONAL.map((p) => p.col);

// ---- birthdays ------------------------------------------------------------------------

// '12 mar', 'march 12', '12.03', '1986-03-12', '12 mar 1986', '12.03.1986', '03-12'
// -> { date: 'MM-DD', year: n | null } | null
export function parseBirthday(text, monthIndex, nowYear) {
  const t = String(text).trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  const out = (m, d, y) => {
    const year = y === undefined || y === null ? null : Number(y);
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31) || !parseISO('2000-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'))) return null;
    if (year !== null && !(year >= 1850 && year <= nowYear)) return null;
    if (year !== null && !parseISO(year + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'))) return null; // 29 Feb of a common year
    return { date: String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'), year };
  };
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) return out(+m[2], +m[3], +m[1]);
  if ((m = /^(\d{1,2})-(\d{1,2})$/.exec(t))) return out(+m[1], +m[2]);
  if ((m = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?$/.exec(t))) return out(+m[2], +m[1], m[3]);
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?(?: (\d{4}))?$/.exec(t)) && monthIndex(m[2]) >= 0) return out(monthIndex(m[2]) + 1, +m[1], m[3]);
  if ((m = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(t)) && monthIndex(m[1]) >= 0) return out(monthIndex(m[1]) + 1, +m[2], m[3]);
  return null;
}

const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// The day a birthday falls on in `year` (29 Feb on 28 Feb in common years).
export const birthdayIn = (b, year) => year + '-' + (b.date === '02-29' && !leap(year) ? '02-28' : b.date);

// The next birthday on or after `today`: { date, age (the age turned then, or null), days }.
export function nextBirthday(b, today) {
  const y = +today.slice(0, 4);
  let date = birthdayIn(b, y);
  if (date < today) date = birthdayIn(b, y + 1);
  const days = Math.round((Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8)) - Date.UTC(y, +today.slice(5, 7) - 1, +today.slice(8))) / 86400000);
  return { date, age: b.year ? +date.slice(0, 4) - b.year : null, days };
}

// ---- subscriptions --------------------------------------------------------------------

// What a subscription costs a month: price × how many renewals fall in a month.
export function perMonth(sub) {
  const m = /^(\d*)([wmy]|week|month|year)$/.exec(sub.every);
  if (!m) return 0;
  const n = Number(m[1]) || 1;
  const unit = m[2][0];
  return sub.price * (unit === 'w' ? 52 / 12 / n : unit === 'm' ? 1 / n : 1 / (12 * n));
}
