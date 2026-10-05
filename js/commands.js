(function (CC) {
  'use strict';

  const U = CC.util;
  const MAX_FILE_BYTES = 5 * 1024 * 1024;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const idNum = (id) => parseInt(id.slice(1), 10);
  const byIdNum = (a, b) => idNum(a.id) - idNum(b.id);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const sortEvents = (a, b) => cmp(a.date, b.date) || cmp(a.time || '', b.time || '') || byIdNum(a, b);

  // ctx = { out, data, store, now(), setInput(text), clearOutput(), pickFile(accept), download(name, text, mime) }
  // `def.run(ctx, rest)` must reach any file picker synchronously (before its first await).
  function createCommands(getCtx) {
    const st = () => getCtx().data.state;
    const defs = [];
    const byName = new Map();

    function add(def) {
      defs.push(def);
      byName.set(def.name, def);
    }

    const showUsage = (ctx, def) => {
      ctx.out.err('usage:');
      def.usage.forEach((u) => ctx.out.line('  ' + u));
    };

    const isBuiltin = (name) => byName.has(name);

    // ---- notes ---------------------------------------------------------------

    add({
      name: 'n', group: 'Notes', desc: 'capture a note',
      usage: ['n <text>', 'n edit <id> [text]', 'n rm <id>'],
      complete: (prev) => {
        if (prev.length === 0) return [{ value: 'edit' }, { value: 'rm' }];
        if (prev.length === 1 && (prev[0] === 'edit' || prev[0] === 'rm')) {
          return st().notes.items.slice().sort(byIdNum).map((n) => ({ value: n.id, label: U.truncate(U.firstLine(n.text), 50) }));
        }
        return [];
      },
      async run(ctx, rest) {
        if (!rest) return showUsage(ctx, this);
        const sub = /^(edit|rm)(?:\s+(\S+))?(?:\s+([\s\S]*))?$/i.exec(rest);
        if (!sub) {
          const id = await ctx.data.allocId('n');
          const stamp = ctx.now().toISOString();
          await ctx.data.mutate('notes', (d) => { d.items.push({ id, text: rest, created: stamp, updated: stamp }); });
          return ctx.out.ok('added ' + id);
        }
        const id = U.parseId('n', sub[2] || '');
        if (!id) return showUsage(ctx, this);
        const note = st().notes.items.find((n) => n.id === id);
        if (!note) return ctx.out.err('no note ' + id);
        if (sub[1].toLowerCase() === 'rm') {
          if (sub[3]) return showUsage(ctx, this);
          await ctx.data.mutate('notes', (d) => { d.items = d.items.filter((n) => n.id !== id); });
          return ctx.out.ok('removed ' + id);
        }
        if (!sub[3]) {
          ctx.setInput('n edit ' + id + ' ' + note.text);
          return ctx.out.dim('editing ' + id + ': change the text and press Enter to save (Esc cancels)');
        }
        const stamp = ctx.now().toISOString();
        await ctx.data.mutate('notes', (d) => {
          const n = d.items.find((x) => x.id === id);
          if (n) { n.text = sub[3]; n.updated = stamp; }
        });
        ctx.out.ok('updated ' + id);
      },
    });

    add({
      name: 'notes', group: 'Notes', desc: 'list notes, newest first',
      usage: ['notes [filter]'],
      async run(ctx, rest) {
        const f = rest.toLowerCase();
        const list = st().notes.items.filter((n) => !f || n.text.toLowerCase().includes(f)).sort((a, b) => byIdNum(b, a));
        if (!list.length) return ctx.out.dim(f ? 'no matching notes' : 'no notes yet; add one with: n <text>');
        for (const n of list) {
          ctx.out.parts([[n.id.padEnd(5), 'id'], [n.created.slice(0, 10) + '  ', 'dim'], [n.text, '']]);
        }
      },
    });

    // ---- tasks ---------------------------------------------------------------

    add({
      name: 't', group: 'Tasks', desc: 'add a task',
      usage: ['t <text> [due:<date>] [#tag]', 't done <id>', 't rm <id>'],
      complete: (prev) => {
        if (prev.length === 0) return [{ value: 'done' }, { value: 'rm' }];
        if (prev.length === 1 && (prev[0] === 'done' || prev[0] === 'rm')) {
          return st().tasks.items
            .filter((t) => prev[0] === 'rm' || !t.done)
            .sort(byIdNum).map((t) => ({ value: t.id, label: U.truncate(t.text, 50) }));
        }
        return [];
      },
      async run(ctx, rest) {
        if (!rest) return showUsage(ctx, this);
        const words = rest.split(/\s+/);
        const first = words[0].toLowerCase();
        if (first === 'done' || first === 'rm') {
          const id = words.length === 2 ? U.parseId('t', words[1]) : null;
          if (!id) return showUsage(ctx, this);
          const task = st().tasks.items.find((t) => t.id === id);
          if (!task) return ctx.out.err('no task ' + id);
          if (first === 'rm') {
            await ctx.data.mutate('tasks', (d) => { d.items = d.items.filter((t) => t.id !== id); });
            return ctx.out.ok('removed ' + id + ': ' + task.text);
          }
          if (task.done) return ctx.out.dim(id + ' is already done');
          const stamp = ctx.now().toISOString();
          await ctx.data.mutate('tasks', (d) => {
            const t = d.items.find((x) => x.id === id);
            if (t) { t.done = true; t.doneAt = stamp; }
          });
          return ctx.out.ok('done ' + id + ': ' + task.text);
        }

        let due = null;
        const tags = [];
        const text = [];
        for (const w of words) {
          if (/^due:/i.test(w)) {
            due = U.parseDate(w.slice(4), ctx.now());
            if (!due) return ctx.out.err("can't read date '" + w.slice(4) + "' (try 2026-10-31, tomorrow, fri, +3d)");
          } else if (/^#[\w-]+$/.test(w)) {
            const tag = w.slice(1).toLowerCase();
            if (!tags.includes(tag)) tags.push(tag);
          } else {
            text.push(w);
          }
        }
        if (!text.length) return showUsage(ctx, this);
        const id = await ctx.data.allocId('t');
        const stamp = ctx.now().toISOString();
        await ctx.data.mutate('tasks', (d) => {
          d.items.push({ id, text: text.join(' '), due, tags, done: false, created: stamp, doneAt: null });
        });
        ctx.out.ok('added ' + id + (due ? ' (due ' + due + ')' : ''));
      },
    });

    add({
      name: 'tasks', group: 'Tasks', desc: 'list open tasks (overdue first, then by due date)',
      usage: ['tasks [#tag] [all]'],
      async run(ctx, rest) {
        let all = false, tag = null;
        for (const w of rest.split(/\s+/).filter(Boolean)) {
          if (w.toLowerCase() === 'all') all = true;
          else if (/^#[\w-]+$/.test(w)) tag = w.slice(1).toLowerCase();
          else return showUsage(ctx, this);
        }
        const today = U.todayISO(ctx.now());
        const list = st().tasks.items
          .filter((t) => (all || !t.done) && (!tag || t.tags.includes(tag)))
          .sort((a, b) =>
            (a.done ? 1 : 0) - (b.done ? 1 : 0) ||
            cmp(a.due || '9999', b.due || '9999') || byIdNum(a, b));
        if (!list.length) return ctx.out.dim(all ? 'no tasks' : 'no open tasks');
        for (const t of list) {
          const overdue = !t.done && t.due && t.due < today;
          ctx.out.parts([
            [t.id.padEnd(5), 'id'],
            [t.done ? '[x] ' : '[ ] ', 'dim'],
            [(t.due || '          ') + '  ', overdue ? 'err' : 'dim'],
            [t.text, t.done ? 'dim' : ''],
            [t.tags.length ? '  ' + t.tags.map((x) => '#' + x).join(' ') : '', 'accent'],
            [overdue ? '  overdue' : '', 'err'],
          ]);
        }
      },
    });

    // ---- calendar ------------------------------------------------------------

    function describeEvent(e) {
      return e.date + (e.time ? ' ' + e.time : '');
    }

    add({
      name: 'cal', group: 'Calendar', desc: 'month grid with event days marked',
      usage: ['cal [YYYY-MM]'],
      async run(ctx, rest) {
        const today = U.todayISO(ctx.now());
        let year = +today.slice(0, 4), month = +today.slice(5, 7);
        if (rest) {
          const m = /^(\d{4})-(\d{2})$/.exec(rest);
          if (!m || +m[2] < 1 || +m[2] > 12) return showUsage(ctx, this);
          year = +m[1]; month = +m[2];
        }
        const prefix = year + '-' + U.pad2(month) + '-';
        const events = st().events.items.filter((e) => e.date.startsWith(prefix)).sort(sortEvents);
        const hasEvent = new Set(events.map((e) => +e.date.slice(8)));
        const title = MONTHS[month - 1] + ' ' + year;
        ctx.out.line(title.padStart(Math.floor((28 + title.length) / 2)), 'accent');
        ctx.out.parts(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => [d + '  ', 'dim']));
        const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7;
        const days = new Date(year, month, 0).getDate();
        let row = [];
        for (let i = 0; i < lead; i++) row.push(['    ', '']);
        for (let d = 1; d <= days; d++) {
          const isToday = prefix + U.pad2(d) === today;
          row.push([String(d).padStart(2) + (hasEvent.has(d) ? '*' : ' ') + ' ', isToday ? 'today' : hasEvent.has(d) ? 'accent' : '']);
          if (row.length === 7) { ctx.out.parts(row); row = []; }
        }
        if (row.length) ctx.out.parts(row);
        if (events.length) {
          ctx.out.line('');
          for (const e of events) {
            ctx.out.parts([[e.id.padEnd(5), 'id'], [describeEvent(e) + '  ', 'dim'], [e.title, '']]);
          }
        }
      },
    });

    add({
      name: 'agenda', group: 'Calendar', desc: 'events and due tasks for the next n days (default 7)',
      usage: ['agenda [n]'],
      async run(ctx, rest) {
        let n = 7;
        if (rest) {
          if (!/^\d{1,3}$/.test(rest) || +rest < 1 || +rest > 366) return showUsage(ctx, this);
          n = +rest;
        }
        const lines = agendaLines(ctx, n);
        if (!lines.length) return ctx.out.dim('nothing in the next ' + U.plural(n, 'day'));
        lines.forEach((l) => (Array.isArray(l) ? ctx.out.parts(l) : ctx.out.line(l)));
      },
    });

    // Rows for agenda: overdue tasks first, then each day with something on it.
    function agendaLines(ctx, n) {
      const today = U.todayISO(ctx.now());
      const lines = [];
      const open = st().tasks.items.filter((t) => !t.done && t.due);
      const overdue = open.filter((t) => t.due < today).sort((a, b) => cmp(a.due, b.due) || byIdNum(a, b));
      if (overdue.length) {
        lines.push([['overdue', 'err']]);
        for (const t of overdue) lines.push([['  ' + t.id.padEnd(5), 'id'], [t.due + '  ', 'err'], [t.text, '']]);
      }
      for (let i = 0; i < n; i++) {
        const day = U.addDays(today, i);
        const events = st().events.items.filter((e) => e.date === day).sort(sortEvents);
        const tasks = open.filter((t) => t.due === day).sort(byIdNum);
        if (!events.length && !tasks.length) continue;
        const wd = DAY_NAMES[U.parseISO(day).getDay()];
        lines.push([[wd + ' ' + day + (i === 0 ? '  (today)' : i === 1 ? '  (tomorrow)' : ''), 'accent']]);
        for (const e of events) lines.push([['  ' + e.id.padEnd(5), 'id'], [(e.time || 'all-day').padEnd(8), 'dim'], [e.title, '']]);
        for (const t of tasks) lines.push([['  ' + t.id.padEnd(5), 'id'], ['task    ', 'dim'], [t.text, '']]);
      }
      return lines;
    }

    add({
      name: 'ev', group: 'Calendar', desc: 'add or remove a calendar event',
      usage: ['ev <date> [HH:MM] <title>', 'ev rm <id>'],
      complete: (prev) => {
        if (prev.length === 0) return [{ value: 'rm' }];
        if (prev.length === 1 && prev[0] === 'rm') {
          return st().events.items.slice().sort(byIdNum)
            .map((e) => ({ value: e.id, label: describeEvent(e) + ' ' + U.truncate(e.title, 40) }));
        }
        return [];
      },
      async run(ctx, rest) {
        const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest);
        if (!m) return showUsage(ctx, this);
        if (m[1].toLowerCase() === 'rm') {
          const id = U.parseId('e', (m[2] || '').trim());
          if (!id) return showUsage(ctx, this);
          const ev = st().events.items.find((e) => e.id === id);
          if (!ev) return ctx.out.err('no event ' + id);
          await ctx.data.mutate('events', (d) => { d.items = d.items.filter((e) => e.id !== id); });
          return ctx.out.ok('removed ' + id + ': ' + ev.title);
        }
        const date = U.parseDate(m[1], ctx.now());
        if (!date) return ctx.out.err("can't read date '" + m[1] + "' (try 2026-10-31, tomorrow, fri, +3d)");
        let rem = m[2] || '';
        let time = null;
        const tm = /^(\d{1,2}:\d{2})(?:\s+([\s\S]*))?$/.exec(rem);
        if (tm) {
          time = U.parseTime(tm[1]);
          if (!time) return ctx.out.err("can't read time '" + tm[1] + "' (use 24-hour HH:MM)");
          rem = tm[2] || '';
        }
        if (!rem) return showUsage(ctx, this);
        if (rem.length > 200) return ctx.out.err('title is too long (200 characters max)');
        const id = await ctx.data.allocId('e');
        await ctx.data.mutate('events', (d) => { d.items.push({ id, date, time, title: rem }); });
        ctx.out.ok('added ' + id + ': ' + date + (time ? ' ' + time : '') + ' ' + rem);
      },
    });

    add({
      name: 'ics', group: 'Calendar', desc: 'import events from a local .ics file',
      usage: ['ics import'],
      complete: (prev) => (prev.length === 0 ? [{ value: 'import' }] : []),
      run(ctx, rest) {
        if (rest.toLowerCase() !== 'import') return showUsage(ctx, this);
        // Open the picker synchronously so the browser still sees the key press.
        const picked = ctx.pickFile('.ics,text/calendar');
        return (async () => {
          const file = await picked;
          if (!file) return ctx.out.dim('cancelled');
          if (file.size > MAX_FILE_BYTES) return ctx.out.err('file is too large (5 MB max)');
          const parsed = CC.ics.parseICS(await file.text());
          const have = new Set(st().events.items.map((e) => e.date + '|' + (e.time || '') + '|' + e.title));
          const fresh = [];
          let dupes = 0;
          for (const e of parsed.events) {
            const k = e.date + '|' + (e.time || '') + '|' + e.title;
            if (have.has(k)) { dupes++; continue; }
            have.add(k);
            fresh.push(e);
          }
          if (fresh.length) {
            const ids = await ctx.data.allocIds('e', fresh.length);
            await ctx.data.mutate('events', (d) => {
              fresh.forEach((e, i) => d.items.push({ id: ids[i], date: e.date, time: e.time, title: e.title }));
            });
          }
          ctx.out.ok('imported ' + U.plural(fresh.length, 'event'));
          if (dupes) ctx.out.dim(U.plural(dupes, 'event') + ' already present, skipped');
          if (parsed.recurring) ctx.out.warn(U.plural(parsed.recurring, 'recurring event') + ' skipped (recurrence is not supported)');
          if (parsed.invalid) ctx.out.warn(U.plural(parsed.invalid, 'event') + ' without a readable start date skipped');
        })();
      },
    });

    // ---- tools ---------------------------------------------------------------

    add({
      name: 'calc', group: 'Tools', desc: 'arithmetic: + - * / % ^ ( ) and sqrt, abs, round, sin, ln, pi, e ...',
      usage: ['calc <expr>'],
      async run(ctx, rest) {
        if (!rest) return showUsage(ctx, this);
        try {
          ctx.out.line(CC.calc.formatNumber(CC.calc.evaluate(rest)));
        } catch (e) {
          ctx.out.err(e.message);
        }
      },
    });

    add({
      name: 'tz', group: 'Tools', desc: 'time across your zones, with working-hours overlap',
      usage: ['tz [HH:MM]', 'tz add <IANA zone>', 'tz rm <zone>'],
      complete: (prev) => {
        if (prev.length === 0) return [{ value: 'add' }, { value: 'rm' }];
        if (prev.length === 1 && prev[0] === 'rm') return st().settings.zones.map((z) => ({ value: z }));
        return [];
      },
      async run(ctx, rest) {
        const local = CC.tools.localZone();
        const m = /^(add|rm)(?:\s+(\S+))?$/i.exec(rest);
        if (m) {
          const arg = m[2];
          if (!arg) return showUsage(ctx, this);
          if (m[1].toLowerCase() === 'add') {
            if (!U.isValidZone(arg)) return ctx.out.err("unknown time zone '" + arg + "' (use an IANA name such as Europe/London)");
            const zone = U.canonicalZone(arg);
            if (zone === local) return ctx.out.dim(zone + ' is your local zone already');
            if (st().settings.zones.includes(zone)) return ctx.out.dim(zone + ' is already listed');
            await ctx.data.mutate('settings', (d) => { d.zones.push(zone); });
            return ctx.out.ok('added ' + zone);
          }
          const found = st().settings.zones.find((z) => z.toLowerCase() === arg.toLowerCase());
          if (!found) return ctx.out.err("'" + arg + "' is not in your list");
          await ctx.data.mutate('settings', (d) => { d.zones = d.zones.filter((z) => z !== found); });
          return ctx.out.ok('removed ' + found);
        }

        const now = ctx.now();
        let instant = now;
        if (rest) {
          const time = U.parseTime(rest);
          if (!time) return showUsage(ctx, this);
          instant = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +time.slice(0, 2), +time.slice(3));
        }
        const zones = [local].concat(st().settings.zones.filter((z) => z !== local));
        const rows = CC.tools.zoneRows(instant, zones);
        const width = Math.max.apply(null, rows.map((r) => r.zone.length)) + 2;
        for (const r of rows) {
          ctx.out.parts([
            [r.zone.padEnd(width), r === rows[0] ? 'accent' : ''],
            [r.time + '  ', ''],
            [r.day.padEnd(4), 'dim'],
            [r.working ? 'working hours' : '', 'ok'],
          ]);
        }
        if (zones.length > 1) {
          const ranges = CC.tools.workOverlap(instant, zones);
          ctx.out.dim('overlap (' + local + '): ' + (ranges.length ? ranges.join(', ') : 'none'));
        } else {
          ctx.out.dim('add zones with: tz add <IANA zone>');
        }
      },
    });

    add({
      name: 'epoch', group: 'Tools', desc: 'unix time now, or convert to/from a date',
      usage: ['epoch [timestamp | YYYY-MM-DD[ HH:MM[:SS]][Z]]'],
      async run(ctx, rest) {
        try {
          const d = rest ? CC.tools.parseEpochInput(rest) : ctx.now();
          CC.tools.epochLines(d).forEach((l) => ctx.out.line(l));
        } catch (e) {
          ctx.out.err(e.message);
        }
      },
    });

    add({
      name: 'uuid', group: 'Tools', desc: 'generate a v4 UUID',
      usage: ['uuid'],
      async run(ctx) { ctx.out.line(CC.tools.uuid()); },
    });

    add({
      name: 'b64', group: 'Tools', desc: 'base64 encode or decode (UTF-8)',
      usage: ['b64 enc <text>', 'b64 dec <text>'],
      complete: (prev) => (prev.length === 0 ? [{ value: 'enc' }, { value: 'dec' }] : []),
      async run(ctx, rest) {
        const m = /^(enc|dec)(?:\s+([\s\S]*))?$/i.exec(rest);
        if (!m || !m[2]) return showUsage(ctx, this);
        try {
          ctx.out.line(m[1].toLowerCase() === 'enc' ? CC.tools.b64encode(m[2]) : CC.tools.b64decode(m[2]));
        } catch (e) {
          ctx.out.err(e.message);
        }
      },
    });

    add({
      name: 'json', group: 'Tools', desc: 'validate and pretty-print JSON',
      usage: ['json <text>'],
      async run(ctx, rest) {
        if (!rest) return showUsage(ctx, this);
        try {
          CC.tools.prettyJson(rest).split('\n').forEach((l) => ctx.out.line(l));
        } catch (e) {
          ctx.out.err('invalid JSON: ' + e.message);
        }
      },
    });

    add({
      name: 'units', group: 'Tools', desc: 'convert units (length, mass, volume, speed, time, data, temperature)',
      usage: ['units <value> <from> to <to>'],
      async run(ctx, rest) {
        const m = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(.+?)\s+to\s+(.+)$/i.exec(rest);
        if (!m) {
          showUsage(ctx, this);
          CC.units.listUnits().forEach((l) => ctx.out.dim(l));
          return;
        }
        try {
          const v = parseFloat(m[1]);
          ctx.out.line(m[1] + ' ' + m[2] + ' = ' + CC.calc.formatNumber(CC.units.convert(v, m[2].trim(), m[3].trim()), 10) + ' ' + m[3].trim());
        } catch (e) {
          ctx.out.err(e.message);
        }
      },
    });

    // ---- aliases and engines -------------------------------------------------

    const entries = () => st().aliases.entries;
    const engineNames = () => entries().filter((e) => e.template).map((e) => ({ value: e.name, label: 'engine' }));
    const aliasNames = () => entries().map((e) => ({ value: e.name, label: e.template ? 'engine' : 'alias' }));

    add({
      name: 'alias', group: 'Aliases & engines', desc: 'define URL aliases and search engines',
      usage: [
        'alias <name> <base> [template] [--path] [--force]',
        'alias set <name> ... [--force]',
        'alias rm <name>', 'alias ls [filter]', 'alias show <name>',
      ],
      complete: (prev) => {
        if (prev.length === 0) return ['set', 'rm', 'ls', 'show'].map((v) => ({ value: v }));
        if (prev.length === 1 && ['set', 'rm', 'show'].includes(prev[0])) return aliasNames();
        return [];
      },
      async run(ctx, rest) {
        if (!rest) return showUsage(ctx, this);
        const words = rest.split(/\s+/);
        const sub = words[0].toLowerCase();
        const doc = st().aliases;
        const describe = (e) => {
          const flags = [];
          if (e.name === doc.defaultEngine) flags.push('default engine');
          if (isBuiltin(e.name)) flags.push('inactive: shadowed by built-in');
          return flags.length ? '  (' + flags.join(', ') + ')' : '';
        };

        if (sub === 'ls') {
          const f = (words[1] || '').toLowerCase();
          const list = entries().filter((e) => !f || e.name.includes(f) || e.base.toLowerCase().includes(f))
            .sort((a, b) => cmp(a.name, b.name));
          if (!list.length) return ctx.out.dim('no aliases');
          const w = Math.max.apply(null, list.map((e) => e.name.length)) + 2;
          for (const e of list) {
            ctx.out.parts([[e.name.padEnd(w), 'accent'], [e.template || e.base, ''], [describe(e), 'dim']]);
          }
          return;
        }
        if (sub === 'show' || sub === 'rm') {
          if (words.length !== 2) return showUsage(ctx, this);
          const name = words[1].toLowerCase();
          const e = entries().find((x) => x.name === name);
          if (!e) return ctx.out.err("no alias '" + name + "'");
          if (sub === 'show') {
            ctx.out.line('name      ' + e.name + describe(e));
            ctx.out.line('base      ' + e.base);
            ctx.out.line('template  ' + (e.template || '(none)'));
            ctx.out.line('escape    ' + e.escape);
            return;
          }
          if (name === doc.defaultEngine) {
            return ctx.out.err("'" + name + "' is the default engine; choose another first with: engine default <name>");
          }
          await ctx.data.mutate('aliases', (d) => { d.entries = d.entries.filter((x) => x.name !== name); });
          return ctx.out.ok('removed ' + name);
        }

        // Define: `alias [set] <name> <base> [template] [--path] [--force]`
        const positional = [];
        let force = false, path = false;
        for (const w of words) {
          if (w === '--force') force = true;
          else if (w === '--path') path = true;
          else if (w.startsWith('--')) return ctx.out.err("unknown option '" + w + "'");
          else positional.push(w);
        }
        if (positional[0] && positional[0].toLowerCase() === 'set') positional.shift();
        if (positional.length < 2 || positional.length > 3) return showUsage(ctx, this);
        const [name, base, template] = positional;
        if (path && !template) return ctx.out.err('--path only applies to aliases with a template');
        const v = CC.aliases.validateEntry({ name, base, template, escape: path ? 'path' : 'query' }, isBuiltin);
        if (v.error) return ctx.out.err(v.error);
        const entry = v.entry;
        const existing = entries().find((e) => e.name === entry.name);
        if (existing && !force) {
          return ctx.out.err("alias '" + entry.name + "' already exists (" + (existing.template || existing.base) + '); use --force to overwrite');
        }
        if (existing && entry.name === doc.defaultEngine && !entry.template) {
          return ctx.out.err("'" + entry.name + "' is the default engine and needs a template");
        }
        await ctx.data.mutate('aliases', (d) => {
          const i = d.entries.findIndex((e) => e.name === entry.name);
          if (i >= 0) d.entries[i] = entry; else d.entries.push(entry);
        });
        ctx.out.ok((existing ? 'updated ' : 'added ') + entry.name);
      },
    });

    add({
      name: 'engine', group: 'Aliases & engines', desc: 'show or set the default search engine',
      usage: ['engine', 'engine default <name>'],
      complete: (prev) => {
        if (prev.length === 0) return [{ value: 'default' }];
        if (prev.length === 1 && prev[0] === 'default') return engineNames();
        return [];
      },
      async run(ctx, rest) {
        const doc = st().aliases;
        if (!rest) return ctx.out.line('default engine: ' + doc.defaultEngine);
        const m = /^default\s+(\S+)$/i.exec(rest);
        if (!m) return showUsage(ctx, this);
        const name = m[1].toLowerCase();
        const e = entries().find((x) => x.name === name);
        if (!e) return ctx.out.err("no alias '" + name + "'");
        if (!e.template) return ctx.out.err("'" + name + "' has no template, so it can't be a search engine");
        if (isBuiltin(name)) return ctx.out.err("'" + name + "' is shadowed by a built-in command");
        await ctx.data.mutate('aliases', (d) => { d.defaultEngine = name; });
        ctx.out.ok('default engine is now ' + name);
      },
    });

    // ---- meta ----------------------------------------------------------------

    add({
      name: 'help', group: 'Meta', desc: 'list commands, or detail for one',
      usage: ['help [command]'],
      complete: (prev) => (prev.length === 0 ? defs.map((d) => ({ value: d.name, label: d.desc })) : []),
      async run(ctx, rest) {
        if (rest) {
          const def = byName.get(rest.toLowerCase());
          if (!def) return ctx.out.err("no built-in command '" + rest + "'");
          ctx.out.line(def.name + ': ' + def.desc, 'accent');
          def.usage.forEach((u) => ctx.out.line('  ' + u));
          return;
        }
        let group = null;
        const width = Math.max.apply(null, defs.map((d) => d.usage[0].length)) + 2;
        for (const d of defs) {
          if (d.group !== group) {
            group = d.group;
            ctx.out.line('');
            ctx.out.line(group, 'accent');
          }
          ctx.out.parts([['  ' + d.usage[0].padEnd(width), ''], [d.desc, 'dim']]);
        }
        ctx.out.line('');
        ctx.out.dim('anything else is searched with the default engine (' + st().aliases.defaultEngine + ')');
        ctx.out.dim('keys: Tab completes, ↑/↓ history, / opens the command palette, Esc clears');
      },
    });

    add({
      name: 'clear', group: 'Meta', desc: 'clear the output',
      usage: ['clear'],
      async run(ctx) { ctx.clearOutput(); },
    });

    add({
      name: 'history', group: 'Meta', desc: 'show recent commands',
      usage: ['history [n]'],
      async run(ctx, rest) {
        let n = 20;
        if (rest) {
          if (!/^\d{1,3}$/.test(rest) || +rest < 1) return showUsage(ctx, this);
          n = +rest;
        }
        const items = st().history.items;
        const start = Math.max(0, items.length - n);
        items.slice(start).forEach((h, i) => {
          ctx.out.parts([[String(start + i + 1).padStart(4) + '  ', 'dim'], [h, '']]);
        });
      },
    });

    add({
      name: 'export', group: 'Meta', desc: 'download all data as one JSON file',
      usage: ['export'],
      async run(ctx) {
        await ctx.data.load();
        const data = await ctx.store.exportAll();
        const day = U.todayISO(ctx.now());
        ctx.download('control-center-' + day + '.json', JSON.stringify(data, null, 2), 'application/json');
        await ctx.data.markExported();
        const c = data.collections;
        const count = (k) => (c[k] && c[k].items ? c[k].items.length : 0);
        ctx.out.ok('exported ' + count('notes') + ' notes, ' + count('tasks') + ' tasks, ' + count('events') + ' events, ' +
          (c.aliases ? c.aliases.entries.length : 0) + ' aliases');
      },
    });

    add({
      name: 'import', group: 'Meta', desc: 'load a JSON export, skipping conflicts',
      usage: ['import'],
      run(ctx) {
        const picked = ctx.pickFile('.json,application/json');
        return (async () => {
          const file = await picked;
          if (!file) return ctx.out.dim('cancelled');
          if (file.size > MAX_FILE_BYTES) return ctx.out.err('file is too large (5 MB max)');
          let parsed;
          try {
            parsed = JSON.parse(await file.text());
          } catch (e) {
            return ctx.out.err('not valid JSON: ' + e.message);
          }
          await ctx.data.load();
          const current = {};
          for (const k of Object.keys(ctx.data.DEFAULTS)) current[k] = st()[k];
          const result = CC.importer.merge(current, parsed, isBuiltin, ctx.now);
          await ctx.store.importAll({ collections: result.collections });
          await ctx.data.load();
          result.lines.forEach((l, i) => (i === 0 ? ctx.out.ok(l) : ctx.out.warn(l)));
        })();
      },
    });

    // Runs a built-in. Any thrown error is reported at the prompt.
    async function run(name, rest, ctx) {
      try {
        await byName.get(name).run(ctx, rest);
      } catch (e) {
        ctx.out.err(e && e.message ? e.message : String(e));
      }
    }

    return { defs, byName, isBuiltin, run, agendaLines };
  }

  CC.createCommands = createCommands;
})((globalThis.CC = globalThis.CC || {}));
