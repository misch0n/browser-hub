import { parseId, parseDate, leadingDate, parseTime, truncate, byIdNum, plural, pad2, todayISO } from '../core/util.js';
import { MONTH_NAMES, DAY_NAMES_LONG, dayLabel, longDate, usageSegs } from '../core/format.js';
import { daySummary, summaryRows, summaryCounts, tomorrowLine } from '../core/summary.js';
import { agenda, eventDays, sortEvents } from '../core/agenda.js';
import { parseICS } from '../lib/ics.js';
import { oneValue } from '../core/args.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export default function register(add, { st, usage, records }) {
  add({
    name: 'cal', group: 'Calendar', desc: 'month grid with event days marked',
    usage: ['cal [YYYY-MM]'],
    examples: ['cal', 'cal 2026-12'],
    async run(ctx, rest) {
      const { out } = ctx;
      const today = todayISO(ctx.now());
      let year = +today.slice(0, 4), month = +today.slice(5, 7);
      if (rest) {
        const m = /^(\d{4})-(\d{2})$/.exec(rest);
        if (!m || +m[2] < 1 || +m[2] > 12) return usage(ctx, this);
        year = +m[1]; month = +m[2];
      }
      const prefix = year + '-' + pad2(month) + '-';
      const events = st().events.items.filter((e) => e.date.startsWith(prefix)).sort(sortEvents);
      out.head([[MONTH_NAMES[month - 1] + ' ' + year, 'strong'], [events.length ? ' · ' + plural(events.length, 'event') : '', 'dim']]);
      out.calendar({ year, month, today, marks: eventDays(st(), year, month) });
      if (events.length) {
        out.table(null, events.map((e) => [
          [[e.id, 'id', { run: 'events ' + e.id }]], [[longDate(e.date, today), 'date']], [[e.time || 'all day', e.time ? 'num' : 'faint']], e.title,
        ]));
      }
    },
  });

  add({
    name: 'agenda', group: 'Calendar', desc: 'events and due tasks for the next n days (default 7)',
    usage: ['agenda [n]'],
    examples: ['agenda', 'agenda 30'],
    async run(ctx, rest) {
      const { out } = ctx;
      let n = 7;
      if (rest) {
        if (!/^\d{1,3}$/.test(rest) || +rest < 1 || +rest > 366) return usage(ctx, this);
        n = +rest;
      }
      const today = todayISO(ctx.now());
      const a = agenda(st(), today, n);
      const items = a.overdue.length + a.days.reduce((s, d) => s + d.events.length + d.tasks.length, 0);
      if (!items) {
        out.head('Nothing in the next ' + plural(n, 'day'), 'dim');
        return;
      }
      out.head([['Next ' + plural(n, 'day'), 'strong'], [' · ' + plural(items, 'item'), 'dim'],
        [a.overdue.length ? ' · ' + a.overdue.length + ' overdue' : '', 'err']], a.overdue.length ? 'warn' : undefined);
      if (a.overdue.length) {
        out.section([['Overdue', 'err']]);
        out.table(null, a.overdue.map((t) => [[[t.id, 'id', { run: 'tasks ' + t.id }]], [[dayLabel(t.due, today), 'err']], t.text]));
      }
      for (const d of a.days) {
        const label = dayLabel(d.date, today);
        out.section(label === 'today' || label === 'tomorrow'
          ? [[label[0].toUpperCase() + label.slice(1), 'accent'], [' · ' + longDate(d.date, today), 'dim']]
          : [[longDate(d.date, today), 'date']]);
        out.table(null, [
          ...d.events.map((e) => [[[e.id, 'id', { run: 'events ' + e.id }]], [[e.time || 'all day', e.time ? 'num' : 'faint']], e.title]),
          ...d.tasks.map((t) => [[[t.id, 'id', { run: 'tasks ' + t.id }]], [['task due', 'warn']], t.text]),
        ]);
      }
    },
  });

  add({
    name: 'today', group: 'Calendar', desc: 'the daily summary; pinned at the top until dismissed for the day',
    usage: ['today', 'today dismiss', 'today pin', 'today off', 'today on'],
    examples: ['today', 'today dismiss', 'today off'],
    complete: (prev) => (prev.length === 0 ? ['dismiss', 'pin', 'off', 'on'].map((v) => ({ value: v })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const today = todayISO(ctx.now());
      const arg = rest.trim().toLowerCase();
      if (arg) {
        const change = { dismiss: { summaryDismissed: today }, pin: { summaryDismissed: null, summary: 'on' },
          off: { summary: 'off' }, on: { summary: 'on', summaryDismissed: null } }[arg];
        if (!change) return usage(ctx, this);
        await ctx.data.mutate('settings', (d) => { Object.assign(d, change); });
        const said = {
          dismiss: 'Summary dismissed for today, on every device · today pin brings it back',
          pin: 'Summary pinned', off: 'The summary is no longer pinned · today still prints it', on: 'Summary pinned again, every day',
        };
        return out.head(said[arg], 'ok');
      }
      const sum = daySummary(st(), today);
      const d = ctx.now();
      const counts = summaryCounts(sum);
      out.head([['Today', 'strong'], [' · ' + DAY_NAMES_LONG[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()], 'dim'],
        ...(counts.length ? [[' · ', 'faint'], ...counts] : [])], sum.overdue.length ? 'warn' : undefined);
      const rows = summaryRows(sum);
      if (rows.length) out.table(null, rows.map((r) => [r]));
      else out.line([['Nothing overdue, due or scheduled today', 'dim']]);
      out.line(tomorrowLine(sum));
    },
  });

  async function addEvent(ctx, rest) {
    const { out } = ctx;
    // The date can take a few words: events add 12 oct 19:00 dinner, events add next friday lunch
    const words = rest.trim().split(/\s+/).filter(Boolean);
    const lead = leadingDate(words, ctx.now());
    const m = lead ? [null, words.slice(0, lead.used).join(' '), rest.trim().replace(new RegExp('^(\\s*\\S+){' + lead.used + '}\\s*'), '')]
      : /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest.trim());
    if (!m) {
      out.head([['Usage', ''], [' · events add', 'dim']], 'err');
      out.table(null, [[usageSegs('events add <date> [HH:MM] <title>')], [usageSegs('ev <date> [HH:MM] <title>')]]);
      return;
    }
    const today = todayISO(ctx.now());
    const date = parseDate(m[1], ctx.now());
    if (!date) {
      out.err("Can't read the date '" + m[1] + "'");
      out.dim('Try friday, next friday, 12 oct, tomorrow, in 3 days, +2w or 2026-10-31');
      return;
    }
    let title = m[2] || '';
    let time = null;
    const tm = /^(\d{1,2}:\d{2})(?:\s+([\s\S]*))?$/.exec(title);
    if (tm) {
      time = parseTime(tm[1]);
      if (!time) return out.err("Can't read the time '" + tm[1] + "' (use 24-hour HH:MM)");
      title = tm[2] || '';
    }
    title = oneValue(title); // ev fri "19:30 is the title"
    if (!title.trim()) return out.err('An event needs a title: events add ' + m[1] + (time ? ' ' + time : '') + ' <title>');
    if (title.length > 200) return out.err('The title is too long (200 characters max)');
    const id = await ctx.data.allocId('e');
    await ctx.data.mutate('events', (d) => { d.items.push({ id, date, time, title }); });
    out.head([['Added event ', ''], [id, 'id', { run: 'events ' + id }]], 'ok');
    out.line([[title, ''], ['  ', ''], [dayLabel(date, today), 'date'], [time ? ' ' + time : '', 'num']]);
  }

  function listEvents(ctx, rest) {
    const { out } = ctx;
    const arg = rest.trim().toLowerCase();
    if (arg && arg !== 'all') {
      out.err("events: '" + rest.trim() + "' is not an event id, add or all");
      out.dim('events · events all · events add <date> [HH:MM] <title> · events <id>');
      return;
    }
    const today = todayISO(ctx.now());
    const list = st().events.items.filter((e) => arg === 'all' || e.date >= today).sort(sortEvents);
    if (!list.length) {
      out.head(arg === 'all' ? 'No events' : 'No upcoming events', 'dim');
      out.dim('Add one with: events add <date> [HH:MM] <title>  (or ev …)');
      return;
    }
    out.head([[plural(list.length, arg === 'all' ? 'event' : 'upcoming event'), 'strong']]);
    out.table(['id', 'date', 'time', 'event'], list.map((e) => [
      [[e.id, 'id', { run: 'events ' + e.id }]], [[longDate(e.date, today), e.date < today ? 'faint' : 'date']],
      [[e.time || 'all day', e.time ? 'num' : 'faint']], [[e.title, e.date < today ? 'dim' : '']],
    ]));
  }

  const spec = { list: listEvents, add: addEvent, addArgs: '<date> [HH:MM] <title>', filter: '[all]' };

  add({
    name: 'events', group: 'Calendar', desc: 'list, add, show, edit and remove events',
    usage: records.usageFor('event', spec),
    examples: ['events', 'events all', 'events add fri 19:30 dinner at Mia\'s', 'events e2', 'events e2 edit', 'events e2 edit time 20:00', 'events e2 rm'],
    complete: (prev) => records.complete('event', prev, { first: [{ value: 'all' }] }),
    run: (ctx, rest) => records.route(ctx, 'event', rest, spec),
  });

  add({
    name: 'ev', group: 'Calendar', desc: 'short for events; ev <date> … adds an event',
    usage: ['ev <date> [HH:MM] <title>', 'ev <id> [edit [<field> [<value>]] | rm]'],
    examples: ['ev fri 19:30 dinner at Mia\'s', 'ev 2026-12-24 Christmas Eve', 'ev e2 edit time 20:00', 'ev e2 rm'],
    complete: (prev) => records.complete('event', prev),
    run: (ctx, rest) => records.route(ctx, 'event', records.legacy('event', rest) ?? rest, { ...spec, short: true }),
  });

  add({
    name: 'ics', group: 'Calendar', desc: 'import events from a local .ics file',
    usage: ['ics import'],
    complete: (prev) => (prev.length === 0 ? [{ value: 'import' }] : []),
    run(ctx, rest) {
      if (rest.toLowerCase() !== 'import') return usage(ctx, this);
      // Open the picker synchronously so the browser still sees the key press.
      const picked = ctx.pickFile('.ics,text/calendar');
      return (async () => {
        const { out } = ctx;
        const file = await picked;
        if (!file) return out.head('Import cancelled', 'dim');
        if (file.size > MAX_FILE_BYTES) return out.err('The file is too large (5 MB max)');
        const parsed = parseICS(await file.text());
        await ctx.data.reload('events');
        const key = (e) => e.date + '|' + (e.time || '') + '|' + e.title;
        const have = new Set(st().events.items.map(key));
        const fresh = [];
        let dupes = 0;
        for (const e of parsed.events) {
          if (have.has(key(e))) { dupes++; continue; }
          have.add(key(e));
          fresh.push(e);
        }
        if (fresh.length) {
          const ids = await ctx.data.allocIds('e', fresh.length);
          await ctx.data.mutate('events', (d) => {
            fresh.forEach((e, i) => d.items.push({ id: ids[i], date: e.date, time: e.time, title: e.title }));
          });
        }
        out.head([['Imported ', ''], [plural(fresh.length, 'event'), 'strong'], [' from ' + file.name, 'dim']], fresh.length ? 'ok' : 'dim');
        if (dupes) out.dim(plural(dupes, 'event') + ' already present, skipped');
        if (parsed.recurring) out.warn(plural(parsed.recurring, 'recurring event') + ' skipped: recurrence is not supported');
        if (parsed.invalid) out.warn(plural(parsed.invalid, 'event') + ' without a readable start date skipped');
        if (parsed.guessedZones) out.warn(plural(parsed.guessedZones, 'event') + ' used an unknown time zone; their times were read as local');
      })();
    },
  });
}
