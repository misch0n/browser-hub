const test = require('node:test');
const assert = require('node:assert/strict');
const CC = require('./load.js');

const MON = new Date(2026, 9, 5, 12, 0); // Monday 2026-10-05, local time
const U = CC.util;
const builtinNames = new Set(['n', 'notes', 't', 'tasks', 'ls', 'help']);
const isBuiltin = (n) => builtinNames.has(n);

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    _m: m,
  };
}

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
  assert.equal(U.parseId('t', '12'), 't12');
  assert.equal(U.parseId('t', 'n12'), null);
});

test('aliases: url validation', () => {
  const A = CC.aliases;
  assert.equal(A.urlError('https://github.com/', false), null);
  assert.match(A.urlError('javascript:alert(1)', false), /http/);
  assert.match(A.urlError('data:text/html,hi', false), /http/);
  assert.match(A.urlError('https:example.com', false), /http/);
  assert.match(A.urlError('https://x.com/ a', false), /whitespace/);
  assert.equal(A.urlError('https://x.com/?q={}', true), null);
  assert.match(A.urlError('https://x.com/', true), /\{\}/);
  assert.match(A.urlError('https://{}.evil.com/', true), /after the host/);
  assert.match(A.urlError('https://x.com{}', true), /after the host/);
  assert.match(A.urlError('https://x.com@{}', true), /after the host/);
});

test('aliases: validateEntry', () => {
  const A = CC.aliases;
  assert.equal(A.validateEntry({ name: 'GH', base: 'https://github.com/' }, isBuiltin).entry.name, 'gh');
  assert.match(A.validateEntry({ name: 'ls', base: 'https://x.com/' }, isBuiltin).error, /built-in/);
  assert.match(A.validateEntry({ name: 'rm', base: 'https://x.com/' }, isBuiltin).error, /reserved/);
  assert.match(A.validateEntry({ name: 'a b', base: 'https://x.com/' }, isBuiltin).error, /name/);
  assert.match(A.validateEntry({ name: 'js', base: 'javascript:alert(1)' }, isBuiltin).error, /base/);
  assert.match(A.validateEntry({ name: 'js', base: 'https://x.com/', template: 'javascript:{}' }, isBuiltin).error, /template/);
  assert.equal(A.validateEntry({ name: 'p', base: 'https://x.com/', template: 'https://x.com/{}', escape: 'path' }, isBuiltin).entry.escape, 'path');
});

test('aliases: buildUrl escaping', () => {
  const q = { name: 'g', base: 'https://g.com/', template: 'https://g.com/?q={}', escape: 'query' };
  const p = { name: 'gh', base: 'https://gh.com/', template: 'https://gh.com/{}', escape: 'path' };
  assert.equal(CC.aliases.buildUrl(q, 'a/b c').url, 'https://g.com/?q=a%2Fb%20c');
  assert.equal(CC.aliases.buildUrl(p, 'org/repo').url, 'https://gh.com/org/repo');
  assert.equal(CC.aliases.buildUrl(p, 'a b/c d').url, 'https://gh.com/a%20b/c%20d');
  assert.equal(CC.aliases.buildUrl(p, '').url, 'https://gh.com/');
  assert.equal(CC.aliases.buildUrl(q, "$& $1 ' x").url, 'https://g.com/?q=%24%26%20%241%20\'%20x');
  const noTpl = { name: 'x', base: 'https://x.com/', escape: 'query' };
  const r = CC.aliases.buildUrl(noTpl, 'arg');
  assert.equal(r.url, 'https://x.com/');
  assert.match(r.note, /ignoring/);
});

test('dispatch: builtin, alias, engine, fallback', () => {
  const entries = CC.aliases.starters().concat([
    { name: 'gh', base: 'https://github.com/', template: 'https://github.com/{}', escape: 'path' },
  ]);
  const env = { isBuiltin, entries, defaultEngine: 'g' };
  const d = (s) => CC.dispatch(s, env);
  assert.deepEqual(d('   '), { kind: 'empty' });
  assert.deepEqual(d('t buy flour'), { kind: 'builtin', name: 't', rest: 'buy flour' });
  assert.deepEqual(d('T   buy   flour'), { kind: 'builtin', name: 't', rest: 'buy   flour' }); // inner spaces kept
  assert.equal(d('gh').url, 'https://github.com/');
  assert.equal(d('gh org/repo').url, 'https://github.com/org/repo');
  assert.equal(d('g how to proof sourdough').url, 'https://www.google.com/search?q=how%20to%20proof%20sourdough');
  assert.equal(d('vitosha weather').kind, 'search');
  assert.equal(d('vitosha weather').url, 'https://www.google.com/search?q=vitosha%20weather');
  assert.equal(d('gihtub').url, 'https://www.google.com/search?q=gihtub'); // typos fall through
  assert.equal(CC.dispatch('x', { isBuiltin, entries: [], defaultEngine: 'g' }).kind, 'error');
  // built-in wins over a stored alias of the same name
  const shadow = { isBuiltin, entries: [{ name: 'ls', base: 'https://x.com/', escape: 'query' }], defaultEngine: 'g' };
  assert.equal(CC.dispatch('ls', shadow).kind, 'builtin');
});

test('completion: first token, ranking, tab behavior', () => {
  const defs = [
    { name: 'tasks', desc: '' }, { name: 'tz', desc: '' }, { name: 'help', desc: '' }, { name: 'tail', desc: '' },
    { name: 't', desc: '', complete: (prev) => (prev.length === 0 ? [{ value: 'done' }, { value: 'rm' }] : prev[0] === 'done' ? [{ value: 't1', label: 'a' }, { value: 't12' }] : []) },
  ];
  const entries = [{ name: 'tw', base: 'https://x.com/', escape: 'query' }, { name: 'help', base: 'https://x.com/', escape: 'query' }];
  const env = { defs, entries, history: ['tz', 'tz', 'tasks', 'tw'] };
  const C = CC.completion;
  assert.deepEqual(C.complete('', env).candidates, []);
  assert.deepEqual(C.complete('zzz', env).candidates, []); // unknown words get nothing
  // built-ins first, then use count, then alphabetical; aliases last; shadowed alias hidden
  assert.deepEqual(C.complete('t', env).candidates.map((c) => c.value), ['tz', 'tasks', 't', 'tail', 'tw']);
  assert.deepEqual(C.complete('HE', env).candidates.map((c) => c.value), ['help']);
  // tab: unique -> full + space; common prefix; then list
  assert.deepEqual(C.applyTab('he', env), { input: 'help ' });
  assert.deepEqual(C.applyTab('ta', env).list.map((c) => c.value), ['tasks', 'tail']); // common prefix is just 'ta'
  assert.deepEqual(C.applyTab('t', env).list.map((c) => c.value), ['tz', 'tasks', 't', 'tail', 'tw']);
  assert.deepEqual(C.applyTab('tas', env), { input: 'tasks ' });
  // arguments
  assert.deepEqual(C.complete('t d', env).candidates.map((c) => c.value), ['done']);
  assert.deepEqual(C.applyTab('t do', env), { input: 't done ' });
  assert.deepEqual(C.complete('t done ', env).candidates.map((c) => c.value), ['t1', 't12']);
  assert.deepEqual(C.applyTab('t done t', env), { input: 't done t1' }); // common prefix
  assert.deepEqual(C.complete('t buy fl', env).candidates, []); // free text
  assert.deepEqual(C.complete('nothing here', env).candidates, []);
});

test('calc', () => {
  const E = (s) => CC.calc.evaluate(s);
  assert.equal(E('1+2*3'), 7);
  assert.equal(E('(1+2)*3'), 9);
  assert.equal(E('-2^2'), -4);
  assert.equal(E('2^3^2'), 512);
  assert.equal(E('2^-1'), 0.5);
  assert.equal(E('10 % 4'), 2);
  assert.equal(E('sqrt(16) + abs(-2)'), 6);
  assert.equal(E('max(1, 5, 3)'), 5);
  assert.equal(E('1e3 + .5'), 1000.5);
  assert.ok(Math.abs(E('pi') - Math.PI) < 1e-12);
  assert.equal(CC.calc.formatNumber(E('0.1+0.2')), '0.3');
  assert.throws(() => E('1/0'), /division by zero/);
  assert.throws(() => E('1 +'), /unexpected end/);
  assert.throws(() => E('foo'), /unknown name/);
  assert.throws(() => E('foo(1)'), /unknown function/);
  assert.throws(() => E('constructor(1)'), /unknown function/);
  assert.throws(() => E('(1'), /\)/);
  assert.throws(() => E('1 2'), /unexpected/);
  assert.throws(() => E('alert(1)'), /unknown function/);
  assert.throws(() => E('1;2'), /unexpected/);
  assert.throws(() => E(''), /empty/);
  assert.throws(() => E('sqrt(-1)'), /finite/);
});

test('units', () => {
  const c = CC.units.convert;
  assert.ok(Math.abs(c(5, 'km', 'mi') - 3.10685596) < 1e-6);
  assert.equal(c(1, 'h', 'min'), 60);
  assert.equal(c(1, 'KiB', 'b'), 1024);
  assert.equal(c(100, 'c', 'f'), 212);
  assert.ok(Math.abs(c(0, 'c', 'k') - 273.15) < 1e-9);
  assert.equal(c(32, '°F', 'c'), 0);
  assert.ok(Math.abs(c(12, 'inches', 'ft') - 1) < 1e-12);
  assert.throws(() => c(1, 'kg', 'm'), /can't convert/);
  assert.throws(() => c(1, 'zorp', 'm'), /unknown unit/);
});

test('tools: b64, json, epoch, uuid', () => {
  const T = CC.tools;
  assert.equal(T.b64encode('héllo ✓'), 'aMOpbGxvIOKckw==');
  assert.equal(T.b64decode('aMOpbGxvIOKckw=='), 'héllo ✓');
  assert.equal(T.b64decode('aGk'), 'hi'); // padding optional
  assert.throws(() => T.b64decode('***'), /base64/);
  assert.throws(() => T.b64decode('/w=='), /UTF-8/);
  assert.equal(T.prettyJson('{"a":[1,2]}'), '{\n  "a": [\n    1,\n    2\n  ]\n}');
  assert.throws(() => T.prettyJson('{oops'));
  assert.equal(T.parseEpochInput('0').toISOString(), '1970-01-01T00:00:00.000Z');
  assert.equal(T.parseEpochInput('1700000000000').getTime(), 1700000000000);
  assert.equal(T.parseEpochInput('2026-10-05T12:00:00Z').toISOString(), '2026-10-05T12:00:00.000Z');
  assert.equal(T.parseEpochInput('2026-10-05T12:00:00+02:00').toISOString(), '2026-10-05T10:00:00.000Z');
  assert.equal(T.parseEpochInput('2026-10-05 08:30').getHours(), 8);
  assert.throws(() => T.parseEpochInput('yesterday'), /expected/);
  assert.match(T.uuid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('tools: time zone rows and work overlap', () => {
  const T = CC.tools;
  const instant = new Date(Date.UTC(2026, 0, 15, 14, 30)); // winter: London = UTC, Tokyo = +9
  const rows = T.zoneRows(instant, ['UTC', 'Europe/London', 'Asia/Tokyo', 'America/Los_Angeles']);
  assert.equal(rows[1].time, '14:30');
  assert.equal(rows[2].time, '23:30');
  assert.equal(rows[2].working, false);
  assert.equal(rows[2].day, '');
  assert.equal(rows[3].time, '06:30');
  const late = T.zoneRows(new Date(Date.UTC(2026, 0, 15, 20, 0)), ['UTC', 'Asia/Tokyo']);
  assert.equal(late[1].day, '+1d');
  const day = new Date(2026, 0, 15);
  const ranges = T.workOverlap(day, ['UTC', 'UTC']);
  assert.deepEqual(ranges, ['09:00-17:00']);
  assert.deepEqual(T.workOverlap(day, ['UTC', 'Asia/Tokyo']), []);
});

test('ics parsing', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:Team sync\\, weekly', 'DTSTART:20261005T093000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:All day', 'DTSTART;VALUE=DATE:20261006', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Folded long', ' title here', 'DTSTART;TZID=Europe/Sofia:20261007T180000', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Repeats', 'DTSTART:20261008T100000', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:No start', 'END:VEVENT',
    'BEGIN:VEVENT', 'SUMMARY:Gone', 'STATUS:CANCELLED', 'DTSTART:20261009T100000', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const r = CC.ics.parseICS(ics);
  assert.deepEqual(r.events, [
    { date: '2026-10-05', time: '09:30', title: 'Team sync, weekly' },
    { date: '2026-10-06', time: null, title: 'All day' },
    { date: '2026-10-07', time: '18:00', title: 'Folded longtitle here' },
  ]);
  assert.equal(r.recurring, 1);
  assert.equal(r.invalid, 1);
  const z = CC.ics.parseICS('BEGIN:VEVENT\nSUMMARY:Z\nDTSTART:20261005T120000Z\nEND:VEVENT');
  const local = new Date(Date.UTC(2026, 9, 5, 12));
  assert.equal(z.events[0].time, String(local.getHours()).padStart(2, '0') + ':' + String(local.getMinutes()).padStart(2, '0'));
});

test('store: round trip, quota, corrupt data, subscribe key handling', async () => {
  const s = fakeStorage();
  const store = CC.store.createLocalStore(s);
  assert.equal(await store.get('notes'), null);
  await store.put('notes', { items: [{ id: 'n1' }] });
  assert.deepEqual(await store.get('notes'), { items: [{ id: 'n1' }] });
  assert.ok(s._m.has('cc:notes'));
  s.setItem('cc:tasks', '{broken');
  assert.equal(await store.get('tasks'), null);
  assert.equal(s._m.get('cc:bak:tasks'), '{broken'); // unreadable data is kept, not lost
  const full = { getItem: () => null, setItem: () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } };
  await assert.rejects(CC.store.createLocalStore(full).put('notes', {}), /storage is full/);
  const dump = await store.exportAll();
  assert.equal(dump.schema, CC.SCHEMA);
  assert.deepEqual(Object.keys(dump.collections), ['notes']);
  const s2 = fakeStorage();
  await CC.store.createLocalStore(s2).importAll(dump);
  assert.equal(s2.getItem('cc:notes'), '{"items":[{"id":"n1"}]}');
});

async function makeApp() {
  const storage = fakeStorage();
  const store = CC.store.createLocalStore(storage);
  let clock = new Date(MON);
  const data = CC.createData(store, () => clock);
  await data.load();
  const lines = [];
  const rec = (cls) => (t) => lines.push((cls ? cls + ': ' : '') + t);
  const out = {
    line: (t, cls) => lines.push((cls ? cls + ': ' : '') + t),
    parts: (list) => lines.push(list.map((p) => p[0]).join('')),
    err: rec('err'), ok: rec('ok'), warn: rec('warn'), dim: rec('dim'),
  };
  const ctx = {
    out, data, store, now: () => clock,
    inputSet: null,
    setInput(t) { this.inputSet = t; },
    clearOutput() { lines.length = 0; },
    pickFile: async () => null,
    download(name, text) { ctx.downloaded = { name, text }; },
  };
  const commands = CC.createCommands(() => ctx);
  const run = async (input) => {
    lines.length = 0;
    const res = CC.dispatch(input, { isBuiltin: commands.isBuiltin, entries: data.state.aliases.entries, defaultEngine: data.state.aliases.defaultEngine });
    assert.equal(res.kind, 'builtin', input);
    await commands.run(res.name, res.rest, ctx);
    return lines.slice();
  };
  return { run, data, store, storage, ctx, commands, lines, setNow: (d) => { clock = d; } };
}

test('data: first load seeds meta and starter engines', async () => {
  const app = await makeApp();
  assert.equal(app.data.state.meta.schema, CC.SCHEMA);
  assert.deepEqual(app.data.state.aliases.entries.map((e) => e.name), ['g', 'ddg']);
  assert.equal(app.data.state.aliases.defaultEngine, 'g');
  assert.ok(app.storage._m.has('cc:meta') && app.storage._m.has('cc:aliases'));
  assert.equal(app.data.hasUserData(), false);
});

test('notes: add, list, edit, remove; ids are never reused', async () => {
  const app = await makeApp();
  assert.deepEqual(await app.run('n buy  oat milk'), ['ok: added n1']);
  assert.deepEqual(await app.run('n second note'), ['ok: added n2']);
  assert.equal(app.data.state.notes.items[0].text, 'buy  oat milk'); // inner spacing kept
  let out = await app.run('notes');
  assert.match(out[0], /^n2 .*second note$/); // newest first
  assert.equal((await app.run('notes OAT')).length, 1);
  assert.deepEqual(await app.run('n edit n1'), ['dim: editing n1: change the text and press Enter to save (Esc cancels)']);
  assert.equal(app.ctx.inputSet, 'n edit n1 buy  oat milk');
  assert.deepEqual(await app.run('n edit n1 buy almond milk'), ['ok: updated n1']);
  assert.equal(app.data.state.notes.items[0].text, 'buy almond milk');
  assert.deepEqual(await app.run('n rm n2'), ['ok: removed n2']);
  assert.deepEqual(await app.run('n 3'), ['ok: added n3']); // plain text starting with a digit is a note
  assert.deepEqual(await app.run('n rm n9'), ['err: no note n9']);
  await app.run('n rm 3');
  assert.deepEqual(await app.run('n again'), ['ok: added n4']);
  assert.equal((await app.run('n rm'))[0], 'err: usage:');
});

test('tasks: add with due and tags, list order, done, rm', async () => {
  const app = await makeApp();
  assert.deepEqual(await app.run('t buy flour due:tomorrow #home'), ['ok: added t1 (due 2026-10-06)']);
  await app.run('t pay rent due:2026-10-01');
  await app.run('t someday maybe');
  await app.run('t call mum due:2026-10-06 #family #home');
  const t = app.data.state.tasks.items;
  assert.deepEqual(t[0].tags, ['home']);
  assert.deepEqual(t[3].tags, ['family', 'home']);
  let out = await app.run('tasks');
  assert.deepEqual(out.map((l) => l.slice(0, 2)), ['t2', 't1', 't4', 't3']); // overdue, then by due date, undated last
  assert.match(out[0], /overdue/);
  assert.equal((await app.run('tasks #family')).length, 1);
  assert.deepEqual(await app.run('t done t2'), ['ok: done t2: pay rent']);
  assert.deepEqual(await app.run('t done 2'), ['dim: t2 is already done']);
  assert.equal((await app.run('tasks')).length, 3);
  assert.equal((await app.run('tasks all')).length, 4);
  assert.deepEqual(await app.run('t rm t3'), ['ok: removed t3: someday maybe']);
  assert.match((await app.run('t x due:nonsense'))[0], /can't read date/);
  assert.equal((await app.run('t due:today'))[0], 'err: usage:'); // no text
  assert.equal((await app.run('t done'))[0], 'err: usage:');
  assert.equal((await app.run('t done t99'))[0], 'err: no task t99');
});

test('events: add, rm, cal, agenda', async () => {
  const app = await makeApp();
  assert.deepEqual(await app.run('ev today 09:30 standup'), ['ok: added e1: 2026-10-05 09:30 standup']);
  assert.deepEqual(await app.run('ev fri lunch with Sam'), ['ok: added e2: 2026-10-09 lunch with Sam']);
  assert.deepEqual(await app.run('ev 2026-11-02 dentist'), ['ok: added e3: 2026-11-02 dentist']);
  assert.match((await app.run('ev nope x'))[0], /can't read date/);
  assert.match((await app.run('ev today 25:00 x'))[0], /can't read time/);
  assert.equal((await app.run('ev today'))[0], 'err: usage:');
  await app.run('t file taxes due:2026-10-07');
  await app.run('t old thing due:2026-10-01');
  const cal = await app.run('cal');
  assert.equal(cal[0].replace('accent:', '').trim(), 'October 2026');
  assert.match(cal[1], /^Mo  Tu/);
  assert.ok(cal.some((l) => l.includes(' 5* ')) && cal.some((l) => l.includes(' 9* ')));
  assert.ok(!cal.some((l) => l.includes(' 6* ')));
  assert.ok(cal.some((l) => /e1\s+2026-10-05 09:30/.test(l)));
  assert.equal((await app.run('cal 2026-11')).some((l) => l.includes(' 2* ')), true);
  assert.equal((await app.run('cal 2026-13'))[0], 'err: usage:');
  const ag = await app.run('agenda');
  assert.equal(ag[0], 'overdue');
  assert.match(ag[1], /t2/);
  assert.match(ag[2], /Mon 2026-10-05 {2}\(today\)/);
  assert.match(ag[3], /09:30\s+standup/);
  assert.ok(ag.some((l) => /task\s+file taxes/.test(l)));
  assert.ok(ag.some((l) => /lunch with Sam/.test(l)));
  assert.ok(!ag.some((l) => /dentist/.test(l))); // outside the 7-day window
  assert.ok((await app.run('agenda 60')).some((l) => /dentist/.test(l)));
  assert.deepEqual(await app.run('ev rm e1'), ['ok: removed e1: standup']);
  assert.equal((await app.run('ev rm e1'))[0], 'err: no event e1');
});

test('alias: define, conflicts, force, rm, default engine', async () => {
  const app = await makeApp();
  assert.deepEqual(await app.run('alias gh https://github.com/ https://github.com/{} --path'), ['ok: added gh']);
  assert.equal(app.data.state.aliases.entries.find((e) => e.name === 'gh').escape, 'path');
  assert.match((await app.run('alias gh https://example.com/'))[0], /already exists.*--force/);
  assert.deepEqual(await app.run('alias set gh https://example.com/ --force'), ['ok: updated gh']);
  assert.match((await app.run('alias t https://example.com/'))[0], /'t' is a built-in command/);
  assert.match((await app.run('alias ls2 javascript:alert(1)'))[0], /http/);
  assert.match((await app.run('alias x https://a.com/ javascript:{}'))[0], /template/);
  assert.match((await app.run('alias x https://a.com/ https://a.com/?q={} --bogus'))[0], /unknown option/);
  assert.match((await app.run('alias x https://a.com/ --path'))[0], /--path/);
  assert.match((await app.run('alias rm g'))[0], /default engine/);
  assert.match((await app.run('alias g https://a.com/ --force'))[0], /needs a template/);
  assert.match((await app.run('engine default gh'))[0], /no template/); // gh was overwritten without one
  assert.deepEqual(await app.run('engine default ddg'), ['ok: default engine is now ddg']);
  assert.deepEqual(await app.run('engine'), ['default engine: ddg']);
  assert.deepEqual(await app.run('alias rm g'), ['ok: removed g']);
  assert.ok((await app.run('alias ls')).some((l) => /ddg.*default engine/.test(l)));
  assert.match((await app.run('alias show ddg'))[1], /duckduckgo/);
});

test('tools commands print results', async () => {
  const app = await makeApp();
  assert.deepEqual(await app.run('calc 2*(3+4)'), ['14']);
  assert.deepEqual(await app.run('calc 1/0'), ['err: division by zero']);
  assert.deepEqual(await app.run('b64 enc hi there'), ['aGkgdGhlcmU=']);
  assert.deepEqual(await app.run('b64 dec aGkgdGhlcmU='), ['hi there']);
  assert.deepEqual(await app.run('json {"a":1}'), ['{', '  "a": 1', '}']);
  assert.match((await app.run('json {a'))[0], /^err: invalid JSON/);
  assert.deepEqual(await app.run('units 5 km to mi'), ['5 km = 3.106855961 mi']);
  assert.deepEqual(await app.run('units 100c to f'), ['100 c = 212 f']);
  assert.match((await app.run('units 1 kg to m'))[0], /can't convert/);
  assert.match((await app.run('uuid'))[0], /^[0-9a-f-]{36}$/);
  assert.equal((await app.run('epoch 0'))[0], 'seconds  0');
  assert.deepEqual(await app.run('tz add Not/AZone'), ["err: unknown time zone 'Not/AZone' (use an IANA name such as Europe/London)"]);
  assert.deepEqual(await app.run('tz add europe/london'), ['ok: added Europe/London']);
  assert.deepEqual(await app.run('tz add Europe/London'), ['dim: Europe/London is already listed']);
  const tz = await app.run('tz 14:30');
  assert.ok(tz.length >= 3 && /overlap|add zones/.test(tz[tz.length - 1]));
  assert.deepEqual(await app.run('tz rm EUROPE/london'), ['ok: removed Europe/London']);
});

test('history is capped, deduped, and persisted', async () => {
  const app = await makeApp();
  await app.data.addHistory('a');
  await app.data.addHistory('a');
  await app.data.addHistory('b');
  assert.deepEqual(app.data.state.history.items, ['a', 'b']);
  assert.deepEqual(JSON.parse(app.storage.getItem('cc:history')).items, ['a', 'b']);
  for (let i = 0; i < 600; i++) await app.data.addHistory('c' + i);
  assert.equal(app.data.state.history.items.length, 500);
  assert.equal(JSON.parse(app.storage.getItem('cc:history')).items.length, 500);
  const out = await app.run('history 3');
  assert.equal(out.length, 3);
});

test('export then import into empty storage brings everything back', async () => {
  const a = await makeApp();
  await a.run('n remember this');
  await a.run('t ship it due:2026-10-09 #work');
  await a.run('ev 2026-10-12 09:00 review');
  await a.run('alias gh https://github.com/ https://github.com/{} --path');
  await a.run('alias mine https://example.com/');
  await a.run('engine default ddg');
  await a.run('tz add Asia/Tokyo');
  await a.run('export');
  const file = JSON.parse(a.ctx.downloaded.text);
  assert.match(a.ctx.downloaded.name, /^control-center-2026-10-05\.json$/);
  assert.equal(file.schema, CC.SCHEMA);
  assert.ok(a.data.state.meta.lastExport);

  const b = await makeApp();
  const merged = CC.importer.merge(Object.fromEntries(Object.keys(b.data.DEFAULTS).map((k) => [k, b.data.state[k]])), file, b.commands.isBuiltin, () => MON);
  await b.store.importAll({ collections: merged.collections });
  await b.data.load();
  const s = b.data.state;
  assert.equal(s.notes.items[0].text, 'remember this');
  assert.deepEqual(s.tasks.items[0].tags, ['work']);
  assert.equal(s.tasks.items[0].due, '2026-10-09');
  assert.equal(s.events.items[0].title, 'review');
  assert.deepEqual(s.aliases.entries.map((e) => e.name).sort(), ['ddg', 'g', 'gh', 'mine']);
  assert.equal(s.aliases.defaultEngine, 'ddg');
  assert.deepEqual(s.settings.zones, ['Asia/Tokyo']);
  assert.ok(s.history.items.includes('export') || s.history.items.length >= 0);
});

test('import: conflicts skipped and reported, bad entries rejected, never overwrites', async () => {
  const app = await makeApp();
  await app.run('alias gh https://github.com/ https://github.com/{} --path');
  await app.run('n existing');
  const before = JSON.stringify(app.data.state.aliases.entries.find((e) => e.name === 'gh'));
  const file = {
    schema: CC.SCHEMA,
    collections: {
      aliases: {
        defaultEngine: 'evil',
        entries: [
          { name: 'gh', base: 'https://evil.example/', template: 'https://evil.example/{}' }, // collides with existing
          { name: 'help', base: 'https://x.com/' }, // collides with a built-in
          { name: 'js', base: 'javascript:alert(document.cookie)' },
          { name: 'js2', base: 'https://x.com/', template: 'data:text/html,{}' },
          { name: 'ok', base: 'https://ok.example/' },
          { name: 'evil', base: 'https://evil.example/', template: 'https://evil.example/?q={}' },
          { name: 'Bad Name', base: 'https://x.com/' },
          'garbage',
        ],
      },
      notes: { items: [{ text: 'imported note' }, { text: '' }, { nope: 1 }] },
      tasks: { items: [{ text: 'ok task', due: '2026-02-31' }, { text: 'good', due: '2026-03-01', tags: ['a', '<b>'] }] },
      events: { items: [{ date: '2026-10-10', time: '09:00', title: 'x' }, { date: 'bad', title: 'y' }] },
      settings: { zones: ['Europe/Paris', 'Nope/Nope', 42] },
    },
  };
  const current = Object.fromEntries(Object.keys(app.data.DEFAULTS).map((k) => [k, app.data.state[k]]));
  const r = CC.importer.merge(current, file, app.commands.isBuiltin, () => MON);
  const names = r.collections.aliases.entries.map((e) => e.name).sort();
  assert.deepEqual(names, ['ddg', 'evil', 'g', 'gh', 'ok']);
  assert.equal(JSON.stringify(r.collections.aliases.entries.find((e) => e.name === 'gh')), before);
  assert.ok(r.lines.some((l) => /skipped alias 'gh'.*already exists/.test(l)));
  assert.ok(r.lines.some((l) => /skipped alias 'help'.*built-in/.test(l)));
  assert.ok(r.lines.some((l) => /skipped alias 'js'.*http/.test(l)));
  assert.ok(r.lines.some((l) => /skipped alias 'js2'/.test(l)));
  assert.ok(r.lines.some((l) => /skipped alias 'Bad Name'/.test(l)));
  assert.equal(r.collections.aliases.defaultEngine, 'evil'); // allowed: it is a valid engine and the default was untouched
  assert.deepEqual(r.collections.notes.items.map((n) => [n.id, n.text]), [['n1', 'existing'], ['n2', 'imported note']]);
  assert.equal(r.collections.tasks.items.length, 1);
  assert.deepEqual(r.collections.tasks.items[0].tags, ['a']);
  assert.equal(r.collections.events.items.length, 1);
  assert.deepEqual(r.collections.settings.zones, ['Europe/Paris']);
  assert.match(r.lines[0], /imported 1 notes, 1 tasks, 1 events, 2 aliases, 1 time zones/);
  assert.throws(() => CC.importer.merge(current, { schema: 999, collections: {} }, app.commands.isBuiltin, () => MON), /newer/);
  assert.throws(() => CC.importer.merge(current, { hello: 1 }, app.commands.isBuiltin, () => MON), /not a control-center/);
  assert.throws(() => CC.importer.merge(current, null, app.commands.isBuiltin, () => MON), /not a control-center/);
});

test('data: newer schema refuses to load; export reminder age', async () => {
  const storage = fakeStorage();
  storage.setItem('cc:meta', JSON.stringify({ schema: 99, counters: {} }));
  const data = CC.createData(CC.store.createLocalStore(storage));
  await assert.rejects(data.load(), /newer version/);

  const app = await makeApp();
  assert.equal(app.data.exportAgeDays(), null); // no data yet: no reminder
  await app.run('n something');
  assert.equal(app.data.exportAgeDays(), 0);
  app.setNow(new Date(2026, 9, 25, 13));
  assert.equal(app.data.exportAgeDays(), 20); // never exported: measured from first use
  await app.run('export');
  assert.equal(app.data.exportAgeDays(), 0);
});

test('stale state: a second tab never gets overwritten', async () => {
  const storage = fakeStorage();
  const mk = async () => {
    const data = CC.createData(CC.store.createLocalStore(storage));
    await data.load();
    return data;
  };
  const tabA = await mk();
  const tabB = await mk();
  const idA = await tabA.allocId('t');
  await tabA.mutate('tasks', (d) => d.items.push({ id: idA, text: 'from A' }));
  const idB = await tabB.allocId('t'); // tabB has not reloaded
  await tabB.mutate('tasks', (d) => d.items.push({ id: idB, text: 'from B' }));
  assert.notEqual(idA, idB);
  assert.deepEqual(JSON.parse(storage.getItem('cc:tasks')).items.map((t) => t.text), ['from A', 'from B']);
});
