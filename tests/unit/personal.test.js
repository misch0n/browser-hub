import test from 'node:test';
import assert from 'node:assert/strict';
import { createSync } from '../../js/sync.js';
import { fakeGitHub } from '../fake-github.mjs';
import { DEFAULTS } from '../../js/core/data.js';
import * as P from '../../js/core/personal.js';
import { monthIndex } from '../../js/core/util.js';
import { MON, makeApp } from '../helpers.mjs';

test('personal helpers: birthday dates and ages, monthly cost of a subscription', () => {
  assert.deepEqual(P.parseBirthday('12 mar 1986', monthIndex, 2026), { date: '03-12', year: 1986 });
  assert.deepEqual(P.parseBirthday('March 12th', monthIndex, 2026), { date: '03-12', year: null });
  assert.deepEqual(P.parseBirthday('12.03', monthIndex, 2026), { date: '03-12', year: null });
  assert.equal(P.parseBirthday('29 feb 1985', monthIndex, 2026), null);
  assert.equal(P.parseBirthday('12 mar 2031', monthIndex, 2026), null); // not born yet
  assert.deepEqual(P.nextBirthday({ date: '10-05', year: 1990 }, '2026-10-05'), { date: '2026-10-05', age: 36, days: 0 });
  assert.deepEqual(P.nextBirthday({ date: '10-04', year: null }, '2026-10-05'), { date: '2027-10-04', age: null, days: 364 });
  assert.equal(P.birthdayIn({ date: '02-29' }, 2027), '2027-02-28');
  assert.equal(P.perMonth({ price: 120, every: 'year' }), 10);
  assert.equal(P.perMonth({ price: 30, every: '3m' }), 10);
});

test('birthdays: add with or without a year, list by next date, and they show in agenda and today', async () => {
  const app = await makeApp(); // Monday 5 October 2026
  let out = await app.run('birthdays add Ana Petrova 7 oct 1990');
  assert.equal(out[0], '# Added birthday b1 · Ana Petrova');
  assert.match(out[1], /^Wednesday 7 October · turns 36 in 2 days/);
  await app.run('birthdays add Grandma 5 october');
  assert.match((await app.run('birthdays add Bob'))[0], /^err: Give a name and a date/);
  out = await app.run('birthdays');
  assert.equal(out[0], '# 2 birthdays · 1 today');
  assert.ok(out.includes('b2 | Grandma | Monday 5 October |  | today 🎂'));
  assert.ok(out.includes('b1 | Ana Petrova | Wednesday 7 October | turns 36 | in 2 days'));
  const ag = (await app.run('agenda')).join('\n');
  assert.match(ag, /🎂 Grandma’s birthday/);
  assert.match(ag, /🎂 Ana Petrova turns 36/);
  assert.ok((await app.run('today')).some((l) => /🎂 Grandma’s birthday/.test(l)));
  assert.match((await app.run('birthdays b1 edit date 7 oct 1991'))[0], /Updated/);
  assert.equal(app.data.state.birthdays.items[0].year, 1991);
  assert.ok((await app.run('find grandma')).some((l) => /Birthdays/.test(l)));
  assert.match((await app.run('birthdays b2 rm'))[0], /^# Removed birthday b2/);
});

test('lists: checklists by name, tick by number or text, reset, drop, rename', async () => {
  const app = await makeApp();
  let out = await app.run('lists add packing passport, charger, toothbrush');
  assert.equal(out[0], '# Added list packing · 3 items');
  assert.equal(out.tone, 'ok');
  assert.ok(out.includes('☐ | 1 | passport'));
  out = await app.run('lists packing check 2');
  assert.equal(out[0], '# packing · 1 of 3 done');
  assert.ok(out.includes('☑ | 2 | charger'));
  await app.run('lists packing check tooth');
  await app.run('lists packing add socks; sunglasses');
  assert.equal((await app.run('lists packing'))[0], '# packing · 2 of 5 done');
  assert.equal((await app.run('lists packing reset'))[0], '# packing · 0 of 5 done');
  await app.run('lists packing drop socks');
  assert.deepEqual(app.data.state.lists.items[0].entries.map((e) => e.text), ['passport', 'charger', 'toothbrush', 'sunglasses']);
  assert.match((await app.run('lists packing check 9'))[0], /^err: No item 9/);
  assert.match((await app.run('lists add packing'))[0], /^err: A list named 'packing' already exists/);
  out = await app.run('lists');
  assert.ok(out.includes('packing | 0 of 4 | passport, charger, toothbrush, sunglasses'));
  await app.run('lists packing edit name travel');
  assert.equal((await app.run('lists travel'))[0], '# travel · 0 of 4 done');
  await app.run('undo');
  assert.equal(app.data.state.lists.items[0].name, 'packing');
  assert.ok((await app.run('find sunglasses')).some((l) => /Lists/.test(l)));
});

test('subs: price, currency, renewal rule; totals per currency; renewals in the agenda', async () => {
  const app = await makeApp();
  let out = await app.run('subs add Netflix 15.99 EUR every:month next:7 oct');
  assert.equal(out[0], '# Added subscription p1 · Netflix');
  assert.equal(out[1], '15.99 EUR every month · next Wednesday 7 October · 15.99 a month');
  await app.run('subs add domain 12 USD every:year next:2027-02-01');
  await app.run('subs add iCloud 2.99'); // currency of the last one, monthly, from today
  assert.deepEqual(app.data.state.subs.items[2], { id: 'p3', name: 'iCloud', price: 2.99, currency: 'USD', every: 'month', next: '2026-10-05', created: MON.toISOString() });
  out = await app.run('subs');
  assert.match(out[0], /^# 3 subscriptions · 15\.99 EUR a month \+ 3\.99 USD a month$/);
  assert.ok(out.includes('EUR: 15.99 a month · 191.88 a year'));
  assert.match((await app.run('agenda'))[2] + (await app.run('agenda')).join('\n'), /Netflix renews · 15\.99 EUR/);
  // The next date moves on by itself.
  app.setNow(new Date(2026, 10, 20, 12));
  assert.ok((await app.run('subs')).some((l) => /^p1 \| Netflix \| 15\.99 EUR \| month \| Monday 7 December/.test(l)));
  assert.match((await app.run('subs add x'))[0], /^err: subs add <name> <price>/);
  assert.match((await app.run('subs p1 edit every sometimes'))[0], /^err: every is week, month, year/);
  await app.run('subs p1 edit price €17.99');
  assert.equal(app.data.state.subs.items[0].price, 17.99);
});

test('log: write for today, read a day, a month or the week; on this day in today', async () => {
  const app = await makeApp();
  app.setNow(new Date(2025, 9, 5, 9));
  await app.run('log first day at the new job');
  app.setNow(new Date(2026, 9, 4, 21));
  await app.run('log long walk by the river');
  app.setNow(MON);
  let out = await app.run('log finished the report');
  assert.equal(out[0], '# Written j3 · 1 entry today');
  out = await app.run('log');
  assert.equal(out[0], '# 2 entries · the last 7 days');
  assert.ok(out.includes('j3  finished the report'));
  out = await app.run('log yesterday');
  assert.equal(out[0], '# 1 entry · Sunday 4 October');
  assert.equal((await app.run('log october 2025'))[0], '# 1 entry · October 2025');
  assert.equal((await app.run('log week'))[0], '# 2 entries · the last 7 days');
  await app.run('log yesterday was a good day'); // more than a date: an entry
  assert.equal(app.data.state.journal.items[3].text, 'yesterday was a good day');
  out = await app.run('today');
  assert.ok(out.includes('## On this day  from your log'));
  assert.ok(out.includes('2025  first day at the new job'));
  await app.run('log j4 edit date yesterday');
  assert.equal(app.data.state.journal.items[3].date, '2026-10-04');
  assert.ok((await app.run('find river')).some((l) => /Journal/.test(l)));
});

test('eat: log foods from the nutrition table with amounts and portions, the day, the week, a target', async () => {
  const app = await makeApp();
  let out = await app.run('eat 150 g chicken breast raw');
  assert.match(out[0], /^# Logged Chicken breast.*· \d+ kcal$/);
  const m1 = app.data.state.meals.items[0];
  assert.deepEqual([m1.date, m1.time, m1.grams], ['2026-10-05', '12:00', 150]);
  assert.ok(m1.kcal > 100 && m1.kcal < 250);
  await app.run('eat 2 eggs + 1 slice bread');
  assert.equal(app.data.state.meals.items.length, 3);
  assert.match(app.data.state.meals.items[1].label, /×/);
  assert.match((await app.run('eat 100 g unobtainium'))[0], /^err: No food matches "unobtainium"/);
  out = await app.run('eat');
  assert.match(out[0], /^# Today · [\d,]+ kcal$/);
  assert.ok(out.some((l) => /^total: [\d,]+ kcal · protein/.test(l)));
  assert.equal((await app.run('eat target 2000'))[0], '# Daily target 2,000 kcal · on every device');
  assert.match((await app.run('eat'))[0], /^# Today · [\d,]+ of 2,000 kcal · [\d,]+ left$/);
  assert.match((await app.run('eat target 50'))[0], /^err: A target is 500 to 10,000/);
  // Editing the amount scales what was saved.
  const before = app.data.state.meals.items[0].kcal;
  await app.run('eat m1 edit grams 300');
  assert.equal(app.data.state.meals.items[0].kcal, Math.round(before * 2 * 10) / 10);
  assert.equal((await app.run('eat yesterday'))[0], '# Sunday 4 October · 0 of 2,000 kcal · 2,000 left');
  out = await app.run('eat week');
  assert.match(out[0], /^# The last 7 days · [\d,]+ kcal a day on average$/);
  assert.match(out[1], /█  Tu We Th Fr Sa Su Mo$/); // today is the tallest bar, last
  // Your own food works the same.
  await app.run('cook calorie add lyutenitsa 75 kcal 1.5 protein 2.5 fat 11 carbs');
  out = await app.run('eat 200 g lyutenitsa');
  assert.match(out[0], /^# Logged lyutenitsa · 150 kcal$/);
  assert.match((await app.run('eat m4 rm'))[0], /^# Removed meal m4/);
});

test('the personal collections sync between devices, renumbered on a clash; export and import carry them', async () => {
  const gh = fakeGitHub({ tokens: ['tok'], repos: { 'me/data': { private: true } } });
  const dev = async () => {
    const a = await makeApp();
    a.ctx.sync = createSync({ data: a.data, store: a.store, now: () => new Date(MON), fetch: gh.fetch, device: 'test' });
    return a;
  };
  const A = await dev(), B = await dev();
  await A.run('lists add groceries milk, bread');
  await B.run('lists add packing passport');
  await A.run('birthdays add Ana 7 oct 1990');
  await B.run('timer 10m tea');
  await A.ctx.sync.setup('me/data', null, 'tok');
  const rb = await B.ctx.sync.setup('me/data', null, 'tok');
  assert.deepEqual(rb.renumbered, [{ from: 'c1', to: 'c2' }]);
  await A.ctx.sync.syncNow();
  for (const x of [A, B]) {
    assert.deepEqual(x.data.state.lists.items.map((l) => l.id + ':' + l.name), ['c1:groceries', 'c2:packing']);
    assert.equal(x.data.state.birthdays.items.length, 1);
    assert.equal(x.data.state.timers.items[0].name, 'tea');
  }
  // Import checks each item and gives fresh ids.
  const { merge: mergeImport } = await import('../../js/core/importer.js');
  const cur = {};
  for (const k of Object.keys(DEFAULTS)) cur[k] = B.data.state[k];
  const imp = mergeImport(cur, { schema: 1, collections: {
    subs: { items: [{ name: 'gym', price: 30, currency: 'BGN', every: 'month', next: '2026-11-01' }, { name: 'bad', price: -1, currency: 'X', every: 'never', next: 'no' }] },
    lists: { items: [{ name: 'packing', entries: [] }, { name: 'tools', entries: [{ text: 'saw', done: true }] }] },
    meals: { items: [{ date: '2026-10-05', food: 'apple', grams: 150, kcal: 78 }] },
  } }, B.commands.isBuiltin, () => MON);
  assert.deepEqual(imp.counts.subs, 1);
  assert.equal(imp.invalid, 1);
  assert.deepEqual(imp.collections.lists.items.map((l) => l.name), ['groceries', 'packing', 'tools']);
  assert.ok(imp.lines.includes("skipped list 'packing': already exists"));
  assert.equal(imp.counts.meals, 1);
});
