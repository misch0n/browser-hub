import { readRandom, drawRandom, fmtRandom, readDice, rollDice, diceText, STANDARD } from '../lib/chance.js';

// random and roll (lib/chance.js).

// The dice of one term as segments: kept ones bright, dropped ones faint,
// a natural 20 or 1 on a d20 coloured.
function diceSegs(t) {
  return t.rolls.flatMap((r, i) => [[i ? ' ' : '', ''], [String(r.v), !r.kept ? 'gone' : t.sides === 20 && r.v === 20 ? 'ok strong' : t.sides === 20 && r.v === 1 ? 'err strong' : 'num']]);
}

export default function register(add, { usage }) {
  add({
    name: 'random', group: 'Chance', noUndo: true, desc: 'random numbers: a band, a length, several, unique',
    usage: ['random', 'random <max>', 'random <min>-<max>', 'random <n> digits', 'random … x<count> [unique]'],
    examples: ['random', 'random 50', 'random 10-20', 'random -5..5', 'random 0.5-2.5', 'random 6 digits', 'random 1-49 x6 unique', 'random 4 digits x3'],
    async run(ctx, rest) {
      const { out } = ctx;
      const o = readRandom(rest);
      if (o.error) {
        out.err(o.error);
        return usage(ctx, this);
      }
      const values = drawRandom(o);
      const shown = (o.unique && o.count > 1 ? values.slice().sort((a, b) => a - b) : values).map((v) => fmtRandom(v, o));
      const range = o.digits ? o.digits + '-digit' : fmtRandom(o.min, o) + ' to ' + fmtRandom(o.max, o);
      out.head([[o.count > 1 ? o.count + (o.unique ? ' different' : '') + ' numbers' : 'Random number', 'strong'], [' · ' + range, 'dim']]);
      out.value(shown.join(', '));
      if (o.count > 1 && o.unique) out.dim('Sorted; drawn in this order: ' + values.map((v) => fmtRandom(v, o)).join(', '));
    },
  });

  add({
    name: 'roll', group: 'Chance', noUndo: true, desc: 'roll dice: every standard die, or d20, 2d6+3, 4d6kh3, d20 adv, stats',
    usage: ['roll', 'roll d<sides>', 'roll <n>d<sides>[+<n>d<sides>][±<modifier>]', 'roll d20 adv | dis', 'roll <n>d<sides>kh<k> | kl<k> | dl<k>', 'roll stats'],
    examples: ['roll', 'roll d6', 'roll d20', 'roll 2d6+3', 'roll d20+5 adv', 'roll 8d6', 'roll 4d6kh3', 'roll d%', 'roll stats'],
    complete: (prev) => (prev.length === 0 ? [...STANDARD.map((s) => ({ value: 'd' + s })), { value: 'stats' }] : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const text = rest.trim();
      if (!text || /^all$/i.test(text)) {
        // One of each standard die.
        const rows = STANDARD.map((s) => {
          const r = rollDice({ terms: [{ n: 1, sides: s, sign: 1 }] });
          return [[['d' + s, 'accent', { run: 'roll d' + s }]], diceSegs(r.terms[0])];
        });
        out.head([['One of each', 'strong'], [' · d4 d6 d8 d10 d12 d20 d100 · tap one to roll it again', 'dim']]);
        out.table(null, rows);
        return;
      }
      if (/^stats?$/i.test(text) || /^abilit/i.test(text)) {
        // Ability scores: 4d6, the lowest dropped, six times.
        const spec = readDice('4d6kh3');
        const rolls = Array.from({ length: 6 }, () => rollDice(spec));
        const total = rolls.reduce((a, r) => a + r.total, 0);
        out.head([['Ability scores', 'strong'], [' · 4d6, lowest dropped · ' + rolls.map((r) => r.total).join(', ') + ' · total ' + total, 'dim']]);
        out.table(null, rolls.map((r) => [[[String(r.total), 'num strong']], diceSegs(r.terms[0]),
          [[r.total >= 16 ? 'great' : r.total >= 13 ? 'good' : r.total <= 7 ? 'poor' : '', r.total >= 16 ? 'ok' : r.total <= 7 ? 'err' : 'dim']]]));
        out.copyable(rolls.map((r) => r.total).join(', '));
        return;
      }
      const spec = readDice(text);
      if (spec.error) {
        out.err(spec.error);
        return usage(ctx, this);
      }
      const r = rollDice(spec);
      const d20 = r.terms.find((t) => t.sides === 20 && t.rolls);
      const natural = d20 && d20.rolls.filter((x) => x.kept).length === 1 ? d20.rolls.find((x) => x.kept).v : null;
      const tone = natural === 20 ? 'ok' : natural === 1 ? 'err' : null;
      out.head([[diceText(spec), 'dim'], [' = ', 'faint'], [String(r.total), 'num strong'],
        [natural === 20 ? ' · natural 20' : natural === 1 ? ' · natural 1' : '', tone || '']], tone);
      const parts = r.terms.flatMap((t, i) => {
        const sign = i === 0 ? (t.subtotal < 0 && t.mod !== undefined ? '−' : t.sign < 0 ? '−' : '') : (t.mod !== undefined ? t.mod < 0 : t.sign < 0) ? ' − ' : ' + ';
        if (t.mod !== undefined) return [[sign, 'faint'], [String(Math.abs(t.mod)), 'num']];
        return [[sign, 'faint'], ['[', 'faint'], ...diceSegs(t), [']', 'faint']];
      });
      const single = r.terms.length === 1 && r.terms[0].rolls && r.terms[0].rolls.length === 1;
      if (!single) out.line(parts);
      out.copyable(String(r.total));
    },
  });
}
