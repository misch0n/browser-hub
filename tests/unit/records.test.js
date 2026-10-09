import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../js/core/aliases.js';
import { edit, actionFor, historySearch } from '../../js/core/lineedit.js';
import * as R from '../../js/core/repeat.js';
import * as S from '../../js/core/search.js';
import * as Sum from '../../js/core/summary.js';
import { makeApp, MON } from '../helpers.mjs';
import { DEFAULTS } from '../../js/core/data.js';

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

test('recurring events: series rules, every view shows the occurrences, edits and removal act on the series', async () => {
  // The rule alone.
  assert.ok(R.occursOn('week', '2026-10-09', '2026-10-23') && !R.occursOn('week', '2026-10-09', '2026-10-22'));
  assert.ok(!R.occursOn('week', '2026-10-09', '2026-10-02')); // never before the start
  assert.ok(R.occursOn('2w', '2026-10-09', '2026-11-06') && !R.occursOn('2w', '2026-10-09', '2026-10-16'));
  assert.ok(R.occursOn('weekday', '2026-10-05', '2026-10-09') && !R.occursOn('weekday', '2026-10-05', '2026-10-10'));
  assert.ok(R.occursOn('month', '2026-01-31', '2026-02-28') && R.occursOn('month', '2026-01-31', '2026-03-31') && !R.occursOn('month', '2026-01-31', '2026-03-30'));
  assert.ok(R.occursOn('year', '2024-02-29', '2025-02-28') && R.occursOn('year', '2024-02-29', '2028-02-29') && !R.occursOn('year', '2024-02-29', '2028-02-28'));
  assert.ok(R.occursOn('3m', '2026-01-15', '2026-07-15') && !R.occursOn('3m', '2026-01-15', '2026-06-15'));
  assert.equal(R.nextOn('month', '2026-01-31', '2026-04-01'), '2026-04-30');
  assert.equal(R.nextOn('2w', '2026-10-02', '2026-10-09'), '2026-10-16');
  assert.equal(R.nextOn('mon,thu', '2026-10-05', '2026-10-07'), '2026-10-08');
  assert.equal(R.nextOn('day', '2026-10-09', '2026-10-01'), '2026-10-09'); // not started yet: its start

  const app = await makeApp(); // Monday 5 October 2026
  assert.match((await app.run('ev fri 19:00 book club every:week'))[1], /book club  Friday 9 Oct 19:00  ↻ every week, from then on|book club/);
  const e = app.data.state.events.items[0];
  assert.deepEqual([e.date, e.time, e.title, e.repeat], ['2026-10-09', '19:00', 'book club', 'week']);
  await app.run('ev wed standup every:mon,thu'); // starts on the first day the rule has
  assert.equal(app.data.state.events.items[1].date, '2026-10-08');
  assert.match((await app.run('ev fri lunch every:fortnightly'))[0], /^err: Can't read the repeat 'fortnightly'/);
  // agenda and today: each occurrence on its day.
  const ag = (await app.run('agenda 14')).join('\n');
  assert.equal((ag.match(/book club/g) || []).length, 2); // 9 and 16 October
  assert.equal((ag.match(/standup/g) || []).length, 3); // agenda 14 is 5-18 Oct: Thu 8, Mon 12, Thu 15
  app.setNow(new Date(2026, 9, 16, 9, 0));
  assert.ok((await app.run('today')).some((l) => /19:00 \| ?e1|19:00  e1  book club/.test(l) || /book club/.test(l)));
  // cal marks every Friday from the 9th; the list shows each occurrence.
  const cal = await app.run('cal');
  assert.ok(cal.some((l) => /^CAL/.test(l)));
  assert.equal(cal.filter((l) => /book club/.test(l)).length, 4); // 9, 16, 23, 30 October
  // events: the next occurrence, with the rule; events all: as stored.
  const list = (await app.run('events')).join('\n');
  assert.match(list, /e1 \| Friday 16 Oct.*book club  ↻ every week/);
  assert.match((await app.run('events all')).join('\n'), /e1 \| Friday 9 Oct/);
  // show: next and a note that changes apply to the series.
  const shown = (await app.run('events e1')).join('\n');
  assert.match(shown, /repeat: ↻ every week/);
  assert.match(shown, /next: Friday 16 October · today/);
  assert.match(shown, /every occurrence/);
  // Editing the rule; none ends it (a one-off on its first date).
  await app.run('events e1 edit repeat 2w');
  assert.equal(app.data.state.events.items[0].repeat, '2w');
  await app.run('events e1 edit repeat none');
  assert.equal(app.data.state.events.items[0].repeat, undefined);
  assert.match((await app.run('events e1 edit repeat sometimes'))[0], /^err: .*can't read 'sometimes'/);
  await app.run('undo'); await app.run('undo');
  assert.equal(app.data.state.events.items[0].repeat, 'week');
  // Removing removes the series, and says so.
  assert.match((await app.run('events e2 rm'))[0], /Removed event e2 · the whole series \(every Monday, Thursday\)/);
  // Import carries the rule; a bad one is dropped.
  const { merge: mergeImport } = await import('../../js/core/importer.js');
  const other = await makeApp();
  const cur = {};
  for (const k of Object.keys(DEFAULTS)) cur[k] = other.data.state[k];
  const imp = mergeImport(cur, { schema: 1, collections: { events: { items: [{ date: '2026-11-01', title: 'rent', repeat: 'month' }, { date: '2026-11-02', title: 'x', repeat: 'often' }] } } }, other.commands.isBuiltin, () => MON);
  assert.deepEqual(imp.collections.events.items.map((x) => x.repeat), ['month', undefined]);
});
