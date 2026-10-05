import { parseId, parseDate, parseTime, truncate, byIdNum, plural, pad2, todayISO } from '../core/util.js';
import { MONTH_NAMES, dayLabel, shortDate } from '../core/format.js';
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
          [[e.id, 'id', { run: 'ev show ' + e.id }]], [[shortDate(e.date, today), 'date']], [[e.time || 'all day', e.time ? 'num' : 'faint']], e.title,
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
        out.table(null, a.overdue.map((t) => [[[t.id, 'id', { run: 't show ' + t.id }]], [[dayLabel(t.due, today), 'err']], t.text]));
      }
      for (const d of a.days) {
        const label = dayLabel(d.date, today);
        out.section(label === 'today' || label === 'tomorrow'
          ? [[label[0].toUpperCase() + label.slice(1), 'accent'], [' · ' + shortDate(d.date, today), 'dim']]
          : [[shortDate(d.date, today), 'date']]);
        out.table(null, [
          ...d.events.map((e) => [[[e.id, 'id', { run: 'ev show ' + e.id }]], [[e.time || 'all day', e.time ? 'num' : 'faint']], e.title]),
          ...d.tasks.map((t) => [[[t.id, 'id', { run: 't show ' + t.id }]], [['task due', 'warn']], t.text]),
        ]);
      }
    },
  });

  add({
    name: 'ev', group: 'Calendar', desc: 'add or remove a calendar event',
    usage: ['ev <date> [HH:MM] <title>', 'ev rm <id>', 'ev show <id>', 'ev edit <id>.<field> <value>'],
    examples: ['ev fri 19:30 dinner at Mia\'s', 'ev 2026-12-24 Christmas Eve', 'ev rm e2', 'ev edit e2.time 20:00', 'ev edit e2.date sat'],
    complete: (prev) => {
      if (prev.length === 0) return ['rm', 'show', 'edit'].map((v) => ({ value: v }));
      if (prev.length === 1 && ['rm', 'show', 'edit'].includes(prev[0])) {
        return st().events.items.slice().sort(byIdNum)
          .map((e) => ({ value: e.id, label: e.date + (e.time ? ' ' + e.time : '') + ' ' + truncate(e.title, 40) }));
      }
      return [];
    },
    async run(ctx, rest) {
      const { out } = ctx;
      const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest);
      if (!m) return usage(ctx, this);
      const today = todayISO(ctx.now());
      const sub = m[1].toLowerCase();
      if (sub === 'edit' && await records.edit(ctx, 'event', m[2] || '')) return;
      if ((sub === 'show' || sub === 'edit') && parseId('e', (m[2] || '').trim())) return records.showCmd(ctx, 'event', m[2].trim());
      if (sub === 'rm') {
        const id = parseId('e', (m[2] || '').trim());
        if (!id) return usage(ctx, this);
        const ev = st().events.items.find((e) => e.id === id);
        if (!ev) return out.err('No event ' + id);
        await ctx.data.mutate('events', (d) => { d.items = d.items.filter((e) => e.id !== id); });
        out.head([['Removed event ', ''], [id, 'id']], 'ok');
        out.line(ev.title, 'gone');
        return;
      }
      const date = parseDate(m[1], ctx.now());
      if (!date) {
        out.err("Can't read the date '" + m[1] + "'");
        out.dim('Try 2026-10-31, today, tomorrow, fri, +3d or +2w');
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
      if (!title.trim()) return usage(ctx, this);
      if (title.length > 200) return out.err('The title is too long (200 characters max)');
      const id = await ctx.data.allocId('e');
      await ctx.data.mutate('events', (d) => { d.items.push({ id, date, time, title }); });
      out.head([['Added event ', ''], [id, 'id', { run: 'ev show ' + id }]], 'ok');
      out.line([[title, ''], ['  ', ''], [dayLabel(date, today), 'date'], [time ? ' ' + time : '', 'num']]);
    },
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
