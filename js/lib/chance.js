// Random numbers and dice, with the browser's secure random numbers and no
// modulo bias. Pure apart from the random source (`rand`, crypto by default).

// A uniform integer in [min, max] (both inclusive, |values| up to 2^53).
export function randomInt(min, max, rand = globalThis.crypto) {
  const span = BigInt(max) - BigInt(min) + 1n;
  if (span <= 0n) throw new Error('empty range');
  if (span > 2n ** 53n) throw new Error('range too large');
  const limit = (2n ** 53n / span) * span;
  const buf = new Uint32Array(2);
  for (;;) {
    rand.getRandomValues(buf);
    const x = (BigInt(buf[0] & 0x1fffff) << 32n) | BigInt(buf[1]); // 53 random bits
    if (x < limit) return Number(BigInt(min) + (x % span));
  }
}

// ---- random <options> ------------------------------------------------------------

const decimals = (s) => (s.includes('.') ? s.split('.')[1].length : 0);

// 'random' options -> { min, max, places, count, unique, digits } or { error }
//   (nothing) 1 to 100 · 50: 1 to 50 · 10-20, 10..20, 10 to 20: a band · -5..5
//   0.5-2.5: two decimals · 6 digits / length 6 · x6, 6 times, count 6 · unique
export function readRandom(text) {
  let s = ' ' + String(text).toLowerCase().replace(/,/g, ' ') + ' ';
  const out = { min: 1, max: 100, places: 0, count: 1, unique: false, digits: null };
  const take = (re) => { const m = re.exec(s); if (m) s = s.replace(m[0], ' '); return m; };
  if (take(/\s(unique|distinct|different|no repeats?)(?=\s)/)) out.unique = true;
  const c = take(/\s(?:x\s?(\d+)|(\d+)\s?(?:times|numbers|values)|(?:count|times)\s(\d+))(?=\s)/);
  if (c) out.count = Number(c[1] || c[2] || c[3]);
  const d = take(/\s(?:(\d+)[\s-]?digits?|(?:length|digits|len)\s(\d+))(?=\s)/);
  if (d) {
    out.digits = Number(d[1] || d[2]);
    if (out.digits < 1 || out.digits > 15) return { error: 'between 1 and 15 digits' };
    out.min = out.digits === 1 ? 0 : 10 ** (out.digits - 1);
    out.max = 10 ** out.digits - 1;
  }
  const n = '(-?\\d+(?:\\.\\d+)?)';
  const band = take(new RegExp('\\s' + n + '\\s?(?:\\.\\.|–|-|\\sto\\s|:)\\s?' + n + '(?=\\s)'));
  if (band) {
    if (out.digits) return { error: 'give a length or a band, not both' };
    out.places = Math.max(decimals(band[1]), decimals(band[2]));
    out.min = Number(band[1]);
    out.max = Number(band[2]);
  } else {
    const one = take(new RegExp('\\s(?:max\\s)?' + n + '(?=\\s)'));
    if (one) {
      if (out.digits) return { error: 'give a length or a band, not both' };
      out.places = decimals(one[1]);
      out.min = out.places ? 0 : 1;
      out.max = Number(one[1]);
    }
  }
  if (s.trim()) return { error: "didn't understand '" + s.trim() + "'" };
  if (out.min > out.max) [out.min, out.max] = [out.max, out.min];
  if (out.places > 6) return { error: 'at most 6 decimal places' };
  if (out.count < 1 || out.count > 1000) return { error: 'between 1 and 1,000 numbers' };
  const f = 10 ** out.places;
  const lo = Math.round(out.min * f), hi = Math.round(out.max * f);
  if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi)) return { error: 'numbers too large' };
  if (out.unique && out.count > hi - lo + 1) return { error: 'only ' + (hi - lo + 1) + ' different numbers fit between ' + out.min + ' and ' + out.max };
  return out;
}

// -> [numbers] (unique ones in the order drawn)
export function drawRandom(o, rand) {
  const f = 10 ** o.places;
  const lo = Math.round(o.min * f), hi = Math.round(o.max * f);
  const out = [];
  const seen = new Set();
  while (out.length < o.count) {
    const v = randomInt(lo, hi, rand);
    if (o.unique) { if (seen.has(v)) continue; seen.add(v); }
    out.push(v / f);
  }
  return out;
}
export const fmtRandom = (v, o) => (o.digits ? String(v).padStart(o.digits, '0') : o.places ? v.toFixed(o.places) : String(v));

// ---- dice --------------------------------------------------------------------------

export const STANDARD = [4, 6, 8, 10, 12, 20, 100];

// '2d6+1d4+3', 'd20 adv', '4d6kh3', 'd%', '3d8-1' -> { terms: [{ n, sides, keep?, sign } | { mod }], adv } or { error }
export function readDice(text) {
  let s = String(text).toLowerCase().replace(/\s+/g, ' ').trim();
  let adv = null;
  const a = /\s?\b(adv|advantage|dis|disadvantage)\b/.exec(s);
  if (a) { adv = a[1].startsWith('a') ? 'advantage' : 'disadvantage'; s = s.replace(a[0], '').trim(); }
  const gap = /([\d%])\s+(\d|d)/.exec(s); // '2d6 3' is not 2d63
  if (gap) return { error: "put + or - between '" + s.slice(0, gap.index + 1) + "' and '" + s.slice(gap.index + gap[0].length - 1) + "'" };
  s = s.replace(/\s/g, '').replace(/d%/g, 'd100');
  if (!s) return { error: 'nothing to roll' };
  const terms = [];
  const re = /([+-])?(?:(\d*)d(\d+)(?:(kh|kl|dh|dl|k)(\d+))?|(\d+))/gy;
  let m, pos = 0, dice = 0;
  while (pos < s.length) {
    re.lastIndex = pos;
    m = re.exec(s);
    if (!m || m[0] === '') return { error: "can't read '" + s.slice(pos) + "' (try d20, 2d6+3, 4d6kh3)" };
    if (pos > 0 && !m[1]) return { error: "put + or - between '" + s.slice(0, pos) + "' and '" + s.slice(pos) + "'" };
    const sign = m[1] === '-' ? -1 : 1;
    if (m[3]) {
      const n = m[2] ? Number(m[2]) : 1, sides = Number(m[3]);
      if (n < 1 || n > 100) return { error: 'between 1 and 100 dice at a time' };
      if (sides < 2 || sides > 1000) return { error: 'a die has 2 to 1,000 sides' };
      const t = { n, sides, sign };
      if (m[4]) {
        const k = Number(m[5]);
        // kh3 keep the highest 3, kl1 keep the lowest, dl1 drop the lowest 1 (= keep n-1 highest)
        const kind = m[4] === 'k' ? 'kh' : m[4];
        t.keep = kind === 'kh' || kind === 'kl' ? { high: kind === 'kh', count: k } : { high: kind === 'dl', count: n - k };
        if (t.keep.count < 1 || t.keep.count > n) return { error: 'keep between 1 and ' + n + ' of ' + n + 'd' + sides };
      }
      dice += n;
      terms.push(t);
    } else {
      terms.push({ mod: sign * Number(m[6]) });
    }
    pos = re.lastIndex;
  }
  if (!dice) return { error: 'no dice in it (try d20 or 2d6+3)' };
  if (adv) {
    const t = terms.filter((x) => x.sides === 20 && x.n === 1 && !x.keep);
    if (t.length !== 1) return { error: 'advantage needs one d20 to roll twice (d20 adv, d20+5 adv)' };
    t[0].n = 2;
    t[0].keep = { high: adv === 'advantage', count: 1 };
  }
  return { terms, adv };
}

// Rolls a reading -> { total, terms: [{ ...term, rolls: [{ v, kept }], subtotal }] }
export function rollDice(spec, rand) {
  let total = 0;
  const terms = spec.terms.map((t) => {
    if (t.mod !== undefined) { total += t.mod; return { ...t, subtotal: t.mod }; }
    const rolls = Array.from({ length: t.n }, () => ({ v: randomInt(1, t.sides, rand), kept: true }));
    if (t.keep) {
      const order = rolls.map((r, i) => i).sort((i, j) => (t.keep.high ? rolls[j].v - rolls[i].v : rolls[i].v - rolls[j].v) || i - j);
      order.slice(t.keep.count).forEach((i) => { rolls[i].kept = false; });
    }
    const subtotal = t.sign * rolls.filter((r) => r.kept).reduce((a, r) => a + r.v, 0);
    total += subtotal;
    return { ...t, rolls, subtotal };
  });
  return { total, terms };
}

// '2d6+3' as written back.
export function diceText(spec) {
  return spec.terms.map((t, i) => {
    const sign = (t.mod !== undefined ? t.mod < 0 : t.sign < 0) ? '-' : i ? '+' : '';
    if (t.mod !== undefined) return sign + Math.abs(t.mod);
    const n = spec.adv ? 1 : t.n;
    const keep = t.keep && !spec.adv ? (t.keep.high ? 'kh' : 'kl') + t.keep.count : '';
    return sign + (n > 1 ? n : '') + 'd' + t.sides + keep;
  }).join('') + (spec.adv ? ' with ' + spec.adv : '');
}
