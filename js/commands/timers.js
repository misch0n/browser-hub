import { plural } from '../core/util.js';
import { parseDuration, status, laps, clock, spoken } from '../lib/timers.js';

// timer and stopwatch: entries in the synced `timers` collection (core/personal.js),
// each with its start time, worked out live from the clock (lib/timers.js). They
// run until stopped; a finished timer counts how long it has been done. main.js
// alerts when one finishes while a page is open; the timers widget shows the running ones.
//
//   timer <duration> [name]   timer list   timer <id | name> [stop | restart | rm]
//   stopwatch [name]          stopwatch list   stopwatch <id | name> [lap | stop | restart | rm]

const NAME = /^[^\s].{0,39}$/;

export default function register(add, { st, usage }) {
  const of = (kind) => st().timers.items.filter((x) => x.kind === kind);
  const label = (x) => x.name || (x.kind === 'timer' ? 'timer' : 'stopwatch') + ' ' + x.id;
  const ref = (x) => x.kind + ' ' + (x.name && !/\s/.test(x.name) ? x.name : x.id);

  // An id (w3) or a name; a name prefers the running one, then the newest.
  function find(kind, word) {
    const w = word.toLowerCase();
    const list = of(kind);
    if (/^w\d+$/.test(w)) return list.find((x) => x.id === w) || null;
    const named = list.filter((x) => x.name && x.name.toLowerCase() === w);
    return named.find((x) => !x.stop) || named[named.length - 1] || null;
  }

  // One line for an entry: its live clock and state.
  function line(x, now) {
    const s = status(x, now);
    const id = [x.id, 'id', { run: x.kind + ' ' + x.id }];
    if (x.kind === 'timer') {
      const state = s.done ? (s.running ? ['done ' + spoken(s.over) + ' ago', 'warn'] : ['done', 'ok'])
        : s.running ? [clock(s.remaining) + ' left', 'num'] : ['stopped with ' + clock(s.remaining) + ' left', 'dim'];
      return [[id], [[label(x), x.name ? 'strong' : 'dim']], [[clock(x.duration), 'faint']], [state]];
    }
    return [[id], [[label(x), x.name ? 'strong' : 'dim']], [[clock(s.elapsed), s.running ? 'num' : 'dim']], [[s.running ? 'running' : 'stopped', s.running ? 'ok' : 'faint']]];
  }

  function list(ctx, kind) {
    const { out } = ctx;
    const items = of(kind).slice().sort((a, b) => (!!a.stop - !!b.stop) || (a.start < b.start ? 1 : -1));
    if (!items.length) {
      out.head('No ' + kind + 's', 'dim');
      return out.dim(kind === 'timer' ? 'Start one: timer 10m tea' : 'Start one: stopwatch, or stopwatch run');
    }
    const running = items.filter((x) => !x.stop).length;
    out.head([[plural(items.length, kind), 'strong'], [' · ' + running + ' running', 'dim']]);
    out.table(['id', 'name', kind === 'timer' ? 'set' : 'time', 'state'], items.map((x) => line(x, ctx.now())));
    out.dim('The timers widget keeps them live · ' + kind + ' <id> stop · ' + kind + ' <id> rm');
  }

  function show(ctx, x) {
    const { out } = ctx;
    const now = ctx.now();
    const s = status(x, now);
    out.head([[label(x), 'strong'], [' · ' + x.kind + ' ' + x.id, 'dim']], x.kind === 'timer' && s.done ? 'warn' : s.running ? 'ok' : 'dim');
    out.ticker({ id: x.id, kind: x.kind, start: x.start, created: x.created, duration: x.duration || null, stop: x.stop || null });
    const rows = [['started', [[new Date(x.start).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }), 'date']]]];
    if (x.kind === 'timer') {
      rows.push(['set', [[clock(x.duration), 'num'], [' · ' + spoken(x.duration), 'faint']]]);
      rows.push(['ends', [[new Date(s.end).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), 'date']]]);
    }
    if (x.stop) rows.push(['stopped', [[new Date(x.stop).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), 'dim'], [' · ran ' + spoken(s.elapsed), 'faint']]]);
    out.kv(rows);
    const ls = laps(x);
    if (ls.length) out.table(['lap', 'split', 'total'], ls.map((l) => [[[String(l.n), 'faint']], [[clock(l.split, true), 'num']], [[clock(l.at, true), 'dim']]]));
    const verbs = x.kind === 'timer' ? (x.stop ? ['restart', 'rm'] : ['stop', 'restart', 'rm']) : (x.stop ? ['restart', 'rm'] : ['lap', 'stop', 'rm']);
    out.line(verbs.flatMap((v, i) => [[i ? '  ' : '', ''], [v, 'accent', { run: x.kind + ' ' + x.id + ' ' + v }]]));
  }

  async function start(ctx, kind, duration, name) {
    const { out } = ctx;
    if (name && !NAME.test(name)) return out.err('A name is up to 40 characters');
    if (name && /^w\d+$/i.test(name)) return out.err("'" + name + "' looks like an id; pick another name");
    if (name && ['list', 'all', 'stop', 'lap', 'rm', 'restart'].includes(name.toLowerCase())) return out.err("'" + name + "' is a word the command uses; pick another name");
    const now = ctx.now().toISOString();
    const id = await ctx.data.allocId('w');
    const item = { id, kind, name: name || null, start: now, stop: null, laps: [], created: now };
    if (kind === 'timer') item.duration = duration;
    await ctx.data.mutate('timers', (d) => { d.items.push(item); });
    out.head([[kind === 'timer' ? 'Timer started' : 'Stopwatch started', ''], [' · ' + label(item), 'strong'],
      [kind === 'timer' ? ' · ' + spoken(duration) : '', 'dim']], 'ok');
    out.ticker({ id, kind, start: now, created: now, duration: duration || null, stop: null });
    out.line([[ref(item) + ' stop', 'accent', { run: kind + ' ' + id + ' stop' }], [kind === 'stopwatch' ? '  ' : '', ''],
      [kind === 'stopwatch' ? ref(item) + ' lap' : '', 'accent', { run: kind + ' ' + id + ' lap' }],
      [kind === 'timer' ? '  · rings while a page is open; the timers widget keeps it in view' : '', 'faint']]);
  }

  async function act(ctx, x, verb) {
    const { out } = ctx;
    const now = ctx.now().toISOString();
    if (verb === 'rm') {
      await ctx.data.mutate('timers', (d) => { d.items = d.items.filter((y) => y.id !== x.id); });
      return out.head([['Removed ', ''], [label(x), 'strong']], 'ok');
    }
    if (verb === 'restart') {
      await ctx.data.mutate('timers', (d) => { const y = d.items.find((z) => z.id === x.id); if (y) { y.start = now; y.stop = null; y.laps = []; } });
      return show(ctx, st().timers.items.find((y) => y.id === x.id));
    }
    if (x.stop) return out.head([[label(x), 'strong'], [' is already stopped · ' + ref(x) + ' restart', 'dim']], 'dim');
    if (verb === 'stop') {
      await ctx.data.mutate('timers', (d) => { const y = d.items.find((z) => z.id === x.id); if (y) y.stop = now; });
      const s = status(st().timers.items.find((y) => y.id === x.id), ctx.now());
      return out.head([['Stopped ', ''], [label(x), 'strong'],
        [x.kind === 'timer' ? (s.done ? ' · done ' + spoken(s.over) + ' before' : ' · ' + clock(s.remaining) + ' was left') : ' · ' + clock(s.elapsed, true), 'dim']], 'ok');
    }
    if (verb === 'lap') {
      if (x.kind !== 'stopwatch') return out.err('Only a stopwatch takes laps');
      if ((x.laps || []).length >= 100) return out.err('100 laps at most');
      await ctx.data.mutate('timers', (d) => { const y = d.items.find((z) => z.id === x.id); if (y) y.laps = [...(y.laps || []), now]; });
      const ls = laps(st().timers.items.find((y) => y.id === x.id));
      const l = ls[ls.length - 1];
      return out.head([['Lap ' + l.n, 'strong'], ['  ' + clock(l.split, true), 'num'], [' · total ' + clock(l.at, true), 'dim']], 'ok');
    }
    return null;
  }

  // Routing shared by both: list | <id|name> [verb] | start.
  function route(kind, ctx, rest, def) {
    const { out } = ctx;
    const words = rest.trim().split(/\s+/).filter(Boolean);
    const first = (words[0] || '').toLowerCase();
    if (first === 'list' || first === 'all' || (kind === 'timer' && !words.length)) return list(ctx, kind);
    const verbs = kind === 'timer' ? ['stop', 'restart', 'rm'] : ['lap', 'stop', 'restart', 'rm'];
    // stop / lap with nothing named: the only running one.
    if (words.length === 1 && verbs.includes(first)) {
      const running = of(kind).filter((x) => !x.stop);
      if (running.length === 1) return act(ctx, running[0], first);
      return out.err(running.length ? 'Which one? ' + running.map((x) => ref(x)).join(', ') : 'No ' + kind + ' is running');
    }
    const last = (words[words.length - 1] || '').toLowerCase();
    if (words.length >= 2 && verbs.includes(last)) {
      const x = find(kind, words.slice(0, -1).join(' '));
      if (!x) return out.err('No ' + kind + " '" + words.slice(0, -1).join(' ') + "' · " + kind + ' list');
      return act(ctx, x, last);
    }
    if (kind === 'timer') {
      const ms = parseDuration(words[0]);
      if (ms === null) {
        const x = find(kind, words.join(' '));
        if (x) return show(ctx, x);
        if (/^\d/.test(words[0])) return out.err("Can't read the time '" + words[0] + "' (try 10m, 1h30m, 90s, 1:30 or 25 for minutes; up to 7 days)");
        return usage(ctx, def);
      }
      return start(ctx, 'timer', ms, words.slice(1).join(' '));
    }
    if (words.length) {
      const x = find(kind, words.join(' '));
      if (x && (!x.stop || /^w\d+$/i.test(words[0]))) return show(ctx, x);
    }
    return start(ctx, 'stopwatch', null, words.join(' '));
  }

  const complete = (kind) => (prev) => {
    if (prev.length === 0) {
      return [{ value: 'list', label: 'every ' + kind }, ...of(kind).map((x) => ({ value: x.name && !/\s/.test(x.name) ? x.name : x.id, label: x.stop ? 'stopped' : 'running' })),
        ...(kind === 'timer' ? ['5m', '10m', '25m', '1h'].map((v) => ({ value: v, label: 'start' })) : [])];
    }
    if (prev.length === 1 && find(kind, prev[0])) return (kind === 'timer' ? ['stop', 'restart', 'rm'] : ['lap', 'stop', 'restart', 'rm']).map((v) => ({ value: v }));
    return [];
  };

  add({
    name: 'timer', group: 'Tools', desc: 'count down: timer 10m tea starts one; it runs until you stop it, on every device',
    usage: ['timer <duration> [name]', 'timer', 'timer list', 'timer <id | name>', 'timer <id | name> stop | restart | rm', 'timer stop'],
    examples: ['timer 10m', 'timer 25m focus', 'timer 1h30m bread', 'timer 1:30 eggs', 'timer list', 'timer tea stop', 'timer w2 rm'],
    complete: complete('timer'),
    run(ctx, rest) { return route('timer', ctx, rest, this); },
  });

  add({
    name: 'stopwatch', group: 'Tools', desc: 'count up: stopwatch starts one (stopwatch run names it); lap, stop',
    usage: ['stopwatch [name]', 'stopwatch list', 'stopwatch <id | name>', 'stopwatch <id | name> lap | stop | restart | rm', 'stopwatch lap', 'stopwatch stop'],
    examples: ['stopwatch', 'stopwatch run', 'stopwatch run lap', 'stopwatch lap', 'stopwatch run stop', 'stopwatch list', 'stopwatch w3 rm'],
    complete: complete('stopwatch'),
    run(ctx, rest) { return route('stopwatch', ctx, rest, this); },
  });
}
