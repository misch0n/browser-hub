import {
  TARGETS, OVEN, INGREDIENTS, VOLUMES, FAN, toF, toC, gasMark, lookup, readOven, ovenTime, fmtMinutes, fmtRange,
  readConvert, asMeasures, fmtAmount, fmtGrams, readAmount,
} from '../lib/cooking.js';
import { plural } from '../core/util.js';
import { prepare, findFoods, per, fmtNum, salt, ownItem, readFoodLabel, readQuantity, portionGrams, mealParts } from '../lib/nutrition.js';

// cook: a kitchen reference (lib/cooking.js).
//   cook target [food]                       safe and best internal temperatures
//   cook oven [food] [weight] [temp] [fan]   oven temperature and time
//   cook convert <amount> <measure> <food>   cups and spoons to grams (and back)

const deg = (c) => c + '°C (' + toF(c) + '°F)';
const degRange = (c, to) => (to ? c + '–' + to + '°C (' + toF(c) + '–' + toF(to) + '°F)' : deg(c));
const VULNERABLE = 'Pregnant, very young, elderly or immunocompromised? Use the safe temperatures, not the "best" ones below them';

function targetDetail(out, t) {
  out.section([[t.name, 'strong'], [t.below ? '  ⚠ best is below safe' : '', 'warn']]);
  const rows = [['safe', [[deg(t.safe.c), 'strong'], [t.safe.hold ? ' · then rest ' + t.safe.hold + ' min' : '', 'dim']]]];
  for (const b of t.best) rows.push([b.label, [[degRange(b.c, b.to), b.c < t.safe.c ? 'warn' : 'ok']]]);
  out.kv(rows);
  if (t.note) out.dim(t.note);
  if (t.warn) out.warn(t.warn);
}

// What the inside should read: the chosen doneness, else the best (if not below safe), else safe.
function goalFor(e, done) {
  const t = TARGETS.find((x) => x.id === e.target);
  if (!t) return null;
  if (done === 'pink') return { t, goal: { c: 57, to: 60 } }; // lamb
  const want = e.doneness ? t.best.find((b) => b.label === done) : null;
  return { t, goal: want || (t.best[0].c >= t.safe.c ? t.best[0] : { c: t.safe.c }) };
}

function ovenRow(e, kg, tempC, done) {
  const r = ovenTime(e, kg, tempC, done);
  const at = tempC || e.temp;
  const time = r.error ? [['not at ' + at + '°C', 'err']]
    : r.perPiece ? [[fmtRange(r.low, r.high), 'num']]
      : [[(r.sear ? fmtMinutes(r.sear.min) + ' + ' : '') + fmtMinutes(r.minutes), 'num'], [' for ' + fmtKg(r.kg), 'faint']];
  const g = goalFor(e, r.done);
  return [[[e.name, 'strong', { run: 'cook oven ' + e.id + (kg ? ' ' + fmtKg(kg).replace(' ', '') : '') + (tempC ? ' ' + tempC + 'c' : '') }]],
    [[(tempC || e.temp) + '°C', 'num'], [tempC ? '' : ' · fan ' + (e.temp - FAN), 'faint']], time,
    g ? [[g.goal.c + (g.goal.to ? '–' + g.goal.to : '') + '°C', 'dim']] : [['', '']]];
}

const fmtKg = (kg) => (kg < 1 ? Math.round(kg * 1000) + ' g' : Math.round(kg * 100) / 100 + ' kg');

function ovenDetail(ctx, e, q) {
  const { out } = ctx;
  const tempC = q.tempC === null ? null : q.fan ? q.tempC + FAN : q.tempC;
  const r = ovenTime(e, q.kg, tempC, q.done);
  const at = tempC || e.temp;
  out.head([[e.name, 'strong'], [' · ' + (r.perPiece || !r.kg ? '' : fmtKg(r.kg) + ' at ') + (r.perPiece ? 'at ' : '') + at + '°C' + (q.fan ? ' (' + q.tempC + '°C fan)' : ''), 'dim']], r.error ? 'err' : 'ok');
  if (r.error) {
    out.err('At ' + at + '°C it is ' + r.error + ': cook it between ' + e.range[0] + ' and ' + e.range[1] + '°C (usually ' + e.temp + '°C)');
    return;
  }
  const rows = [];
  rows.push(['oven', [[deg(at), 'strong'], [' · fan ' + (at - FAN) + '°C · gas ' + gasMark(at), 'dim']]]);
  if (r.sear) rows.push(['first', [[fmtMinutes(r.sear.min) + ' at ' + r.sear.temp + '°C', 'num'], [' (fan ' + (r.sear.temp - FAN) + '°C) to brown, then turn it down', 'dim']]]);
  if (r.perPiece) {
    rows.push(['time', [[fmtRange(r.low, r.high), 'num strong'], [r.sear ? ' after that' : '', 'dim']]]);
  } else {
    rows.push(['time', [['about ' + fmtMinutes(r.minutes), 'num strong'], [(r.sear ? ' after that' : '') + ' · start checking at ' + fmtMinutes(r.low), 'dim']]]);
    if (r.sear) rows.push(['in all', [['about ' + fmtMinutes(r.sear.min + r.minutes), 'num']]]);
  }
  if (e.doneness) {
    rows.push(['doneness', [[r.done, 'accent'], [' · also ' + Object.keys(e.doneness).filter((d) => d !== r.done).join(', '), 'faint']]]);
  }
  const g = goalFor(e, r.done);
  const t = g && g.t;
  if (g) {
    const { goal } = g;
    rows.push(['done at', [[degRange(goal.c, goal.to) + ' inside', 'strong'], [' · ', 'faint'], ['cook target ' + t.id, 'accent', { run: 'cook target ' + t.id }]]]);
  }
  if (e.rest) rows.push(['rest', [[e.rest, ''], [' before carving: it keeps cooking a few degrees', 'faint']]]);
  out.kv(rows);
  if (e.note) out.dim(e.note);
  if (r.unknownDone) out.warn(e.name + ' is cooked ' + Object.keys(e.doneness).join(', ') + '; showing ' + r.done);
  if (r.perPiece && q.kg) out.dim('Pieces cook by their thickness, not the total weight: ' + fmtKg(q.kg) + ' of them takes as long as one');
  if (!r.perPiece && !q.kg) out.dim('For ' + fmtKg(r.kg) + '; give the weight for yours: cook oven ' + e.id + ' 2kg');
  if (tempC && tempC !== e.temp) out.dim('Usually ' + e.temp + '°C; times at other temperatures are estimates');
  if (t && t.warn) out.warn(t.warn);
  out.dim('Times are a guide: a thermometer in the thickest part says when it is done');
  out.copyable(fmtMinutes(r.perPiece ? r.high : r.minutes));
}

// ---- calories and nutrients (lib/nutrition-data.js, loaded the first time) ----

let foodsCache = null;
async function nutrition() {
  if (!foodsCache) {
    const data = await import('../lib/nutrition-data.js');
    foodsCache = { data, items: prepare(data) };
  }
  return foodsCache;
}

const MAX_ROWS = 40;
const isRawish = (f) => f.state === 'raw' || f.state === 'dry' || f.state === 'uncooked';

// How much of `f` the quantity means: { grams, label } or null (a count with no portion size known).
function amountOf(f, q) {
  if (q.grams) return { grams: q.grams, label: fmtNum(q.grams) + ' g' };
  if (q.count) return portionGrams(f, q.count, q.unit, readAmount);
  return null;
}

// One food and how much of it, for the meal log (eat): the first food that
// matches, its amount from grams or a portion (one portion, else 100 g, when
// none is given). -> { food, name, grams, label, values, others } | { error }
export async function foodAmount(state, text) {
  const { items: usda } = await nutrition();
  const items = [...state.foods.items.map(ownItem), ...usda];
  const q = readQuantity(text, readAmount);
  if (q.grams !== undefined && !(q.grams > 0 && q.grams <= 5000)) return { error: 'Give an amount between 1 g and 5 kg' };
  if (!q.rest) return { error: 'Name a food: eat 150 g chicken breast' };
  const list = /^f\d+$/i.test(q.rest) ? items.filter((f) => f.id === q.rest.toLowerCase()) : findFoods(items, q.rest);
  if (!list.length) return { error: 'No food matches "' + q.rest + '" (cook calorie ' + q.rest.split(' ')[0] + ' to look, cook calorie add to save your own)' };
  let f = list.find(isRawish) && /\b(raw|uncooked)\b/.test(q.rest) ? list.find(isRawish) : list[0];
  if (q.count && !amountOf(f, q)) f = list.find((x) => amountOf(x, q)) || f; // '1 slice bread': a food that comes in slices
  let a = amountOf(f, q);
  if (!a && q.count) return { error: 'No portion size for ' + f.name + (q.unit ? ' in ' + q.unit : '') + '; give grams: eat 150 g ' + q.rest };
  if (!a) a = portionGrams(f, 1, null, readAmount) || { grams: 100, label: '100 g' };
  const name = f.name + (f.state ? ', ' + f.state : '');
  return { food: f, name, grams: a.grams, label: a.label, values: f.values, others: list.length - 1 };
}

function calorieTable(out, list, q, query) {
  const groups = new Set(list.map((f) => f.group));
  const rows = [];
  let group = null;
  const byPortion = !!q.count;
  for (const f of list.slice(0, MAX_ROWS)) {
    if (groups.size > 1 && f.group !== group) { group = f.group; rows.push({ section: [[group, '']] }); }
    const a = byPortion ? amountOf(f, q) : { grams: q.grams || 100 };
    const v = (k) => (a ? fmtNum(per(f.values[k], a.grams)) : '–');
    const run = 'cook calorie ' + f.id + (a && (q.grams || q.count) ? ' ' + Math.round(a.grams) + 'g' : '');
    rows.push([[[f.name, f.own ? 'accent' : '', { run }]], [[f.state || (f.own ? 'yours' : ''), 'dim']],
      ...(byPortion ? [[[a ? fmtNum(a.grams) + ' g' : 'no portion', a ? 'dim' : 'faint']]] : []),
      [[v('kcal'), 'num strong']], [[v('protein'), 'num']], [[v('fat'), 'num']], [[v('carbs'), 'num']]]);
  }
  const amount = byPortion ? fmtNum(q.count) + (q.unit ? ' ' + q.unit : '') : fmtNum(q.grams || 100) + ' g';
  out.head([[plural(list.length, 'food') + ' for "' + query + '"', 'strong'], [' · per ' + amount + ' · tap one for everything in it', 'dim']]);
  out.table(['food', '', ...(byPortion ? ['weight'] : []), 'kcal', 'protein g', 'fat g', 'carbs g'], rows);
  if (list.length > MAX_ROWS) out.dim('+' + (list.length - MAX_ROWS) + ' more · add a word to narrow it down');
  if (list.some(isRawish) && list.some((f) => !isRawish(f) && f.state)) {
    out.dim('Cooking drives water out, so cooked food has more per 100 g: weigh it raw and use the raw line, or weigh it cooked and use the cooked one');
  }
}

function calorieDetail(out, f, nutrients, grams, source, label) {
  const amount = grams || 100;
  const v = (k) => per(f.values[k], amount);
  const dvOf = Object.fromEntries(nutrients.map(([k, , , dv]) => [k, dv]));
  const pct = (k) => (dvOf[k] && v(k) !== null ? Math.round((v(k) / dvOf[k]) * 100) + '%' : '');
  const g = (k, unit = 'g') => (v(k) === null ? [['not measured', 'faint']] : [[fmtNum(v(k)) + ' ' + unit, 'num']]);
  out.head([[f.name, 'strong'], [f.state ? ' · ' + f.state : '', ''], [' · ' + (label && !/^[\d.]+ g$/.test(label) ? label + ' = ' : 'per ') + fmtNum(amount) + ' g', 'dim']]);
  out.kv([
    ['energy', [[fmtNum(v('kcal')) + ' kcal', 'num strong'], [' · ' + fmtNum(v('kcal') * 4.184) + ' kJ', 'dim'], [' · ' + pct('kcal') + ' of 2,000 kcal', 'faint']]],
    ['protein', g('protein')],
    ['fat', [...g('fat'), [v('sat') !== null ? ' · saturated ' + fmtNum(v('sat')) + ' g' : '', 'dim']]],
    ['carbohydrate', [...g('carbs'), [v('sugar') !== null ? ' · sugars ' + fmtNum(v('sugar')) + ' g' : '', 'dim']]],
    ['fibre', g('fiber')],
    ['salt', v('sodium') === null ? [['not measured', 'faint']] : [[fmtNum(salt(v('sodium'))) + ' g', 'num'], [' · sodium ' + fmtNum(v('sodium')) + ' mg', 'dim']]],
    ['cholesterol', g('cholesterol', 'mg')],
  ]);
  for (const [title, kind] of [['Minerals', 'mineral'], ['Vitamins', 'vitamin']]) {
    const rows = nutrients.filter((n) => n[4] === kind).map(([k, label, unit]) => [[[label, 'dim']],
      [[v(k) === null ? '–' : fmtNum(v(k)) + ' ' + unit, v(k) === null ? 'faint' : 'num']], [[pct(k), Number.parseInt(pct(k), 10) >= 20 ? 'ok' : 'faint']]]);
    out.section([[title, ''], ['  % of daily value', 'faint']]);
    out.table(null, rows);
  }
  const other = [['monounsaturated fat', 'mono'], ['polyunsaturated fat', 'poly'], ['water', 'water']].filter(([, k]) => v(k) !== null);
  if (other.length) out.dim(other.map(([l, k]) => l + ' ' + fmtNum(v(k)) + ' g').join(' · '));
  if (f.portions.length) {
    out.line([['Portions: ', 'dim'], ...f.portions.flatMap(([pg, d], i) => [[(i ? ' · ' : '') + d + ' = ' + fmtNum(pg) + ' g, ', ''],
      [fmtNum(per(f.values.kcal, pg)) + ' kcal', 'num']])]);
  }
  out.dim('– not measured · daily values: FDA, adults · ' + source.split(' (')[0] + ' (SR28), NDB ' + f.id + ': ' + f.usda);
  out.copyable(fmtNum(v('kcal')));
}

// Your food: its fields (tap to edit), and what the amount asked for holds.
function ownDetail(ctx, raw, records, a) {
  records.show(ctx, 'food', raw);
  if (!a) return;
  const f = ownItem(raw);
  const v = (k) => per(f.values[k], a.grams);
  ctx.out.line([[a.label === fmtNum(a.grams) + ' g' ? a.label : a.label + ' = ' + fmtNum(a.grams) + ' g', 'strong'], [': ', 'faint'], [fmtNum(v('kcal')) + ' kcal', 'num strong'],
    ...[['protein', 'protein'], ['fat', 'fat'], ['carbs', 'carbs']].filter(([k]) => v(k) !== null).map(([k, l]) => [' · ' + l + ' ' + fmtNum(v(k)) + ' g', 'dim'])]);
  ctx.out.copyable(fmtNum(v('kcal')));
}

async function addFood(ctx, text) {
  const { out } = ctx;
  const r = readFoodLabel(text);
  if (r.error) {
    out.err(r.error);
    out.dim('cook calorie add lyutenitsa 75 kcal 1.5 protein 2.5 fat 11 carbs · add "per 1 slice = 30g" when the label gives a portion');
    return;
  }
  const same = ctx.data.state.foods.items.find((x) => x.name.toLowerCase() === r.name.toLowerCase());
  if (same) {
    out.err('You already have ' + r.name + ' (' + same.id + ')');
    return out.line([['cook calorie ' + same.id + ' edit', 'accent', { run: 'cook calorie ' + same.id + ' edit' }], [' changes it', 'dim']]);
  }
  const id = await ctx.data.allocId('f');
  const at = ctx.now().toISOString();
  const v = (k) => (r.values[k] === undefined ? null : r.values[k]);
  const food = { id, name: r.name, kcal: r.values.kcal, protein: v('protein'), fat: v('fat'), carbs: v('carbs'), sugar: v('sugar'), fiber: v('fiber'),
    sat: v('sat'), salt: v('salt'), portionG: r.portion ? r.portion.g : null, portionName: r.portion ? r.portion.name : null, created: at, updated: at };
  await ctx.data.mutate('foods', (d) => { d.items.push(food); });
  out.head([['Added food ', ''], [id, 'id', { run: 'cook calorie ' + id }], [' · ' + r.name, 'strong']], 'ok');
  out.line([['per 100 g: ', 'dim'], [food.kcal + ' kcal', 'num'], ...['protein', 'fat', 'carbs'].filter((k) => food[k] !== null).map((k) => [' · ' + k + ' ' + food[k] + ' g', 'dim']),
    [food.portionG ? ' · 1 ' + food.portionName + ' = ' + food.portionG + ' g' : '', 'dim']]);
  const missing = ['protein', 'fat', 'carbs'].filter((k) => food[k] === null);
  if (missing.length) out.dim('No ' + missing.join(', ') + ' given; add later: cook calorie ' + id + ' edit ' + missing[0] + ' <grams per 100 g>');
}

// Several foods with their amounts, added up: 200g chicken breast + 150g rice cooked + 1 tbsp olive oil.
function meal(ctx, parts, items) {
  const { out } = ctx;
  const tot = { kcal: 0, protein: 0, fat: 0, carbs: 0, sugar: 0, fiber: 0, sat: 0, sodium: 0 };
  const gaps = new Set();
  const rows = [], notes = [];
  let bad = 0;
  for (const part of parts) {
    const q = readQuantity(part, readAmount);
    const list = q.rest ? findFoods(items, q.rest) : [];
    if (!list.length) { bad++; rows.push([[[part, '']], [['no food matches "' + (q.rest || part) + '"', 'err']], [['', '']], [['', '']], [['', '']], [['', '']]]); continue; }
    const f = (q.count && list.find((x) => amountOf(x, q))) || list[0]; // '1 slice bread': a food that comes in slices
    let a = amountOf(f, q);
    if (!a && q.count) { bad++; rows.push([[[part, '']], [['no portion size for ' + f.name + ': give grams', 'err']], [['', '']], [['', '']], [['', '']], [['', '']]]); continue; }
    if (!a) { a = { grams: 100, label: '100 g?' }; notes.push(q.rest + ': no amount given, counted 100 g'); }
    for (const k of Object.keys(tot)) {
      const val = per(f.values[k], a.grams);
      if (val === null) gaps.add(k); else tot[k] += val;
    }
    if (list.length > 1) notes.push('"' + q.rest + '": ' + f.name + (f.state ? ', ' + f.state : '') + ' (1 of ' + list.length + ' that match; add words for another)');
    rows.push([[[a.label === fmtNum(a.grams) + ' g' ? a.label : a.label + ' · ' + fmtNum(a.grams) + ' g', 'dim']],
      [[f.name + (f.state ? ' · ' + f.state : ''), f.own ? 'accent' : '', { run: 'cook calorie ' + f.id + ' ' + Math.round(a.grams) + 'g' }]],
      [[fmtNum(per(f.values.kcal, a.grams)), 'num strong']], [[fmtNum(per(f.values.protein, a.grams)), 'num']],
      [[fmtNum(per(f.values.fat, a.grams)), 'num']], [[fmtNum(per(f.values.carbs, a.grams)), 'num']]]);
  }
  rows.push([[['', '']], [['Total', 'strong']], [[fmtNum(tot.kcal), 'num strong']], [[fmtNum(tot.protein), 'num strong']], [[fmtNum(tot.fat), 'num strong']], [[fmtNum(tot.carbs), 'num strong']]]);
  out.head([['Meal', 'strong'], [' · ' + plural(parts.length, 'item') + ' · ', 'dim'], [fmtNum(tot.kcal) + ' kcal', 'num strong']], bad ? 'warn' : 'ok');
  out.table(['amount', 'food', 'kcal', 'protein g', 'fat g', 'carbs g'], rows);
  const e = tot.protein * 4 + tot.fat * 9 + tot.carbs * 4;
  const share = (x) => (e ? Math.round((x / e) * 100) + '%' : '–');
  out.kv([
    ['energy from', [['protein ' + share(tot.protein * 4) + ' · fat ' + share(tot.fat * 9) + ' · carbs ' + share(tot.carbs * 4), '']]],
    ['also', [['sugars ' + fmtNum(tot.sugar) + ' g · fibre ' + fmtNum(tot.fiber) + ' g · saturated fat ' + fmtNum(tot.sat) + ' g · salt ' + fmtNum(salt(tot.sodium)) + ' g', 'dim']]],
  ]);
  for (const n of notes) out.dim(n);
  if (gaps.size) out.dim('Some foods have no value for ' + [...gaps].map((k) => ({ sodium: 'salt', fiber: 'fibre', sat: 'saturated fat' }[k] || k)).join(', ') + '; those totals leave them out');
  out.copyable(fmtNum(tot.kcal));
}

async function lookupCalories(ctx, arg) {
  const { out } = ctx;
  const { data, items: usda } = await nutrition();
  const own = ctx.data.state.foods.items.map(ownItem);
  const items = [...own, ...usda];
  const parts = mealParts(arg);
  if (parts) return meal(ctx, parts, items);
  const q = readQuantity(arg, readAmount);
  if (q.grams !== undefined && !(q.grams > 0 && q.grams <= 100000)) return out.err('Give an amount between 1 g and 100 kg');
  if (!q.rest) {
    const groups = [...new Set(items.map((f) => f.group))];
    out.head([['Calories and nutrients', 'strong'], [' · ' + usda.length + ' foods, raw and cooked' + (own.length ? ' · ' + own.length + ' of yours' : '') + ' · per 100 g', 'dim']]);
    out.table(null, groups.map((gname) => {
      const names = [...new Set(items.filter((f) => f.group === gname).map((f) => f.name.split(/[,(]/)[0].trim()))];
      return [[[gname, 'strong', { run: 'cook calorie ' + (gname === 'Yours' ? 'mine' : gname.toLowerCase().split(/[ ,]/)[0]) }]], [[names.slice(0, 6).join(', ') + (names.length > 6 ? '…' : ''), 'dim']]];
    }), { stack: true });
    out.dim('cook calorie chicken · cook calorie 2 eggs · cook calorie 200g chicken breast raw + 150g rice cooked + 1 tbsp olive oil');
    out.dim('Your own: cook calorie add <name> 75 kcal 1.5 protein 2.5 fat 11 carbs [per 1 slice = 30g]');
    out.dim(data.SOURCE + ', public domain');
    return;
  }
  const list = /^f\d+$/i.test(q.rest) ? items.filter((f) => f.id === q.rest.toLowerCase()) : findFoods(items, q.rest);
  if (!list.length) {
    out.err('No food matches "' + q.rest + '"');
    out.dim('Try a shorter or more general word (chicken, rice, cheese, chocolate) · cook calorie lists the groups · cook calorie add <name> … saves your own');
    return;
  }
  if (list.length > 1) return calorieTable(out, list, q, q.rest);
  const f = list[0];
  const a = amountOf(f, q);
  if (q.count && !a) {
    out.err('No portion size for ' + f.name + (q.unit ? ' in ' + q.unit : '') + '; give a weight: cook calorie ' + q.rest + ' 150g');
    return;
  }
  if (f.own) return ownDetail(ctx, ctx.data.state.foods.items.find((x) => x.id === f.id), ctx.records, a);
  calorieDetail(out, f, data.NUTRIENTS, a ? a.grams : null, data.SOURCE, a ? a.label : null);
}

// cook calorie …: your own foods in the shared grammar (add, f3, f3 edit, f3 rm,
// mine), anything else a lookup or a meal.
async function calorie(ctx, arg, records) {
  const words = arg.trim().split(/\s+/).filter(Boolean);
  const first = (words[0] || '').toLowerCase();
  const spec = { list: (c, rest) => lookupCalories(c, rest), add: addFood, addArgs: '<name> <kcal> kcal …', show: (c, item) => ownDetail(c, item, records, null) };
  if (first === 'add') return addFood(ctx, arg.trim().slice(3).trim());
  if (/^f\d+$/.test(first) && (words.length === 1 || ['edit', 'rm', 'remove', 'delete', 'show'].includes((words[1] || '').toLowerCase()) || /^f\d+\.[a-z]+$/.test(first))) {
    return records.route(ctx, 'food', arg, spec);
  }
  if (/^f\d+\.[a-z]+$/.test(first)) return records.route(ctx, 'food', arg, spec);
  if (first === 'mine' || first === 'yours') {
    const own = ctx.data.state.foods.items;
    if (!own.length) {
      ctx.out.head('No foods of your own yet', 'dim');
      return ctx.out.dim('cook calorie add <name> 75 kcal 1.5 protein 2.5 fat 11 carbs [per 1 slice = 30g]');
    }
  }
  return lookupCalories(Object.assign(ctx, { records }), arg);
}

function convertTemp(out, text) {
  const m = /^(\d{2,3})\s?°?\s?(c|f|celsius|fahrenheit)$/i.exec(text) || /^gas(?: mark)?\s?(\d)$/i.exec(text);
  if (!m) return false;
  let c;
  if (/^gas/i.test(text)) {
    const g = { 1: 140, 2: 150, 3: 170, 4: 180, 5: 190, 6: 200, 7: 220, 8: 230, 9: 240 }[m[1]];
    if (!g) { out.err('Gas marks go from 1 to 9'); return true; }
    c = g;
  } else {
    c = /^f/i.test(m[2]) ? toC(+m[1]) : +m[1];
  }
  const fromF = !/^gas/i.test(text) && /^f/i.test(m[2]);
  const given = /^gas/i.test(text) ? 'gas ' + m[1] : fromF ? m[1] + '°F' : m[1] + '°C';
  const answer = fromF ? c + '°C' : toF(c) + '°F';
  out.head([[given, ''], [' = ', 'faint'], [/^gas/i.test(text) ? deg(c) : answer, 'strong'], [' · fan ' + (c - FAN) + '°C · gas ' + gasMark(c), 'dim']], 'ok');
  out.copyable(/^gas/i.test(text) ? String(c) : answer.replace(/°.$/, ''));
  return true;
}

function convertTable(out) {
  out.head([['Cups and spoons to grams', 'strong'], [' · US cup 240 ml · tbsp 15 ml · tsp 5 ml', 'dim']]);
  const g = (x) => fmtGrams(x);
  out.table(['ingredient', '1 cup', '1 tbsp', '1 tsp'], INGREDIENTS.map((i) => [[[i.name, '']], [[g(i.cup), 'num']], [[g(i.cup / 16), 'num']], [[g(i.cup / 48), 'dim']]]), { stack: false });
  out.dim('Butter: 1 stick = 113 g · egg (large, no shell) 50 g, yolk 18 g, white 30 g · also oz, lb, fl oz, pints, °C/°F/gas');
}

function convert(ctx, text) {
  const { out } = ctx;
  if (!text) return convertTable(out);
  if (convertTemp(out, text)) return;
  const r = readConvert(text);
  if (r.error) {
    out.err(r.error);
    out.dim('cook convert 1 tbsp sugar · cook convert 2 cups flour · cook convert ½ stick butter · cook convert 250 g flour · cook convert 350f');
    return;
  }
  const ing = r.ingredient;
  const what = (unitWord) => fmtAmount(r.amount) + ' ' + unitWord + (ing && ing.name ? ' ' + ing.name.replace(/ \(.*\)$/, '') : '');
  if (r.unit.kind === 'egg') {
    out.head([[plural(r.amount, ing.name.replace(/ \(.*\)$/, '')).replace(/^1 /, '1 '), ''], [' = ', 'faint'], [fmtGrams(r.grams), 'num strong']], 'ok');
    if (r.unit.key === 'egg') out.dim('A large egg without its shell; medium is about 44 g, extra large 56 g');
    out.copyable(String(Math.round(r.grams)));
    return;
  }
  if (r.unit.kind === 'stick') {
    out.head([[what(r.amount > 1 ? 'sticks' : 'stick'), ''], [' = ', 'faint'], [fmtGrams(r.grams), 'num strong']], 'ok');
    out.dim('A US stick of butter is 113 g (½ cup, 8 tbsp)');
    out.copyable(String(Math.round(r.grams)));
    return;
  }
  if (r.unit.kind === 'weight') {
    const unitWord = r.unit.key;
    if (!ing) {
      if (r.unit.key === 'g' || r.unit.key === 'kg') {
        out.head([[fmtGrams(r.grams), 'num strong'], [' = ' + Math.round((r.grams / 28.35) * 10) / 10 + ' oz', 'dim']]);
      } else {
        out.head([[fmtAmount(r.amount) + ' ' + unitWord, ''], [' = ', 'faint'], [fmtGrams(r.grams), 'num strong']], 'ok');
      }
      if (r.ingredientText) out.warn("I don't know " + r.ingredientText + '; the weight is the same for anything');
      out.copyable(String(Math.round(r.grams)));
      return;
    }
    const measures = asMeasures(r.grams, ing);
    const lead = r.unit.key === 'g' || r.unit.key === 'kg' ? [[fmtGrams(r.grams) + ' ' + ing.name.replace(/ \(.*\)$/, ''), '']] : [[what(unitWord), ''], [' = ', 'faint'], [fmtGrams(r.grams), 'num strong']];
    out.head([...lead, [' ≈ ', 'faint'], [measures[0] || 'a pinch', 'num strong']], 'ok');
    if (measures.length > 1) out.kv([['or', [[measures.slice(1).join(' · '), 'num']]]]);
    if (ing.note) out.dim(ing.note);
    out.copyable(measures[0] || '');
    return;
  }
  // A volume.
  const unitWord = VOLUMES[r.unit.key].name === 'ml' ? 'ml' : VOLUMES[r.unit.key].name + (r.amount > 1 ? 's' : '');
  if (!ing) {
    out.head([[fmtAmount(r.amount) + ' ' + unitWord, ''], [' = ', 'faint'], [Math.round(r.ml * 10) / 10 + ' ml', 'num strong']], r.ingredientText ? 'warn' : 'ok');
    if (r.ingredientText) {
      out.warn("I don't know how much " + r.ingredientText + ' weighs per cup; as water it would be ' + fmtGrams(r.ml));
      out.line([['cook convert', 'accent', { run: 'cook convert' }], [' lists the ingredients I know', 'dim']]);
    }
    out.copyable(String(Math.round(r.ml)));
    return;
  }
  out.head([[what(unitWord), ''], [' = ', 'faint'], [fmtGrams(r.grams), 'num strong']], 'ok');
  out.kv([
    ['volume', [[Math.round(r.ml * 10) / 10 + ' ml', 'num']]],
    ['1 cup of it', [[fmtGrams(ing.cup), 'num'], [' · 1 tbsp ' + fmtGrams(ing.cup / 16) + ' · 1 tsp ' + fmtGrams(ing.cup / 48), 'dim']]],
  ]);
  if (/\bspoon/i.test(text) && !/(tea|table|dessert)spoon/i.test(text)) out.dim('A spoon is taken as a tablespoon (15 ml); say tsp for a teaspoon');
  if (r.unit.key === 'cup') out.dim('US cup (240 ml), spooned in and levelled; a metric cup (250 ml) is 4% more');
  if (ing.note) out.dim(ing.note);
  out.copyable(fmtGrams(r.grams).replace(/ g$/, ''));
}

export default function register(add, { usage, records }) {
  add({
    name: 'cook', group: 'Kitchen', desc: 'kitchen reference: safe and best temperatures, oven times, cups and spoons to grams, calories and nutrients',
    usage: ['cook target [food]', 'cook oven [food] [weight] [temperature] [fan] [doneness]', 'cook convert <amount> <measure> <ingredient>', 'cook convert <temperature>',
      'cook calorie [amount] <food> [raw | cooked]', 'cook calorie <amount> <food> + <amount> <food> …', 'cook calorie add <name> <n> kcal <n> protein <n> fat <n> carbs [per …]',
      'cook calorie f<n> [edit [<field> [<value>]] | rm]', 'cook calorie mine'],
    examples: ['cook target chicken', 'cook target', 'cook oven chicken 500g at 200', 'cook oven whole chicken 1.6kg', 'cook oven beef 1.5kg medium-rare',
      'cook oven lamb leg 2kg fan 160', 'cook calorie chicken', 'cook calorie chicken breast raw 250g', 'cook calorie 2 eggs', 'cook calorie 1 slice bread',
      'cook calorie 200g chicken breast raw + 150g rice cooked + 1 tbsp olive oil', 'cook calorie add lyutenitsa 75 kcal 1.5 protein 2.5 fat 11 carbs', 'cook calorie crisps', 'cook convert 1 spoon sugar', 'cook convert ½ stick butter', 'cook convert 250 g flour', 'cook convert 350f'],
    complete(prev) {
      if (prev.length === 0) return ['target', 'oven', 'convert', 'calorie'].map((v) => ({ value: v }));
      if (prev.length === 1 && prev[0] === 'target') return TARGETS.map((t) => ({ value: t.id, label: t.name }));
      if (prev.length === 1 && prev[0] === 'oven') return OVEN.map((o) => ({ value: o.id, label: o.name }));
      return [];
    },
    async run(ctx, rest) {
      const { out } = ctx;
      const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest.trim());
      const sub = m ? m[1].toLowerCase() : '';
      const arg = m && m[2] ? m[2].trim() : '';

      if (!sub) {
        out.head([['Kitchen', 'strong'], [' · temperatures, oven times, measures, nutrition', 'dim']]);
        out.table(null, [
          [[['cook target', 'accent', { run: 'cook target' }], [' [food]', 'dim']], [['how hot inside: safe, and best for taste', 'dim']]],
          [[['cook oven', 'accent', { run: 'cook oven' }], [' [food] [weight] [°C]', 'dim']], [['oven temperature and how long', 'dim']]],
          [[['cook convert', 'accent', { run: 'cook convert' }], [' <amount> <measure> <food>', 'dim']], [['cups, spoons, sticks, oz to grams; °F to °C', 'dim']]],
          [[['cook calorie', 'accent', { run: 'cook calorie' }], [' [food] [raw|cooked] [weight]', 'dim']], [['calories, protein, fat, carbs, vitamins and minerals', 'dim']]],
        ], { stack: true });
        return;
      }

      if (sub === 'target' || sub === 'temp' || sub === 'safe') {
        const list = lookup(TARGETS, arg);
        if (!list.length) return out.err('No temperatures for "' + arg + '" · cook target lists them all');
        if (!arg) {
          out.head([['Inside temperatures', 'strong'], [' · safe, and best for taste', 'dim']]);
          const rows = [];
          let group = null;
          for (const t of list) {
            if (t.group !== group) { group = t.group; rows.push({ section: [[group, '']] }); }
            rows.push([[[t.name, '', { run: 'cook target ' + t.id }]], [[t.safe.c + '°C', 'strong']],
              [[t.best.map((b) => b.label + ' ' + (b.to ? b.c + '–' + b.to : b.c) + '°C').join(' · '), t.below ? 'warn' : 'dim']], [[t.below || t.warn ? '⚠' : '', 'warn']]]);
          }
          out.table(['food', 'safe', 'best', ''], rows);
          out.dim('°F: cook target <food> · ⚠: read the warning before going lower');
          out.warn(VULNERABLE);
          return;
        }
        out.head([[list.length === 1 ? list[0].name : plural(list.length, 'match', 'matches') + ' for "' + arg + '"', 'strong'], [' · inside temperature', 'dim']], list.some((t) => t.below) ? 'warn' : 'ok');
        for (const t of list.slice(0, 6)) targetDetail(out, t);
        if (list.some((t) => t.below)) out.warn(VULNERABLE);
        out.dim('Measure in the thickest part, away from bone. USDA safe temperatures; the UK uses 70°C held 2 minutes');
        return;
      }

      if (sub === 'oven' || sub === 'roast' || sub === 'bake') {
        const q = readOven(arg);
        if (q.error) return out.err(q.error);
        const list = lookup(OVEN, q.food);
        if (!list.length) {
          out.err('No oven times for "' + q.food + '" · cook oven lists them');
          const t = lookup(TARGETS, q.food);
          if (t.length) out.line([['Its temperatures: ', 'dim'], ['cook target ' + q.food, 'accent', { run: 'cook target ' + q.food }]]);
          return;
        }
        if (list.length === 1) return ovenDetail(ctx, list[0], q);
        const tempC = q.tempC === null ? null : q.fan ? q.tempC + FAN : q.tempC;
        out.head([[q.food ? plural(list.length, 'way') + ' with "' + q.food + '"' : 'Oven times', 'strong'],
          [(q.kg ? ' · ' + fmtKg(q.kg) : '') + (tempC ? ' at ' + tempC + '°C' : '') + ' · tap one for details', 'dim']]);
        const rows = [];
        let group = null;
        for (const e of list) {
          if (!q.food && e.group !== group) { group = e.group; rows.push({ section: [[group, '']] }); }
          rows.push(ovenRow(e, q.kg, tempC, q.done));
        }
        out.table(['food', 'oven', 'time', 'done at'], rows);
        out.dim('Conventional oven; fan 20°C lower. Pieces cook by thickness, joints by weight. A thermometer decides');
        return;
      }

      if (sub === 'convert' || sub === 'grams' || sub === 'conv') return convert(ctx, arg);
      if (['calorie', 'calories', 'kcal', 'nutrition', 'nutrients', 'macros'].includes(sub)) return calorie(ctx, arg, records);
      return usage(ctx, this);
    },
  });
}
