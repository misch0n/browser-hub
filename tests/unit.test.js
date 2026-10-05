import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import * as U from '../js/core/util.js';
import * as A from '../js/core/aliases.js';
import { dispatch } from '../js/core/dispatch.js';
import * as C from '../js/core/completion.js';
import { createLocalStore } from '../js/core/store.js';
import { createData, DEFAULTS } from '../js/core/data.js';
import { merge } from '../js/core/importer.js';
import { jsonLines, dueSeg, dayLabel } from '../js/core/format.js';
import { evaluate, formatNumber } from '../js/lib/calc.js';
import { convert } from '../js/lib/units.js';
import * as M from '../js/lib/misc.js';
import * as Z from '../js/lib/zones.js';
import { parseICS } from '../js/lib/ics.js';
import { createCommands } from '../js/commands/index.js';

const MON = new Date(2026, 9, 5, 12, 0); // Monday 2026-10-05, local time
const builtinNames = new Set(['n', 'notes', 't', 'tasks', 'help']);
const isBuiltin = (n) => builtinNames.has(n);

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _m: m,
  };
}

// ---- pure modules ------------------------------------------------------------------

test('dates: iso, keywords, weekdays, offsets', () => {
  assert.equal(U.parseDate('2026-10-31', MON), '2026-10-31');
  assert.equal(U.parseDate('2026-02-30', MON), null);
  assert.equal(U.parseDate('today', MON), '2026-10-05');
  assert.equal(U.parseDate('Tomorrow', MON), '2026-10-06');
  assert.equal(U.parseDate('fri', MON), '2026-10-09');
  assert.equal(U.parseDate('monday', MON), '2026-10-12'); // next occurrence, never today
  assert.equal(U.parseDate('+3d', MON), '2026-10-08');
  assert.equal(U.parseDate('+2w', MON), '2026-10-19');
  assert.equal(U.parseDate('someday', MON), null);
  assert.equal(U.parseTime('9:05'), '09:05');
  assert.equal(U.parseTime('24:00'), null);
  assert.equal(U.parseId('t', 'T12'), 't12');
  assert.equal(U.parseId('t', 'n12'), null);
  assert.equal(U.daysBetween('2026-03-28', '2026-03-30'), 2); // across DST
});

test('format: due labels and json colouring', () => {
  assert.deepEqual(dueSeg('2026-10-03', '2026-10-05'), ['2 days overdue', 'err']);
  assert.deepEqual(dueSeg('2026-10-05', '2026-10-05'), ['today', 'warn']);
  assert.deepEqual(dueSeg('2026-10-06', '2026-10-05'), ['tomorrow', 'info']);
  assert.deepEqual(dueSeg('2026-10-08', '2026-10-05'), ['Thu 8 Oct', 'date']);
  assert.equal(dayLabel('2027-01-02', '2026-10-05'), 'Sat 2 Jan 2027');
  const lines = jsonLines('{\n  "a": [1, true, null, "x"]\n}');
  assert.deepEqual(lines[1].map((s) => s[1]), ['dim', 'id', 'dim', 'dim', 'num', 'dim', 'accent', 'dim', 'faint', 'dim', 'ok', 'dim']);
  assert.equal(lines.map((l) => l.map((s) => s[0]).join('')).join('\n'), '{\n  "a": [1, true, null, "x"]\n}');
});

test('aliases: url validation', () => {
  assert.equal(A.urlError('https://github.com/', false), null);
  assert.match(A.urlError('javascript:alert(1)', false), /http/);
  assert.match(A.urlError('data:text/html,hi', false), /http/);
  assert.match(A.urlError('https:example.com', false), /http/);
  assert.match(A.urlError('https://x.com/ a', false), /whitespace/);
  assert.equal(A.urlError('https://x.com/?q={}', true), null);
  assert.match(A.urlError('https://x.com/', true), /\{\}/);
  assert.match(A.urlError('https://{}.evil.com/', true), /after the host/);
  assert.match(A.urlError('https://x.com@{}', true), /after the host/);
});

test('aliases: validateEntry and buildUrl', () => {
  assert.equal(A.validateEntry({ name: 'GH', base: 'https://github.com/' }, isBuiltin).entry.name, 'gh');
  assert.match(A.validateEntry({ name: 'help', base: 'https://x.com/' }, isBuiltin).error, /built-in/);
  assert.match(A.validateEntry({ name: 'rm', base: 'https://x.com/' }, isBuiltin).error, /reserved/);
  assert.match(A.validateEntry({ name: 'js', base: 'https://x.com/', template: 'javascript:{}' }, isBuiltin).error, /template/);
  const q = { name: 'g', base: 'https://g.com/', template: 'https://g.com/?q={}', escape: 'query' };
  const p = { name: 'gh', base: 'https://gh.com/', template: 'https://gh.com/{}', escape: 'path' };
  assert.equal(A.buildUrl(q, 'a/b c').url, 'https://g.com/?q=a%2Fb%20c');
  assert.equal(A.buildUrl(p, 'org/repo').url, 'https://gh.com/org/repo');
  assert.equal(A.buildUrl(q, "$& $1").url, 'https://g.com/?q=%24%26%20%241');
  assert.match(A.buildUrl({ name: 'x', base: 'https://x.com/', escape: 'query' }, 'arg').note, /ignoring/);
});

test('dispatch: builtin, alias, engine, fallback', () => {
  const entries = A.starters().concat([{ name: 'gh', base: 'https://github.com/', template: 'https://github.com/{}', escape: 'path' }]);
  const env = { isBuiltin, entries, defaultEngine: 'g' };
  const d = (s) => dispatch(s, env);
  assert.deepEqual(d('   '), { kind: 'empty' });
  assert.deepEqual(d('T   buy   flour'), { kind: 'builtin', name: 't', rest: 'buy   flour' });
  assert.equal(d('gh').url, 'https://github.com/');
  assert.equal(d('gh org/repo').url, 'https://github.com/org/repo');
  assert.equal(d('g how to proof sourdough').url, 'https://www.google.com/search?q=how%20to%20proof%20sourdough');
  assert.equal(d('vitosha weather').url, 'https://www.google.com/search?q=vitosha%20weather');
  assert.equal(d('gihtub').kind, 'search');
  assert.equal(dispatch('x', { isBuiltin, entries: [], defaultEngine: 'g' }).kind, 'error');
  assert.equal(dispatch('help', { isBuiltin, entries: [{ name: 'help', base: 'https://x.com/' }], defaultEngine: 'g' }).kind, 'builtin');
});

test('completion: first token ranking, tab behaviour, case-insensitive arguments', () => {
  const defs = [
    { name: 'tasks', desc: '' }, { name: 'tz', desc: '' }, { name: 'help', desc: '' }, { name: 'tail', desc: '' },
    { name: 't', desc: '', complete: (prev) => (prev.length === 0 ? [{ value: 'done' }, { value: 'rm' }] : prev[0] === 'done' ? [{ value: 't1', label: 'a' }, { value: 't12' }] : []) },
  ];
  const entries = [{ name: 'tw', base: 'https://x.com/' }, { name: 'help', base: 'https://x.com/' }];
  const env = { defs, entries, history: ['tz', 'tz', 'tasks', 'tw'] };
  assert.deepEqual(C.complete('', env).candidates, []);
  assert.deepEqual(C.complete('zzz', env).candidates, []);
  assert.deepEqual(C.complete('t', env).candidates.map((c) => c.value), ['tz', 'tasks', 't', 'tail', 'tw']);
  assert.deepEqual(C.applyTab('he', env), { input: 'help ' });
  assert.deepEqual(C.applyTab('ta', env).list.map((c) => c.value), ['tasks', 'tail']);
  assert.deepEqual(C.applyTab('t do', env), { input: 't done ' });
  assert.deepEqual(C.complete('t done ', env).candidates.map((c) => c.value), ['t1', 't12']);
  assert.deepEqual(C.complete('T DONE ', env).candidates.map((c) => c.value), ['t1', 't12']); // review #6
  assert.deepEqual(C.applyTab('t done t', env), { input: 't done t1' });
  assert.deepEqual(C.complete('t buy fl', env).candidates, []);
});

test('calc', () => {
  assert.equal(evaluate('1+2*3'), 7);
  assert.equal(evaluate('-2^2'), -4);
  assert.equal(evaluate('2^3^2'), 512);
  assert.equal(evaluate('max(1, 5, 3)'), 5);
  assert.equal(formatNumber(evaluate('0.1+0.2')), '0.3');
  assert.equal(formatNumber(evaluate('1/3')), '0.333333333333333');
  assert.throws(() => evaluate('1/0'), /division by zero/);
  assert.throws(() => evaluate('constructor(1)'), /unknown function/);
  assert.throws(() => evaluate('alert(1)'), /unknown function/);
  assert.throws(() => evaluate('1 2'), /unexpected/);
  assert.throws(() => evaluate(''), /empty/);
});

test('units', () => {
  assert.ok(Math.abs(convert(5, 'km', 'mi') - 3.10685596) < 1e-6);
  assert.equal(convert(100, 'c', 'f'), 212);
  assert.equal(convert(32, '°F', 'c'), 0);
  assert.throws(() => convert(1, 'kg', 'm'), /can't convert/);
});

test('misc: b64, json, epoch, uuid, relative', () => {
  assert.equal(M.b64encode('héllo ✓'), 'aMOpbGxvIOKckw==');
  assert.equal(M.b64decode('aMOpbGxvIOKckw=='), 'héllo ✓');
  assert.throws(() => M.b64decode('/w=='), /UTF-8/);
  assert.equal(M.parseEpochInput('2026-10-05T12:00:00+02:00').toISOString(), '2026-10-05T10:00:00.000Z');
  assert.throws(() => M.parseEpochInput('2026-02-31'), /invalid date/); // no silent rollover
  assert.match(M.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(M.relative(new Date(MON.getTime() + 3 * 86400000), MON), 'in 3 days');
  assert.equal(M.relative(new Date(MON.getTime() - 2 * 3600000), MON), '2 hours ago');
});

test('zones: rows, offsets, overlap, zoned wall time', () => {
  const instant = new Date(Date.UTC(2026, 0, 15, 14, 30));
  const rows = Z.zoneRows(instant, ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']);
  assert.equal(rows[1].time, '23:30');
  assert.equal(rows[1].offset, '+09:00');
  assert.equal(rows[2].offset, '-08:00');
  assert.equal(Z.zoneRows(new Date(Date.UTC(2026, 0, 15, 20)), ['UTC', 'Asia/Tokyo'])[1].day, '+1d');
  assert.equal(Z.zonedToDate(2026, 10, 5, 9, 0, 0, 'America/New_York').toISOString(), '2026-10-05T13:00:00.000Z');
  assert.equal(Z.zonedToDate(2026, 1, 5, 9, 0, 0, 'America/New_York').toISOString(), '2026-01-05T14:00:00.000Z');
});

test('zones: work overlap is right on DST change days (review #3)', () => {
  const here = fileURLToPath(new URL('../js/lib/zones.js', import.meta.url));
  const script = "import('" + here + "').then((Z) => console.log(JSON.stringify([" +
    "Z.workOverlap(new Date(2026, 2, 29), ['Europe/Sofia'])," +
    "Z.workOverlap(new Date(2026, 9, 25), ['Europe/Sofia'])," +
    "Z.workOverlap(new Date(2026, 9, 25), ['Europe/Sofia', 'Asia/Tokyo'])])))";
  const out = execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: 'Europe/Sofia' } }).toString();
  // Sofia 09:00 (UTC+2 after the change) is 16:00 in Tokyo: one shared hour.
  assert.deepEqual(JSON.parse(out), [['09:00-17:00'], ['09:00-17:00'], ['09:00-10:00']]);
});

test('ics: timezones, all-day, folding, VALARM, recurrence (review #2)', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:Team sync\\, weekly', 'DTSTART:20261005T093000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:All day', 'DTSTART;VALUE=DATE:20261006', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Folded long', ' title here', 'DTSTART:20261007T180000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Repeats', 'DTSTART:20261008T100000', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:No start', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Gone', 'STATUS:CANCELLED', 'DTSTART:20261009T100000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Has alarm', 'DTSTART:20261010T080000', 'BEGIN:VALARM', 'SUMMARY:Reminder email', 'ACTION:EMAIL', 'END:VALARM', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Bad date', 'DTSTART:20260231T100000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Windows zone', 'DTSTART;TZID=Pacific Standard Time:20261011T100000', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const r = parseICS(ics);
  assert.deepEqual(r.events.map((e) => e.title), ['Team sync, weekly', 'All day', 'Folded longtitle here', 'Has alarm', 'Windows zone']);
  assert.deepEqual(r.events[1], { date: '2026-10-06', time: null, title: 'All day' });
  assert.equal(r.events[3].time, '08:00');
  assert.equal(r.recurring, 1);
  assert.equal(r.invalid, 2);
  assert.equal(r.guessedZones, 1);
  // A TZID wall time becomes the right local instant.
  const ny = parseICS('BEGIN:VEVENT\nSUMMARY:NY\nDTSTART;TZID=America/New_York:20261005T090000\nEND:VEVENT').events[0];
  const want = new Date(Date.UTC(2026, 9, 5, 13, 0));
  assert.equal(ny.date, U.toISO(want));
  assert.equal(ny.time, U.pad2(want.getHours()) + ':' + U.pad2(want.getMinutes()));
});

test('store: round trip, quota, corrupt data, usage', async () => {
  const s = fakeStorage();
  const store = createLocalStore(s);
  await store.put('notes', { items: [{ id: 'n1' }] });
  assert.deepEqual(await store.get('notes'), { items: [{ id: 'n1' }] });
  s.setItem('cc:tasks', '{broken');
  assert.equal(await store.get('tasks'), null);
  assert.equal(s._m.get('cc:bak:tasks'), '{broken');
  const full = { getItem: () => null, setItem: () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } };
  await assert.rejects(createLocalStore(full).put('notes', {}), /storage is full/);
  assert.ok((await store.usage()) > 0);
});

// ---- commands through a recording Out -------------------------------------------------

const flat = (c) => (c === null || c === undefined ? '' : typeof c === 'string' ? c : c.swatch ? '[' + c.swatch + ']' : c.map((s) => (s.swatch ? '[' + s.swatch + ']' : s[0])).join(''));

function recorder() {
  const lines = [];
  let tone = null;
  const rank = { err: 3, warn: 2 };
  const setTone = (t, strong) => {
    if (!t) return;
    if ((rank[t] || 0) >= (rank[tone] || 0) && (strong || rank[t] || !tone)) tone = t;
  };
  const out = {
    head: (c, t) => { lines.push('# ' + flat(c)); setTone(t, true); },
    tone: (t) => setTone(t, true),
    line: (c) => lines.push(flat(c)),
    ok: (t) => { setTone('ok'); lines.push('ok: ' + t); },
    info: (t) => { setTone('info'); lines.push('info: ' + t); },
    warn: (t) => { setTone('warn'); lines.push('warn: ' + t); },
    err: (t) => { setTone('err'); lines.push('err: ' + t); },
    dim: (t) => lines.push('dim: ' + t),
    section: (c) => lines.push('## ' + flat(c)),
    table: (cols, rows) => {
      if (cols) lines.push('| ' + cols.join(' | '));
      for (const r of rows) lines.push(Array.isArray(r) ? r.map(flat).join(' | ') : '## ' + flat(r.section));
    },
    kv: (pairs) => pairs.forEach(([k, v]) => lines.push(k + ': ' + flat(v))),
    code: (text) => lines.push(...text.split('\n')),
    value: (text) => lines.push('= ' + text),
    calendar: (spec) => lines.push('CAL ' + spec.year + '-' + spec.month + ' marks=' + spec.marks.sort((a, b) => a - b).join(',')),
  };
  return { out, lines, tone: () => tone };
}

async function makeApp(storage) {
  storage = storage || fakeStorage();
  const store = createLocalStore(storage);
  let clock = new Date(MON);
  const data = createData(store, () => clock);
  await data.load();
  const base = {
    data, store, now: () => clock,
    setInput(t) { base.inputSet = t; },
    clearOutput() {},
    pickFile: async () => base.nextFile || null,
    download(name, text) { base.downloaded = { name, text }; },
  };
  let ctx = base;
  const commands = createCommands(() => ctx);
  const run = async (input) => {
    const rec = recorder();
    const res = dispatch(input, { isBuiltin: commands.isBuiltin, entries: data.state.aliases.entries, defaultEngine: data.state.aliases.defaultEngine });
    assert.equal(res.kind, 'builtin', input);
    ctx = Object.assign(base, { out: rec.out });
    await commands.run(res.name, res.rest, ctx);
    const r = rec.lines.slice();
    Object.defineProperty(r, 'tone', { value: rec.tone(), enumerable: false });
    return r;
  };
  return { run, data, store, storage, ctx: base, commands, setNow: (d) => { clock = d; } };
}

test('data: first load seeds meta, starter engines and display settings', async () => {
  const app = await makeApp();
  assert.deepEqual(app.data.state.aliases.entries.map((e) => e.name), ['g', 'ddg']);
  assert.equal(app.data.state.settings.theme, 'auto');
  assert.deepEqual(app.data.state.settings.widgets, ['clock', 'agenda', 'tasks']);
  assert.equal(app.data.state.settings.panel, true);
  assert.equal(app.data.hasUserData(), false);
});

test('data: damaged documents are reshaped, not crashed on', async () => {
  const s = fakeStorage();
  s.setItem('cc:tasks', JSON.stringify({ items: 'nope' }));
  s.setItem('cc:settings', JSON.stringify({ zones: null, theme: 42, widgets: ['clock', null] }));
  s.setItem('cc:meta', JSON.stringify({ schema: -1e10, counters: 'x' })); // review #5
  const app = await makeApp(s);
  assert.deepEqual(app.data.state.tasks.items, []);
  assert.deepEqual(app.data.state.settings.zones, []);
  assert.equal(app.data.state.settings.theme, 'auto');
  assert.deepEqual(app.data.state.settings.widgets, ['clock']);
  assert.deepEqual(app.data.state.meta.counters, { t: 0, n: 0, e: 0 });
  assert.deepEqual(await app.run('t still works'), ['# Added task t1', 'still works']);
});

test('data: mutations are serialised', async () => {
  const app = await makeApp();
  await Promise.all(Array.from({ length: 20 }, (_, i) => app.data.allocId('t').then((id) =>
    app.data.mutate('tasks', (d) => d.items.push({ id, text: 'x' + i, tags: [], done: false })))));
  const ids = app.data.state.tasks.items.map((t) => t.id);
  assert.equal(ids.length, 20);
  assert.equal(new Set(ids).size, 20);
});

test('notes: capture, list, edit round trip, remove; subcommand words never overwrite (review #1)', async () => {
  const app = await makeApp();
  assert.deepEqual(await app.run('n buy  oat milk'), ['# Added note n1']);
  await app.run('n second note');
  assert.equal(app.data.state.notes.items[0].text, 'buy  oat milk');
  const list = await app.run('notes');
  assert.deepEqual(list.slice(0, 3), ['# 2 notes', '| id | date | note', 'n2 | today | second note']);
  assert.deepEqual(await app.run('n edit n1'), ['# Editing n1', 'dim: Change the text and press Enter to save · Esc cancels']);
  assert.equal(app.ctx.inputSet, 'n edit n1: buy  oat milk');
  assert.deepEqual(await app.run('n edit n1: buy almond milk'), ['# Updated note n1']);
  assert.equal(app.data.state.notes.items[0].text, 'buy almond milk');
  // "n edit 2 slides before friday" is a new note, not an overwrite of n2
  assert.deepEqual(await app.run('n edit 2 slides before friday'), ['# Added note n3']);
  assert.equal(app.data.state.notes.items.find((n) => n.id === 'n2').text, 'second note');
  assert.deepEqual(await app.run('n rm the weeds'), ['# Added note n4']);
  const rm = await app.run('n rm n2');
  assert.deepEqual(rm, ['# Removed note n2', 'second note']);
  assert.equal(rm.tone, 'ok');
  const missing = await app.run('n rm n99');
  assert.deepEqual(missing, ['err: No note n99']);
  assert.equal(missing.tone, 'err');
  assert.match((await app.run('n edit n1:'))[0], /needs some text/);
  assert.equal((await app.run('n'))[0], '# Usage · n');
});

test('tasks: add, list order and colour, done, rm; "t done laundry" is a task', async () => {
  const app = await makeApp();
  assert.deepEqual(await app.run('t buy flour due:tomorrow #home'), ['# Added task t1', 'buy flour  due tomorrow  #home']);
  await app.run('t pay rent due:2026-10-01');
  await app.run('t someday maybe');
  await app.run('t call mum due:2026-10-06 #family #home');
  const list = await app.run('tasks');
  assert.equal(list[0], '# 4 open tasks · 1 overdue');
  assert.equal(list.tone, 'warn');
  assert.deepEqual(list.slice(2).map((l) => l.split(' | ')[0]), ['t2', 't1', 't4', 't3']);
  assert.match(list[2], /4 days overdue/);
  assert.equal((await app.run('tasks #family')).length, 3);
  assert.deepEqual(await app.run('t done t2'), ['# Completed t2', 'pay rent']);
  assert.deepEqual(await app.run('t done 2'), ['# t2 is already done']);
  assert.equal((await app.run('tasks all'))[0], '# 3 open tasks · 1 done');
  assert.deepEqual(await app.run('t done laundry'), ['# Added task t5', 'done laundry']);
  assert.deepEqual(await app.run('t done t99'), ['err: No task t99']);
  assert.match((await app.run('t x due:nonsense'))[0], /Can't read the date/);
  assert.equal((await app.run('t due:today #x'))[0], '# Usage · t');
});

test('calendar: ev, cal, agenda', async () => {
  const app = await makeApp();
  assert.deepEqual(await app.run('ev today 09:30 standup'), ['# Added event e1', 'standup  today 09:30']);
  await app.run('ev fri lunch with Sam');
  await app.run('ev 2026-11-02 dentist');
  assert.match((await app.run('ev today 25:00 x'))[0], /Can't read the time/);
  await app.run('t file taxes due:2026-10-07');
  await app.run('t old thing due:2026-10-01');
  const cal = await app.run('cal');
  assert.deepEqual(cal.slice(0, 2), ['# October 2026 · 2 events', 'CAL 2026-10 marks=5,9']);
  assert.match(cal[2], /^e1 \| Mon 5 Oct \| 09:30 \| standup$/);
  assert.equal((await app.run('cal 2026-13'))[0], '# Usage · cal');
  const ag = await app.run('agenda');
  assert.equal(ag[0], '# Next 7 days · 4 items · 1 overdue');
  assert.equal(ag[1], '## Overdue');
  assert.match(ag[2], /^t2 \| Thu 1 Oct \| old thing$/);
  assert.ok(ag.includes('t1 | task due | file taxes'));
  assert.equal(ag[3], '## Today · Mon 5 Oct');
  assert.ok(ag.includes('## Wed 7 Oct'));
  assert.ok(!ag.some((l) => /dentist/.test(l)));
  assert.ok((await app.run('agenda 60')).some((l) => /dentist/.test(l)));
  assert.deepEqual(await app.run('ev rm e1'), ['# Removed event e1', 'standup']);
});

test('ics import through the command: dedupe and warnings', async () => {
  const app = await makeApp();
  const body = 'BEGIN:VEVENT\nSUMMARY:A\nDTSTART:20261012T090000\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:R\nRRULE:FREQ=DAILY\nDTSTART:20261012T090000\nEND:VEVENT';
  app.ctx.nextFile = { name: 'cal.ics', size: body.length, text: async () => body };
  const first = await app.run('ics import');
  assert.equal(first[0], '# Imported 1 event from cal.ics');
  assert.equal(first.tone, 'warn');
  const second = await app.run('ics import');
  assert.equal(second[0], '# Imported 0 events from cal.ics');
  assert.ok(second.includes('dim: 1 event already present, skipped'));
});

test('alias and engine commands', async () => {
  const app = await makeApp();
  const add = await app.run('alias gh https://github.com/ https://github.com/{} --path');
  assert.equal(add[0], '# Added gh  engine');
  assert.ok(add.includes('escape: path'));
  const dup = await app.run('alias gh https://example.com/');
  assert.equal(dup[0], "err: Alias 'gh' already exists");
  assert.equal(dup.tone, 'err');
  assert.equal((await app.run('alias set gh https://example.com/ --force'))[0], '# Updated gh  alias');
  assert.match((await app.run('alias t https://example.com/'))[0], /'t' is a built-in command/);
  assert.match((await app.run('alias x javascript:alert(1)'))[0], /http/);
  assert.match((await app.run('alias rm g'))[0], /default engine/);
  assert.match((await app.run('engine default gh'))[0], /no template/);
  assert.deepEqual(await app.run('engine default ddg'), ['# Default engine is now ddg']);
  const ls = await app.run('alias ls');
  assert.equal(ls[0], '# 3 aliases · 2 engines');
  assert.ok(ls.some((l) => /^ddg \| engine \| .* \| ★ default$/.test(l)));
});

test('tools commands', async () => {
  const app = await makeApp();
  assert.deepEqual(await app.run('calc 2*(3+4)'), ['# 2*(3+4) = 14']);
  assert.deepEqual(await app.run('calc 1/0'), ['err: division by zero']);
  assert.deepEqual(await app.run('b64 enc hi there'), ['= aGkgdGhlcmU=']);
  const j = await app.run('json {"a":1}');
  assert.deepEqual(j, ['# Valid JSON · 1 key (object)', '{', '  "a": 1', '}']);
  assert.deepEqual(await app.run('units 5 km to mi'), ['# 5 km = 3.106855961 mi']);
  assert.equal((await app.run('epoch 0'))[0], '# 0 seconds');
  assert.deepEqual(await app.run('tz add europe/london'), ['# Added Europe/London']);
  const tz = await app.run('tz 14:30');
  assert.match(tz[0], /^# 14:30 local · overlap/);
  assert.equal(tz[1], '| zone | time |  | utc | ');
  assert.deepEqual(await app.run('tz rm EUROPE/london'), ['# Removed Europe/London']);
});

test('theme and widgets commands', async () => {
  const app = await makeApp();
  const list = await app.run('theme');
  assert.equal(list[0], '# Themes · current auto');
  assert.ok(list.some((l) => l.startsWith('[nord] | nord |')));
  assert.deepEqual(await app.run('theme nord'), ['# Theme set to nord']);
  assert.equal(app.data.state.settings.theme, 'nord');
  assert.equal((await app.run('theme neon'))[0], "err: No theme 'neon'");
  const w = await app.run('widgets');
  assert.equal(w[0], '# Widgets · 3 of 7 on');
  assert.deepEqual(await app.run('widgets zones'), ['# zones on']);
  assert.deepEqual(app.data.state.settings.widgets, ['clock', 'agenda', 'tasks', 'zones']);
  await app.run('widgets clock off');
  await app.run('widgets calendar on');
  assert.deepEqual(app.data.state.settings.widgets, ['agenda', 'tasks', 'calendar', 'zones']); // catalogue order
  assert.deepEqual(await app.run('widgets hide'), ['# Widget panel hidden']);
  assert.equal(app.data.state.settings.panel, false);
  await app.run('widgets notes');
  assert.equal(app.data.state.settings.panel, true); // turning one on shows the panel
  assert.equal((await app.run('widgets bogus'))[0], "err: No widget 'bogus'");
});

test('help, history', async () => {
  const app = await makeApp();
  const help = await app.run('help');
  assert.match(help[0], /^# Commands · \d+ built-in$/);
  assert.ok(help.includes('## View'));
  const ht = await app.run('help t');
  assert.deepEqual(ht.slice(0, 3), ['# t · add a task', '## Usage', 't <text> [due:<date>] [#tag]']);
  assert.ok(ht.includes('## Examples'));
  await app.data.addHistory('calc 1');
  await app.data.addHistory('vitosha weather');
  assert.deepEqual(await app.run('history 2'), ['# Last 2 commands of 2', '1 | calc 1', '2 | vitosha weather']);
});

test('export then import into empty storage brings everything back', async () => {
  const a = await makeApp();
  await a.run('n remember this');
  await a.run('t ship it due:2026-10-09 #work');
  await a.run('ev 2026-10-12 09:00 review');
  await a.run('alias gh https://github.com/ https://github.com/{} --path');
  await a.run('engine default ddg');
  await a.run('tz add Asia/Tokyo');
  await a.run('theme dracula');
  await a.run('widgets notes on');
  const ex = await a.run('export');
  assert.equal(ex[0], '# Exported control-center-2026-10-05.json');
  const file = JSON.parse(a.ctx.downloaded.text);

  const b = await makeApp();
  b.ctx.nextFile = { name: 'x.json', size: 10, text: async () => JSON.stringify(file) };
  const im = await b.run('import');
  assert.equal(im[0], '# Imported x.json');
  const s = b.data.state;
  assert.equal(s.notes.items[0].text, 'remember this');
  assert.deepEqual(s.tasks.items[0].tags, ['work']);
  assert.equal(s.events.items[0].title, 'review');
  assert.deepEqual(s.aliases.entries.map((e) => e.name).sort(), ['ddg', 'g', 'gh']);
  assert.equal(s.aliases.defaultEngine, 'ddg');
  assert.deepEqual(s.settings.zones, ['Asia/Tokyo']);
  assert.equal(s.settings.theme, 'dracula');
  assert.deepEqual(s.settings.widgets, ['clock', 'agenda', 'tasks', 'notes']);
});

test('import: conflicts reported, bad entries rejected, schema checked, never overwrites', async () => {
  const app = await makeApp();
  await app.run('alias gh https://github.com/ https://github.com/{} --path');
  await app.run('theme nord');
  const current = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, app.data.state[k]]));
  const file = {
    schema: 1,
    collections: {
      aliases: {
        defaultEngine: 'evil',
        entries: [
          { name: 'gh', base: 'https://evil.example/', template: 'https://evil.example/{}' },
          { name: 'help', base: 'https://x.com/' },
          { name: 'js', base: 'javascript:alert(document.cookie)' },
          { name: 'ok', base: 'https://ok.example/' },
          { name: 'evil', base: 'https://evil.example/', template: 'https://evil.example/?q={}' },
          'garbage',
        ],
      },
      notes: { items: [{ text: 'imported note' }, { text: '' }] },
      settings: { zones: ['Europe/Paris', 'Nope/Nope'], theme: 'gruvbox', widgets: ['notes', 'bogus'] },
    },
  };
  const r = merge(current, file, app.commands.isBuiltin, () => MON);
  assert.deepEqual(r.collections.aliases.entries.map((e) => e.name).sort(), ['ddg', 'evil', 'g', 'gh', 'ok']);
  assert.equal(r.collections.aliases.entries.find((e) => e.name === 'gh').base, 'https://github.com/');
  assert.ok(r.lines.some((l) => /skipped alias 'gh'.*already exists/.test(l)));
  assert.ok(r.lines.some((l) => /skipped alias 'help'.*built-in/.test(l)));
  assert.ok(r.lines.some((l) => /skipped alias 'js'/.test(l)));
  assert.deepEqual(r.counts, { notes: 1, tasks: 0, events: 0, aliases: 2, zones: 1 });
  assert.equal(r.invalid, 2);
  assert.equal(r.collections.settings.theme, 'nord'); // this browser already chose a theme
  assert.deepEqual(r.collections.settings.widgets, ['notes']);
  for (const schema of [999, -1e10, 0, 1.5, '1']) {
    assert.throws(() => merge(current, { schema, collections: {} }, app.commands.isBuiltin, () => MON), /newer|not a control-center/);
  }
});

test('import is all-or-nothing when storage fills up', async () => {
  const storage = fakeStorage();
  const app = await makeApp(storage);
  await app.run('n keep me');
  const before = storage.getItem('cc:notes');
  const file = { schema: 1, collections: { notes: { items: [{ text: 'new' }] }, tasks: { items: [{ text: 'boom' }] } } };
  app.ctx.nextFile = { name: 'f.json', size: 10, text: async () => JSON.stringify(file) };
  const realSet = storage.setItem;
  storage.setItem = (k, v) => {
    if (k === 'cc:tasks' && v.includes('boom')) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }
    realSet(k, v);
  };
  const outLines = await app.run('import');
  assert.match(outLines[0], /Import failed, nothing was changed: storage is full/);
  assert.equal(storage.getItem('cc:notes'), before);
});

test('export reminder age and newer schema refusal', async () => {
  const s = fakeStorage();
  s.setItem('cc:meta', JSON.stringify({ schema: 99, counters: {} }));
  await assert.rejects(createData(createLocalStore(s)).load(), /newer version/);
  const app = await makeApp();
  assert.equal(app.data.exportAgeDays(), null);
  await app.run('n something');
  app.setNow(new Date(2026, 9, 25, 13));
  assert.equal(app.data.exportAgeDays(), 20);
  await app.run('export');
  assert.equal(app.data.exportAgeDays(), 0);
});

test('a second tab is never overwritten by a stale copy', async () => {
  const storage = fakeStorage();
  const tabA = await makeApp(storage);
  const tabB = await makeApp(storage);
  await tabA.run('t from A');
  await tabB.run('t from B'); // tabB never reloaded
  assert.deepEqual(JSON.parse(storage.getItem('cc:tasks')).items.map((t) => [t.id, t.text]), [['t1', 'from A'], ['t2', 'from B']]);
});
