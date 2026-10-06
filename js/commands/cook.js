import {
  TARGETS, OVEN, INGREDIENTS, VOLUMES, FAN, toF, toC, gasMark, lookup, readOven, ovenTime, fmtMinutes, fmtRange,
  readConvert, asMeasures, fmtAmount, fmtGrams,
} from '../lib/cooking.js';
import { plural } from '../core/util.js';

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

export default function register(add, { usage }) {
  add({
    name: 'cook', group: 'Kitchen', desc: 'kitchen reference: safe and best temperatures, oven times, cups and spoons to grams',
    usage: ['cook target [food]', 'cook oven [food] [weight] [temperature] [fan] [doneness]', 'cook convert <amount> <measure> <ingredient>', 'cook convert <temperature>'],
    examples: ['cook target chicken', 'cook target', 'cook oven chicken 500g at 200', 'cook oven whole chicken 1.6kg', 'cook oven beef 1.5kg medium-rare',
      'cook oven lamb leg 2kg fan 160', 'cook convert 1 spoon sugar', 'cook convert ½ stick butter', 'cook convert 250 g flour', 'cook convert 350f'],
    complete(prev) {
      if (prev.length === 0) return ['target', 'oven', 'convert'].map((v) => ({ value: v }));
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
        out.head([['Kitchen', 'strong'], [' · temperatures, oven times, measures', 'dim']]);
        out.table(null, [
          [[['cook target', 'accent', { run: 'cook target' }], [' [food]', 'dim']], [['how hot inside: safe, and best for taste', 'dim']]],
          [[['cook oven', 'accent', { run: 'cook oven' }], [' [food] [weight] [°C]', 'dim']], [['oven temperature and how long', 'dim']]],
          [[['cook convert', 'accent', { run: 'cook convert' }], [' <amount> <measure> <food>', 'dim']], [['cups, spoons, sticks, oz to grams; °F to °C', 'dim']]],
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
      return usage(ctx, this);
    },
  });
}
