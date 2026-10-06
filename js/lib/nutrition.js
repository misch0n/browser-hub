// Looking things up in the nutrition table (lib/nutrition-data.js, loaded on
// demand: it is about 110 KB). Pure helpers; the command is in commands/cook.js.

// States that mean "cooked" for searching (`cook calorie chicken cooked`).
const RAW_STATES = new Set(['raw', 'dry', 'uncooked', '']);

// FOODS rows -> searchable items.
export function prepare(data) {
  const keys = data.NUTRIENTS.map((n) => n[0]);
  return data.FOODS.map(([id, group, name, state, words, values, portions, usda]) => ({
    id, group, name, state, words, portions, usda,
    values: Object.fromEntries(keys.map((k, i) => [k, values[i]])),
    text: [name, state, words, state && !RAW_STATES.has(state) ? 'cooked' : state === 'raw' ? 'uncooked' : ''].join(' ').toLowerCase(),
    groupText: group.toLowerCase(),
  }));
}

const STOP = new Set(['of', 'the', 'a', 'an', 'and', 'with', 'in', 'per']);

// Every word of the query starts a word of the food, or is its plural
// ('eggs' finds egg, 'tomatoes' tomato; 'crisps' doesn't find crispy). An NDB
// number finds that food.
export function findFoods(items, query) {
  const raw = String(query).toLowerCase().trim();
  if (/^\d{4,5}$/.test(raw)) return items.filter((x) => x.id === raw.padStart(5, '0'));
  const q = raw.split(/[^a-z0-9%&']+/).filter((w) => w && !STOP.has(w)); // 'hard-boiled' is two words, as in the food
  if (!q.length) return [];
  const match = (text) => {
    const words = text.split(/[^a-z0-9%&']+/).filter(Boolean);
    return q.every((w) => words.some((v) => v.startsWith(w) || (w.length > 3 && w.endsWith('s') && (v === w.slice(0, -1) || (w.endsWith('es') && v === w.slice(0, -2))))));
  };
  // The food's own words first; its group's ('poultry', 'snacks') only when nothing else matches,
  // so 'bread' doesn't find rice through "Grains, bread and pasta".
  const hits = items.filter((x) => match(x.text));
  return hits.length ? hits : items.filter((x) => match(x.text + ' ' + (x.groupText || '')));
}

// '250g', '1.5 kg', '8 oz', '1 lb' anywhere in the text -> { grams, rest } (grams null when none).
export function readWeight(text) {
  const m = /(?:^|\s)(\d+(?:[.,]\d+)?)\s?(g|gr|grams?|kg|kilos?|oz|ounces?|lbs?|pounds?)(?=\s|$)/i.exec(' ' + text + ' ');
  if (!m) return { grams: null, rest: text.trim() };
  const n = Number(m[1].replace(',', '.'));
  const unit = m[2].toLowerCase();
  const grams = /^k/.test(unit) ? n * 1000 : /^(oz|ounce)/.test(unit) ? n * 28.35 : /^(lb|pound)/.test(unit) ? n * 453.6 : n;
  return { grams, rest: (' ' + text + ' ').replace(m[0], ' ').replace(/\s+/g, ' ').trim() };
}

// A value per 100 g scaled to `grams` (null stays null: not measured).
export const per = (v, grams) => (v === null || v === undefined ? null : (v * grams) / 100);

// 22.5 · 0.4 · 165 · 0.04 · 1,234
export function fmtNum(v) {
  if (v === null || v === undefined) return '–';
  if (v === 0) return '0';
  if (v >= 100) return Math.round(v).toLocaleString('en');
  if (v >= 10) return String(Math.round(v * 10) / 10);
  if (v >= 1) return String(Math.round(v * 10) / 10);
  return String(Number(v.toPrecision(2)));
}

// Salt in grams from sodium in mg (salt is 40% sodium).
export const salt = (sodiumMg) => (sodiumMg === null ? null : (sodiumMg * 2.5) / 1000);

// ---- your own foods ------------------------------------------------------------------

// A saved food (collection `foods`) as a searchable item like the USDA ones.
export function ownItem(f) {
  const val = (k) => (f[k] === null || f[k] === undefined ? null : f[k]);
  return {
    id: f.id, group: 'Yours', name: f.name, state: '', words: 'mine yours own', own: true, usda: null,
    portions: f.portionG ? [[f.portionG, '1 ' + f.portionName]] : [],
    values: { kcal: f.kcal, protein: val('protein'), fat: val('fat'), carbs: val('carbs'), sugar: val('sugar'), fiber: val('fiber'), sat: val('sat'),
      sodium: f.salt === null || f.salt === undefined ? null : f.salt * 400 },
    text: (f.name + ' mine yours own').toLowerCase(),
  };
}

const LABELS = [
  ['kcal', /^(kcal|cal|calories|calorie|energy)$/],
  ['protein', /^(protein|proteins|p)$/],
  ['fat', /^(fat|fats|f|total fat)$/],
  ['carbs', /^(carbs?|carbohydrates?|c)$/],
  ['sugar', /^(sugars?|of which sugars)$/],
  ['fiber', /^(fib(?:re|er)s?)$/],
  ['sat', /^(sat|saturated|saturates|saturated fat)$/],
  ['salt', /^(salt)$/],
];
const labelKey = (w) => (LABELS.find(([, re]) => re.test(w)) || [null])[0];

// 'cook calorie add lyutenitsa 75 kcal 1.5 protein 2.5 fat 11 carbs per 100g'
// 'cook calorie add "oat bar" kcal 190 protein 4 fat 7 carbs 27 sugar 9 per 1 bar = 45 g'
// Values in either order (number then label, or label then number), as on a
// label; `per …` gives the portion they are for (default 100 g).
// -> { name, values: { kcal, protein, … }, portion: { name, g } | null } or { error }
export function readFoodLabel(text) {
  let s = String(text).trim();
  let portion = null, perG = 100;
  const per = /\s(?:per|for|a|each)\s+(.+)$/i.exec(' ' + s);
  if (per) {
    const p = /^(?:(\d+(?:[.,]\d+)?)\s*g|(.*?)\s*=?\s*(\d+(?:[.,]\d+)?)\s*g)$/i.exec(per[1].trim());
    if (!p) return { error: "say the portion as 'per 100g', 'per 30g' or 'per 1 slice = 30g'" };
    perG = Number((p[1] || p[3]).replace(',', '.'));
    if (!(perG > 0 && perG <= 5000)) return { error: 'the portion is 1 to 5,000 g' };
    if (p[2] !== undefined && p[2].trim()) portion = { name: p[2].trim().replace(/^1\s+/, ''), g: perG };
    else if (perG !== 100) portion = { name: 'portion', g: perG };
    s = s.slice(0, per.index).trim();
  }
  let name = '';
  const q = /^"([^"]+)"|^'([^']+)'/.exec(s);
  if (q) { name = q[1] || q[2]; s = s.slice(q[0].length); }
  const toks = s.replace(/,/g, ' ').replace(/(\d)(kcal)\b/gi, '$1 $2').replace(/(\d)\s*g\b/gi, '$1').replace(/\b(total fat|saturated fat|of which sugars)\b/gi, (m) => m.replace(' ', '_')).split(/\s+/).filter(Boolean);
  let i = 0;
  if (!name) {
    const words = [];
    while (i < toks.length && !labelKey(toks[i].toLowerCase().replace('_', ' ')) && !/^\d/.test(toks[i])) words.push(toks[i++]);
    name = words.join(' ');
  }
  name = name.trim();
  if (!name) return { error: 'start with the food’s name: cook calorie add <name> 75 kcal 1.5 protein …' };
  if (name.length > 80) return { error: 'the name is too long (80 characters at most)' };
  const rest = toks.slice(i);
  const values = {};
  const numberFirst = rest.length && /^\d/.test(rest[0]);
  for (let k = 0; k + 1 < rest.length + 1; k += 2) {
    if (k + 1 >= rest.length) { if (rest[k] !== undefined) return { error: "'" + rest[k] + "' has no " + (numberFirst ? 'label' : 'number') }; break; }
    const [a, b] = numberFirst ? [rest[k + 1], rest[k]] : [rest[k], rest[k + 1]];
    const key = labelKey(a.toLowerCase().replace('_', ' '));
    const n = Number(String(b).replace(',', '.'));
    if (!key) return { error: "'" + a + "' isn't kcal, protein, fat, carbs, sugar, fibre, saturated or salt" };
    if (!Number.isFinite(n) || n < 0) return { error: "'" + b + "' isn't a number for " + key };
    values[key] = (n * 100) / perG;
  }
  if (values.kcal === undefined) return { error: 'give at least the kcal: cook calorie add ' + name + ' 75 kcal 1.5 protein 2.5 fat 11 carbs' };
  for (const k of Object.keys(values)) values[k] = Math.round(values[k] * 100) / 100;
  if (values.kcal > 900) return { error: 'over 900 kcal per 100 g is more than pure fat: check the numbers' };
  return { name, values, portion };
}

// ---- amounts: weights and portions ------------------------------------------------------

const VOLUME_TSP = { cup: 48, cups: 48, tbsp: 3, tablespoon: 3, tablespoons: 3, tbs: 3, tsp: 1, teaspoon: 1, teaspoons: 1 };
const PORTION_WORDS = ['slice', 'slices', 'piece', 'pieces', 'serving', 'servings', 'bar', 'bars', 'can', 'cans', 'clove', 'cloves', 'large', 'medium',
  'small', 'whole', 'link', 'links', 'patty', 'patties', 'stalk', 'stalks', 'spear', 'spears', 'leaf', 'leaves', 'wedge', 'wedges', 'packet', 'packets', 'bag', 'bags', 'portion', 'portions'];
const singular = (w) => (w === 'leaves' ? 'leaf' : /ies$/.test(w) ? w.slice(0, -3) + 'y' : /(ches|shes)$/.test(w) ? w.slice(0, -2) : w.replace(/s$/, ''));
// '1 large' for one, '2 × 1 large' for more.
const portionLabel = (count, desc) => (count === 1 && /^1\s/.test(desc) ? desc : fmtNum(count) + ' × ' + desc);

// '200g chicken', '2 eggs', '1 slice bread', '½ cup rice', 'a banana' ->
// { grams } | { count, unit } (unit may be null) plus { rest }; neither when no amount.
export function readQuantity(text, readAmountFn) {
  const w = readWeight(text);
  if (w.grams !== null) return { grams: w.grams, rest: w.rest };
  const t = String(text).trim();
  const a = readAmountFn(t);
  // An amount stands apart from the food: '2 eggs', '½cup', not '7up'.
  if (!a || !a.rest.trim() || !(a.n > 0) || !(/^\s/.test(a.rest) || /[½¼¾⅓⅔⅛⅜⅝⅞]$/.test(t.slice(0, t.length - a.rest.length)))) return { rest: t };
  const words = a.rest.trim().split(/\s+/);
  const u = words[0].toLowerCase();
  if (VOLUME_TSP[u] || PORTION_WORDS.includes(u)) {
    const rest = words.slice(1).join(' ').replace(/^of\s+/i, '');
    return rest ? { count: a.n, unit: u, rest } : { rest: String(text).trim() };
  }
  return { count: a.n, unit: null, rest: a.rest.trim() };
}

// Grams for `count` × `unit` of `item`, from its portions ('1 cup, chopped' = 140 g,
// '1 large' = 50 g). Volumes come from any cup, tbsp or tsp portion. -> { grams, label } or null
export function portionGrams(item, count, unit, readAmountFn) {
  const ports = item.portions.map(([g, desc]) => {
    const a = readAmountFn(desc) || { n: 1, rest: desc };
    const word = (a.rest.trim().split(/[\s,(]+/)[0] || '').toLowerCase();
    return { g, desc, n: a.n || 1, word };
  });
  if (unit && VOLUME_TSP[unit]) {
    const v = ports.find((p) => VOLUME_TSP[p.word]);
    if (!v) return null;
    const perTsp = v.g / (v.n * VOLUME_TSP[v.word]);
    return { grams: count * VOLUME_TSP[unit] * perTsp, label: fmtNum(count) + ' ' + unit };
  }
  if (unit) {
    const want = singular(unit);
    const p = ports.find((x) => singular(x.word) === want || x.desc.toLowerCase().includes(want));
    return p ? { grams: (count * p.g) / p.n, label: portionLabel(count, p.desc) } : null;
  }
  // No unit: the first portion that is a thing, not a measure.
  const p = ports.find((x) => !VOLUME_TSP[x.word] && !['oz', 'fl', 'g', 'lb', 'pint', 'quart', 'serving'].includes(x.word)) || null;
  return p ? { grams: (count * p.g) / p.n, label: portionLabel(count, p.desc) } : null;
}

// 'a + b; c' -> ['a', 'b', 'c'] (a meal), or null for a single food.
export function mealParts(text) {
  const parts = String(text).split(/\s\+\s|\s*;\s*|\s+\+(?=\s*\d)|^\+/).map((x) => x.trim()).filter(Boolean);
  return parts.length > 1 ? parts : null;
}
