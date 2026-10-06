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
    text: [name, state, words, group, state && !RAW_STATES.has(state) ? 'cooked' : state === 'raw' ? 'uncooked' : ''].join(' ').toLowerCase(),
  }));
}

const STOP = new Set(['of', 'the', 'a', 'an', 'and', 'with', 'in', 'per']);

// Every word of the query starts a word of the food, or is its plural
// ('eggs' finds egg, 'tomatoes' tomato; 'crisps' doesn't find crispy). An NDB
// number finds that food.
export function findFoods(items, query) {
  const q = String(query).toLowerCase().replace(/[(),]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
  if (!q.length) return [];
  if (q.length === 1 && /^\d{4,5}$/.test(q[0])) return items.filter((x) => x.id === q[0].padStart(5, '0'));
  return items.filter((x) => {
    const words = x.text.split(/[^a-z0-9%&']+/).filter(Boolean);
    return q.every((w) => words.some((v) => v.startsWith(w) || (w.length > 3 && w.endsWith('s') && (v === w.slice(0, -1) || (w.endsWith('es') && v === w.slice(0, -2))))));
  });
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
