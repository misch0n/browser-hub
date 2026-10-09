import test from 'node:test';
import assert from 'node:assert/strict';
import * as U from '../../js/core/util.js';
import * as A from '../../js/core/aliases.js';
import { edit, actionFor, historySearch } from '../../js/core/lineedit.js';
import { tokenize, oneValue, quote } from '../../js/core/args.js';
import * as K from '../../js/core/keys.js';
import * as R from '../../js/core/repeat.js';
import * as P from '../../js/core/paste.js';
import * as C from '../../js/core/completion.js';
import * as F from '../../js/core/format.js';
import { evaluate, formatNumber } from '../../js/lib/calc.js';
import { convert } from '../../js/lib/units.js';
import * as M from '../../js/lib/misc.js';
import * as Z from '../../js/lib/zones.js';
import { MON, makeApp } from '../helpers.mjs';

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
  assert.equal(w[0], '# Widgets · 3 of 8 on');
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
  assert.match(help[0], /^# Help · \d+ commands · tap one for everything about it$/);
  // Categories tagged as built-in, one row per command (its name and what it does), then your engines and aliases.
  assert.ok(help.includes('## View  ⚙ built-in'));
  assert.ok(help.includes('## Aliases & engines  ⚙ built-in'));
  assert.ok(help.includes('theme | switch colour theme') || help.some((l) => /^theme \| /.test(l)));
  // A command's short names follow it after a comma; they get no row of their own.
  assert.ok(help.some((l) => /^tasks, t \| /.test(l)));
  assert.ok(help.some((l) => /^notes, n \| /.test(l)));
  assert.ok(help.some((l) => /^events, ev \| /.test(l)));
  assert.ok(help.some((l) => /^snippets, snip \| /.test(l)));
  assert.ok(help.some((l) => /^aliases, alias \| /.test(l)));
  assert.ok(!help.some((l) => /^t \| /.test(l)));
  assert.ok(!help.some((l) => /^tasks add /.test(l))); // names, not every form
  assert.ok(help.includes('## Your search engines  ⌕ engine'));
  assert.ok(help.some((l) => /^g \| https:\/\/www\.google\.com\/search\?q=\{\}  ★ default$/.test(l)));
  assert.ok(help.includes('## Your aliases  ↗ alias'));
  assert.ok(help.includes('none yet | alias <name> <url> · alias <name> <command>'));
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
  // A command without what it needs shows the same full help, headed Usage.
  const u = await app.run('qr');
  assert.deepEqual(u.slice(0, 4), ['# Usage · qr', 'a QR code for text or a link, to scan with a phone', '## Usage', 'qr <text>']);
  assert.equal(u.tone, 'err');
  assert.ok(u.includes('## Examples'));
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

test('font: bigger and smaller in steps, a percentage, reset; help and keys are for now', async () => {
  const app = await makeApp();
  let scale = 1;
  app.ctx.fontScale = () => scale;
  app.ctx.setFontScale = (f) => { scale = f; };
  assert.equal((await app.run('font'))[0], '# Text size 100% on this device');
  assert.equal((await app.run('font bigger'))[0], '# Text size 110% on this device');
  await app.run('font bigger');
  assert.equal(scale, 1.2);
  await app.run('font smaller');
  await app.run('font smaller');
  await app.run('font smaller');
  assert.equal(scale, 0.9);
  await app.run('font smaller');
  const floor = await app.run('font smaller');
  assert.deepEqual(floor, ['# Text size 80% (already)', 'dim: That is the smallest step']);
  await app.run('font 150%');
  assert.equal(scale, 1.5);
  assert.equal((await app.run('font 300'))[0], 'err: Between 70% and 200%');
  await app.run('font reset');
  assert.equal(scale, 1);
  assert.match((await app.run('font huge'))[0], /^# Usage/);
  assert.equal(app.data.steps().undo.length, 0);
  // Help and the key list stay out of the shared history and leave the screen after the next command.
  assert.equal(app.commands.byName.get('help').ephemeral, true);
  assert.equal(app.commands.byName.get('keys').ephemeral, true);
  assert.notEqual(app.commands.byName.get('help').noHistory, true); // still recalled with ↑
});

test('completion offers the next input where it is known', async () => {
  const app = await makeApp();
  const env = { defs: app.commands.defs.filter((d) => !d.hidden), entries: app.data.state.aliases.entries, history: [] };
  const vals = (input) => C.complete(input, env).candidates.map((c) => c.value);
  assert.ok(vals('units 5 ').length > 20);
  assert.ok(vals('units 5 k').includes('km') && vals('units 5 k').includes('kg'));
  assert.deepEqual(vals('units 5 km '), ['to']);
  assert.ok(vals('units 5 km to m').includes('mi'));
  assert.deepEqual(vals('cal n'), ['next', 'november']);
  assert.deepEqual(vals('agenda '), ['7', '14', '30']);
  assert.ok(vals('date fr').includes('friday'));
  assert.deepEqual(vals('date friday '), ['+', '-', 'to']);
  assert.deepEqual(vals('cron @d'), ['@daily']);
  assert.ok(vals('cook ').includes('calorie'));
  assert.ok(vals('roll d').includes('d20'));
  assert.ok(vals('help ro').includes('roll'));
  // Tab on an empty argument with one known choice completes it; with several, the second Tab lists them.
  assert.deepEqual(C.applyTab('units 5 km ', env), { input: 'units 5 km to ' });
  assert.ok(C.applyTab('agenda ', env).list.length === 3);
});

test('docs: the command reference (docs/commands.md, the README table) matches the code', async () => {
  const { staleDocs } = await import('../../tools/docs-commands.mjs');
  assert.deepEqual(staleDocs(), [], 'run: node tools/docs-commands.mjs --write');
});

test('refresh: asks for a reload from the server once the command is recorded', async () => {
  const app = await makeApp();
  app.ctx.reloadAfter = false;
  assert.deepEqual(await app.run('refresh'), ['# Refreshing · loading the page anew']);
  assert.equal(app.ctx.reloadAfter, true);
  app.ctx.reloadAfter = false;
  assert.match((await app.run('refresh now'))[0], /Usage/);
  assert.equal(app.ctx.reloadAfter, false);
});
