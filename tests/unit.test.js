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
import * as R from '../js/core/repeat.js';
import * as S from '../js/core/search.js';
import * as Sum from '../js/core/summary.js';
import * as Merge from '../js/core/merge.js';
import { createSync } from '../js/sync.js';
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

test('sync command: status, setup asks for the token, cancel, errors, off', async () => {
  const gh = fakeGitHub({ tokens: ['tok'], repos: { 'me/data': { private: true } } });
  const app = await makeApp();
  app.ctx.sync = createSync({ data: app.data, store: app.store, now: () => new Date(MON), fetch: gh.fetch, device: 'test' });
  let answer = null;
  const asked = [];
  app.ctx.askSecret = async (label) => { asked.push(label); return answer; };
  assert.match((await app.run('sync'))[0], /^# Sync is off/);
  assert.equal((await app.run('sync setup not-a-repo'))[0], "err: 'not-a-repo' is not owner/repository");
  assert.equal((await app.run('sync setup me/data'))[0], '# Cancelled; nothing was saved'); // Esc
  assert.deepEqual(asked, ['GitHub token for me/data (hidden)']);
  answer = 'bad';
  const bad = await app.run('sync setup me/data');
  assert.ok(bad.includes('err: GitHub refused the token (expired or revoked)'));
  answer = 'tok';
  const ok = await app.run('sync setup me/data');
  assert.ok(ok.includes('# Syncing with me/data · browser-hub.json'));
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
