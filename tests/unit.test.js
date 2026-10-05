import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import * as U from '../js/core/util.js';
import * as A from '../js/core/aliases.js';
import { dispatch } from '../js/core/dispatch.js';
import { edit, actionFor, historySearch } from '../js/core/lineedit.js';
import { tokenize, oneValue, quote } from '../js/core/args.js';
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
  assert.equal(A.urlError('https://x.com/?q=a b "c"', false), null); // spaces and quotes are encoded on the way out
  assert.match(A.urlError('https://x.com/\ta', false), /tabs/);
  assert.match(A.urlError('https:// x.com/', false), /http/);
  assert.equal(A.urlError('https://x.com/{1}/{2}', true), null);
  assert.match(A.urlError('https://{1}.x.com/', true), /after the host/);
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

  // %s is stored as {}; numbered placeholders take single (quotable) arguments.
  assert.equal(A.validateEntry({ name: 'w', base: 'https://w.org/', template: 'https://w.org/?s=%s' }, isBuiltin).entry.template, 'https://w.org/?s={}');
  const j = { name: 'jira', base: 'https://j.com/', template: 'https://j.com/{1}/browse/{2}', escape: 'query' };
  assert.equal(A.arity(j.template), 2);
  assert.equal(A.buildUrl(j, 'ABC 12').url, 'https://j.com/ABC/browse/12');
  assert.equal(A.buildUrl(j, '"A B" more words').url, 'https://j.com/A%20B/browse/more%20words'); // last one takes the rest
  assert.match(A.buildUrl(j, 'ABC').error, /needs 2 arguments, got 1/);
  // The JQL alias: quotes and spaces in the template, the phrase inside its quotes.
  const jql = 'https://jira.example.net/issues/?jql=project="UBMVC" AND "Migrated From Bugzilla Id" ~ "%s"';
  const mobile = A.validateEntry({ name: 'mobile', base: A.siteRoot(jql), template: jql }, isBuiltin).entry;
  assert.equal(mobile.base, 'https://jira.example.net/');
  const url = A.buildUrl(mobile, '12345').url;
  assert.equal(url, 'https://jira.example.net/issues/?jql=project="UBMVC" AND "Migrated From Bugzilla Id" ~ "12345"');
  assert.equal(new URL(url).href, 'https://jira.example.net/issues/?jql=project=%22UBMVC%22%20AND%20%22Migrated%20From%20Bugzilla%20Id%22%20~%20%2212345%22');
});

test('args: optional quotes', () => {
  const t = (s) => tokenize(s).map((x) => (x.quoted ? 'Q:' : '') + x.text);
  assert.deepEqual(t('  a  b c '), ['a', 'b', 'c']);
  assert.deepEqual(t('t "done laundry" due:fri'), ['t', 'Q:done laundry', 'due:fri']);
  assert.deepEqual(t("add 'Kenji's team'"), ['add', "Q:Kenji's team"]); // closes only before a space or the end
  assert.deepEqual(t('project="UBMVC" x'), ['project="UBMVC"', 'x']); // quotes inside a word are literal
  assert.deepEqual(t('"open ended'), ['"open', 'ended']); // unclosed: literal
  assert.deepEqual(t('"a \\" b\\\\" c'), ['Q:a " b\\', 'c']);
  assert.equal(oneValue('  "  spaced  " '), '  spaced  ');
  assert.equal(oneValue('two "words"'), 'two "words"');
  for (const v of ['plain', 'two words', 'say "hi"', 'it\'s "x"', 'back\\slash', '"lead', '']) assert.equal(oneValue(quote(v)), v);
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
  // An engine with a phrase is a search on that engine; unknown input falls back to the default.
  assert.deepEqual(d('ddg sourdough starter'), { kind: 'search', url: 'https://duckduckgo.com/?q=sourdough%20starter', name: 'ddg', query: 'sourdough starter', fallback: false });
  assert.deepEqual(d('gtg'), { kind: 'search', url: 'https://www.google.com/search?q=gtg', name: 'g', query: 'gtg', fallback: true });
  assert.equal(d('gh org/repo').kind, 'search');
  assert.equal(d('ddg').kind, 'redirect');
  assert.equal(dispatch('x', { isBuiltin, entries: [], defaultEngine: 'g' }).kind, 'error');
  assert.equal(dispatch('help', { isBuiltin, entries: [{ name: 'help', base: 'https://x.com/' }], defaultEngine: 'g' }).kind, 'builtin');
});

test('line editing: readline keys', () => {
  const e = (action, value, cursor, killed = '') => edit(action, value, cursor, killed);
  const line = 'gh org/repo issues';
  assert.deepEqual(e('start', line, 5), { value: line, cursor: 0, killed: '' });
  assert.deepEqual(e('end', line, 5), { value: line, cursor: line.length, killed: '' });
  assert.equal(e('start', line, 0), null); // already there
  // Ctrl+W cuts back to whitespace, so a whole path goes; trailing spaces go with it.
  assert.deepEqual(e('kill-big-word-back', line, 11), { value: 'gh  issues', cursor: 3, killed: 'org/repo' });
  assert.deepEqual(e('kill-big-word-back', 'gh org  ', 8), { value: 'gh ', cursor: 3, killed: 'org  ' });
  assert.equal(e('kill-big-word-back', 'x', 0), null);
  // Alt+Backspace / Alt+B / Alt+F / Alt+D stop at punctuation.
  assert.deepEqual(e('kill-word-back', line, 11), { value: 'gh org/ issues', cursor: 7, killed: 'repo' });
  assert.equal(e('back-word', line, 11).cursor, 7);
  assert.equal(e('forward-word', line, 3).cursor, 6);
  assert.deepEqual(e('kill-word-forward', line, 6), { value: 'gh org issues', cursor: 6, killed: '/repo' });
  assert.deepEqual(e('kill-start', line, 3), { value: 'org/repo issues', cursor: 0, killed: 'gh ' });
  assert.deepEqual(e('kill-end', line, 11), { value: 'gh org/repo', cursor: 11, killed: ' issues' });
  assert.deepEqual(e('yank', 'ab', 1, 'XY'), { value: 'aXYb', cursor: 3, killed: 'XY' });
  assert.equal(e('yank', 'ab', 1, ''), null);
  assert.deepEqual(e('delete-char', 'abc', 1), { value: 'ac', cursor: 1, killed: '' });
  assert.equal(e('back-char', 'abc', 0), null);
  assert.equal(e('forward-char', 'abc', 1).cursor, 2);
  assert.equal(e('back-word', 'café olé', 8).cursor, 5); // letters beyond ASCII are word characters

  const key = (o) => actionFor(Object.assign({ key: '', code: '', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false }, o));
  assert.equal(key({ key: 'a', ctrlKey: true }), 'start');
  assert.equal(key({ key: 'E', ctrlKey: true }), 'end'); // caps lock
  assert.equal(key({ key: 'w', ctrlKey: true }), 'kill-big-word-back');
  assert.equal(key({ key: '∫', code: 'KeyB', altKey: true }), 'back-word'); // Option+B on a Mac
  assert.equal(key({ key: 'Backspace', code: 'Backspace', altKey: true }), 'kill-word-back');
  assert.equal(key({ key: 'a', metaKey: true }), null); // Cmd+A stays select-all
  assert.equal(key({ key: 'c', ctrlKey: true }), null); // copy, paste, undo untouched
  assert.equal(key({ key: 'a', ctrlKey: true, shiftKey: true }), null);
  assert.equal(key({ key: 'b', ctrlKey: true, altKey: true }), null); // AltGr
});

test('did you mean: one typo away, Tab fixes it', () => {
  const defs = [{ name: 'tasks', desc: '' }, { name: 'alias', desc: '' }, { name: 'n', desc: '' }, { name: 't', desc: '' }];
  const env = { defs, entries: [{ name: 'gh', base: 'https://github.com/' }, { name: 'mobile', base: 'https://m.com/' }], history: [] };
  assert.equal(C.didYouMean('tsks', env), 'tasks'); // missing letter
  assert.equal(C.didYouMean('taks', env), 'tasks');
  assert.equal(C.didYouMean('atsks', env), 'tasks'); // swapped letters
  assert.equal(C.didYouMean('tssk', env), null); // two edits
  assert.equal(C.didYouMean('tasks', env), null); // already right
  assert.equal(C.didYouMean('aliss', env), 'alias');
  assert.equal(C.didYouMean('moblie', env), 'mobile'); // swapped letters
  assert.equal(C.didYouMean('ghh', env), 'gh');
  assert.equal(C.didYouMean('ns', env), null); // too short to guess
  assert.equal(C.didYouMean('gtg', env), null);
  assert.deepEqual(C.applyTab('tsks', env), { input: 'tasks ' });
  assert.deepEqual(C.applyTab('moblie 123', env), { input: 'mobile 123' });
  assert.deepEqual(C.applyTab('vitosha weather', env), {});
});

test('history search (Ctrl+R)', () => {
  const items = ['calc 1+1', 'gh org/repo', 'tasks', 'gh other/thing', 'gh other/thing', 'calc 2*3'];
  assert.equal(historySearch(items, 'gh', Infinity, null), 4); // newest first
  assert.equal(historySearch(items, 'gh', 4, items[4]), 1); // older, skipping the same text
  assert.equal(historySearch(items, 'CALC', Infinity, null), 5); // any case
  assert.equal(historySearch(items, 'zzz', Infinity, null), -1);
  assert.equal(historySearch(items, '', Infinity, null), 5);
  const key = (o) => actionFor(Object.assign({ key: '', code: '', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false }, o));
  assert.equal(key({ key: 'r', ctrlKey: true }), 'history-search');
  assert.equal(key({ key: 'g', ctrlKey: true }), 'cancel');
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
  // Earliest wall clock first; the reference zone keeps its `ref` mark wherever it lands.
  assert.deepEqual(rows.map((r) => [r.zone, r.time, r.offset, r.ref]),
    [['America/Los_Angeles', '06:30', '-08:00', false], ['UTC', '14:30', '+00:00', true], ['Asia/Tokyo', '23:30', '+09:00', false]]);
  assert.deepEqual(rows.map((r) => r.date), ['', '', '']);
  // A different calendar day shows the date; the same day shows nothing.
  const late = Z.zoneRows(new Date(Date.UTC(2026, 0, 15, 20)), ['UTC', 'Asia/Tokyo', 'Pacific/Honolulu']);
  assert.deepEqual(late.map((r) => [r.zone, r.date]), [['Pacific/Honolulu', ''], ['UTC', ''], ['Asia/Tokyo', 'Fri 16 Jan']]);
  const early = Z.zoneRows(new Date(Date.UTC(2026, 0, 15, 3)), ['Asia/Tokyo', 'America/New_York']);
  assert.deepEqual(early.map((r) => [r.zone, r.date]), [['America/New_York', 'Wed 14 Jan'], ['Asia/Tokyo', '']]);
  assert.ok(Z.allZones().includes('Europe/Sofia') && Z.allZones().includes('UTC'));
  assert.equal(Z.resolveZone('tokyo'), 'Asia/Tokyo');
  assert.equal(Z.resolveZone('new york'), 'America/New_York');
  assert.equal(Z.resolveZone('america/los_angeles'), 'America/Los_Angeles');
  assert.equal(Z.resolveZone('Atlantis'), null);
  assert.equal(Z.zoneLabel('America/New_York', {}), 'New York');
  assert.equal(Z.zoneLabel('America/New_York', { 'America/New_York': 'NYC office' }), 'NYC office');
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
    // Editable rows show the command a tap would run: `field: value  [n edit n1.text]`.
    fields: (rows) => rows.forEach(([k, v, e]) => lines.push(k + ': ' + flat(v) + (e ? '  [' + e.command + ' = ' + e.current + ']' : ''))),
    code: (text) => lines.push(...text.split('\n')),
    value: (text) => { lines.push('= ' + text); lines.copied = text; }, // the page's value() also marks it copyable
    copyable: (text) => { lines.copied = text; },
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
    Object.defineProperty(r, 'copied', { value: rec.lines.copied, enumerable: false });
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

test('editing fields: n / t / ev edit <id>.<field> <value>, show views are editable', async () => {
  const app = await makeApp();
  const st = () => app.data.state;
  await app.run('n first draft');
  // `name` is accepted for a note's text; the value is everything after the field.
  const up = await app.run('n edit n1.name buy  oat milk');
  assert.equal(up[0], '# Updated n1.text');
  assert.ok(up.includes('text: buy  oat milk  [n edit n1.text = buy  oat milk]'));
  assert.equal(up.tone, 'ok');
  assert.equal(st().notes.items[0].text, 'buy  oat milk');
  assert.deepEqual(await app.run('n edit n1.text "  padded  "'), (await app.run('n show n1')).map((l, i) => (i ? l : '# Updated n1.text')));
  assert.equal(st().notes.items[0].text, 'padded'); // text is trimmed
  assert.equal((await app.run('n edit n1.colour red'))[0], 'err: Notes have no field colour');
  assert.equal((await app.run('n edit n9.text x'))[0], 'err: No note n9');
  assert.equal((await app.run('n edit n1.text ""'))[0], 'err: text needs some text');
  // No value: the command with the current value goes into the prompt.
  await app.run('n edit n1.text');
  assert.equal(app.ctx.inputSet, 'n edit n1.text padded');
  // Not an id: still note text, as before.
  assert.deepEqual(await app.run('n edit config.yaml for prod'), ['# Added note n2']);

  await app.run('t buy flour due:tomorrow #home');
  const show = await app.run('t show t1');
  assert.deepEqual(show.slice(0, 5), ['# task t1', 'text: buy flour  [t edit t1.text = buy flour]', 'due: tomorrow  [t edit t1.due = 2026-10-06]',
    'tags: #home  [t edit t1.tags = #home]', 'done: ○ open  [t edit t1.done = no]']);
  assert.deepEqual(await app.run('t edit t1'), show); // edit with no field shows it
  await app.run('t edit t1.due fri');
  assert.equal(st().tasks.items[0].due, '2026-10-09');
  await app.run('t edit t1.due none');
  assert.equal(st().tasks.items[0].due, null);
  await app.run('t edit t1.tags #Home, errands');
  assert.deepEqual(st().tasks.items[0].tags, ['home', 'errands']);
  await app.run('t edit t1.done yes');
  assert.equal(st().tasks.items[0].done, true);
  assert.ok(st().tasks.items[0].doneAt);
  await app.run('t edit t1.done no');
  assert.equal(st().tasks.items[0].doneAt, null);
  assert.match((await app.run('t edit t1.due someday'))[0], /^err: due can't read the date 'someday'/);
  assert.match((await app.run('t edit t1.tags a+b'))[0], /not a tag/);

  await app.run('ev 2026-10-12 09:00 review');
  await app.run('ev edit e1.time none');
  assert.equal(st().events.items[0].time, null);
  await app.run('ev edit e1.date tomorrow');
  assert.equal(st().events.items[0].date, '2026-10-06');
  await app.run('ev edit e1.title design review');
  assert.equal(st().events.items[0].title, 'design review');
  assert.match((await app.run('ev edit e1.time 25:00'))[0], /can't read the time/);
  assert.equal((await app.run('ev show e1'))[0], '# event e1');

  // Lists link each id to its show view.
  const linked = await app.run('tasks all');
  assert.ok(linked.some((l) => l.startsWith('t1 | ')));
});

test('quotes say what you mean: literal text, names with spaces', async () => {
  const app = await makeApp();
  const st = () => app.data.state;
  assert.deepEqual(await app.run('n "rm the weeds"'), ['# Added note n1']);
  assert.equal(st().notes.items[0].text, 'rm the weeds');
  assert.deepEqual(await app.run('n "edit n1"'), ['# Added note n2']);
  assert.equal(st().notes.items[1].text, 'edit n1');
  await app.run('t "done laundry"');
  assert.equal(st().tasks.items[0].text, 'done laundry');
  await app.run('t "due:friday is a word" #home due:fri');
  assert.deepEqual([st().tasks.items[1].text, st().tasks.items[1].due, st().tasks.items[1].tags], ['due:friday is a word', '2026-10-09', ['home']]);
  await app.run('ev fri "19:30 is the title"');
  assert.deepEqual([st().events.items[0].time, st().events.items[0].title], [null, '19:30 is the title']);
  await app.run('ev fri 19:30 "quoted title"');
  assert.equal(st().events.items[1].title, 'quoted title');
  // Unquoted text is untouched, quotes and all.
  await app.run('n she said "hi" twice');
  assert.equal(st().notes.items[2].text, 'she said "hi" twice');
});

test('alias templates: spaces and quotes, numbered placeholders, editing', async () => {
  const app = await makeApp();
  const st = () => app.data.state;
  const env = () => ({ isBuiltin: app.commands.isBuiltin, entries: st().aliases.entries, defaultEngine: st().aliases.defaultEngine });
  const go = (s) => dispatch(s, env());
  // The JQL alias, pasted as is: no quoting needed; \/ from JSON copies is read as /.
  const def = 'alias mobile https:\\/\\/jira.example.net\\/issues\\/?jql=project="UBMVC" AND "Migrated From Bugzilla Id" ~ "%s"';
  assert.equal((await app.run(def))[0], '# Added mobile  engine');
  const mobile = st().aliases.entries.find((e) => e.name === 'mobile');
  assert.equal(mobile.template, 'https://jira.example.net/issues/?jql=project="UBMVC" AND "Migrated From Bugzilla Id" ~ "{}"');
  assert.equal(mobile.base, 'https://jira.example.net/');
  assert.equal(go('mobile 12345').url, 'https://jira.example.net/issues/?jql=project="UBMVC" AND "Migrated From Bugzilla Id" ~ "12345"');
  assert.equal(go('mobile').url, 'https://jira.example.net/');
  // Quoted, with a base and a flag after it.
  await app.run("alias q2 https://x.com/ 'https://x.com/s?q=a b {}' --force");
  assert.equal(st().aliases.entries.find((e) => e.name === 'q2').template, 'https://x.com/s?q=a b {}');
  // Numbered placeholders.
  await app.run('alias jira https://jira.example.com/browse/{1}-{2}');
  assert.equal(go('jira APP 42').url, 'https://jira.example.com/browse/APP-42');
  assert.deepEqual(go('jira APP'), { kind: 'error', message: "'jira' needs 2 arguments, got 1: https://jira.example.com/browse/{1}-{2}" });
  assert.match((await app.run('alias bad https://x.com/a b'))[0], /^# Added bad  alias/); // a base URL may have spaces too
  assert.match((await app.run('alias bad2 https://{1}.x.com/'))[0], /after the host/);
  assert.equal((await app.run('alias edit2 x'))[0].startsWith('err:'), true);

  // alias edit <name>: the whole definition in the prompt, quoted where needed, plus editable fields.
  const ed = await app.run('alias edit mobile');
  assert.equal(ed[0], '# Editing mobile');
  assert.equal(app.ctx.inputSet, 'alias set mobile https://jira.example.net/ \'https://jira.example.net/issues/?jql=project="UBMVC" AND "Migrated From Bugzilla Id" ~ "{}"\' --force');
  assert.equal((await app.run(app.ctx.inputSet))[0], '# Updated mobile  engine'); // reads back unchanged
  assert.equal(st().aliases.entries.find((e) => e.name === 'mobile').template, mobile.template);
  // Field edits; a rename keeps the default engine pointing at it.
  await app.run('alias edit g.name google');
  assert.equal(st().aliases.defaultEngine, 'google');
  assert.equal((await app.run('alias edit google.template none'))[0], "err: 'google' is the default engine and needs a template");
  assert.equal((await app.run('alias edit ddg.name google'))[0], "err: alias 'google' already exists");
  assert.match((await app.run('alias edit ddg.name t'))[0], /built-in/);
  assert.match((await app.run('alias edit ddg.base javascript:alert(1)'))[0], /http/);
  await app.run('alias edit ddg.template https://duckduckgo.com/?q=%s&ia=web');
  assert.equal(st().aliases.entries.find((e) => e.name === 'ddg').template, 'https://duckduckgo.com/?q={}&ia=web');
  const shown = await app.run('alias show ddg');
  assert.ok(shown.includes('template: https://duckduckgo.com/?q={}&ia=web  [alias edit ddg.template = https://duckduckgo.com/?q={}&ia=web]'));
});

test('import reads an xsearch export as search engines', () => {
  const current = {};
  for (const k of Object.keys(DEFAULTS)) current[k] = DEFAULTS[k](() => new Date(MON));
  const r = merge(current, {
    mobile: 'https:\/\/jira.example.net\/issues\/?jql=project="UBMVC" AND "Migrated From Bugzilla Id" ~ "%s"',
    Wiki: 'https://en.wikipedia.org/w/index.php?search=%s',
    'two words': 'https://x.com/?q=%s',
    home: 'https://example.com/',
  }, isBuiltin, () => new Date(MON));
  const names = r.collections.aliases.entries.map((e) => e.name);
  assert.deepEqual(names, ['g', 'ddg', 'mobile', 'wiki', 'home']);
  assert.equal(r.collections.aliases.entries[2].template, 'https://jira.example.net/issues/?jql=project="UBMVC" AND "Migrated From Bugzilla Id" ~ "{}"');
  assert.equal(r.collections.aliases.entries[4].template, undefined);
  assert.equal(r.counts.aliases, 3);
  assert.match(r.lines[0], /xsearch export: 4 search engines/);
  assert.ok(r.lines.some((l) => /skipped alias 'two words'/.test(l)));
  assert.throws(() => merge(current, { a: 1 }, isBuiltin, () => new Date(MON)), /not a control-center export/);
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
  // A lone template defines an engine; its base is the site root. `%s` works like `{}`.
  assert.equal((await app.run('alias yt https://www.youtube.com/results?search_query={}'))[0], '# Added yt  engine');
  assert.deepEqual(app.data.state.aliases.entries.find((e) => e.name === 'yt'),
    { name: 'yt', base: 'https://www.youtube.com/', template: 'https://www.youtube.com/results?search_query={}', escape: 'query' });
  await app.run('alias w https://en.wikipedia.org/w/index.php?search=%s');
  assert.equal(app.data.state.aliases.entries.find((e) => e.name === 'w').template, 'https://en.wikipedia.org/w/index.php?search={}');
  assert.match((await app.run('alias bad https://x.com{}'))[0], /after the host/);
  await app.run('alias rm yt');
  await app.run('alias rm w');
  const ls = await app.run('alias ls');
  assert.equal(ls[0], '# 3 aliases · 2 engines');
  assert.ok(ls.some((l) => /^ddg \| engine \| .* \| ★ default$/.test(l)));
});

test('tools commands', async () => {
  const app = await makeApp();
  assert.deepEqual(await app.run('calc 2*(3+4)'), ['# 2*(3+4) = 14']);
  assert.equal((await app.run('calc 2*(3+4)')).copied, '14'); // for the copy button
  assert.equal((await app.run('units 5 km to mi')).copied, '3.106855961');
  assert.equal((await app.run('b64 enc hi')).copied, 'aGk=');
  assert.equal((await app.run('epoch 0')).copied, '0');
  assert.deepEqual(await app.run('calc 1/0'), ['err: division by zero']);
  assert.deepEqual(await app.run('b64 enc hi there'), ['= aGkgdGhlcmU=']);
  const j = await app.run('json {"a":1}');
  assert.deepEqual(j, ['# Valid JSON · 1 key (object)', '{', '  "a": 1', '}']);
  assert.deepEqual(await app.run('units 5 km to mi'), ['# 5 km = 3.106855961 mi']);
  assert.equal((await app.run('epoch 0'))[0], '# 0 seconds');
  const z = () => app.data.state.settings;
  assert.deepEqual(await app.run('tz add europe/london'), ['# Added Europe/London']);
  const tz = await app.run('tz 14:30');
  assert.match(tz[0], /^# 14:30 local · overlap/);
  assert.equal(tz[1], '| name | time |  | utc | zone | ');
  assert.deepEqual(await app.run('tz rm EUROPE/london'), ['# Removed Europe/London']);
  // Custom names: on add, later with `tz name`, cleared with no name, dropped on rm.
  assert.deepEqual(await app.run('tz add nairobi Kenji in Nairobi'), ['# Added Africa/Nairobi as Kenji in Nairobi']);
  assert.deepEqual(z().zoneNames, { 'Africa/Nairobi': 'Kenji in Nairobi' });
  assert.ok((await app.run('tz')).some((l) => /^Kenji in Nairobi \| \d\d:\d\d \| .* \| Africa\/Nairobi \|/.test(l)));
  assert.deepEqual(await app.run('tz name Africa/Nairobi Kenji'), ['# Named Africa/Nairobi as Kenji']);
  assert.deepEqual(await app.run('tz add nairobi Nairobi team'), ['# Named Africa/Nairobi as Nairobi team']);
  assert.deepEqual(await app.run('tz name nairobi "Kenji\'s team"'), ['# Named Africa/Nairobi as Kenji\'s team']);
  assert.deepEqual(await app.run('tz name nairobi'), ['# Cleared the name of Africa/Nairobi']);
  assert.deepEqual(z().zoneNames, {});
  await app.run('tz add America/New_York NYC');
  assert.deepEqual(await app.run('tz rm nyc'), ['# Removed America/New_York']);
  assert.deepEqual(z().zoneNames, {});
  assert.equal((await app.run('tz name paris Bob'))[0], "err: 'paris' is not in your list");
  assert.equal((await app.run('tz add Atlantis'))[0], "err: Unknown time zone 'Atlantis'");
  assert.match((await app.run('tz add nairobi ' + 'x'.repeat(33)))[0], /too long/);
  // tz HH:MM <zone>: a time in another zone, listed or not, by city or name.
  await app.run('tz add Pacific/Marquesas Kenji');
  const conv = await app.run('tz 09:00 Pacific/Chatham');
  const chathamRow = conv.find((l) => l.startsWith('Chatham | '));
  assert.match(chathamRow, /^Chatham \| 09:00 \| /);
  assert.match(conv[0], /^# 09:00 Chatham( \w{3} \d+ \w{3})? = \d\d:\d\d local/);
  // ...and the local time is right: 09:00 on Chatham's own today.
  const [cy, cm, cd] = Z.partsIn(MON, 'Pacific/Chatham').date.split('-').map(Number);
  const inst = Z.zonedToDate(cy, cm, cd, 9, 0, 0, 'Pacific/Chatham');
  assert.ok(conv[0].includes('= ' + U.pad2(inst.getHours()) + ':' + U.pad2(inst.getMinutes()) + ' local'), conv[0]);
  assert.match((await app.run('tz 23:30 kenji'))[0], /^# 23:30 Kenji( \w{3} \d+ \w{3})? = \d\d:\d\d local/);
  assert.ok(!app.data.state.settings.zones.includes('Pacific/Chatham')); // shown, not added
  assert.equal((await app.run('tz 09:00 atlantis'))[0], "err: Unknown time zone 'atlantis'");
  await app.run('tz rm kenji');
  // tz ls lists every zone the browser knows, filterable; listed ones are marked.
  const all = await app.run('tz ls');
  assert.match(all[0], /^# \d{3} time zones · earliest first$/);
  const asia = await app.run('tz ls africa/nai');
  assert.equal(asia[0], '# 1 time zone matching "africa/nai"');
  assert.match(asia[2], /^Africa\/Nairobi \| \d\d:\d\d \| .* \| \+03:00 \| ● listed$/);
  assert.equal((await app.run('tz ls zzz'))[0], '# No time zones match "zzz"');
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
  const ws = () => app.data.state.settings.widgets;
  assert.deepEqual(ws(), ['agenda', 'tasks', 'zones', 'calendar']); // turned on -> bottom
  // Reordering from the command line.
  assert.deepEqual(await app.run('widgets move zones top'), ['# Moved zones to 1', 'dim: Order: 1. zones  2. agenda  3. tasks  4. calendar']);
  await app.run('widgets move agenda down');
  assert.deepEqual(ws(), ['zones', 'tasks', 'agenda', 'calendar']);
  await app.run('widgets move calendar 2');
  assert.deepEqual(ws(), ['zones', 'calendar', 'tasks', 'agenda']);
  await app.run('widgets move zones bottom');
  assert.deepEqual(ws(), ['calendar', 'tasks', 'agenda', 'zones']);
  assert.equal((await app.run('widgets move calendar up'))[0], '# calendar is already first');
  assert.equal((await app.run('widgets move clock top'))[0], 'err: clock is off');
  assert.equal((await app.run('widgets move bogus top'))[0], "err: No widget 'bogus'");
  await app.run('widgets order clock agenda');
  assert.deepEqual(ws(), ['clock', 'agenda', 'calendar', 'tasks', 'zones']); // named first, clock turned on
  assert.equal((await app.run('widgets order clock clock'))[0], 'err: Each widget can be named once');
  const listed = await app.run('widgets');
  assert.deepEqual(listed.slice(1, 3), ['1 | ● | clock | time and date', '2 | ● | agenda | overdue tasks, events and due tasks for the week']);
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
  await a.run('tz add Pacific/Chatham'); // a zone no test machine runs in
  await a.run('tz add Africa/Nairobi Kenji');
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
  assert.deepEqual(s.settings.zones, ['Pacific/Chatham', 'Africa/Nairobi']);
  assert.deepEqual(s.settings.zoneNames, { 'Africa/Nairobi': 'Kenji' });
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
