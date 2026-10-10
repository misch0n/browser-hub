import { toISO, addDays, daysBetween, plural, parseISO, pad2 } from '../core/util.js';
import { longDate, DAY_NAMES_LONG, MONTH_NAMES } from '../core/format.js';
import { point, difference, isoWeek, weeksIn, weekMonday, dayOfYear, daysInYear, workdaysBetween, calendarSpan } from '../core/datemath.js';

// date, day, days, week: arithmetic on calendar dates (core/datemath.js).

const UNIT_WORD = { d: 'day', w: 'week', m: 'month', y: 'year', wd: 'workday' };

function fromToday(iso, today) {
  const n = daysBetween(today, iso);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? 'in ' + plural(n, 'day') : plural(-n, 'day') + ' ago';
}

const weekLink = (iso) => {
  const w = isoWeek(iso);
  return ['week ' + w.week + (w.year !== +iso.slice(0, 4) ? ' of ' + w.year : ''), 'accent', { run: 'week ' + w.week + ' ' + w.year }];
};

// Everything about one day.
function describeDay(out, iso, today) {
  const y = +iso.slice(0, 4);
  const doy = dayOfYear(iso);
  out.head([[longDate(iso), 'strong'], [' · ' + fromToday(iso, today), 'dim']]);
  out.kv([
    ['date', [[iso, 'date']]],
    ['week', [weekLink(iso)]],
    ['day', [[String(doy), 'num'], [' of ' + daysInYear(y) + ' · ' + plural(daysInYear(y) - doy, 'day') + ' left in ' + y, 'dim']]],
    ['quarter', [['Q' + (Math.floor((+iso.slice(5, 7) - 1) / 3) + 1), 'num']]],
  ]);
  out.copyable(iso);
}

// `day`'s date: anything `date` reads, plus day.month[.year] (12.03, 12/03/2027,
// European order). A day of a month without a year is this year's, past or not.
// -> { date } | { error }
export function dayArg(text, now) {
  const t = text.trim().toLowerCase();
  const today = toISO(now);
  if (!t) return { date: today };
  const dm = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?\.?$/.exec(t);
  if (dm) {
    const y = dm[3] ? (dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]) : +today.slice(0, 4);
    const iso = y + '-' + pad2(+dm[2]) + '-' + pad2(+dm[1]);
    return parseISO(iso) ? { date: iso } : { error: 'there is no ' + text.trim() + (dm[3] ? '' : ' in ' + y) };
  }
  const p = point(t, now, { thisYear: true });
  if (p.error) {
    // '31 feb': a real month and day number, but no such day
    const bad = /^(\d{1,2}) ([a-z]+)\.?(?: (\d{4}))?$|^([a-z]+)\.? (\d{1,2})(?: (\d{4}))?$/.exec(t);
    return { error: bad ? 'there is no ' + text.trim() + (bad[3] || bad[6] ? '' : ' in ' + today.slice(0, 4)) : p.error };
  }
  return { date: p.date };
}

// The distance between two days, every useful way.
function describeSpan(out, from, to, today, headText) {
  const n = daysBetween(from, to);
  const a = Math.abs(n);
  const span = calendarSpan(from, to);
  const cal = [span.years && plural(span.years, 'year'), span.months && plural(span.months, 'month'), (span.days || (!span.years && !span.months)) && plural(span.days, 'day')].filter(Boolean).join(' ');
  out.head(headText || [[plural(a, 'day'), 'num strong'], [' from ' + longDate(from, today) + ' to ' + longDate(to, today) + (n < 0 ? ' (backwards)' : ''), 'dim']]);
  const rows = [];
  if (a >= 7) rows.push(['weeks', [[plural(Math.floor(a / 7), 'week') + (a % 7 ? ' ' + plural(a % 7, 'day') : ''), '']]]);
  if (span.months || span.years) rows.push(['calendar', [[cal, '']]]);
  rows.push(['workdays', [[String(Math.abs(workdaysBetween(from, to))), 'num'], [' · Monday to Friday', 'faint']]]);
  out.kv(rows);
  out.copyable(String(a));
}

export default function register(add, { usage }) {
  add({
    name: 'date', group: 'Dates',
    complete: (prev) => (prev.length === 0 ? ['today', 'tomorrow', 'yesterday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'next']
      .map((v) => ({ value: v })) : prev.length === 1 ? ['+', '-', 'to'].map((v) => ({ value: v })) : []), desc: 'a day in detail, date ± days/weeks/months, or the days between two dates',
    usage: ['date [<date>]', 'date [<date>] ± <n> d|w|m|y|wd', 'date <date> to <date>'],
    examples: ['date', 'date 25 dec', 'date + 90d', 'date fri + 3 wd', 'date 31 jan + 1m', 'date 1 jan to 25 dec', 'date 2026-10-05 - 2026-01-01'],
    async run(ctx, rest) {
      const { out } = ctx;
      const now = ctx.now();
      const today = toISO(now);
      const text = rest.trim();
      if (!text) return describeDay(out, today, today);
      const diff = difference(text, now);
      if (diff) return describeSpan(out, diff.from, diff.to, today);
      const p = point(text, now);
      if (p.error) {
        out.err(p.error);
        return usage(ctx, this);
      }
      if (!p.steps.length) return describeDay(out, p.date, today);
      const steps = p.steps.map(([s, n, u]) => s + ' ' + plural(n, UNIT_WORD[u])).join(' ');
      out.head([[longDate(p.base, today), 'dim'], [' ' + steps + ' = ', 'faint'], [longDate(p.date, today), 'strong']]);
      out.kv([
        ['date', [[p.date, 'date'], [' · ' + fromToday(p.date, today), 'dim']]],
        ['week', [weekLink(p.date)]],
      ]);
      out.copyable(p.date);
    },
  });

  add({
    name: 'day', group: 'Dates', desc: 'the day of the week of a date (this year unless you give one), and what else to know about it',
    usage: ['day [<date>]', 'day <day> <month> [year]', 'day <day>.<month>[.<year>]'],
    examples: ['day 12 march', 'day march 12 2027', 'day 12.03', 'day 24.12.2030', 'day 1 jan 2000', 'day tomorrow', 'day'],
    complete: (prev) => (prev.length === 0 ? ['today', 'tomorrow', ...MONTH_NAMES.map((m) => m.toLowerCase())].map((v) => ({ value: v })) : []),
    run(ctx, rest) {
      const { out } = ctx;
      const now = ctx.now();
      const today = toISO(now);
      const r = dayArg(rest, now);
      if (r.error) {
        out.err(r.error[0].toUpperCase() + r.error.slice(1));
        return out.dim('day 12 march · day 12 march 2027 · day 12.03 · day 2027-03-12');
      }
      const iso = r.date;
      const d = parseISO(iso);
      const y = d.getFullYear();
      const doy = dayOfYear(iso);
      const rel = fromToday(iso, today);
      out.head([[DAY_NAMES_LONG[d.getDay()], 'accent strong'], [' · ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + ' ' + y, 'strong'],
        [' · ' + rel, 'dim']]);
      // The same day of the month in the years around it (a birthday, an anniversary).
      const near = [-1, 1, 2, 3].map((k) => {
        const other = (y + k) + iso.slice(4);
        return parseISO(other) ? [[String(y + k) + ' ', 'faint'], [DAY_NAMES_LONG[parseISO(other).getDay()].slice(0, 3), '', { run: 'day ' + other }], ['   ', '']] : [];
      }).flat();
      out.kv([
        ['week', [weekLink(iso), [' · ' + (d.getDay() === 0 || d.getDay() === 6 ? 'a weekend day' : 'a weekday'), 'dim']]],
        ['day', [[String(doy), 'num'], [' of ' + daysInYear(y) + ' · ' + plural(daysInYear(y) - doy, 'day') + ' left in ' + y, 'dim']]],
        ['quarter', [['Q' + (Math.floor(d.getMonth() / 3) + 1), 'num'], [daysInYear(y) === 366 ? ' · ' + y + ' is a leap year' : '', 'faint']]],
        ...(near.length ? [['other years', near]] : []),
      ]);
      out.line([['date ' + iso, 'accent', { run: 'date ' + iso }], [' for date maths · ', 'faint'],
        ['days ' + (iso >= today ? 'until ' : 'since ') + iso, 'accent', { run: 'days ' + (iso >= today ? 'until ' : 'since ') + iso }]]);
      out.copyable(DAY_NAMES_LONG[d.getDay()]);
    },
  });

  add({
    name: 'days', group: 'Dates', desc: 'days until or since a date, or between two',
    usage: ['days until <date>', 'days since <date>', 'days <date> to <date>'],
    examples: ['days until 25 dec', 'days since 1 jan', 'days since last fri', 'days 1 mar to 1 jun'],
    complete: (prev) => (prev.length === 0 ? [{ value: 'until' }, { value: 'since' }] : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const now = ctx.now();
      const today = toISO(now);
      const m = /^(until|till|to|since|from)\s+(.+)$/i.exec(rest.trim());
      if (m) {
        const since = /^(since|from)$/i.test(m[1]);
        const p = point(m[2], now, { past: since });
        if (p.error) return out.err(p.error);
        const n = since ? daysBetween(p.date, today) : daysBetween(today, p.date);
        const word = since ? (n >= 0 ? ' since ' : ' until ') : (n >= 0 ? ' until ' : ' since ');
        return describeSpan(out, since ? p.date : today, since ? today : p.date, today,
          [[plural(Math.abs(n), 'day'), 'num strong'], [word + longDate(p.date, today), 'dim']]);
      }
      const diff = rest.trim() && difference(rest, now);
      if (diff) return describeSpan(out, diff.from, diff.to, today);
      return usage(ctx, this);
    },
  });

  add({
    name: 'week', group: 'Dates', desc: 'the week number and its days: this week, week <n>, or the week of a date',
    usage: ['week', 'week <n> [year]', 'week <date>'],
    examples: ['week', 'week 52', 'week 1 2027', 'week 25 dec'],
    async run(ctx, rest) {
      const { out } = ctx;
      const now = ctx.now();
      const today = toISO(now);
      const text = rest.trim();
      let year, wk;
      const num = /^(?:w)?(\d{1,2})(?:\s+(\d{4}))?$/i.exec(text) || /^(\d{4})-?w(\d{1,2})$/i.exec(text);
      if (!text) ({ year, week: wk } = isoWeek(today));
      else if (num) {
        [wk, year] = /^\d{4}/.test(text) ? [+num[2], +num[1]] : [+num[1], num[2] ? +num[2] : isoWeek(today).year];
        if (wk < 1 || wk > weeksIn(year)) return out.err(year + ' has weeks 1 to ' + weeksIn(year));
      } else {
        const p = point(text, now);
        if (p.error) { out.err(p.error); return usage(ctx, this); }
        ({ year, week: wk } = isoWeek(p.date));
      }
      const mon = weekMonday(year, wk);
      const sun = addDays(mon, 6);
      const where = today < mon ? 'in ' + plural(Math.round(daysBetween(today, mon) / 7), 'week') : today > sun ? plural(Math.round(daysBetween(sun, today) / 7) || 1, 'week') + ' ago' : 'this week';
      out.head([['Week ' + wk, 'strong'], [' of ' + year + ' · ' + longDate(mon, today) + ' to ' + longDate(sun, today) + ' · ' + where, 'dim']]);
      const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
      out.table(null, days.map((d) => [[[longDate(d, today), d === today ? 'strong' : 'dim', { run: 'date ' + d }]], [[d === today ? 'today' : '', 'accent']]]));
      out.line([['week ' + (wk === 1 ? weeksIn(year - 1) + ' ' + (year - 1) : (wk - 1) + ' ' + year), 'accent', { run: 'week ' + (wk === 1 ? weeksIn(year - 1) + ' ' + (year - 1) : (wk - 1) + ' ' + year) }],
        [' ← · → ', 'faint'],
        ['week ' + (wk === weeksIn(year) ? '1 ' + (year + 1) : (wk + 1) + ' ' + year), 'accent', { run: 'week ' + (wk === weeksIn(year) ? '1 ' + (year + 1) : (wk + 1) + ' ' + year) }]]);
      out.copyable(String(wk));
    },
  });
}
