import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import * as U from '../js/core/util.js';
import * as A from '../js/core/aliases.js';
import { dispatch } from '../js/core/dispatch.js';
import { edit, actionFor, historySearch } from '../js/core/lineedit.js';
import { tokenize, oneValue, quote } from '../js/core/args.js';
import * as K from '../js/core/keys.js';
import { loadDevice, defaultDeviceName, detectBrowser } from '../js/core/device.js';
import * as R from '../js/core/repeat.js';
import * as S from '../js/core/search.js';
import * as Sum from '../js/core/summary.js';
import * as Merge from '../js/core/merge.js';
import * as Log from '../js/core/log.js';
import * as P from '../js/core/paste.js';
import { createSync } from '../js/sync.js';
import * as Sync from '../js/sync.js';
import { fakeGitHub } from './fake-github.mjs';
import * as C from '../js/core/completion.js';
import { createLocalStore } from '../js/core/store.js';
import { createData, DEFAULTS } from '../js/core/data.js';
import { merge } from '../js/core/importer.js';
import { jsonLines, dueSeg, dayLabel } from '../js/core/format.js';
import * as F from '../js/core/format.js';
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
  // Any start of a day name, two letters on; any start of a month name, three on.
  for (const w of ['fr', 'fri', 'frid', 'friday', 'FRIDAY', 'Fri.']) assert.equal(U.parseDate(w, MON), '2026-10-09', w);
  assert.equal(U.parseDate('th', MON), '2026-10-08');
  assert.equal(U.parseDate('tu', MON), '2026-10-06');
  assert.equal(U.parseDate('t', MON), null); // tuesday or thursday?
  assert.equal(U.parseDate('s', MON), null);
  assert.equal(U.parseDate('next friday', MON), '2026-10-16');
  assert.equal(U.parseDate('12 oct', MON), '2026-10-12');
  assert.equal(U.parseDate('Oct 12', MON), '2026-10-12');
  assert.equal(U.parseDate('october 3', MON), '2027-10-03'); // passed this year: the next one
  assert.equal(U.parseDate('3 October 2027', MON), '2027-10-03');
  assert.equal(U.parseDate('31 feb', MON), null);
  assert.equal(U.parseDate('ju 3', MON), null); // june or july?
  assert.equal(U.parseDate('in 3 days', MON), '2026-10-08');
  assert.equal(U.parseDate('in 2 weeks', MON), '2026-10-19');
  assert.equal(U.parseDate('in 1 month', MON), '2026-11-05');
  assert.equal(U.parseDate('tmr', MON), '2026-10-06');
  assert.equal(U.parseDate('yesterday', MON), '2026-10-04');
  assert.deepEqual(U.leadingDate(['next', 'friday', 'lunch'], MON), { date: '2026-10-16', used: 2 });
  assert.deepEqual(U.leadingDate(['fri', '3', 'friends'], MON), { date: '2026-10-09', used: 1 });
  // Shown in full, always.
  assert.equal(F.longDate('2026-10-09', '2026-10-05'), 'Friday 9 October');
  assert.equal(F.longDate('2027-01-01', '2026-10-05'), 'Friday 1 January 2027');
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
  assert.deepEqual(dueSeg('2026-10-08', '2026-10-05'), ['Thursday 8 October', 'date']);
  assert.equal(dayLabel('2027-01-02', '2026-10-05'), 'Saturday 2 January 2027');
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

test('keys: OS detection and labels', () => {
  assert.equal(K.detectOS({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }), 'mac');
  assert.equal(K.detectOS({ platform: 'MacIntel', maxTouchPoints: 5, userAgent: 'Macintosh' }), 'ios'); // iPadOS
  assert.equal(K.detectOS({ platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }), 'ios');
  assert.equal(K.detectOS({ userAgentData: { platform: 'Windows' }, platform: 'Win32' }), 'windows');
  assert.equal(K.detectOS({ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 14)' }), 'android');
  assert.equal(K.detectOS({ platform: 'Linux x86_64', userAgent: 'X11; Linux x86_64' }), 'linux');
  assert.equal(K.detectOS({}), 'other');
  assert.equal(K.keyLabel('ctrl+r', 'mac'), '⌃R');
  assert.equal(K.keyLabel('alt+backspace', 'mac'), '⌥⌫');
  assert.equal(K.keyLabel('ctrl+r', 'windows'), 'Ctrl+R');
  assert.equal(K.keyLabel('alt+backspace', 'linux'), 'Alt+Backspace');
  assert.equal(K.keyLabel('/', 'mac'), '/');
  assert.equal(K.keyLabel('esc', 'windows'), 'Esc');
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
  assert.deepEqual(late.map((r) => [r.zone, r.date]), [['Pacific/Honolulu', ''], ['UTC', ''], ['Asia/Tokyo', 'Friday 16 January']]);
  const early = Z.zoneRows(new Date(Date.UTC(2026, 0, 15, 3)), ['Asia/Tokyo', 'America/New_York']);
  assert.deepEqual(early.map((r) => [r.zone, r.date]), [['America/New_York', 'Wednesday 14 January'], ['Asia/Tokyo', '']]);
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
    qr: (text, ecl) => lines.push('QR ' + ecl + ' ' + text),
    swatch: (items) => lines.push('SWATCH ' + items.map((i) => i.color + (i.text ? ' ' + i.text.value + ' ' + i.text.color : '') + (i.label ? ' ' + i.label : '')).join(' | ')),
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
    device: loadDevice(store, { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36' }),
    setDeviceName(name) { base.device.name = name; store.setLocal('device', base.device); },
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
  assert.deepEqual(await app.run('notes add second note'), ['# Added note n2']);
  assert.equal(app.data.state.notes.items[0].text, 'buy  oat milk');
  const list = await app.run('notes');
  assert.deepEqual(list.slice(0, 3), ['# 2 notes', '| id | date | note', 'n2 | today | second note']);
  assert.deepEqual(await app.run('n'), list); // the short name alone lists, like the noun
  assert.deepEqual((await app.run('notes oat')).slice(0, 1), ['# 1 note matching "oat"']);
  // The older prompt-edit form still saves.
  assert.match((await app.run('n edit n1: buy almond milk'))[0], /^# Updated notes n1 text/);
  assert.equal(app.data.state.notes.items[0].text, 'buy almond milk');
  // Words that only look like commands are note text.
  assert.deepEqual(await app.run('n edit 2 slides before friday'), ['# Added note n3']);
  assert.equal(app.data.state.notes.items.find((n) => n.id === 'n2').text, 'second note');
  assert.deepEqual(await app.run('n rm the weeds'), ['# Added note n4']);
  assert.deepEqual(await app.run('n n1 has a typo in it'), ['# Added note n5']); // an id, but no action after it
  const rm = await app.run('notes n2 rm');
  assert.deepEqual(rm, ['# Removed note n2', 'second note', '↶ undo brings it back']);
  assert.equal(rm.tone, 'ok');
  const missing = await app.run('notes n99 rm');
  assert.deepEqual(missing, ['err: No note n99']);
  assert.equal(missing.tone, 'err');
  assert.match((await app.run('n edit n1:'))[0], /needs some text/);
});

test('one grammar: <things> | <things> add | <things> <id> | <id> edit [field [value]] | <id> rm', async () => {
  const app = await makeApp();
  const st = () => app.data.state;
  await app.run('notes add first draft');
  // Field by name, value as typed; `name` is accepted for a note's text.
  const up = await app.run('notes n1 edit name buy  oat milk');
  assert.equal(up[0], '# Updated notes n1 text');
  assert.ok(up.includes('text: buy  oat milk  [notes n1 edit text = buy  oat milk]'));
  assert.equal(up.tone, 'ok');
  assert.equal(st().notes.items[0].text, 'buy  oat milk');
  await app.run('notes n1 edit text "  padded  "');
  assert.equal(st().notes.items[0].text, 'padded'); // one quoted argument: quotes off; text is trimmed
  assert.equal((await app.run('notes n1 edit colour red'))[0], 'err: Notes have no field colour');
  assert.equal((await app.run('notes n9'))[0], 'err: No note n9');
  assert.equal((await app.run('notes n1 edit text ""'))[0], 'err: text needs some text');
  assert.equal((await app.run('notes n1 frobnicate'))[0], 'err: notes n1: no action frobnicate');
  // edit <field> with no value: the command and the current value go into the prompt.
  await app.run('notes n1 edit text');
  assert.equal(app.ctx.inputSet, 'notes n1 edit text padded');
  assert.equal((await app.run('notes 1'))[0], '# note n1'); // the noun also takes a bare number

  await app.run('tasks add buy flour due:tomorrow #home');
  const show = await app.run('tasks t1');
  assert.deepEqual(show.slice(0, 6), ['# task t1', 'text: buy flour  [tasks t1 edit text = buy flour]', 'due: tomorrow  [tasks t1 edit due = 2026-10-06]',
    'tags: #home  [tasks t1 edit tags = #home]', 'repeat: none  [tasks t1 edit repeat = none]', 'done: ○ open  [tasks t1 edit done = no]']);
  assert.deepEqual(await app.run('t t1'), show); // the short name is the same command
  // edit alone: edit in place (the same view, a field open, a different heading).
  const editing = await app.run('tasks t1 edit');
  assert.equal(editing[0], '# Editing tasks t1 · tap any value, Enter saves, Esc leaves it');
  assert.deepEqual(editing.slice(1, 6), show.slice(1, 6));
  await app.run('tasks t1 edit due fri');
  assert.equal(st().tasks.items[0].due, '2026-10-09');
  await app.run('tasks t1 edit due none');
  assert.equal(st().tasks.items[0].due, null);
  await app.run('tasks t1 edit tags #Home, errands');
  assert.deepEqual(st().tasks.items[0].tags, ['home', 'errands']);
  await app.run('tasks t1 edit name buy rye flour');
  assert.equal(st().tasks.items[0].text, 'buy rye flour');
  await app.run('tasks t1 done');
  assert.equal(st().tasks.items[0].done, true);
  await app.run('tasks t1 edit done no');
  assert.equal(st().tasks.items[0].doneAt, null);
  assert.match((await app.run('tasks t1 edit due someday'))[0], /^err: due can't read the date 'someday'/);
  assert.match((await app.run('tasks t1 edit tags a+b'))[0], /not a tag/);
  assert.match((await app.run('tasks lunch'))[0], /'lunch' is not a task id, add, all or #tag/);

  await app.run('events add 2026-10-12 09:00 review');
  await app.run('events e1 edit time none');
  assert.equal(st().events.items[0].time, null);
  await app.run('events e1 edit date tomorrow');
  assert.equal(st().events.items[0].date, '2026-10-06');
  await app.run('ev e1 edit title design review');
  assert.equal(st().events.items[0].title, 'design review');
  assert.match((await app.run('events e1 edit time 25:00'))[0], /can't read the time/);
  assert.equal((await app.run('events e1'))[0], '# event e1');
  assert.deepEqual((await app.run('events')).slice(0, 2), ['# 1 upcoming event', '| id | date | time | event']);
  assert.match((await app.run('events e1 rm'))[0], /Removed event e1/);

  // Older forms keep working.
  await app.run('t legacy one');
  const id = st().tasks.items.find((t) => t.text === 'legacy one').id;
  await app.run('t edit ' + id + '.due fri');
  assert.equal(st().tasks.items.find((t) => t.id === id).due, '2026-10-09');
  assert.equal((await app.run('t show ' + id))[0], '# task ' + id);
  await app.run('t done ' + id);
  assert.equal(st().tasks.items.find((t) => t.id === id).done, true);
  await app.run('t rm ' + id.slice(1)); // bare number in the old two-word form
  assert.equal(st().tasks.items.some((t) => t.id === id), false);

  // Lists link each id to its entry, by the noun.
  const linked = await app.run('tasks all');
  assert.ok(linked.some((l) => l.startsWith('t1 | ')));
});

test('undo and redo: per item, across commands, refusing to clobber newer changes', async () => {
  const app = await makeApp();
  const st = () => app.data.state;
  const texts = () => st().tasks.items.map((t) => t.id + ':' + t.text + (t.done ? ':done' : ''));
  await app.run('t one');
  await app.run('t two');
  await app.run('t done t1');
  assert.deepEqual(texts(), ['t1:one:done', 't2:two']);
  assert.deepEqual(await app.run('undo'), ['# Undid t done t1', 'dim: task t1 changed', 'redo puts it back · 2 more steps to undo']);
  assert.deepEqual(texts(), ['t1:one', 't2:two']);
  assert.equal((await app.run('redo'))[0], '# Redid t done t1');
  assert.deepEqual(texts(), ['t1:one:done', 't2:two']);
  await app.run('undo');
  // A removal comes back in place, with its id.
  await app.run('t rm t1');
  assert.deepEqual(texts(), ['t2:two']);
  await app.run('undo');
  assert.deepEqual(texts(), ['t1:one', 't2:two']);
  // A new command clears redo.
  await app.run('t three');
  assert.equal((await app.run('redo'))[0], '# Nothing to redo');
  // Unrelated changes since don't block undo; changes to the same item do.
  await app.run('t edit t2.text second');
  await app.run('n a note'); // different collection
  await app.run('t edit t1.text first'); // a different task
  await app.run('undo'); // undoes t1's edit
  await app.run('undo'); // undoes the note
  assert.deepEqual(st().notes.items, []);
  await app.data.mutate('tasks', (d) => { d.items.find((t) => t.id === 't2').text = 'changed elsewhere'; }); // e.g. another tab
  const c = await app.run('undo');
  assert.equal(c[0], "err: Can't undo 't edit t2.text second': changed since: tasks t2");
  assert.equal(st().tasks.items.find((t) => t.id === 't2').text, 'changed elsewhere');
  await app.run('undo force');
  assert.equal(st().tasks.items.find((t) => t.id === 't2').text, 'two');
  // Settings and aliases too; ids are never reused after an undone add.
  await app.run('theme nord');
  await app.run('undo');
  assert.equal(st().settings.theme, 'auto');
  await app.run('alias rm ddg');
  await app.run('undo');
  assert.ok(st().aliases.entries.some((e) => e.name === 'ddg'));
  await app.run('t four');
  const four = st().tasks.items.find((t) => t.text === 'four').id;
  await app.run('undo');
  await app.run('t five');
  assert.notEqual(st().tasks.items.find((t) => t.text === 'five').id, four);
  // Read-only commands make no steps; ls lists them newest first.
  const before = app.data.steps().undo.length;
  await app.run('tasks');
  await app.run('calc 1+1');
  assert.equal(app.data.steps().undo.length, before);
  const ls = await app.run('undo ls');
  assert.match(ls[0], /^# \d+ steps to undo, newest first$/);
  assert.match(ls[1], /^1 \| t five \| task t\d+ added \| /);
  // Undo steps live on the device, not in the synced/exported data.
  const exported = await app.store.exportAll();
  assert.deepEqual(Object.keys(exported.collections).filter((k) => !['meta', 'aliases', 'notes', 'tasks', 'events', 'settings', 'history'].includes(k)), []);
  assert.ok(app.storage.getItem('cc-device:undo'));
});

test('recurring tasks: rules, next due date, done moves it on', async () => {
  // Rules (pure).
  assert.equal(R.parseRepeat('daily'), 'day');
  assert.equal(R.parseRepeat('Weekdays'), 'weekday');
  assert.equal(R.parseRepeat('1w'), 'week');
  assert.equal(R.parseRepeat('2w'), '2w');
  assert.equal(R.parseRepeat('Thursday, mon'), 'mon,thu');
  assert.equal(R.parseRepeat('0d'), null);
  assert.equal(R.parseRepeat('sometimes'), null);
  // Wednesday 2026-10-07: late or early, the next date is after both due and today.
  assert.equal(R.nextDue('week', '2026-10-05', '2026-10-07'), '2026-10-12'); // weekly Monday, done late: next Monday
  assert.equal(R.nextDue('week', '2026-10-12', '2026-10-07'), '2026-10-19'); // done early: skips the one done
  assert.equal(R.nextDue('day', '2026-10-05', '2026-10-07'), '2026-10-08');
  assert.equal(R.nextDue('mon,thu', '2026-10-05', '2026-10-07'), '2026-10-08');
  assert.equal(R.nextDue('weekday', '2026-10-09', '2026-10-09'), '2026-10-12'); // Friday -> Monday
  assert.equal(R.nextDue('month', '2026-01-31', '2026-01-31'), '2026-02-28'); // short month
  assert.equal(R.nextDue('2w', '2026-10-05', '2026-10-05'), '2026-10-19');
  assert.equal(R.firstDue('mon', '2026-10-07'), '2026-10-12');
  assert.equal(R.repeatLabel('mon,thu'), 'every Monday, Thursday');

  // Commands (today is Monday 2026-10-05).
  const app = await makeApp();
  const task = (id) => app.data.state.tasks.items.find((t) => t.id === id);
  assert.deepEqual(await app.run('t water the plants every:mon,thu #home'), ['# Added task t1', 'water the plants  due today  ↻ every Monday, Thursday  #home']);
  assert.equal(task('t1').due, '2026-10-05');
  assert.deepEqual(await app.run('t done t1'), ['# Completed t1 · next Thursday 8 October', 'water the plants  ↻ every Monday, Thursday']);
  assert.deepEqual([task('t1').done, task('t1').due, task('t1').doneCount], [false, '2026-10-08', 1]);
  await app.run('undo');
  assert.equal(task('t1').due, '2026-10-05');
  assert.match((await app.run('t x every:sometimes'))[0], /Can't read the repeat 'sometimes'/);
  await app.run('t pay rent every:month due:2026-11-01');
  assert.deepEqual([task('t2').repeat, task('t2').due], ['month', '2026-11-01']);
  // Editable like any field; none makes it a plain task again.
  await app.run('t edit t2.repeat 2w');
  assert.equal(task('t2').repeat, '2w');
  await app.run('t edit t2.repeat none');
  assert.equal(task('t2').repeat, undefined);
  await app.run('t done t2');
  assert.equal(task('t2').done, true);
  assert.ok((await app.run('tasks')).some((l) => l.includes('water the plants  ↻ every Monday, Thursday')));
});

test('search: matching, ranking, regex, categories, highlighting', async () => {
  // Term matching: whole word > word start > inside a word > fuzzy.
  assert.equal(S.matchTerm('milk', 'oat milk').score, 100);
  assert.equal(S.matchTerm('mil', 'oat milk').score, 70);
  assert.equal(S.matchTerm('ilk', 'oat milk').score, 50);
  const f = S.matchTerm('pmt', 'pay the payment');
  assert.ok(f && f.score < 50 && f.score > 0);
  assert.deepEqual(f.ranges, [[8, 9], [11, 12], [14, 15]]); // p..m..t in "payment", the tightest run
  assert.equal(S.matchTerm('pmt', 'p and much later t'), null); // too spread out
  assert.equal(S.matchTerm('zz', 'pizza').score, 50); // substrings match at any length
  assert.equal(S.matchTerm('xq', 'a quick fox'), null); // no fuzzy for 2 letters
  assert.match(S.parseRegex('/a(/'), /^not a valid regular expression: /);
  assert.equal(S.parseRegex('plain words'), null);
  assert.equal(S.parseRegex('/^buy/').flags, 'i');
  assert.equal(S.parseRegex('/^Buy/s').flags, 's'); // given flags are kept (case-sensitive here)
  assert.deepEqual(S.highlight('buy oat milk', [[4, 7], [8, 12], [6, 9]]), [['buy ', ''], ['oat milk', 'hl']]);

  const app = await makeApp();
  await app.run('t buy oat milk due:tomorrow #shop');
  await app.run('t pay the payment for milk delivery');
  await app.run('n milkshake recipe: banana, oat milk');
  await app.run('n the payment portal password is in the vault');
  await app.run('ev fri 09:00 milk run with Sam');
  await app.run('alias milkman https://milk.example.com/');
  await app.run('t done t2');
  await app.data.addHistory('t buy oat milk due:tomorrow #shop'); // the page records what was typed
  const docs = () => S.documents(app.data.state, app.commands.defs, app.commands.isBuiltin);
  const titles = (r, cat) => r.groups.find((g) => g.category === cat).results.map((x) => x.doc.key);

  const milk = S.search('milk', docs());
  // Exact word beats prefix: t1 "oat milk" before the done t2; groups ordered by their best hit.
  assert.deepEqual(titles(milk, 'tasks'), ['t1', 't2']);
  assert.deepEqual(titles(milk, 'notes'), ['n1']);
  assert.ok(milk.groups.some((g) => g.category === 'links'));
  assert.ok(milk.groups.some((g) => g.category === 'history')); // 't buy oat milk …' was typed
  // Every word must match, anywhere in the item.
  assert.deepEqual(S.search('oat shop', docs()).groups.map((g) => g.category), ['tasks', 'history']);
  assert.deepEqual(titles(S.search('"oat milk"', docs()), 'notes'), ['n1']);
  // Fuzzy finds what a substring wouldn't.
  assert.ok(titles(S.search('pmnt', docs()), 'notes').includes('n2'));
  // Regex, and a category filter.
  assert.deepEqual(titles(S.search('/^buy\\s/', docs()), 'tasks'), ['t1']);
  const onlyNotes = S.search('milk in:notes', docs());
  assert.deepEqual(onlyNotes.groups.map((g) => g.category), ['notes']);
  assert.match(S.search('x in:stuff', docs()).error, /unknown category 'stuff'/);
  assert.match(S.search('/(/', docs()).error, /not a valid regular expression/);
  assert.deepEqual(S.search('zzzz', docs()).groups, []);

  // The command.
  const out = await app.run('find milk');
  assert.match(out[0], /^# \d+ results for “milk” · \d groups, best first$/);
  assert.ok(out.includes('## Tasks 2'));
  assert.ok(out.includes("t1 | buy oat milk  #shop | tomorrow"));
  assert.ok(out.includes("milkman | your alias  https://milk.example.com/ | "));
  assert.ok(out.includes('## Your aliases and engines 1'));
  assert.equal((await app.run('find nothing-here'))[0], '# Nothing matches “nothing-here”');
  assert.equal((await app.run('find /(/'))[0].startsWith('err: not a valid regular expression'), true);
  assert.match((await app.run('find /oat/'))[0], /regular expression/);
});

test('daily summary: today, dismiss for the day (a synced setting), pin, off', async () => {
  const app = await makeApp(); // Monday 2026-10-05
  await app.run('t file the report due:2026-10-01');
  await app.run('t pay rent due:today');
  await app.run('ev today 10:30 design review');
  await app.run('ev tomorrow 09:00 dentist');
  const out = await app.run('today');
  assert.deepEqual(out, ['# Today · Monday 5 October · 1 overdue · 1 event · 1 due',
    'Thursday 1 October  t1  file the report', '10:30  e1  design review', 'due today  t2  pay rent', 'Tomorrow: 1 event']);
  assert.equal(out.tone, 'warn');
  const st = () => app.data.state.settings;
  assert.equal(Sum.summaryVisible(st(), '2026-10-05'), true);
  assert.match((await app.run('today dismiss'))[0], /dismissed for today, on every device/);
  assert.equal(st().summaryDismissed, '2026-10-05');
  assert.equal(Sum.summaryVisible(st(), '2026-10-05'), false);
  assert.equal(Sum.summaryVisible(st(), '2026-10-06'), true); // back the next day
  await app.run('undo');
  assert.equal(Sum.summaryVisible(st(), '2026-10-05'), true);
  await app.run('today off');
  assert.equal(Sum.summaryVisible(st(), '2026-10-06'), false);
  await app.run('today on');
  assert.equal(Sum.summaryVisible(st(), '2026-10-06'), true);
  const empty = await makeApp();
  assert.deepEqual(await empty.run('today'), ['# Today · Monday 5 October', 'Nothing overdue, due or scheduled today', 'Tomorrow is clear']);
});

test('merge: three-way, per item and per setting', () => {
  const docs = (o) => ({
    meta: { schema: 1, created: '2026-01-01T00:00:00.000Z', lastExport: null, counters: { t: o.t || 0, n: 0, e: 0 } },
    aliases: { entries: o.aliases || [{ name: 'g', base: 'https://g.com/', template: 'https://g.com/?q={}', escape: 'query' }], defaultEngine: 'g' },
    notes: { items: [] }, events: { items: [] },
    tasks: { items: o.tasks || [] },
    settings: { zones: o.zones || [], zoneNames: {}, theme: o.theme || 'auto', widgets: ['clock'], panel: true, summary: 'on', summaryDismissed: o.dismissed || null },
  });
  const t = (id, text, extra) => ({ id, text, due: null, tags: [], done: false, created: 'x', doneAt: null, ...extra });
  const base = docs({ t: 2, tasks: [t('t1', 'one'), t('t2', 'two')], zones: ['Asia/Tokyo'] });
  // Device A edits t1 and adds t3; the repo (device B) edits t2, adds its own t3, and a zone.
  const local = docs({ t: 3, tasks: [t('t1', 'one!'), t('t2', 'two'), t('t3', 'mine')], zones: ['Asia/Tokyo'], theme: 'nord' });
  const remote = docs({ t: 3, tasks: [t('t1', 'one'), t('t2', 'two?'), t('t3', 'theirs')], zones: ['Asia/Tokyo', 'Europe/Paris'], dismissed: '2026-10-05' });
  const m = Merge.merge3(base, local, remote);
  const tasks = m.collections.tasks.items.map((x) => x.id + ':' + x.text);
  assert.deepEqual(tasks, ['t1:one!', 't2:two?', 't3:theirs', 't4:mine']); // both edits kept; local t3 renumbered
  assert.deepEqual(m.renumbered, [{ from: 't3', to: 't4' }]);
  assert.equal(m.collections.meta.counters.t, 4);
  assert.deepEqual(m.collections.settings.zones, ['Asia/Tokyo', 'Europe/Paris']);
  assert.equal(m.collections.settings.theme, 'nord');
  assert.equal(m.collections.settings.summaryDismissed, '2026-10-05'); // dismissed elsewhere: dismissed here
  assert.deepEqual(m.conflicts, []);
  // Same item changed on both sides: this device's version, reported.
  const c = Merge.merge3(base, docs({ t: 2, tasks: [t('t1', 'A'), t('t2', 'two')] }), docs({ t: 2, tasks: [t('t1', 'B'), t('t2', 'two')] }));
  assert.equal(c.collections.tasks.items[0].text, 'A');
  assert.deepEqual(c.conflicts, ['t1']);
  // Deleted on one side, untouched on the other: deleted. Deleted vs changed: kept.
  const d = Merge.merge3(base, docs({ t: 2, tasks: [t('t2', 'two')] }), docs({ t: 2, tasks: [t('t1', 'one'), t('t2', 'two changed')] }));
  assert.deepEqual(d.collections.tasks.items.map((x) => x.text), ['two changed']);
  const e = Merge.merge3(base, docs({ t: 2, tasks: [t('t2', 'two')] }), docs({ t: 2, tasks: [t('t1', 'one edited'), t('t2', 'two')] }));
  assert.deepEqual(e.collections.tasks.items.map((x) => x.text), ['one edited', 'two']);
  // First sync (no base): union of items, settings from the repo.
  const f = Merge.merge3(null, docs({ t: 1, tasks: [t('t1', 'phone task')], theme: 'nord' }), docs({ t: 1, tasks: [t('t1', 'laptop task')], theme: 'dracula' }));
  assert.deepEqual(f.collections.tasks.items.map((x) => x.id + ':' + x.text), ['t1:laptop task', 't2:phone task']);
  assert.equal(f.collections.settings.theme, 'dracula');
  // No remote yet: local as is. Key order never matters.
  assert.ok(Merge.sameData(Merge.merge3(null, local, null).collections, local));
  assert.ok(Merge.sameDoc({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }));
});

test('sync: setup, two devices, conflicts, races, expired tokens', async () => {
  const gh = fakeGitHub({ tokens: ['tok-a', 'tok-b'], repos: { 'me/data': { private: true }, 'me/open': { private: false }, 'me/ro': { push: false } } });
  const device = async () => {
    const app = await makeApp();
    const sync = createSync({ data: app.data, store: app.store, now: () => new Date(MON), fetch: gh.fetch, device: 'test' });
    return { app, sync };
  };
  const A = await device();
  // Refusals: bad repo name, public repo, read-only token, unknown repo, bad token.
  await assert.rejects(A.sync.setup('nope', null, 'tok-a'), /not owner\/repository/);
  await assert.rejects(A.sync.setup('me/open', null, 'tok-a'), /is public/);
  await assert.rejects(A.sync.setup('me/ro', null, 'tok-a'), /not write/);
  await assert.rejects(A.sync.setup('me/none', null, 'tok-a'), /not found/);
  await assert.rejects(A.sync.setup('me/data', null, 'wrong'), (e) => e.kind === 'auth');
  assert.equal(A.app.store.getLocal('sync-token'), null); // nothing kept from a failed setup

  await A.app.run('t from laptop');
  await A.app.run('alias gh https://github.com/ https://github.com/{} --path');
  const first = await A.sync.setup('me/data', null, 'tok-a');
  assert.equal(first.pushed, true);
  assert.equal(gh.file('me/data').collections.tasks.items[0].text, 'from laptop');
  assert.equal(gh.file('me/data').collections.history, undefined); // history stays on the device
  assert.equal(A.sync.status.state, 'ok');
  // The token lives on the device only: not in exports, not in the repo.
  assert.equal(A.app.store.getLocal('sync-token'), 'tok-a');
  assert.ok(!JSON.stringify(await A.app.store.exportAll()).includes('tok-a'));
  assert.ok(!JSON.stringify(gh.state.repos).includes('tok-a'));

  // A second device with its own task joins: it gets everything, and the repo gets its task.
  const B = await device();
  await B.app.run('t from phone');
  await B.sync.setup('me/data', null, 'tok-b');
  const texts = (app) => app.data.state.tasks.items.map((t) => t.id + ':' + t.text);
  assert.deepEqual(texts(B.app), ['t1:from laptop', 't2:from phone']); // renumbered, nothing lost
  assert.ok(B.app.data.state.aliases.entries.some((e) => e.name === 'gh'));
  await A.sync.syncNow();
  assert.deepEqual(texts(A.app), ['t1:from laptop', 't2:from phone']);

  // Edits on both, different items: both kept. A quiet sync pushes nothing.
  await A.app.run('t edit t1.text laptop edit');
  await B.app.run('t done t2');
  await B.app.run('today dismiss');
  await A.sync.syncNow();
  await B.sync.syncNow();
  await A.sync.syncNow();
  for (const d of [A, B]) {
    assert.deepEqual(d.app.data.state.tasks.items.map((t) => [t.text, t.done]), [['laptop edit', false], ['from phone', true]]);
    assert.equal(d.app.data.state.settings.summaryDismissed, '2026-10-05');
  }
  const puts = () => gh.state.requests.filter((r) => r.startsWith('PUT')).length;
  const before = puts();
  const quiet = await A.sync.syncNow();
  assert.equal(puts(), before);
  assert.deepEqual([quiet.pulled, quiet.pushed], [false, false]);
  // Undo still works after a sync touched other items.
  await A.app.run('n note on laptop');
  await A.sync.syncNow();
  await B.sync.syncNow();
  await B.app.run('undo'); // B's last step: today dismiss
  assert.equal(B.app.data.state.settings.summaryDismissed, null);

  // Two tabs on one device: the second tab's sync uses the first's record of
  // the last sync, so a third device's edit isn't mistaken for a conflict.
  const A2 = createSync({ data: A.app.data, store: A.app.store, now: () => new Date(MON), fetch: gh.fetch, device: 'tab 2' });
  await A.app.run('t two tabs');
  await A.sync.syncNow(); // tab 1 syncs
  const id = A.app.data.state.tasks.items.find((t) => t.text === 'two tabs').id;
  await B.sync.syncNow();
  await B.app.run('t edit ' + id + '.text edited on the phone');
  await B.sync.syncNow();
  await A2.syncNow(); // tab 2, created before tab 1's sync
  assert.equal(A.app.data.state.tasks.items.find((t) => t.id === id).text, 'edited on the phone');
  assert.deepEqual(A2.status.conflicts, []);
  assert.deepEqual(A2.status.renumbered, []); // no duplicate of the old version either
  assert.equal(A.app.data.state.tasks.items.filter((t) => /two tabs|edited on the phone/.test(t.text)).length, 1);

  // Another device pushes between our read and our write: start over, nothing lost.
  await A.app.run('t race');
  gh.state.failNextPut = 1;
  await A.sync.syncNow();
  assert.ok(gh.file('me/data').collections.tasks.items.some((t) => t.text === 'race'));

  // Token revoked: sync stops and says so; a new token resumes it.
  gh.revoke('tok-a');
  await assert.rejects(A.sync.syncNow(), (e) => e.kind === 'auth');
  assert.equal(A.sync.status.state, 'auth');
  gh.allow('tok-a2');
  await A.sync.setToken('tok-a2');
  assert.equal(A.sync.status.state, 'ok');
  assert.equal(A.app.store.getLocal('sync-token'), 'tok-a2');
  // Off: forgets the token and settings, keeps the data.
  A.sync.off();
  assert.equal(A.app.store.getLocal('sync-token'), null);
  assert.equal(A.sync.status.state, 'off');
  assert.ok(A.app.data.state.tasks.items.length >= 3);
});

test('sync in a shared repository: its own directory only, never other files', async () => {
  const gh = fakeGitHub({ tokens: ['tok'], repos: { 'me/shared': { private: true } } });
  const others = {
    'README.md': '# my private stuff\n',
    'notes/journal.md': 'dear diary',
    'other-app/data.json': '{"app":"something-else","collections":{"tasks":{"items":[]}}}', // looks a lot like ours
    'data.json': '{"mine":"not the hub"}',
  };
  for (const [p, t] of Object.entries(others)) gh.seed('me/shared', p, t);
  const device = async () => {
    const app = await makeApp();
    return { app, sync: createSync({ data: app.data, store: app.store, now: () => new Date(MON), fetch: gh.fetch, device: 'test' }) };
  };
  const A = await device();
  await A.app.run('t from the hub');
  await A.sync.setup('me/shared', undefined, 'tok');
  assert.equal(A.sync.config.path, 'browser-hub/data.json'); // the default directory
  assert.equal(gh.file('me/shared').collections.tasks.items[0].text, 'from the hub');
  for (const [p, t] of Object.entries(others)) assert.equal(gh.raw('me/shared', p), t, p); // untouched
  const touched = gh.state.requests.filter((r) => r.includes('/contents/')).map((r) => r.replace(/^\w+ /, ''));
  assert.deepEqual([...new Set(touched)], ['/repos/me/shared/contents/browser-hub/data.json']);
  assert.ok(gh.state.requests.every((r) => !r.startsWith('PUT') || r.endsWith('/browser-hub/data.json')));

  // A directory of your choice; a second device finds it there.
  const B = await device();
  await B.sync.setup('me/shared', 'apps/hub/', 'tok');
  assert.equal(B.sync.config.path, 'apps/hub/data.json');
  assert.ok(gh.file('me/shared', 'apps/hub/data.json'));

  // A directory whose data.json belongs to something else: refused, nothing written, nothing kept.
  const C = await device();
  await assert.rejects(C.sync.setup('me/shared', 'other-app', 'tok'), (e) => e.kind === 'bad-file' && /isn't the hub's file; it was left untouched/.test(e.message));
  assert.equal(gh.raw('me/shared', 'other-app/data.json'), others['other-app/data.json']);
  assert.equal(C.sync.config, null);
  assert.equal(C.app.store.getLocal('sync-token'), null);
  // Directory names: no files, no climbing out, no .git.
  for (const bad of ['../up', 'a/../b', '.git', '.github/x', 'has space', 'x.json', 'browser-hub/data.json']) {
    assert.ok(Sync.syncDir(bad).error, bad);
  }
  assert.equal(Sync.syncDir('/apps/hub/'), 'apps/hub');
  assert.equal(Sync.syncDir(undefined), 'browser-hub');
  // Commits in the shared history say what made them.
  assert.equal(gh.message('me/shared'), 'browser-hub: sync from test');
});

test('sync command: status, setup asks for the token, cancel, errors, off', async () => {
  const gh = fakeGitHub({ tokens: ['tok'], repos: { 'me/data': { private: true } } });
  const app = await makeApp();
  app.ctx.sync = createSync({ data: app.data, store: app.store, now: () => new Date(MON), fetch: gh.fetch, device: 'test' });
  let answer = null;
  const asked = [];
  app.ctx.askSecret = async (label) => { asked.push(label); return answer; };
  assert.match((await app.run('sync'))[0], /^# Sync is off/);
  assert.equal((await app.run('sync setup not-a-repo'))[0], "err: 'not-a-repo' is not owner/repository");
  assert.match((await app.run('sync setup me/data ../elsewhere'))[0], /not a directory name/);
  assert.match((await app.run('sync setup me/data notes.json'))[0], /give a directory, not a file/);
  assert.equal((await app.run('sync setup me/data'))[0], '# Cancelled; nothing was saved'); // Esc
  assert.deepEqual(asked, ['GitHub token for me/data (hidden)']);
  answer = 'bad';
  const bad = await app.run('sync setup me/data');
  assert.ok(bad.includes('err: GitHub refused the token (expired or revoked)'));
  answer = 'tok';
  const ok = await app.run('sync setup me/data');
  assert.ok(ok.includes('# Syncing with me/data · browser-hub/data.json'));
  assert.ok(ok.includes('dim: Only browser-hub/data.json is read and written; the rest of me/data is left alone'));
  assert.ok(!ok.join('\n').includes('tok '));
  const st = await app.run('sync');
  assert.equal(st[0], '# Sync · in sync');
  assert.ok(st.includes('repository: me/data'));
  assert.ok(st.some((l) => /^token: tok… · on this device only$/.test(l) || /^token: .*….* · on this device only$/.test(l)));
  assert.equal(app.data.steps().undo.some((x) => x.label.startsWith('sync')), false); // sync is never an undo step
  assert.match((await app.run('sync off'))[0], /Sync is off · the token is forgotten/);
  assert.equal((await app.run('sync now'))[0], 'err: Sync is not set up · sync setup <owner/repo>');
});

test('dates in commands: words after due: and events add', async () => {
  const app = await makeApp();
  const st = () => app.data.state;
  assert.deepEqual(await app.run('t pay rent due:next friday #home'), ['# Added task t1', 'pay rent  due Friday 16 October  #home']);
  await app.run('t book flights due:12 oct');
  assert.equal(st().tasks.items[1].due, '2026-10-12');
  await app.run('t call mum due:in 3 days please');
  assert.deepEqual([st().tasks.items[2].due, st().tasks.items[2].text], ['2026-10-08', 'call mum please']);
  await app.run('tasks t1 edit due thursday');
  assert.equal(st().tasks.items[0].due, '2026-10-08');
  await app.run('events add 12 oct 19:00 dinner at Mia\'s');
  assert.deepEqual([st().events.items[0].date, st().events.items[0].time, st().events.items[0].title], ['2026-10-12', '19:00', "dinner at Mia's"]);
  await app.run('ev next friday lunch');
  assert.deepEqual([st().events.items[1].date, st().events.items[1].title], ['2026-10-16', 'lunch']);
  assert.match((await app.run('t x due:someday'))[0], /Can't read the date 'someday'/);
});

test('config: your name (synced) and this device (local); device names and ids', async () => {
  const mac = { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15' };
  assert.equal(defaultDeviceName(mac), 'Mac · Safari');
  assert.equal(defaultDeviceName({ platform: 'iPhone', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) CriOS/130.0 Safari/604.1' }), 'iPhone · Chrome');
  assert.equal(detectBrowser({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0' }), 'Edge');
  const app = await makeApp();
  const dev = app.ctx.device;
  assert.match(dev.id, /^[a-z0-9]{8}$/);
  assert.equal(dev.name, 'Mac · Chrome');
  assert.deepEqual(app.store.getLocal('device'), dev); // the same id next time
  const shown = await app.run('config');
  assert.deepEqual(shown.slice(0, 4), ['# Config', 'name: not set  [config edit name = ]', 'device: Mac · Chrome  [config edit device = Mac · Chrome]', 'device id: ' + dev.id + ' · fixed, marks what this device did']);
  assert.equal((await app.run('config edit name Michael'))[0], '# Updated config name');
  assert.equal(app.data.state.settings.name, 'Michael'); // a setting: synced, exported
  await app.run('config edit device Work laptop');
  assert.equal(app.store.getLocal('device').name, 'Work laptop'); // this device only
  assert.ok(!JSON.stringify(app.data.state.settings).includes('Work laptop'));
  await app.run('config edit name');
  assert.equal(app.ctx.inputSet, 'config edit name Michael');
  await app.run('config edit name none');
  assert.equal(app.data.state.settings.name, null);
  assert.equal((await app.run('config edit colour red'))[0], 'err: config has no field colour');
  assert.equal((await app.run('config edit device ""'))[0], 'err: A device needs a name');
  assert.match((await app.run('config edit'))[0], /^# Editing config/);
});

test('visual history: entries, views, clear marks, merging, limits', () => {
  const e = (id, at, device, extra) => ({ id, at, device, deviceName: device === 'pc' ? 'Mac · Chrome' : 'iPhone · Safari', input: id, ops: [['head', id]], ...extra });
  const log = { entries: [e('b', '2026-10-05T10:02:00Z', 'phone'), e('a', '2026-10-05T10:01:00Z', 'pc'), e('c', '2026-10-05T10:03:00Z', 'pc')], cleared: { all: null, devices: {} } };
  assert.deepEqual(Log.visible(log, 'all', 'pc').map((x) => x.id), ['a', 'b', 'c']); // merged, by time
  assert.deepEqual(Log.visible(log, 'current', 'pc').map((x) => x.id), ['a', 'c']);
  assert.deepEqual(Log.visible(log, 'phone', 'pc').map((x) => x.id), ['b']);
  assert.deepEqual(Log.sessions(log).map((x) => [x.device, x.count]), [['pc', 2], ['phone', 1]]);
  // clear current hides one device's entries up to a time; clear all hides everything up to it.
  const c1 = { ...log, cleared: { all: null, devices: { pc: '2026-10-05T10:01:30Z' } } };
  assert.deepEqual(Log.visible(c1, 'all', 'pc').map((x) => x.id), ['b', 'c']);
  const c2 = { ...log, cleared: { all: '2026-10-05T10:02:00Z', devices: {} } };
  assert.deepEqual(Log.visible(c2, 'all', 'pc').map((x) => x.id), ['c']);
  // Merge: every entry from both sides; marks three-way (an undone clear stays undone).
  const base = { entries: [log.entries[1]], cleared: { all: null, devices: { pc: '2026-10-05T09:00:00Z' } } };
  const local = { entries: [log.entries[1], log.entries[2]], cleared: { all: null, devices: {} } }; // undid its clear
  const remote = { entries: [log.entries[1], log.entries[0]], cleared: { all: null, devices: { pc: '2026-10-05T09:00:00Z' } } };
  const m = Log.mergeLog(base, local, remote);
  assert.deepEqual(m.entries.map((x) => x.id), ['a', 'b', 'c']);
  assert.deepEqual(m.cleared.devices, {});
  const both = Log.mergeLog(null, { ...local, cleared: { all: '2026-10-05T10:00:00Z', devices: {} } }, { ...remote, cleared: { all: '2026-10-05T11:00:00Z', devices: {} } });
  assert.equal(both.cleared.all, '2026-10-05T11:00:00Z'); // both cleared: the later one
  // Limits: huge output is cut to its heading; oldest entries drop first.
  const big = Log.makeEntry({ id: 'x', at: '2026-10-05T10:00:00Z', device: 'pc', deviceName: 'pc', input: 'zones all', ops: [['head', 'many'], ['dim', 'x'.repeat(30000)]] });
  assert.deepEqual(big.ops, [['head', 'many'], ['dim', 'The output was too long to keep in history · run it again to see it']]);
  const many = { entries: Array.from({ length: 320 }, (_, i) => e('n' + i, new Date(Date.UTC(2026, 9, 5, 0, i)).toISOString(), 'pc')), cleared: { all: null, devices: {} } };
  const kept = Log.compact(many).entries;
  assert.equal(kept.length, Log.MAX_ENTRIES);
  assert.equal(kept[0].id, 'n20');
  assert.match(Log.newEntryId('pc', '2026-10-05T10:00:00Z'), /^pc-[a-z0-9]+-[a-z0-9]+$/);
});

test('clear and session: per device, undoable, synced across devices', async () => {
  const gh = fakeGitHub({ tokens: ['tok'], repos: { 'me/data': { private: true } } });
  const device = async (name, minute) => {
    const app = await makeApp();
    app.ctx.device.name = name;
    const sync = createSync({ data: app.data, store: app.store, now: () => new Date(MON), fetch: gh.fetch, device: name });
    // What the page does after each command: keep it in the history.
    const say = async (input, at) => {
      await app.data.appendLog(Log.makeEntry({ id: Log.newEntryId(app.ctx.device.id, at), at, device: app.ctx.device.id, deviceName: name, input, ops: [['head', input]] }));
    };
    return { app, sync, say, minute };
  };
  const pc = await device('Mac · Chrome');
  const phone = await device('iPhone · Safari');
  await pc.say('tasks', '2026-10-05T10:01:00Z');
  await phone.say('notes', '2026-10-05T10:02:00Z');
  await pc.say('find milk', '2026-10-05T10:03:00Z');
  await pc.sync.setup('me/data', null, 'tok');
  await phone.sync.setup('me/data', null, 'tok');
  await pc.sync.syncNow();
  const inputs = (d, view = 'all') => Log.visible(d.app.data.state.log, view, d.app.ctx.device.id).map((x) => x.input);
  assert.deepEqual(inputs(pc), ['tasks', 'notes', 'find milk']); // what the phone did, here too, in time order
  assert.deepEqual(inputs(phone), ['tasks', 'notes', 'find milk']);
  assert.deepEqual(inputs(pc, 'current'), ['tasks', 'find milk']);
  // session lists them; session show switches the view (this device only).
  const ls = await pc.app.run('session');
  assert.match(ls[0], /^# 2 sessions · showing every device$/);
  assert.ok(ls.some((l) => /^Mac · Chrome \| ● this device \| 2 \|/.test(l)));
  assert.ok(ls.some((l) => /^iPhone · Safari \|  \| 1 \|/.test(l)));
  let view = 'all';
  pc.app.ctx.logView = () => view;
  pc.app.ctx.setLogView = (v) => { view = v; };
  assert.deepEqual(await pc.app.run('session show current'), ['# Showing this device']);
  assert.equal(view, 'current');
  await pc.app.run('session show iphone · safari');
  assert.equal(view, phone.app.ctx.device.id);
  assert.equal((await pc.app.run('session show nowhere'))[0], "err: No session 'nowhere' · session lists them");
  // clear current: this device's entries, on every device once synced; undo brings them back.
  let now = new Date('2026-10-05T10:05:00Z');
  pc.app.ctx.now = () => now;
  await pc.app.run('clear');
  assert.deepEqual(inputs(pc), ['notes']);
  await pc.sync.syncNow();
  await phone.sync.syncNow();
  assert.deepEqual(inputs(phone), ['notes']);
  await pc.app.run('undo');
  assert.deepEqual(inputs(pc), ['tasks', 'notes', 'find milk']);
  await pc.sync.syncNow();
  await phone.sync.syncNow();
  assert.deepEqual(inputs(phone), ['tasks', 'notes', 'find milk']); // the undo reached the phone too
  // clear all: everything, everywhere.
  phone.app.ctx.now = () => new Date('2026-10-05T10:06:00Z'); // after every entry, in any time zone
  await phone.app.run('clear all');
  await phone.sync.syncNow();
  await pc.sync.syncNow();
  assert.deepEqual(inputs(pc), []);
  assert.equal((await pc.app.run('clear sometimes'))[0], '# Usage · clear');
});

test('paste placeholders: collapse, expand where the cursor goes, remove whole, run in full', () => {
  const text = 'line one\nline two\nline three';
  assert.equal(P.shouldCollapse(text), true);
  assert.equal(P.shouldCollapse('short'), false);
  assert.equal(P.shouldCollapse('x'.repeat(201)), true);
  assert.equal(P.labelFor(text, 1), '[Pasted text #1 +3 lines]');
  assert.equal(P.labelFor('x'.repeat(1234), 2), '[Pasted text #2, 1,234 characters]');
  const pastes = new Map([['[Pasted text #1 +3 lines]', text]]);
  const v = 'n [Pasted text #1 +3 lines] done';
  assert.deepEqual(P.placeholders(v, pastes), [{ label: '[Pasted text #1 +3 lines]', start: 2, end: 27 }]);
  assert.equal(P.expandAll(v, pastes), 'n line one\nline two\nline three done'); // what runs
  assert.equal(P.expandAt(v, 2, pastes), null); // at the edge: still a placeholder
  assert.equal(P.expandAt(v, 27, pastes), null);
  const x = P.expandAt(v, 10, pastes); // inside: the text itself, line breaks as ⏎
  assert.equal(x.value, 'n line one⏎line two⏎line three done');
  assert.equal(x.caret, 2 + 'line one⏎line two⏎line three'.length);
  assert.equal(P.expandAll(x.value, pastes), 'n line one\nline two\nline three done'); // and back
  assert.deepEqual(P.removeAt(v, 27, 'Backspace', pastes), { value: 'n  done', caret: 2, label: '[Pasted text #1 +3 lines]' });
  assert.deepEqual(P.removeAt(v, 2, 'Delete', pastes), { value: 'n  done', caret: 2, label: '[Pasted text #1 +3 lines]' });
  assert.equal(P.removeAt(v, 10, 'Backspace', pastes), null);
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

  // aliases <name> edit: in place, like everything else; the template field takes the URL as typed.
  const ed = await app.run('aliases mobile edit');
  assert.equal(ed[0], '# Editing aliases mobile · tap any value, Enter saves, Esc leaves it');
  assert.ok(ed.includes('template: ' + mobile.template + '  [aliases mobile edit template = ' + mobile.template + ']'));
  assert.equal((await app.run('alias edit mobile'))[0], ed[0]); // the older order too
  assert.equal((await app.run('aliases mobile edit template ' + mobile.template))[0], '# Updated aliases mobile template'); // reads back unchanged
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
  assert.ok(shown.includes('template: https://duckduckgo.com/?q={}&ia=web  [aliases ddg edit template = https://duckduckgo.com/?q={}&ia=web]'));
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
  assert.equal((await app.run('t due:today #x'))[0], '# Usage · tasks add');
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
  assert.match(cal[2], /^e1 \| Monday 5 October \| 09:30 \| standup$/);
  assert.equal((await app.run('cal 2026-13'))[0], '# Usage · cal');
  const ag = await app.run('agenda');
  assert.equal(ag[0], '# Next 7 days · 4 items · 1 overdue');
  assert.equal(ag[1], '## Overdue');
  assert.match(ag[2], /^t2 \| Thursday 1 October \| old thing$/);
  assert.ok(ag.includes('t1 | task due | file taxes'));
  assert.equal(ag[3], '## Today · Monday 5 October');
  assert.ok(ag.includes('## Wednesday 7 October'));
  assert.ok(!ag.some((l) => /dentist/.test(l)));
  assert.ok((await app.run('agenda 60')).some((l) => /dentist/.test(l)));
  assert.deepEqual(await app.run('ev rm e1'), ['# Removed event e1', 'standup', '↶ undo brings it back']);
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
  // import takes .ics files too, by name or by content.
  const other = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:B\nDTSTART:20261013T090000\nEND:VEVENT\nEND:VCALENDAR';
  app.ctx.nextFile = { name: 'download', size: other.length, text: async () => other };
  assert.equal((await app.run('import'))[0], '# Imported 1 event from download');
});

test('vocabulary: the same words everywhere, older forms still understood', async () => {
  const app = await makeApp(); // Monday 5 October 2026
  assert.equal((await app.run('cal dec'))[0], '# December 2026');
  assert.equal((await app.run('cal march 2027'))[0], '# March 2027');
  assert.equal((await app.run('cal next'))[0], '# November 2026');
  assert.equal((await app.run('cal last'))[0], '# September 2026');
  assert.equal((await app.run('cal 2026-12'))[0], '# December 2026');
  assert.equal((await app.run('cal someday'))[0], '# Usage · cal');
  assert.deepEqual(await app.run('engine ddg'), ['# Default engine is now ddg']);
  assert.deepEqual(await app.run('engine default g'), ['# Default engine is now g']);
  assert.deepEqual(await app.run('b64 encode hi'), ['= aGk=']);
  assert.deepEqual(await app.run('b64 decode aGk='), ['= hi']);
  await app.run('t one');
  assert.match((await app.run('undo list'))[0], /steps to undo/);
  // Older names still work but aren't listed.
  const help = await app.run('help');
  assert.ok(!help.some((l) => l.startsWith('ics ')));
  assert.equal((await app.run('help ics'))[0], '# ics · import events from a local .ics file (now: import)');
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
  assert.ok(ls.some((l) => /^ddg \| your engine \| .* \| ★ default$/.test(l)));
  assert.deepEqual(await app.run('aliases'), ls); // the noun lists the same
  assert.match((await app.run('aliases gh'))[0], /^# gh  alias/);
  assert.deepEqual(await app.run('aliases ddg default'), ['# Default engine is now ddg']);
  assert.match((await app.run('aliases add gh2 https://github.com/'))[0], /^# Added gh2  alias/);
  assert.match((await app.run('aliases gh2 rm'))[0], /^# Removed gh2/);
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
  // zones: the shared grammar.
  assert.deepEqual(await app.run('zones add europe/london'), ['# Added Europe/London']);
  const tz = await app.run('tz 14:30');
  assert.match(tz[0], /^# 14:30 local · overlap/);
  assert.equal(tz[1], '| name | time |  | utc | zone | ');
  assert.deepEqual(await app.run('zones'), await app.run('tz')); // your zones, with the time in each
  assert.deepEqual(await app.run('zones EUROPE/london rm'), ['# Removed Europe/London']);
  assert.deepEqual(await app.run('zones add nairobi Kenji in Nairobi'), ['# Added Africa/Nairobi as Kenji in Nairobi']);
  assert.deepEqual(z().zoneNames, { 'Africa/Nairobi': 'Kenji in Nairobi' });
  assert.ok((await app.run('zones')).some((l) => /^Kenji in Nairobi \| \d\d:\d\d \| .* \| Africa\/Nairobi \|/.test(l)));
  // A zone by IANA name, city or your name for it; shown with its name editable.
  const shown = await app.run('zones nairobi');
  assert.deepEqual(shown.slice(0, 2), ['# zone Africa/Nairobi', 'name: Kenji in Nairobi  [zones Africa/Nairobi edit name = Kenji in Nairobi]']);
  assert.deepEqual(await app.run('zones Africa/Nairobi'), shown);
  assert.equal((await app.run('zones nairobi edit'))[0], '# Editing zones Africa/Nairobi · tap any value, Enter saves, Esc leaves it');
  assert.equal((await app.run('zones nairobi edit name Kenji'))[0], '# Named Africa/Nairobi Kenji');
  assert.equal(z().zoneNames['Africa/Nairobi'], 'Kenji');
  await app.run('zones kenji edit name "Kenji\'s team"');
  assert.equal(z().zoneNames['Africa/Nairobi'], "Kenji's team");
  await app.run('zones nairobi edit name');
  assert.equal(app.ctx.inputSet, "zones Africa/Nairobi edit name Kenji's team");
  assert.equal((await app.run('zones nairobi edit name none'))[0], '# Cleared the name of Africa/Nairobi');
  assert.deepEqual(z().zoneNames, {});
  assert.equal((await app.run('zones nairobi edit colour red'))[0], 'err: Zones have no field colour');
  assert.equal((await app.run('zones paris'))[0], "err: 'paris' is not one of your zones");
  assert.equal((await app.run('zones add Atlantis'))[0], "err: Unknown time zone 'Atlantis'");
  assert.match((await app.run('zones add nairobi ' + 'x'.repeat(33)))[0], /too long/);
  assert.match((await app.run('zones ' + Z.localZone() + ' rm'))[0], /your local zone; it can't be removed/);
  // The older tz forms keep working.
  await app.run('tz add America/New_York NYC');
  assert.deepEqual(await app.run('tz rm nyc'), ['# Removed America/New_York']);
  assert.equal((await app.run('tz name paris Bob'))[0], "err: 'paris' is not in your list");
  await app.run('tz name nairobi Bob');
  assert.equal(z().zoneNames['Africa/Nairobi'], 'Bob');
  await app.run('tz name nairobi');
  assert.deepEqual(z().zoneNames, {});
  // tz HH:MM <zone>: a time in another zone, listed or not, by city or name.
  await app.run('zones add Pacific/Marquesas Kenji');
  const conv = await app.run('tz 09:00 Pacific/Chatham');
  const chathamRow = conv.find((l) => l.startsWith('Chatham | '));
  assert.match(chathamRow, /^Chatham \| 09:00 \| /);
  assert.match(conv[0], /^# 09:00 Chatham( \w+ \d+ \w+)? = \d\d:\d\d local/);
  // ...and the local time is right: 09:00 on Chatham's own today.
  const [cy, cm, cd] = Z.partsIn(MON, 'Pacific/Chatham').date.split('-').map(Number);
  const inst = Z.zonedToDate(cy, cm, cd, 9, 0, 0, 'Pacific/Chatham');
  assert.ok(conv[0].includes('= ' + U.pad2(inst.getHours()) + ':' + U.pad2(inst.getMinutes()) + ' local'), conv[0]);
  assert.match((await app.run('tz 23:30 kenji'))[0], /^# 23:30 Kenji( \w+ \d+ \w+)? = \d\d:\d\d local/);
  assert.ok(!app.data.state.settings.zones.includes('Pacific/Chatham')); // shown, not added
  assert.equal((await app.run('tz 09:00 atlantis'))[0], "err: Unknown time zone 'atlantis'");
  assert.equal((await app.run('tz lunch'))[0], "err: tz: 'lunch' is not a time (HH:MM)");
  await app.run('zones kenji rm');
  // zones all lists every zone the browser knows, filterable; yours are marked. tz ls is the older form.
  const all = await app.run('zones all');
  assert.match(all[0], /^# \d{3} time zones · earliest first$/);
  const asia = await app.run('zones all africa/nai');
  assert.equal(asia[0], '# 1 time zone matching "africa/nai"');
  assert.match(asia[2], /^Africa\/Nairobi \| \d\d:\d\d \| .* \| \+03:00 \| ● listed$/);
  assert.deepEqual(await app.run('tz ls africa/nai'), asia);
  assert.equal((await app.run('zones all zzz'))[0], '# No time zones match "zzz"');
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
  // The shared grammar: widgets <name> shows it; on/off, move, edit, rm, add.
  assert.deepEqual(await app.run('widgets zones'), ['# widget zones', 'on: ○ off  [widgets zones edit on = no]', 'position: —',
    'shows: your time zones and working-hours overlap', 'dim: Tap a value to change it, or: widgets zones on']);
  assert.deepEqual(await app.run('widgets zones on'), ['# zones on']);
  const ws = () => app.data.state.settings.widgets;
  assert.deepEqual(ws(), ['clock', 'agenda', 'tasks', 'zones']);
  await app.run('widgets clock rm'); // rm turns it off
  await app.run('widgets add calendar'); // add turns it on
  assert.deepEqual(ws(), ['agenda', 'tasks', 'zones', 'calendar']); // turned on -> bottom
  assert.equal((await app.run('widgets zones edit'))[0], '# Editing widgets zones · tap any value, Enter saves, Esc leaves it');
  // Reordering.
  assert.deepEqual(await app.run('widgets zones move top'), ['# Moved zones to 1', 'dim: Order: 1. zones  2. agenda  3. tasks  4. calendar']);
  await app.run('widgets agenda move down');
  assert.deepEqual(ws(), ['zones', 'tasks', 'agenda', 'calendar']);
  await app.run('widgets calendar edit position 2');
  assert.deepEqual(ws(), ['zones', 'calendar', 'tasks', 'agenda']);
  await app.run('widgets move zones bottom'); // the older order still works
  assert.deepEqual(ws(), ['calendar', 'tasks', 'agenda', 'zones']);
  assert.equal((await app.run('widgets calendar move up'))[0], '# calendar is already first');
  assert.equal((await app.run('widgets clock move top'))[0], 'err: clock is off');
  assert.equal((await app.run('widgets bogus move top'))[0], "err: widgets: 'bogus move top' is not a widget");
  assert.equal((await app.run('widgets calendar move sideways'))[0], "err: Can't move to 'sideways': top, up, down, bottom or a position");
  await app.run('widgets clock edit on yes');
  assert.ok(ws().includes('clock'));
  await app.run('widgets clock edit on no');
  assert.ok(!ws().includes('clock'));
  await app.run('widgets order clock agenda');
  assert.deepEqual(ws(), ['clock', 'agenda', 'calendar', 'tasks', 'zones']); // named first, clock turned on
  assert.equal((await app.run('widgets order clock clock'))[0], 'err: Each widget can be named once');
  const listed = await app.run('widgets');
  assert.deepEqual(listed.slice(1, 3), ['1 | ● | clock | time and date', '2 | ● | agenda | overdue tasks, events and due tasks for the week']);
  assert.deepEqual(await app.run('widgets hide'), ['# Widget panel hidden']);
  assert.equal(app.data.state.settings.panel, false);
  await app.run('widgets notes on');
  assert.equal(app.data.state.settings.panel, true); // turning one on shows the panel
  assert.equal((await app.run('widgets bogus'))[0], "err: widgets: 'bogus' is not a widget");
  assert.equal((await app.run('widgets add bogus'))[0], "err: No widget 'bogus'");
});

test('help, history', async () => {
  const app = await makeApp();
  const help = await app.run('help');
  assert.match(help[0], /^# Help · \d+ built-in commands · 2 engines and 0 aliases of yours$/);
  // Built-in groups, then the user's own engines and aliases, each labelled.
  assert.ok(help.includes('## Built-in · View'));
  assert.ok(help.includes('## Built-in · Aliases & engines'));
  assert.ok(help.includes('## Your search engines  your engine'));
  assert.ok(help.some((l) => /^g <text> \| https:\/\/www\.google\.com\/search\?q=\{\}  ★ default$/.test(l)));
  assert.ok(help.includes('## Your aliases  your alias'));
  assert.ok(help.includes('none yet | alias <name> <url>'));
  await app.run('alias mail https://mail.example.com/');
  assert.ok((await app.run('help')).includes('mail | https://mail.example.com/'));
  // keys: labelled for the platform.
  app.ctx.os = 'mac';
  const mac = await app.run('keys');
  assert.match(mac[0], /Mac keys/);
  assert.ok(mac.includes('⌃R | search history: type to filter, again for older, Enter runs, Tab edits, Esc cancels'));
  assert.ok(mac.includes('⌃W ⌥⌫ | cut the word before the cursor'));
  app.ctx.os = 'windows';
  const win = await app.run('keys');
  assert.ok(win.includes('Ctrl+R | search history: type to filter, again for older, Enter runs, Tab edits, Esc cancels'));
  assert.ok(win.some((l) => l.startsWith('Ctrl+W Alt+Backspace | cut the word before the cursor (the browser keeps Ctrl+W')));
  assert.ok(win.includes('## Edit the line'));
  const ht = await app.run('help t');
  assert.deepEqual(ht.slice(0, 3), ['# t · short for tasks; t <text> adds a task', '## Usage', 't <text> [due:<date>] [every:<rule>] [#tag]']);
  // Every kept thing documents the same shape.
  for (const [noun, id] of [['notes', '<id>'], ['tasks', '<id>'], ['events', '<id>'], ['aliases', '<name>'], ['zones', '<zone>'], ['widgets', '<name>']]) {
    const u = (await app.run('help ' + noun)).filter((l) => l.startsWith(noun));
    assert.ok(u.some((l) => l.startsWith(noun + ' add ')), noun);
    assert.ok(u.includes(noun + ' ' + id), noun);
    assert.ok(u.includes(noun + ' ' + id + ' edit [<field> [<value>]]'), noun);
    assert.ok(u.includes(noun + ' ' + id + ' rm'), noun);
  }
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
  // The whole import is one undo step.
  assert.equal((await b.run('undo'))[0], '# Undid import');
  const u = b.data.state;
  assert.deepEqual([u.notes.items.length, u.tasks.items.length, u.events.items.length, u.settings.theme, u.aliases.defaultEngine], [0, 0, 0, 'auto', 'g']);
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
  assert.deepEqual(r.counts, { notes: 1, tasks: 0, events: 0, snippets: 0, later: 0, aliases: 2, zones: 1 });
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

test('clip: sealed with a passphrase, one item, gone after 15 minutes, never kept', async () => {
  const Clip = await import('../js/core/clip.js');
  // Sealing: only the right passphrase opens it, and only on the times and device it was made with.
  const meta = { at: '2026-10-05T10:00:00.000Z', expires: '2026-10-05T10:15:00.000Z', device: 'd1', deviceName: 'Mac · Chrome' };
  const item = await Clip.seal('secret text ✓', 'correct horse battery', meta);
  assert.ok(!JSON.stringify(item).includes('secret'));
  assert.equal(await Clip.unseal(item, 'correct horse battery'), 'secret text ✓');
  assert.equal(await Clip.unseal(item, 'wrong horse battery'), null);
  assert.equal(await Clip.unseal({ ...item, expires: '2027-01-01T00:00:00.000Z' }, 'correct horse battery'), null); // moved: refused
  // Expiry and merging: the newer wins; an expired one is wiped the same way everywhere.
  const t = (iso) => new Date(iso);
  assert.equal(Clip.isLive(item, t('2026-10-05T10:14:59Z')), true);
  assert.equal(Clip.isLive(item, t('2026-10-05T10:15:00Z')), false);
  assert.deepEqual(Clip.expire(item, t('2026-10-05T10:20:00Z')), { at: '2026-10-05T10:15:00.000Z', cleared: true });
  const newer = { ...item, at: '2026-10-05T10:05:00.000Z', expires: '2026-10-05T10:20:00.000Z' };
  assert.equal(Clip.mergeClip(item, newer, t('2026-10-05T10:06:00Z'), Merge.canonical).at, newer.at);
  assert.equal(Clip.mergeClip(newer, item, t('2026-10-05T10:06:00Z'), Merge.canonical).at, newer.at);
  assert.deepEqual(Clip.mergeClip(newer, { at: null }, t('2026-10-05T11:00:00Z'), Merge.canonical), { at: '2026-10-05T10:20:00.000Z', cleared: true });
  const wiped = { at: '2026-10-05T10:07:00.000Z', cleared: true }; // `clip clear` after the newer one
  assert.deepEqual(Clip.mergeClip(newer, wiped, t('2026-10-05T10:08:00Z'), Merge.canonical), wiped);

  // Two devices through the fake GitHub.
  const gh = fakeGitHub({ tokens: ['tok'], repos: { 'me/data': { private: true } } });
  const device = async (name) => {
    const app = await makeApp();
    app.ctx.device.name = name;
    app.ctx.sync = createSync({ data: app.data, store: app.store, now: () => app.ctx.now(), fetch: gh.fetch, device: name });
    let answer = null;
    app.ctx.askSecret = async () => answer;
    app.answer = (a) => { answer = a; };
    await app.ctx.sync.setup('me/data', null, 'tok');
    return app;
  };
  const A = await device('laptop');
  const B = await device('phone');

  // Without a passphrase a clip stays on the device: nothing synced.
  const local = await A.run('clip on this device only');
  assert.match(local[0], /^# Clipped · 19 characters · on this device only/);
  assert.deepEqual(await A.run('clip'), ['# Clip · from this device · 15 min left · this device only', '= on this device only', 'clip clear wipes it now']);
  assert.ok(!JSON.stringify(gh.state.repos).includes('this device only'));
  assert.equal(A.store.getLocal('clip').text, 'on this device only');

  // A passphrase: too short is refused; Esc cancels; a good one is kept on the device only.
  A.answer('short');
  assert.match((await A.run('clip key'))[0], /^err: Use at least 10 characters/);
  A.answer(null);
  assert.equal((await A.run('clip key'))[0], '# Cancelled; the passphrase is unchanged');
  A.answer('two devices one secret');
  assert.match((await A.run('clip key'))[0], /^# Passphrase saved on this device/);

  // Shared: sealed in the repo, opened on the other device once it has the passphrase.
  const sent = await A.run('clip add https://example.com/path?token=abc');
  assert.match(sent[0], /^# Clipped · 34 characters · sent sealed to your other devices · wiped in 15 minutes/);
  assert.equal(A.store.getLocal('clip'), null); // the local-only one is replaced
  const repo = JSON.stringify(gh.state.repos);
  assert.ok(!repo.includes('example.com') && !repo.includes('two devices one secret'));
  assert.ok(gh.file('me/data').collections.clip.sealed);
  await B.ctx.sync.syncNow();
  assert.deepEqual((await B.run('clip')).slice(0, 2), ['# A clip from laptop · sealed · 15 min left', 'Run clip key with the passphrase your other devices use']);
  B.answer('not the same secret');
  const wrongKey = await B.run('clip key');
  assert.ok(wrongKey.includes('warn: It does not open the clip from laptop: is it the same passphrase?'));
  assert.match((await B.run('clip'))[1], /passphrase isn't the one it was sealed with/);
  B.answer('two devices one secret');
  assert.ok((await B.run('clip key')).includes('It opens the clip from laptop · clip'));
  const got = await B.run('clip');
  assert.deepEqual(got.slice(0, 2), ['# Clip · from laptop · 15 min left', '= https://example.com/path?token=abc']);
  assert.equal(got.copied, 'https://example.com/path?token=abc');

  // One item: a newer clip from either side replaces it.
  B.setNow(new Date(MON.getTime() + 60000));
  await B.run('clip from the phone');
  await A.ctx.sync.syncNow();
  assert.equal((await A.run('clip'))[1], '= from the phone');

  // Kept out of everything that lasts.
  assert.equal(A.data.steps().undo.some((x) => x.label.startsWith('clip')), false);
  assert.equal(A.commands.byName.get('clip').private, true);
  assert.equal(A.commands.byName.get('clip').noHistory, true);
  assert.ok(!JSON.stringify(await A.store.exportAll()).includes('"clip"'));
  assert.ok(!JSON.stringify(A.data.state.log).includes('from the phone'));

  // 15 minutes on: wiped here, and the wipe reaches the repository.
  A.setNow(new Date(MON.getTime() + 60000 + Clip.CLIP_TTL));
  assert.equal((await A.run('clip'))[0], '# The clipboard is empty');
  assert.deepEqual(A.data.state.clip, { at: new Date(MON.getTime() + 60000 + Clip.CLIP_TTL).toISOString(), cleared: true });
  await A.ctx.sync.syncNow();
  assert.deepEqual(gh.file('me/data').collections.clip, A.data.state.clip);
  // The other device, if it never swept, still agrees at its next sync (no conflict).
  B.setNow(new Date(MON.getTime() + 60000 + Clip.CLIP_TTL + 1000));
  const r = await B.ctx.sync.syncNow();
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(B.data.state.clip, A.data.state.clip);

  // clip clear wipes it everywhere before then; a word after clip is text unless it is the whole command.
  await A.run('clip add clear');
  assert.equal((await A.run('clip'))[1], '= clear');
  assert.match((await A.run('clip clear'))[0], /^# Clip wiped · on every device/);
  await A.ctx.sync.syncNow();
  assert.equal(gh.file('me/data').collections.clip.cleared, true);
  assert.equal((await A.run('clip clear'))[0], '# The clipboard was already empty');
  A.answer(null);
  assert.match((await A.run('clip key off'))[0], /^# Passphrase forgotten on this device/);
  assert.equal(A.store.getLocal('clip-key'), null);
});

test('qr command: drawn from the text, too long refused', async () => {
  const app = await makeApp();
  assert.deepEqual(await app.run('qr https://example.com'), ['# QR code · 19 bytes · version 2 · error correction Q', 'QR Q https://example.com', 'dim: https://example.com']);
  assert.match((await app.run('qr ' + 'x'.repeat(3000)))[0], /^err: too long for a QR code: 3000 bytes \(at most 2331 at level M\)/);
  assert.match((await app.run('qr'))[0], /^# Usage/);
});

test('date maths: steps, workdays, ISO weeks, differences, looking back', async () => {
  const D = await import('../js/core/datemath.js');
  const now = MON; // Monday 5 October 2026
  const at = (s, o) => D.point(s, now, o).date;
  assert.equal(at(''), '2026-10-05');
  assert.equal(at('+ 90d'), '2027-01-03');
  assert.equal(at('today - 3d'), '2026-10-02');
  assert.equal(at('3 days ago'), '2026-10-02');
  assert.equal(at('2 weeks ago'), '2026-09-21');
  assert.equal(at('2026-01-31 + 1m'), '2026-02-28'); // the month's last day
  assert.equal(at('2024-01-31 + 1 month'), '2024-02-29');
  assert.equal(at('2024-02-29 + 1y'), '2025-02-28');
  assert.equal(at('2026-10-05 + 1w + 2d'), '2026-10-14');
  assert.equal(at('2026-10-05 - 1m - 1d'), '2026-09-04');
  // Workdays: Monday to Friday; from a weekend, the next Monday.
  assert.equal(at('fri + 1 wd'), '2026-10-12');
  assert.equal(at('2026-10-10 + 1wd'), '2026-10-12'); // Saturday
  assert.equal(at('2026-10-12 - 1 workday'), '2026-10-09');
  assert.equal(at('2026-10-05 + 10 workdays'), '2026-10-19');
  assert.equal(D.workdaysBetween('2026-10-05', '2026-10-09'), 4);
  assert.equal(D.workdaysBetween('2026-10-09', '2026-10-12'), 1);
  assert.equal(D.workdaysBetween('2026-10-10', '2026-10-11'), 0);
  assert.equal(D.workdaysBetween('2026-10-12', '2026-10-05'), -5);
  for (let n = 0; n < 40; n++) assert.equal(D.workdaysBetween('2026-10-05', D.step('2026-10-05', '+', n, 'wd')), n);
  // Looking back: the last Friday, the last 12 October.
  assert.equal(at('fri', { past: true }), '2026-10-02');
  assert.equal(at('mon', { past: true }), '2026-09-28');
  assert.equal(at('last fri'), '2026-10-02');
  assert.equal(at('25 dec', { past: true }), '2025-12-25');
  assert.equal(at('1 oct', { past: true }), '2026-10-01');
  assert.match(D.point('someday', now).error, /don't know the date 'someday'/);
  // ISO weeks: Monday first, week 1 holds the first Thursday.
  assert.deepEqual(D.isoWeek('2026-10-05'), { year: 2026, week: 41 });
  assert.deepEqual(D.isoWeek('2026-01-01'), { year: 2026, week: 1 }); // a Thursday
  assert.deepEqual(D.isoWeek('2027-01-01'), { year: 2026, week: 53 }); // a Friday
  assert.deepEqual(D.isoWeek('2024-12-30'), { year: 2025, week: 1 });
  assert.deepEqual(D.isoWeek('2021-01-03'), { year: 2020, week: 53 });
  assert.deepEqual([2020, 2025, 2026, 2027].map(D.weeksIn), [53, 52, 53, 52]);
  assert.equal(D.weekMonday(2026, 41), '2026-10-05');
  assert.equal(D.weekMonday(2025, 1), '2024-12-30');
  assert.equal(D.weekMonday(2026, 53), '2026-12-28');
  // Differences: `to` from first to second, `-` second to first; a calendar's sense of years.
  assert.deepEqual(D.difference('1 jan to 25 dec', now), { from: '2026-01-01', to: '2026-12-25' });
  assert.deepEqual(D.difference('25 dec - 1 jan', now), { from: '2026-01-01', to: '2026-12-25' });
  assert.deepEqual(D.difference('1 dec to 1 feb', now), { from: '2026-12-01', to: '2027-02-01' });
  assert.deepEqual(D.difference('2026-10-05 - 2026-01-01', now), { from: '2026-01-01', to: '2026-10-05' });
  assert.equal(D.difference('today - 3d', now), null); // a step, not a difference
  assert.deepEqual(D.calendarSpan('2026-01-31', '2026-03-01'), { years: 0, months: 1, days: 1 });
  assert.deepEqual(D.calendarSpan('2020-02-29', '2026-10-05'), { years: 6, months: 7, days: 6 });
  assert.equal(D.dayOfYear('2026-10-05'), 278);
  assert.equal(D.daysInYear(2024), 366);
});

test('date, days and week commands', async () => {
  const app = await makeApp();
  const today = await app.run('date');
  assert.deepEqual(today, ['# Monday 5 October 2026 · today', 'date: 2026-10-05', 'week: week 41', 'day: 278 of 365 · 87 days left in 2026', 'quarter: Q4']);
  assert.equal(today.copied, '2026-10-05');
  assert.deepEqual((await app.run('date fri + 3 wd')).slice(0, 2), ['# Friday 9 October + 3 workdays = Wednesday 14 October', 'date: 2026-10-14 · in 9 days']);
  assert.deepEqual(await app.run('date 1 jan to 25 dec'), ['# 358 days from Thursday 1 January to Friday 25 December',
    'weeks: 51 weeks 1 day', 'calendar: 11 months 24 days', 'workdays: 256 · Monday to Friday']);
  assert.equal((await app.run('days until 25 dec'))[0], '# 81 days until Friday 25 December');
  assert.equal((await app.run('days since 1 jan'))[0], '# 277 days since Thursday 1 January');
  assert.equal((await app.run('days since 25 dec'))[0], '# 284 days since Thursday 25 December 2025');
  assert.equal((await app.run('days since fri'))[0], '# 3 days since Friday 2 October');
  assert.equal((await app.run('days until fri')).copied, '4');
  assert.match((await app.run('days'))[0], /^# Usage/);
  assert.deepEqual((await app.run('date blah')).slice(0, 2), ["err: don't know the date 'blah'", '# Usage · date']);
  const week = await app.run('week');
  assert.equal(week[0], '# Week 41 of 2026 · Monday 5 October to Sunday 11 October · this week');
  assert.equal(week[1], 'Monday 5 October | today');
  assert.equal(week[8], 'week 40 2026 ← · → week 42 2026');
  assert.equal((await app.run('week 53'))[0], '# Week 53 of 2026 · Monday 28 December to Sunday 3 January 2027 · in 12 weeks');
  assert.equal((await app.run('week 53'))[8], 'week 52 2026 ← · → week 1 2027');
  assert.equal((await app.run('week 1 2027'))[8], 'week 53 2026 ← · → week 2 2027');
  assert.equal((await app.run('week 2026-W10'))[0].slice(0, 25), '# Week 10 of 2026 · Monda');
  assert.equal((await app.run('week 25 dec'))[0].slice(0, 19), '# Week 52 of 2026 ·');
  assert.equal((await app.run('week 54'))[0], 'err: 2026 has weeks 1 to 53');
});

test('developer helpers: md5, jwt, diff, cron, colour', async () => {
  const Dv = await import('../js/lib/dev.js');
  // RFC 1321 test suite, plus multi-block and UTF-8 input.
  const md5 = { '': 'd41d8cd98f00b204e9800998ecf8427e', a: '0cc175b9c0f1b6a831c399e269772661', abc: '900150983cd24fb0d6963f7d28e17f72',
    'message digest': 'f96b697d7cb7938d525a2f31aaf161d0', abcdefghijklmnopqrstuvwxyz: 'c3fcd3d76192e4007dfb496cca67e13b',
    '12345678901234567890123456789012345678901234567890123456789012345678901234567890': '57edf4a22be3c955ac49da2e2107b67a',
    'The quick brown fox jumps over the lazy dog': '9e107d9d372bb6826bd81d3542a419d6' };
  for (const [k, v] of Object.entries(md5)) assert.equal(Dv.md5(k), v, k);
  assert.equal(Dv.md5('a'.repeat(1000)), 'cabe45dcc9ae5b66ba86600cca6b8ba8');
  assert.equal(Dv.md5('héllo wörld'), execFileSync('md5sum', { input: 'héllo wörld' }).toString().slice(0, 32));

  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const tok = b({ alg: 'RS256' }) + '.' + b({ sub: 'u1', exp: 1 }) + '.sig';
  assert.deepEqual(Dv.decodeJWT('Bearer ' + tok), { header: { alg: 'RS256' }, payload: { sub: 'u1', exp: 1 }, signature: 'sig' });
  assert.throws(() => Dv.decodeJWT('a.b'), /header isn't base64url JSON/);
  assert.throws(() => Dv.decodeJWT('nodots'), /three parts/);

  const ops = Dv.diffLists(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']);
  assert.deepEqual(ops, [['=', 'a'], ['-', 'b'], ['+', 'x'], ['=', 'c'], ['=', 'd'], ['+', 'e']]);
  const long = Array.from({ length: 30 }, (_, i) => 'line ' + i);
  const changed = long.slice(); changed[15] = 'changed';
  assert.deepEqual(Dv.diffView(Dv.diffLists(long, changed)).map((l) => l.op + ' ' + l.text),
    ['… 13 unchanged lines', '= line 13', '= line 14', '- line 15', '+ changed', '= line 16', '= line 17', '… 12 unchanged lines']);
  assert.throws(() => Dv.diffLists(Array.from({ length: 3000 }, (_, i) => 'a' + i), Array.from({ length: 3000 }, (_, i) => 'b' + i)), /too large/);

  const cron = (e) => Dv.describeCron(Dv.parseCron(e));
  assert.equal(cron('*/15 * * * *'), 'Every 15 minutes');
  assert.equal(cron('30 9 * * 1-5'), 'At 09:30, on Monday to Friday');
  assert.equal(cron('0 9,17 * * mon-fri'), 'At 09:00 and 17:00, on Monday to Friday');
  assert.equal(cron('@hourly'), 'At minute 0 of every hour');
  assert.equal(cron('0 0 1 1 *'), 'At 00:00, on day 1 of the month, in January');
  assert.equal(cron('23 0-20/2 * * *'), 'At minute 23, every 2 hours from 00:00 to 20:00');
  assert.equal(cron('*/10 9-17 * * 1-5'), 'Every 10 minutes, from 09:00 to 17:59, on Monday to Friday');
  assert.equal(cron('0 0 * * 7'), 'At 00:00, on Sunday'); // 7 is Sunday too
  const next = (e, n) => Dv.cronNext(Dv.parseCron(e), MON, n).map((d) => U.toISO(d) + ' ' + U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes()));
  assert.deepEqual(next('30 9 * * 1-5', 3), ['2026-10-06 09:30', '2026-10-07 09:30', '2026-10-08 09:30']);
  assert.deepEqual(next('0 12 * * *', 1), ['2026-10-06 12:00']); // strictly after now (12:00)
  assert.deepEqual(next('0 0 1,15 * 1', 3), ['2026-10-12 00:00', '2026-10-15 00:00', '2026-10-19 00:00']); // day or weekday
  assert.deepEqual(next('0 0 */2 * 1', 2), ['2026-10-19 00:00', '2026-11-09 00:00']); // */2 isn't a restriction: odd days AND Mondays
  assert.deepEqual(next('0 0 29 2 *', 1), ['2028-02-29 00:00']);
  assert.deepEqual(next('0 0 30 2 *', 1), []);
  for (const [bad, msg] of [['* * *', /5 fields/], ['61 * * * *', /'61' is not a minute/], ['5-1 * * * *', /runs backwards/], ['* * * foo *', /'foo' is not a month/], ['*/0 * * * *', /step/]]) {
    assert.throws(() => Dv.parseCron(bad), msg, bad);
  }

  const c = Dv.parseColor;
  assert.deepEqual(c('#0af'), { r: 0, g: 170, b: 255, a: 1 });
  assert.deepEqual(c('00AAFF'), { r: 0, g: 170, b: 255, a: 1 });
  assert.deepEqual(c('rgb(0 170 255 / 50%)'), { r: 0, g: 170, b: 255, a: 0.5 });
  assert.deepEqual(c('rgba(0, 170, 255, 0.5)'), { r: 0, g: 170, b: 255, a: 0.5 });
  assert.deepEqual(c('hsl(200, 100%, 50%)'), { r: 0, g: 170, b: 255, a: 1 });
  assert.equal(c('nope'), null);
  assert.equal(Dv.toHex(c('#00aaff80')), '#00aaff80');
  assert.deepEqual(Dv.toHsl(c('#00aaff')), { h: 200, s: 100, l: 50 });
  assert.equal(Dv.contrast(c('#000'), c('#fff')).toFixed(1), '21.0');
  assert.equal(Dv.contrast(c('#777'), c('#fff')).toFixed(2), '4.48');
});

test('developer commands: hash, jwt (kept nowhere), url, regex, diff, cron, color', async () => {
  const app = await makeApp();
  const h = await app.run('hash hello');
  assert.deepEqual(h.slice(1, 5), ['MD5 | 5d41402abc4b2a76b9719d911017c592', 'SHA-1 | aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d',
    'SHA-256 | 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    'SHA-512 | 9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043']);
  assert.equal(h.copied, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.deepEqual(await app.run('hash sha384 abc'), ['# SHA-384 · 3 bytes of UTF-8',
    '= cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7']);
  assert.equal(app.commands.byName.get('hash').private, true);

  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(MON.getTime() / 1000) + 7200;
  const j = await app.run('jwt ' + b({ alg: 'HS256', typ: 'JWT' }) + '.' + b({ sub: 'user-1', exp }) + '.c2ln');
  assert.equal(j[0], '# JWT · HS256 · valid, expires in 2 hours');
  assert.equal(j.tone, 'ok');
  assert.ok(j.includes('subject: user-1'));
  assert.ok(j.includes('expires: Monday 5 October 14:00 · in 2 hours'));
  const old = await app.run('jwt ' + b({ alg: 'none' }) + '.' + b({ exp: 1 }) + '.');
  assert.match(old[0], /^# JWT · none · expired \d+ years ago$/);
  assert.equal(old.tone, 'err');
  assert.equal(app.commands.byName.get('jwt').noHistory, true);
  assert.equal(app.commands.byName.get('jwt').private, true);

  const u = await app.run('url example.com/a%20b?q=hello%20world&x=1#top');
  assert.deepEqual(u.slice(0, 6), ['# example.com · https', 'scheme: https', 'host: example.com', 'port: 443 (default)', 'path: /a b', 'fragment: top']);
  assert.deepEqual(u.slice(6), ['## Query · 2 parameters', 'q | hello world', 'x | 1']);
  assert.equal((await app.run('url encode a&b=c d'))[0], '= a%26b%3Dc%20d');
  assert.equal((await app.run('url decode a%26b%3Dc%20d'))[0], '= a&b=c d');
  assert.equal((await app.run('url decode %zz'))[0], 'err: Not valid percent-encoding: %zz');

  const r = await app.run('regex /(\\d{3})-(\\d{4})/ call 555-1234 or 555-9876');
  assert.deepEqual(r, ['# 2 matches · /(\\d{3})-(\\d{4})/', 'call 555-1234 or 555-9876', '| # | at | match | groups',
    '1 | 5 | 555-1234 | 1=555  2=1234', '2 | 17 | 555-9876 | 1=555  2=9876']);
  assert.equal((await app.run('regex /^(?<user>[^@]+)@(?<domain>.+)$/ me@example.com'))[3], '1 | 0 | me@example.com | user=me  domain=example.com');
  assert.equal((await app.run('regex /a|/ ba'))[0], '# 3 matches · /a|/'); // empty matches don't loop for ever
  assert.equal((await app.run('regex /[/]x/'))[0], '# Valid · 0 groups · add some text after it to try it');
  assert.match((await app.run('regex /(/ x'))[0], /^err: Invalid regular expression/);
  assert.equal((await app.run('regex /zz/ abc'))[0], '# No match · /zz/');

  assert.deepEqual(await app.run('diff "the quick brown fox" "the quick red fox"'), ['# Differs · 2 words changed', '− the quick brown fox', '+ the quick red fox']);
  app.ctx.pasted = ['one\ntwo\nthree', 'one\n2\nthree\nfour'];
  assert.deepEqual(await app.run('diff x'), ['# Differs · −1 +2 · 3 lines → 4 lines', '  one', '- two', '+ 2', '  three', '+ four']);
  app.ctx.pasted = [];
  assert.equal((await app.run('diff "same" "same"'))[0], '# Identical · 1 line');
  assert.match((await app.run('diff only-one'))[0], /^# Usage/);

  const cr = await app.run('cron 30 9 * * 1-5');
  assert.deepEqual(cr.slice(0, 3), ['# At 09:30, on Monday to Friday · 30 9 * * 1-5', '## Next runs · your time', 'Tuesday 6 October | 09:30 | in 21 hours']);
  assert.equal((await app.run('cron 0 0 30 2 *'))[1], 'warn: never runs (no such date)');

  const col = await app.run('color #0af');
  assert.deepEqual(col, ['# #00aaff', 'SWATCH #00aaff | #ffffff Aa #00aaff on white | #000000 Aa #00aaff on black', 'hex: #00aaff', 'rgb: rgb(0 170 255)',
    'hsl: hsl(200 100% 50%)', 'on white: 2.56:1 fails', 'on black: 8.19:1 AAA']);
  const pair = await app.run('color #777 on white');
  assert.match(pair[0], /^err: Not a colour: 'white'/);
  const ok = await app.run('color #595959 on #fff');
  assert.equal(ok[0], '# 7.00:1 contrast · AAA');
  assert.equal(ok.tone, 'ok');
  assert.equal((await app.run('color #777 on #fff')).tone, 'warn');
});

test('text helpers: passwords, counting, case, IP ranges', async () => {
  const T = await import('../js/lib/text.js');
  // Uniform: values past the last whole multiple are drawn again, not folded.
  const seq = [0xffffffff, 7];
  const fake = { getRandomValues: (a) => { a[0] = seq.shift(); return a; } };
  assert.equal(T.randomBelow(10, fake), 7);
  for (let i = 0; i < 50; i++) {
    const p = T.password(12);
    assert.equal(p.length, 12);
    assert.ok(/[a-z]/.test(p) && /[A-Z]/.test(p) && /[2-9]/.test(p) && /[!#$%&*+\-=?@^_~]/.test(p), p);
    assert.ok(!/[lIO01]/.test(p), p);
  }
  assert.match(T.password(30, ['lower', 'upper', 'digits']), /^[a-zA-Z2-9]{30}$/);
  assert.match(T.pin(8), /^\d{8}$/);
  const { WORDS } = await import('../js/lib/wordlist.js');
  assert.equal(WORDS.length, 7776);
  assert.equal(new Set(WORDS).size, 7776);
  assert.equal(T.passphrase(WORDS, 6).split('-').length, 6);
  assert.equal(T.bits(7776, 6), 77);

  assert.deepEqual(T.countText('Hello world. It’s here!\n\nSecond para'), { characters: 36, noSpaces: 30, bytes: 38, words: 6, lines: 3,
    sentences: 3, paragraphs: 2, readingMinutes: 6 / 230 });
  assert.equal(T.countText('👍🏽 ok').characters, 5); // code points, not UTF-16 units
  assert.equal(T.countText('').lines, 0);

  assert.deepEqual(T.words('parseHTTPResponse_code-v2 now'), ['parse', 'http', 'response', 'code', 'v2', 'now']);
  const ws = T.words('user account ID');
  assert.deepEqual(Object.fromEntries(Object.entries(T.CASES).map(([k, f]) => [k, f(ws)])), {
    camel: 'userAccountId', pascal: 'UserAccountId', snake: 'user_account_id', kebab: 'user-account-id', constant: 'USER_ACCOUNT_ID',
    title: 'User Account Id', sentence: 'User account id', lower: 'user account id', upper: 'USER ACCOUNT ID', dot: 'user.account.id' });

  const ip = (s) => { const r = T.parseIP(s); return r && T.formatIP(r.n, r.family); };
  assert.equal(ip('2001:0db8:0000:0000:0001:0000:0000:0001'), '2001:db8::1:0:0:1'); // the first longest zero run
  assert.equal(ip('::ffff:192.0.2.1'), '::ffff:c000:201');
  assert.equal(ip('[::1]'), '::1');
  assert.equal(ip('1:0:0:2:0:0:0:3'), '1:0:0:2::3');
  for (const bad of ['1::2::3', '12345::', '1:2:3:4:5:6:7', '256.1.1.1', '1.2.3', '01.2.3.4', 'x']) assert.equal(T.parseIP(bad), null, bad);
  const r = T.parseCIDR('172.20.5.9/12');
  assert.deepEqual([T.formatIP(r.network, 4), T.formatIP(r.last, 4), T.formatIP(r.mask, 4), r.size], ['172.16.0.0', '172.31.255.255', '255.240.0.0', 1048576n]);
  assert.equal(T.parseCIDR('0.0.0.0/0').size, 2n ** 32n);
  assert.throws(() => T.parseCIDR('::/129'), /0 to 128/);
  assert.equal(T.contains(T.parseCIDR('2001:db8::/32'), T.parseIP('2001:db8:ffff::1')), true);
  assert.equal(T.contains(T.parseCIDR('10.0.0.0/8'), T.parseIP('::1')), false);
  assert.deepEqual(['10.1.1.1', '8.8.8.8', '100.64.0.1', 'fe80::1', '2606:4700::1111'].map((s) => T.ipKind(T.parseIP(s))),
    ['private', 'public', 'shared (carrier-grade NAT)', 'link-local', 'public']);
});

test('text commands: pw (kept out of the shared history), count, case, cidr', async () => {
  const app = await makeApp();
  const pw = await app.run('pw');
  assert.match(pw[0], /^# New password · 122 bits/);
  assert.match(pw[1], /^= .{20}$/);
  assert.equal(app.commands.byName.get('pw').private, true);
  assert.match((await app.run('pw words 4'))[1], /^= [a-z-]+(-[a-z-]+){3}$/);
  assert.match((await app.run('pw pin'))[1], /^= \d{6}$/);
  assert.equal((await app.run('pw 7'))[0], 'err: Length: 8 to 128');
  assert.equal((await app.run('pw words 2'))[0], 'err: Words: 3 to 12');
  assert.match((await app.run('pw nonsense'))[0], /^# Usage/);
  assert.equal(app.data.steps().undo.length, 0);

  assert.deepEqual((await app.run('count one two three')).slice(0, 2), ['# 3 words · 13 characters', 'characters: 13 · 11 without spaces']);
  const cs = await app.run('case user account id');
  assert.equal(cs[3], 'snake_case | user_account_id');
  assert.deepEqual(await app.run('case kebab parseHTTPResponse'), ['# kebab-case', '= parse-http-response']);
  const c = await app.run('cidr 10.0.1.5/22');
  assert.deepEqual(c, ['# 10.0.0.0/22 · IPv4 · private', 'address: 10.0.1.5 (inside the range)', 'network: 10.0.0.0/22', 'netmask: 255.255.252.0',
    'wildcard: 0.0.3.255', 'first: 10.0.0.1', 'last: 10.0.3.254', 'broadcast: 10.0.3.255', 'addresses: 1,024 · 1,022 usable hosts']);
  assert.equal((await app.run('cidr 10.0.0.0/22 10.0.3.9'))[0], '# 10.0.3.9 is in 10.0.0.0/22');
  assert.equal((await app.run('cidr 10.0.0.0/22 10.0.4.1')).tone, 'err');
  assert.deepEqual((await app.run('cidr 2001:db8::/48')).slice(0, 4), ['# 2001:db8::/48 · IPv6 · documentation', 'network: 2001:db8::/48', 'first: 2001:db8::',
    'last: 2001:db8:0:ffff:ffff:ffff:ffff:ffff']);
  assert.deepEqual(await app.run('cidr 10.0.0.1/31'), ['# 10.0.0.0/31 · IPv4 · private', 'address: 10.0.0.1 (inside the range)', 'network: 10.0.0.0/31',
    'netmask: 255.255.255.254', 'wildcard: 0.0.0.1', 'first: 10.0.0.0', 'last: 10.0.0.1', 'addresses: 2']);
});

test('snippets and later: the shared grammar, names, read state, undo, find, export, sync', async () => {
  const app = await makeApp();
  // Snippets: snip <name> <text> adds, snip <name> shows it ready to copy.
  assert.deepEqual(await app.run('snip sig Best regards, Mihail'), ['# Added snippet sig · s1']);
  const shown = await app.run('snip sig');
  assert.deepEqual(shown.slice(0, 2), ['# Snippet sig · s1', '= Best regards, Mihail']);
  assert.equal(shown.copied, 'Best regards, Mihail');
  assert.equal((await app.run('snippets s1'))[1], '= Best regards, Mihail'); // by id too
  assert.match((await app.run('snip sig again'))[0], /^err: There is already a snippet named 'sig'/);
  assert.match((await app.run('snip s2 text'))[0], /^err: The name is one word/); // ids aren't names
  await app.run('snippets add addr "1 Long Street, Sofia"');
  assert.equal((await app.run('snip addr'))[1], '= 1 Long Street, Sofia');
  const list = await app.run('snippets');
  assert.deepEqual(list, ['# 2 snippets · snip <name> copies one', '| id | name | text', 's2 | addr | 1 Long Street, Sofia', 's1 | sig | Best regards, Mihail']);
  // Edit by name or id, rename, refuse a clash.
  await app.run('snip sig edit text Cheers, M');
  assert.equal(app.data.state.snippets.items[0].text, 'Cheers, M');
  assert.equal((await app.run('snippets s1 edit name addr'))[0], "err: a snippet named 'addr' already exists");
  await app.run('snippets s1 edit name signature');
  assert.equal((await app.run('snip signature'))[1], '= Cheers, M');
  // A multi-line snippet shows as code with its own copy button.
  await app.run('snip poem roses are red\nviolets are blue');
  assert.deepEqual((await app.run('snip poem')).slice(1, 3), ['roses are red', 'violets are blue']);
  await app.run('snip poem rm');
  assert.equal(app.data.state.snippets.items.length, 2);
  await app.run('undo');
  assert.equal(app.data.state.snippets.items.length, 3);

  // Later: a URL first saves it; lists the unread; open marks read and opens after the command.
  assert.deepEqual(await app.run('later example.com/long-read A long read'), ['# Saved for later l1 · A long read']);
  assert.equal(app.data.state.later.items[0].url, 'https://example.com/long-read');
  await app.run('later add https://blog.example.org/post');
  assert.deepEqual(await app.run('later https://example.com/long-read'), ['# Already saved as l1']);
  assert.equal((await app.run('later javascript:alert(1)'))[0], '# No links match "javascript:alert(1)"'); // not a link, so a filter
  assert.equal(app.data.state.later.items.length, 2);
  assert.match((await app.run('later add javascript:alert(1)'))[0], /^err: 'javascript:alert\(1\)' is not a web address/);
  const l = await app.run('later');
  assert.deepEqual(l.slice(0, 4), ['# 2 links to read', '| id | link | site | saved', 'l2 | blog.example.org/post | blog.example.org | today', 'l1 | A long read | example.com | today']);
  app.ctx.navigateAfter = null;
  await app.run('later l1 open');
  assert.equal(app.ctx.navigateAfter, 'https://example.com/long-read');
  app.ctx.navigateAfter = null;
  assert.equal(app.data.state.later.items[0].read, true);
  await app.run('later l2 done');
  assert.match((await app.run('later'))[0], /^# Nothing left to read · 2 links read/);
  assert.equal((await app.run('later all'))[0], '# 0 links to read · and 2 read');
  await app.run('later l2 edit read no');
  assert.equal((await app.run('later'))[0], '# 1 link to read');
  assert.ok((await app.run('later l1')).includes('read: ✓ read  [later l1 edit read = yes]'));
  assert.equal((await app.run('later l1 edit url not a url'))[0], "err: url 'not a url' is not a web address (https://…)");

  // find sees both.
  const f = await app.run('find long read');
  assert.ok(f.includes('## Read later 1'));
  assert.ok((await app.run('find cheers')).includes('## Snippets 1'));

  // Export, then import into an empty hub: everything comes back; again: nothing doubles.
  const file = await app.store.exportAll();
  assert.equal(file.collections.snippets.items.length, 3);
  const other = await makeApp();
  const { merge: mergeImport } = await import('../js/core/importer.js');
  const cur = {};
  for (const k of Object.keys(DEFAULTS)) cur[k] = other.data.state[k];
  const r = mergeImport(cur, file, other.commands.isBuiltin, () => MON);
  assert.equal(r.counts.snippets, 3);
  assert.equal(r.counts.later, 2);
  const again = mergeImport(r.collections, file, other.commands.isBuiltin, () => MON);
  assert.deepEqual([again.counts.snippets, again.counts.later], [0, 0]);
  assert.ok(again.lines.includes("skipped snippet 'signature': already exists"));

  // Sync: both made s1 offline; one is renumbered, both kept.
  const gh = fakeGitHub({ tokens: ['tok'], repos: { 'me/data': { private: true } } });
  const dev = async () => {
    const a = await makeApp();
    a.ctx.sync = createSync({ data: a.data, store: a.store, now: () => new Date(MON), fetch: gh.fetch, device: 'test' });
    return a;
  };
  const A = await dev(), B = await dev();
  await A.run('snip one first');
  await B.run('snip two second');
  await B.run('later example.com/x');
  await A.ctx.sync.setup('me/data', null, 'tok');
  const rb = await B.ctx.sync.setup('me/data', null, 'tok');
  assert.deepEqual(rb.renumbered, [{ from: 's1', to: 's2' }]);
  await A.ctx.sync.syncNow();
  for (const x of [A, B]) {
    assert.deepEqual(x.data.state.snippets.items.map((s) => s.id + ':' + s.name), ['s1:one', 's2:two']);
    assert.equal(x.data.state.later.items[0].url, 'https://example.com/x');
  }
});
