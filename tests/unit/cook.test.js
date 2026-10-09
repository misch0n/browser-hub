import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../js/core/aliases.js';
import { edit, actionFor, historySearch } from '../../js/core/lineedit.js';
import * as K from '../../js/core/keys.js';
import * as P from '../../js/core/paste.js';
import { createSync } from '../../js/sync.js';
import { fakeGitHub } from '../fake-github.mjs';
import * as C from '../../js/core/completion.js';
import { createData, DEFAULTS } from '../../js/core/data.js';
import { merge } from '../../js/core/importer.js';
import * as F from '../../js/core/format.js';
import { convert } from '../../js/lib/units.js';
import { MON, makeApp } from '../helpers.mjs';

test('cook: safe and best temperatures, oven times, measures to grams', async () => {
  const K = await import('../../js/lib/cooking.js');
  // The safe temperatures are the USDA's; nothing marked "best" below safe goes without a warning.
  const safe = Object.fromEntries(K.TARGETS.map((t) => [t.id, t.safe.c]));
  assert.deepEqual([safe['chicken-breast'], safe['chicken-whole'], safe['poultry-ground'], safe['ground-meat'], safe['beef-steak'], safe['pork-loin'], safe.salmon, safe.leftovers, safe.eggs],
    [74, 74, 74, 71, 63, 63, 63, 74, 71]);
  for (const t of K.TARGETS) {
    const below = t.best.some((b) => b.c < t.safe.c);
    assert.equal(!!t.below, below, t.id + ': below flag');
    if (below) assert.ok(t.warn, t.id + ' needs a warning');
  }
  for (const o of K.OVEN) {
    if (o.target) assert.ok(K.TARGETS.find((t) => t.id === o.target), o.id + ' -> ' + o.target);
    assert.ok(o.temp >= o.range[0] && o.temp <= o.range[1], o.id);
  }
  assert.deepEqual([K.toF(74), K.toF(63), K.toC(350), K.gasMark(180), K.gasMark(160), K.gasMark(220), K.gasMark(120)], [165, 145, 177, '4', '3', '7', '½']);

  // Finding food: every word starts a word of the name or keys; an id wins outright.
  assert.deepEqual(K.lookup(K.OVEN, 'chicken').map((x) => x.id), ['chicken-whole', 'chicken-breast', 'chicken-thighs', 'chicken-drumsticks', 'chicken-wings']);
  assert.deepEqual(K.lookup(K.OVEN, 'whole chicken').map((x) => x.id), ['chicken-whole']);
  assert.deepEqual(K.lookup(K.TARGETS, 'burgers').map((x) => x.id), ['poultry-ground', 'ground-meat']);
  assert.deepEqual(K.lookup(K.OVEN, 'chicken-breast').map((x) => x.id), ['chicken-breast']);

  // Reading what you typed.
  assert.deepEqual(K.readOven('chicken 500g at 200'), { kg: 0.5, tempC: 200, fan: false, done: null, given: { n: 200, unit: 'C' }, food: 'chicken' });
  assert.equal(K.readOven('chicken 2 lb 400f').tempC, 204);
  assert.equal(K.readOven('chicken 1,5 kg').kg, 1.5);
  assert.equal(K.readOven('beef 1.5 kg medium rare').done, 'medium-rare');
  assert.deepEqual([K.readOven('turkey 6kg gas 4').tempC, K.readOven('lamb fan 160').fan], [180, true]);
  assert.equal(K.readOven('roast 350').tempC, 177); // a bare 350 can only be °F

  // Oven times: by weight for joints, by thickness for pieces, slower when cooler, refused outside the range.
  const by = (id) => K.OVEN.find((o) => o.id === id);
  assert.equal(Math.round(K.ovenTime(by('chicken-whole'), 1.6).minutes), 84); // 40 min/kg + 20
  assert.equal(Math.round(K.ovenTime(by('turkey-whole'), 5).minutes), 190); // 20 min/kg + 90 over 4.5 kg
  assert.equal(Math.round(K.ovenTime(by('turkey-whole'), 4).minutes), 150); // + 70 under
  assert.ok(K.ovenTime(by('chicken-whole'), 1.6, 180).minutes > K.ovenTime(by('chicken-whole'), 1.6, 200).minutes);
  assert.deepEqual([K.ovenTime(by('chicken-breast'), 0.5).low, K.ovenTime(by('chicken-breast'), 2).low], [20, 20]); // weight doesn't matter
  assert.match(K.ovenTime(by('chicken-whole'), 1.6, 120).error, /too cool/);
  assert.match(K.ovenTime(by('chicken-whole'), 1.6, 260).error, /too hot/);
  assert.equal(K.ovenTime(by('beef-roast'), 1.5, null, 'rare').done, 'rare');
  assert.ok(K.ovenTime(by('beef-roast'), 1.5, null, 'well done').minutes > K.ovenTime(by('beef-roast'), 1.5, null, 'rare').minutes);
  assert.deepEqual([K.fmtMinutes(84), K.fmtMinutes(7), K.fmtMinutes(120), K.fmtRange(20, 25), K.fmtRange(150, 180)], ['1 h 25 min', '7 min', '2 h', '20–25 min', '2 h 30 min–3 h']);

  // Measures: amounts written every way, spoons, sticks, eggs, weights; grams back to cups.
  for (const [s, n] of [['1 1/2 cups', 1.5], ['1½ cups', 1.5], ['½ cup', 0.5], ['3/4 cup', 0.75], ['0,5 l', 0.5], ['a cup', 1], ['half a cup', 0.5], ['two tbsp', 2], ['a quarter cup', 0.25]]) {
    assert.equal(K.readAmount(s).n, n, s);
  }
  const g = (s) => { const r = K.readConvert(s); return r.grams === undefined ? r : Math.round(r.grams * 10) / 10; };
  assert.equal(g('1 spoon sugar'), 12.5);
  assert.equal(g('1 tbsp sugar'), 12.5);
  assert.equal(g('1 tsp sugar'), 4.2);
  assert.equal(g('2 cups flour'), 250);
  assert.equal(g('1 cup brown sugar'), 220); // not white sugar
  assert.equal(g('1 cup icing sugar'), 120);
  assert.equal(g('1 cup cream cheese'), 232); // not cream
  assert.equal(g('½ stick butter'), 56.5);
  assert.equal(g('2 sticks of butter'), 226);
  assert.equal(g('3 T honey'), 63.8); // T tablespoon, t teaspoon
  assert.equal(g('1 t salt'), 6);
  assert.equal(g('8 oz cream cheese'), 226.8);
  assert.equal(g('1 lb butter'), 453.6);
  assert.equal(g('2 eggs'), 100);
  assert.equal(g('3 yolks'), 54);
  assert.equal(g('1 uk pint milk'), 579.8);
  assert.equal(g('2 fl oz oil'), 53.2);
  assert.match(K.readConvert('1 stick flour').error, /measure of butter/);
  assert.match(K.readConvert('some flour').error, /start with an amount/);
  assert.match(K.readConvert('2 handfuls flour').error, /say a measure/);
  assert.equal(K.readConvert('1 cup unicorn').ingredient, null);
  const flour = K.INGREDIENTS.find((i) => i.id === 'flour');
  assert.deepEqual(K.asMeasures(250, flour), ['2 cups']);
  assert.deepEqual(K.asMeasures(31.25, flour), ['¼ cup', '4 tbsp']);
  assert.deepEqual(K.asMeasures(6, K.INGREDIENTS.find((i) => i.id === 'salt')), ['1 tsp']);
  assert.deepEqual(K.asMeasures(56.5, K.INGREDIENTS.find((i) => i.id === 'butter')), ['¼ cup', '4 tbsp', '½ stick']);
  assert.deepEqual([K.fmtGrams(12.5), K.fmtGrams(4.17), K.fmtGrams(312.5), K.fmtGrams(1250)], ['12.5 g', '4.2 g', '313 g', '1.25 kg']);
});

test('cook command: target, oven, convert', async () => {
  const app = await makeApp();
  const ck = await app.run('cook target chicken breast');
  assert.deepEqual(ck.slice(0, 4), ['# Chicken or turkey breast · inside temperature', '## Chicken or turkey breast  ⚠ best is below safe', 'safe: 74°C (165°F)', 'juicy: 65°C (149°F)']);
  assert.equal(ck.tone, 'warn');
  assert.ok(ck.some((l) => /^warn: Pregnant, very young/.test(l)));
  const all = await app.run('cook target');
  assert.ok(all.includes('## Poultry'));
  assert.ok(all.includes('Burgers, mince, meatballs, meatloaf (beef, pork, lamb) | 71°C | done 71°C | ⚠'));
  assert.match((await app.run('cook target unicorn'))[0], /^err: No temperatures for "unicorn"/);

  const ov = await app.run('cook oven chicken 500g at 200');
  assert.equal(ov[0], '# 5 ways with "chicken" · 500 g at 200°C · tap one for details');
  assert.ok(ov.includes('Chicken breasts (boneless) | 200°C | 20–25 min | 74°C'));
  const whole = await app.run('cook oven whole chicken 1.6kg');
  assert.deepEqual(whole.slice(0, 4), ['# Whole chicken · 1.6 kg at 190°C', 'oven: 190°C (374°F) · fan 170°C · gas 5', 'time: about 1 h 25 min · start checking at 1 h 15 min',
    'done at: 74°C (165°F) inside · cook target chicken-whole']);
  assert.equal(whole.copied, '1 h 25 min');
  const fan = await app.run('cook oven lamb leg 2kg fan 160');
  assert.equal(fan[0], '# Leg of lamb · 2 kg at 180°C (160°C fan)');
  assert.ok(fan.includes('done at: 57–60°C (135–140°F) inside · cook target beef-steak'));
  assert.ok((await app.run('cook oven chicken breasts 1kg')).includes('dim: Pieces cook by their thickness, not the total weight: 1 kg of them takes as long as one'));
  assert.match((await app.run('cook oven whole chicken at 120'))[1], /^err: At 120°C it is too cool/);
  assert.deepEqual(await app.run('cook oven steak'), ['err: No oven times for "steak" · cook oven lists them', 'Its temperatures: cook target steak']);

  const sp = await app.run('cook convert 1 spoon sugar');
  assert.equal(sp[0], '# 1 tablespoon sugar = 12.5 g');
  assert.equal(sp.copied, '12.5');
  assert.ok(sp.includes('dim: A spoon is taken as a tablespoon (15 ml); say tsp for a teaspoon'));
  assert.equal((await app.run('cook convert ½ stick butter'))[0], '# ½ stick butter = 57 g');
  assert.equal((await app.run('cook convert 250 g flour'))[0], '# 250 g flour ≈ 2 cups');
  assert.equal((await app.run('cook convert 350f'))[0], '# 350°F = 177°C · fan 157°C · gas 4');
  assert.equal((await app.run('cook convert gas 6'))[0], '# gas 6 = 200°C (392°F) · fan 180°C · gas 6');
  const unknown = await app.run('cook convert 1 cup unicorn');
  assert.deepEqual(unknown.slice(0, 2), ['# 1 cup = 240 ml', "warn: I don't know how much unicorn weighs per cup; as water it would be 240 g"]);
  const table = await app.run('cook convert');
  assert.ok(table.includes('flour (plain, all-purpose) | 125 g | 7.8 g | 2.6 g'));
  assert.match((await app.run('cook bake'))[0], /^# /);
  assert.match((await app.run('cook nonsense'))[0], /^# Usage/);
});

test('nutrition data: USDA SR28 values, consistent with themselves and with the food list', async () => {
  const data = await import('../../js/lib/nutrition-data.js');
  const { FOODS: LIST } = await import('../../tools/nutrition-foods.mjs');
  const N = await import('../../js/lib/nutrition.js');
  const items = N.prepare(data);
  // The generated file is exactly the list (regenerate it after editing the list).
  const listed = Object.entries(LIST).flatMap(([g, l]) => l.map(([id, name, state, words]) => [id, g, name, state, words]));
  assert.deepEqual(items.map((f) => [f.id, f.group, f.name, f.state, f.words]), listed);
  assert.equal(new Set(items.map((f) => f.id)).size, items.length);
  assert.ok(items.length >= 300);
  // Known values from USDA's own tables.
  const by = (id) => items.find((f) => f.id === id).values;
  assert.deepEqual([by('05062').kcal, by('05062').protein, by('05062').fat], [120, 22.5, 2.62]); // chicken breast, raw
  assert.deepEqual([by('05064').kcal, by('05064').protein], [165, 31.02]); // roasted
  assert.deepEqual([by('01123').kcal, by('20045').kcal, by('09003').kcal, by('19411').kcal], [143, 130, 52, 532]); // egg, cooked rice, apple, crisps
  for (const f of items) {
    const v = f.values;
    assert.ok(typeof v.kcal === 'number' && v.kcal >= 0, f.id + ' kcal');
    for (const k of ['protein', 'fat', 'carbs']) assert.ok(typeof v[k] === 'number' && v[k] >= 0, f.id + ' ' + k);
    // Parts of 100 g add up to no more than 100 g (a shifted column would break this).
    assert.ok(v.protein + v.fat + v.carbs + (v.water || 0) <= 101, f.id + ' adds up to more than 100 g');
    // Energy agrees with the macronutrients (Atwater 4/9/4), apart from alcohol.
    const est = 4 * v.protein + 9 * v.fat + 4 * v.carbs;
    if (!/alcohol|beer|wine|spirits/i.test(f.usda + f.words)) assert.ok(Math.abs(v.kcal - est) <= Math.max(25, 0.15 * v.kcal), f.id + ' ' + f.name + ': ' + v.kcal + ' vs ' + Math.round(est));
    if (v.sat !== null) assert.ok(v.sat <= v.fat + 0.01, f.id + ' saturated > fat');
    if (v.sugar !== null) assert.ok(v.sugar <= v.carbs + 0.5, f.id + ' sugars > carbs');
  }
  for (const n of data.NUTRIENTS) assert.ok(['main', 'mineral', 'vitamin'].includes(n[4]));

  // Finding foods: every word, plurals, raw/cooked, ids; weights anywhere.
  const names = (q) => N.findFoods(items, q).map((f) => f.name + (f.state ? ' · ' + f.state : ''));
  assert.deepEqual(names('chicken breast skinless'), ['Chicken breast, skinless · raw', 'Chicken breast, skinless · roasted', 'Chicken breast, skinless · grilled', 'Chicken breast, skinless · fried']);
  assert.deepEqual(names('chicken breast skinless raw'), ['Chicken breast, skinless · raw']);
  assert.ok(names('chicken breast cooked').every((n) => !/· raw/.test(n)));
  assert.ok(names('chicken').length >= 20);
  assert.ok(names('eggs').includes('Egg, whole · hard-boiled'));
  assert.deepEqual(names('crisps'), ['Potato crisps (chips)']);
  assert.ok(names('chips').includes('Tortilla chips'));
  assert.deepEqual(names('05062'), ['Chicken breast, skinless · raw']);
  assert.deepEqual(names('5062'), ['Chicken breast, skinless · raw']);
  assert.deepEqual(names('unicorn'), []);
  assert.deepEqual(N.readWeight('chicken breast 250g raw'), { grams: 250, rest: 'chicken breast raw' });
  assert.deepEqual(N.readWeight('rice 1,5 kg'), { grams: 1500, rest: 'rice' });
  assert.equal(Math.round(N.readWeight('steak 8 oz').grams), 227);
  assert.deepEqual(N.readWeight('chicken'), { grams: null, rest: 'chicken' });
  assert.deepEqual([N.fmtNum(22.5), N.fmtNum(0.0283), N.fmtNum(165.4), N.fmtNum(null), N.fmtNum(0), N.fmtNum(1234.5)], ['22.5', '0.028', '165', '–', '0', '1,235']);
  assert.equal(N.salt(400), 1);
});

test('cook calorie: a table for many, everything for one, scaled to a weight', async () => {
  const app = await makeApp();
  const t = await app.run('cook calorie chicken breast');
  assert.equal(t[0], '# 6 foods for "chicken breast" · per 100 g · tap one for everything in it');
  assert.equal(t[1], '| food |  | kcal | protein g | fat g | carbs g');
  assert.equal(t[2], 'Chicken breast, skinless | raw | 120 | 22.5 | 2.6 | 0');
  assert.ok(t.some((l) => /^dim: Cooking drives water out/.test(l)));
  const many = await app.run('cook calorie chocolate');
  assert.ok(many.includes('## Snacks and sweets'));
  const one = await app.run('cook calorie chicken breast skinless raw 250g');
  assert.deepEqual(one.slice(0, 8), ['# Chicken breast, skinless · raw · per 250 g', 'energy: 300 kcal · 1,255 kJ · 15% of 2,000 kcal', 'protein: 56.3 g',
    'fat: 6.6 g · saturated 1.4 g', 'carbohydrate: 0 g · sugars 0 g', 'fibre: 0 g', 'salt: 0.28 g · sodium 113 mg', 'cholesterol: 183 mg']);
  assert.ok(one.includes('selenium | 57 µg | 104%'));
  assert.ok(one.includes('niacin (B3) | 24 mg | 150%'));
  assert.equal(one.copied, '300');
  assert.ok(one.some((l) => /NDB 05062: Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw$/.test(l)));
  assert.ok((await app.run('cook calorie 05062')).includes('energy: 120 kcal · 502 kJ · 6% of 2,000 kcal'));
  const scaled = await app.run('cook calorie rice cooked 150g');
  assert.equal(scaled[2], 'Rice, white, long-grain | boiled | 195 | 4 | 0.42 | 42.3');
  assert.deepEqual((await app.run('cook calorie unicorn')).slice(0, 1), ['err: No food matches "unicorn"']);
  assert.equal((await app.run('cook calorie chicken 0g'))[0], 'err: Give an amount between 1 g and 100 kg');
  const groups = await app.run('cook calorie');
  assert.match(groups[0], /^# Calories and nutrients · \d+ foods, raw and cooked · per 100 g$/);
  assert.ok(groups.some((l) => /^Poultry \| Chicken breast, Chicken breast with skin/.test(l)));
  for (const alias of ['calories', 'kcal', 'nutrition', 'macros']) assert.match((await app.run('cook ' + alias + ' apple raw'))[0], /^# Apple · raw · per 100 g$/);
});

test('chance: unbiased integers, random options, dice notation and rolls', async () => {
  const Ch = await import('../../js/lib/chance.js');
  // A fake random source: 53-bit draws built from pairs of 32-bit values.
  const fake = (pairs) => { const q = pairs.flat(); return { getRandomValues: (a) => { a[0] = q.shift(); a[1] = q.shift(); return a; } }; };
  assert.equal(Ch.randomInt(1, 6, fake([[0, 0]])), 1);
  assert.equal(Ch.randomInt(1, 6, fake([[0, 5]])), 6);
  assert.equal(Ch.randomInt(1, 6, fake([[0x1fffff, 0xffffffff], [0, 2]])), 3); // past the last whole multiple: drawn again
  assert.throws(() => Ch.randomInt(0, 2 ** 53 + 1), /too large/);
  for (let i = 0; i < 2000; i++) { const v = Ch.randomInt(-3, 3); assert.ok(v >= -3 && v <= 3 && Number.isInteger(v)); }
  const seen = new Set(Array.from({ length: 600 }, () => Ch.randomInt(1, 6)));
  assert.equal(seen.size, 6);

  const r = (s) => { const o = Ch.readRandom(s); return o.error || [o.min, o.max, o.places, o.count, o.unique, o.digits]; };
  assert.deepEqual(r(''), [1, 100, 0, 1, false, null]);
  assert.deepEqual(r('50'), [1, 50, 0, 1, false, null]);
  assert.deepEqual(r('10-20'), [10, 20, 0, 1, false, null]);
  assert.deepEqual(r('20 to 10'), [10, 20, 0, 1, false, null]);
  assert.deepEqual(r('-5..5'), [-5, 5, 0, 1, false, null]);
  assert.deepEqual(r('0.5-2.25'), [0.5, 2.25, 2, 1, false, null]);
  assert.deepEqual(r('6 digits'), [100000, 999999, 0, 1, false, 6]);
  assert.deepEqual(r('length 4 x3'), [1000, 9999, 0, 3, false, 4]);
  assert.deepEqual(r('1-49 x6 unique'), [1, 49, 0, 6, true, null]);
  assert.deepEqual(r('5 times 1..10'), [1, 10, 0, 5, false, null]);
  assert.equal(r('1-3 x5 unique'), 'only 3 different numbers fit between 1 and 3');
  assert.equal(r('banana'), "didn't understand 'banana'");
  assert.equal(r('20 digits'), 'between 1 and 15 digits');
  const lotto = Ch.drawRandom(Ch.readRandom('1-49 x6 unique'));
  assert.equal(new Set(lotto).size, 6);
  assert.ok(lotto.every((v) => v >= 1 && v <= 49));
  assert.ok(Ch.drawRandom(Ch.readRandom('0.5-2.5 x50')).every((v) => v >= 0.5 && v <= 2.5 && Math.round(v * 10) === v * 10));
  assert.equal(Ch.fmtRandom(42, { digits: 4 }), '0042');

  const d = (s) => { const x = Ch.readDice(s); return x.error || Ch.diceText(x); };
  assert.deepEqual(['d20', '2d6+3', '2d6 - 1', 'd%', '1d8+1d6+2', '4d6kh3', '4d6dl1', '2d20kl1', 'd20+5 adv', 'd20 dis', 'd20 adv + d4'].map(d),
    ['d20', '2d6+3', '2d6-1', 'd100', 'd8+d6+2', '4d6kh3', '4d6kh3', '2d20kl1', 'd20+5 with advantage', 'd20 with disadvantage', 'd20+d4 with advantage']);
  assert.match(d('2d6 3'), /put \+ or -/);
  assert.match(d('d1'), /2 to 1,000 sides/);
  assert.match(d('101d6'), /1 and 100 dice/);
  assert.match(d('2d6 adv'), /one d20/);
  assert.match(d('5'), /no dice/);
  assert.match(d('4d6kh5'), /keep between 1 and 4/);
  // Rolls with known dice: keep the highest 3 of 4, advantage keeps the better d20.
  const seq = (vals) => fake(vals.map((v) => [0, v - 1]));
  const k = Ch.rollDice(Ch.readDice('4d6kh3'), seq([3, 1, 6, 1]));
  assert.equal(k.total, 10);
  assert.deepEqual(k.terms[0].rolls, [{ v: 3, kept: true }, { v: 1, kept: true }, { v: 6, kept: true }, { v: 1, kept: false }]);
  assert.equal(Ch.rollDice(Ch.readDice('d20+5 adv'), seq([7, 15])).total, 20);
  assert.equal(Ch.rollDice(Ch.readDice('d20 dis'), seq([7, 15])).total, 7);
  assert.equal(Ch.rollDice(Ch.readDice('2d6-1'), seq([4, 3])).total, 6);
  assert.equal(Ch.rollDice(Ch.readDice('d8-d4'), seq([5, 3])).total, 2);
});

test('random and roll commands', async () => {
  const app = await makeApp();
  const one = await app.run('random 10-20');
  assert.equal(one[0], '# Random number · 10 to 20');
  assert.ok(+one.copied >= 10 && +one.copied <= 20);
  const lotto = await app.run('random 1-49 x6 unique');
  assert.equal(lotto[0], '# 6 different numbers · 1 to 49');
  const nums = lotto[1].slice(2).split(', ').map(Number);
  assert.deepEqual(nums, nums.slice().sort((a, b) => a - b));
  assert.match((await app.run('random 4 digits'))[1], /^= \d{4}$/);
  assert.match((await app.run('random nonsense'))[0], /^err: didn't understand/);

  const all = await app.run('roll');
  assert.equal(all[0], '# One of each · d4 d6 d8 d10 d12 d20 d100 · tap one to roll it again');
  assert.deepEqual(all.slice(1).map((l) => l.split(' | ')[0]), ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']);
  for (const l of all.slice(1)) { const [die, v] = l.split(' | '); assert.ok(+v >= 1 && +v <= +die.slice(1), l); }
  const d6 = await app.run('roll d6');
  assert.match(d6[0], /^# d6 = [1-6]$/);
  assert.equal(d6.length, 1);
  const two = await app.run('roll 2d6+3');
  assert.match(two[0], /^# 2d6\+3 = (\d+)$/);
  assert.match(two[1], /^\[[1-6] [1-6]\] \+ 3$/);
  const stats = await app.run('roll stats');
  assert.match(stats[0], /^# Ability scores · 4d6, lowest dropped · (\d+, ){5}\d+ · total \d+$/);
  assert.equal(stats.length, 7);
  assert.match((await app.run('roll d20 adv'))[0], /^# d20 with advantage = \d+/);
  assert.match((await app.run('roll 2d6 adv'))[0], /^err: advantage needs one d20/);
  assert.equal(app.data.steps().undo.length, 0);
});

test('own foods, portions and meals: reading labels, amounts and portion sizes', async () => {
  const N = await import('../../js/lib/nutrition.js');
  const { readAmount } = await import('../../js/lib/cooking.js');
  const L = (s) => N.readFoodLabel(s);
  assert.deepEqual(L('lyutenitsa 75 kcal 1.5 protein 2.5 fat 11 carbs'), { name: 'lyutenitsa', values: { kcal: 75, protein: 1.5, fat: 2.5, carbs: 11 }, portion: null });
  assert.deepEqual(L('kefir kcal 52 protein 3.3 fat 1.8 carbs 4.7 sugar 4.7 salt 0.1'), { name: 'kefir', values: { kcal: 52, protein: 3.3, fat: 1.8, carbs: 4.7, sugar: 4.7, salt: 0.1 }, portion: null });
  assert.deepEqual(L('banana bread 320kcal 5g protein 12g fat 48g carbs'), { name: 'banana bread', values: { kcal: 320, protein: 5, fat: 12, carbs: 48 }, portion: null });
  // Values for a portion become per 100 g, and the portion is kept for counting.
  assert.deepEqual(L('"oat bar" kcal 190 protein 4 fat 7 carbs 27 per 1 bar = 45 g'),
    { name: 'oat bar', values: { kcal: 422.22, protein: 8.89, fat: 15.56, carbs: 60 }, portion: { name: 'bar', g: 45 } });
  assert.deepEqual(L('soup 60 kcal per 250g').values, { kcal: 24 });
  assert.match(L('75 kcal').error, /start with the food/);
  assert.match(L('thing 75 kcal 3').error, /'3' has no label/);
  assert.match(L('thing kcal 75 vitamins 3').error, /'vitamins' isn't kcal/);
  assert.match(L('thing 1.5 protein').error, /at least the kcal/);
  assert.match(L('thing 950 kcal').error, /more than pure fat/);
  assert.match(L('thing 75 kcal per slice').error, /portion/);

  const Q = (s) => N.readQuantity(s, readAmount);
  assert.deepEqual(Q('200g chicken breast'), { grams: 200, rest: 'chicken breast' });
  assert.deepEqual(Q('chicken breast 1.5 kg'), { grams: 1500, rest: 'chicken breast' });
  assert.deepEqual(Q('2 eggs'), { count: 2, unit: null, rest: 'eggs' });
  assert.deepEqual(Q('½ cup rice'), { count: 0.5, unit: 'cup', rest: 'rice' });
  assert.deepEqual(Q('2 slices of bread'), { count: 2, unit: 'slices', rest: 'bread' });
  assert.deepEqual(Q('a banana'), { count: 1, unit: null, rest: 'banana' });
  assert.deepEqual(Q('05062'), { rest: '05062' });
  assert.deepEqual(Q('7up'), { rest: '7up' });
  assert.deepEqual(N.mealParts('200g chicken + 150g rice; 1 tbsp oil'), ['200g chicken', '150g rice', '1 tbsp oil']);
  assert.equal(N.mealParts('chicken breast'), null);

  const item = { portions: [[118, '1 medium'], [225, '1 cup, mashed'], [8.5, '1 tbsp']] };
  const P = (c, u) => N.portionGrams(item, c, u, readAmount);
  assert.deepEqual(P(2, null), { grams: 236, label: '2 × 1 medium' });
  assert.deepEqual(P(1, null), { grams: 118, label: '1 medium' });
  assert.deepEqual(P(1, 'medium'), { grams: 118, label: '1 medium' });
  assert.equal(P(2, 'tbsp').grams, 2 * 225 / 16); // from the cup: the first volume portion
  assert.equal(P(1, 'tsp').grams, 225 / 48);
  assert.equal(P(1, 'slice'), null);
  assert.equal(N.portionGrams({ portions: [[28, '1 oz']] }, 1, null, readAmount), null); // an ounce is a weight, not a thing
});

test('cook calorie: your own foods in the shared grammar, portions, meals, sync and import', async () => {
  const app = await makeApp();
  assert.deepEqual(await app.run('cook calorie add lyutenitsa 75 kcal 1.5 protein 2.5 fat 11 carbs'),
    ['# Added food f1 · lyutenitsa', 'per 100 g: 75 kcal · protein 1.5 g · fat 2.5 g · carbs 11 g']);
  await app.run('cook calorie add "oat bar" kcal 190 protein 4 fat 7 carbs 27 per 1 bar = 45 g');
  assert.match((await app.run('cook calorie add Lyutenitsa 80 kcal'))[0], /^err: You already have Lyutenitsa \(f1\)/);
  assert.equal(app.data.state.foods.items[1].portionG, 45);
  // Shown with its fields, editable in place; found by name; counted by its portion.
  const shown = await app.run('cook calorie f1');
  assert.equal(shown[0], '# food f1');
  assert.ok(shown.includes('kcal: 75 kcal per 100 g  [cook calorie f1 edit kcal = 75]'));
  assert.ok(shown.includes('sugar: none  [cook calorie f1 edit sugar = none]'));
  assert.equal((await app.run('cook calorie lyutenitsa'))[0], '# food f1');
  const bars = await app.run('cook calorie 2 bars oat bar');
  assert.equal(bars[bars.length - 1], '2 × 1 bar = 90 g: 380 kcal · protein 8 g · fat 14 g · carbs 54 g');
  assert.equal(bars.copied, '380');
  assert.deepEqual((await app.run('cook calorie f1 edit kcal 80')).slice(0, 1), ['# Updated cook calorie f1 kcal']);
  assert.equal(app.data.state.foods.items[0].kcal, 80);
  assert.match((await app.run('cook calorie f1 edit kcal lots'))[0], /^err: kcal is a number from 0 to 900/);
  assert.match((await app.run('cook calorie f1 edit portion 1 jar = 260 g'))[0], /Updated/);
  assert.deepEqual([app.data.state.foods.items[0].portionName, app.data.state.foods.items[0].portionG], ['1 jar', 260]);
  const mine = await app.run('cook calorie mine');
  assert.deepEqual(mine.slice(2), ['lyutenitsa | yours | 80 | 1.5 | 2.5 | 11', 'oat bar | yours | 422 | 8.9 | 15.6 | 60']);
  assert.match((await app.run('cook calorie overview'))[0], /^err: No food matches/);
  assert.ok((await app.run('cook calorie')).some((l) => /^Yours \| lyutenitsa, oat bar$/.test(l)));

  // USDA foods by count and by measure.
  assert.equal((await app.run('cook calorie a banana'))[0], '# Banana · raw · 1 medium = 118 g');
  assert.equal((await app.run('cook calorie 2 eggs whole hard-boiled'))[0], '# Egg, whole · hard-boiled · 2 × 1 large = 100 g');
  assert.equal((await app.run('cook calorie 1 tbsp olive oil'))[0], '# Olive oil · 1 tbsp = 13.5 g');
  assert.equal((await app.run('cook calorie 2 cloves garlic'))[0], '# Garlic · raw · 2 × 1 clove = 6 g');
  assert.match((await app.run('cook calorie 2 slices chicken breast skinless raw'))[0], /^err: No portion size for Chicken breast, skinless in slices/);
  const eggs = await app.run('cook calorie 2 eggs');
  assert.equal(eggs[1], '| food |  | weight | kcal | protein g | fat g | carbs g');
  assert.ok(eggs.includes('Egg, whole | raw | 100 g | 143 | 12.6 | 9.5 | 0.72'));

  // A meal: amounts and foods added up, which food was picked said, rows open the food.
  const m = await app.run('cook calorie 200g chicken breast raw + 150g rice cooked + 1 tbsp olive oil + 100g lyutenitsa');
  assert.equal(m[0], '# Meal · 4 items · 634 kcal');
  assert.deepEqual(m.slice(1, 7), ['| amount | food | kcal | protein g | fat g | carbs g',
    '200 g | Chicken breast, skinless · raw | 240 | 45 | 5.2 | 0', '150 g | Rice, white, long-grain · boiled | 195 | 4 | 0.42 | 42.3',
    '1 tbsp · 13.5 g | Olive oil | 119 | 0 | 13.5 | 0', '100 g | lyutenitsa | 80 | 1.5 | 2.5 | 11', ' | Total | 634 | 50.5 | 21.7 | 53.3']);
  assert.ok(m.includes('dim: "chicken breast raw": Chicken breast, skinless, raw (1 of 2 that match; add words for another)'));
  assert.equal(m.copied, '634');
  const bad = await app.run('cook calorie 100g unicorn + 2 slices chicken breast skinless raw + rice cooked');
  assert.equal(bad.tone, 'warn');
  assert.ok(bad.some((l) => /no food matches "unicorn"/.test(l)));
  assert.ok(bad.some((l) => /no portion size for Chicken breast, skinless: give grams/.test(l)));
  assert.ok(bad.includes('dim: rice cooked: no amount given, counted 100 g'));

  // Remove and undo; export and import; sync between devices.
  await app.run('cook calorie f2 rm');
  assert.equal(app.data.state.foods.items.length, 1);
  await app.run('undo');
  assert.equal(app.data.state.foods.items.length, 2);
  const file = await app.store.exportAll();
  assert.equal(file.collections.foods.items.length, 2);
  const other = await makeApp();
  const { merge: mergeImport } = await import('../../js/core/importer.js');
  const cur = {};
  for (const k of Object.keys(DEFAULTS)) cur[k] = other.data.state[k];
  const imp = mergeImport(cur, file, other.commands.isBuiltin, () => MON);
  assert.equal(imp.counts.foods, 2);
  assert.deepEqual(imp.collections.foods.items.map((f) => [f.id, f.name, f.kcal, f.portionG]), [['f1', 'lyutenitsa', 80, 260], ['f2', 'oat bar', 422.22, 45]]);
  const bogus = mergeImport(cur, { schema: 1, collections: { foods: { items: [{ name: 'x', kcal: 5000 }, { name: '', kcal: 1 }, { name: 'ok', kcal: 10 }] } } }, other.commands.isBuiltin, () => MON);
  assert.deepEqual([bogus.counts.foods, bogus.invalid], [1, 2]);

  const gh = fakeGitHub({ tokens: ['tok'], repos: { 'me/data': { private: true } } });
  const dev = async () => {
    const a = await makeApp();
    a.ctx.sync = createSync({ data: a.data, store: a.store, now: () => new Date(MON), fetch: gh.fetch, device: 'test' });
    return a;
  };
  const A = await dev(), B = await dev();
  await A.run('cook calorie add kefir 52 kcal 3.3 protein 1.8 fat 4.7 carbs');
  await B.run('cook calorie add ayran 35 kcal 1.7 protein 1.8 fat 2.4 carbs');
  await A.ctx.sync.setup('me/data', null, 'tok');
  const rb = await B.ctx.sync.setup('me/data', null, 'tok');
  assert.deepEqual(rb.renumbered, [{ from: 'f1', to: 'f2' }]);
  await A.ctx.sync.syncNow();
  for (const x of [A, B]) assert.deepEqual(x.data.state.foods.items.map((f) => f.id + ':' + f.name), ['f1:kefir', 'f2:ayran']);
});
