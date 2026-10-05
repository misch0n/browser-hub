import { toISO, addDays, daysBetween, plural } from '../core/util.js';
import { longDate } from '../core/format.js';
import { point, difference, isoWeek, weeksIn, weekMonday, dayOfYear, daysInYear, workdaysBetween, calendarSpan } from '../core/datemath.js';

// date, days, week: arithmetic on calendar dates (core/datemath.js).

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
    name: 'date', group: 'Dates', desc: 'a day in detail, date ± days/weeks/months, or the days between two dates',
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
