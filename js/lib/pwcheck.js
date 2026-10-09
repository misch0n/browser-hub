// Password strength, estimated on the device: nothing is stored, logged or sent.
//   check(password, { words }) -> { length, classes, poolBits, bits, patterns, crack, verdict, advice }
//   duration(seconds)          -> '3 hours', '2 centuries', 'instantly'
// `words` is an optional dictionary (an array, e.g. the EFF list split on spaces).
//
// The model, in the spirit of zxcvbn but much smaller, and only an estimate:
// find patterns an attacker tries first (common passwords, dictionary words,
// look-alike swaps, sequences, repeats, dates, keyboard walks), price each in
// bits (log2 of the guesses it takes), then pick the cheapest way to cover
// the password with patterns plus brute-forced characters. Every piece after
// the first adds a bit for the order. `bits` is the smaller of that and the
// naive length × log2(pool). Crack times assume 10 guesses a second online
// (throttled) and 10^10 a second offline (a fast hash on good hardware).

const COMMON = `123456 password 123456789 12345678 12345 qwerty 1234567 111111 1234567890 123123 abc123 1234
password1 iloveyou 1q2w3e4r 000000 qwerty123 zaq12wsx dragon sunshine princess letmein 654321 monkey 1qaz2wsx
123321 qwertyuiop superman asdfghjkl football baseball welcome admin login master hello freedom whatever
qazwsx trustno1 starwars shadow michael jennifer jordan hunter ashley bailey passw0rd charlie batman access
696969 mustang 121212 flower 555555 loveme 666666 lovely 7777777 888888 hottie 123qwe secret summer winter
internet computer cheese pepper soccer hockey killer george andrew thomas ginger joshua tigger buster daniel
matrix maggie robert family orange purple silver golden yellow cookie chocolate banana pokemon naruto samsung
google apple liverpool chelsea arsenal changeme default guest test123 root toor pass 1111 abcd1234 qwer1234
asdf1234 aa123456 picture1 love sexy angel baby blink182 money`.split(/\s+/);
const COMMON_RANK = new Map(COMMON.map((w, i) => [w, i + 1]));

const LEET = { '@': 'a', 4: 'a', 3: 'e', 0: 'o', 5: 's', $: 's', 7: 't', '!': 'i', '|': 'l', 8: 'b' };
const unleet = (s, one) => s.replace(/[@43057$!|81]/g, (c) => (c === '1' ? one : LEET[c]));

const ROWS = ['`1234567890-=', 'qwertyuiop[]\\', "asdfghjkl;'", 'zxcvbnm,./'];
const SHIFTED = ['~!@#$%^&*()_+', 'QWERTYUIOP{}|', 'ASDFGHJKL:"', 'ZXCVBNM<>?'];
const KEY = new Map();
ROWS.forEach((row, r) => [...row].forEach((ch, c) => { KEY.set(ch, [r, c, false]); KEY.set(SHIFTED[r][c], [r, c, true]); }));
// Rows sit half a key to the right of the one above: q touches 1 and 2, a touches q and w.
const NEAR = [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, -1], [1, 0]];

const POOLS = { lower: 26, upper: 26, digit: 10, symbol: 33, space: 1, other: 100 };
const classOf = (c) => (/[a-z]/.test(c) ? 'lower' : /[A-Z]/.test(c) ? 'upper' : /\d/.test(c) ? 'digit'
  : c === ' ' ? 'space' : /[\x21-\x7e]/.test(c) ? 'symbol' : 'other');
const poolOf = (chars) => [...new Set(chars.map(classOf))].reduce((n, k) => n + POOLS[k], 0);
const log2 = Math.log2;

function capsBits(t) {
  const up = (t.match(/[A-Z]/g) || []).length;
  if (!up) return 0;
  return /^[A-Z][^A-Z]*$/.test(t) || up === t.replace(/[^a-zA-Z]/g, '').length ? 1 : Math.min(up, 4) + 1;
}

// ---- pattern finders: each returns [{ kind, start, end, bits, note }] (end exclusive) ----

function dictionaries(s, words) {
  const out = [], lower = s.toLowerCase(), forms = [...new Set([lower, unleet(lower, 'i'), unleet(lower, 'l')])];
  for (let i = 0; i < s.length; i++) {
    for (let j = s.length; j >= i + 3; j--) {
      for (const f of forms) {
        const w = f.slice(i, j), leet = w !== lower.slice(i, j), rank = COMMON_RANK.get(w);
        const extra = () => capsBits(s.slice(i, j)) + (leet ? 1 : 0);
        if (rank && (j - i >= 4 || (i === 0 && j === s.length))) {
          out.push({ kind: leet ? 'leet' : 'common', start: i, end: j, bits: log2(rank + 1) + extra(), note: (leet ? 'common password ' + w + ' in disguise' : 'common password') + ' (#' + rank + ')' });
        } else if (words.size && j - i >= 4 && words.has(w)) {
          out.push({ kind: leet ? 'leet' : 'word', start: i, end: j, bits: log2(words.size) + extra(), note: leet ? 'the word ' + w + ' in disguise' : 'dictionary word' });
        }
      }
    }
  }
  return out;
}

function sequences(s) {
  const out = [], kind = (c) => (/[a-z]/.test(c) ? 1 : /[A-Z]/.test(c) ? 2 : /\d/.test(c) ? 3 : 0);
  for (let i = 0; i < s.length - 2;) {
    const d = s.charCodeAt(i + 1) - s.charCodeAt(i);
    let j = i + 1;
    if ((d === 1 || d === -1) && kind(s[i]) && kind(s[i]) === kind(s[i + 1])) {
      while (j + 1 < s.length && s.charCodeAt(j + 1) - s.charCodeAt(j) === d && kind(s[j + 1]) === kind(s[i])) j++;
    }
    if (j - i >= 2) {
      const base = /[aAzZ019]/.test(s[i]) ? 4 : kind(s[i]) === 3 ? 10 : 26;
      out.push({ kind: 'sequence', start: i, end: j + 1, bits: log2(base * (j - i + 1) * (d < 0 ? 2 : 1)), note: d > 0 ? 'ascending' : 'descending' });
      i = j + 1;
    } else i++;
  }
  return out;
}

function repeats(s, words) {
  const out = [];
  for (let i = 0; i < s.length - 2; i++) {
    let best = null;
    for (let L = 1; i + 2 * L <= s.length; L++) {
      const unit = s.slice(i, i + L);
      let n = 1;
      while (s.startsWith(unit, i + n * L)) n++;
      if (n >= 2 && (L > 1 || n >= 3) && (!best || n * L > best.n * best.L)) best = { n, L, unit };
    }
    if (!best) continue;
    const unitBits = best.L === 1 ? log2(poolOf([best.unit])) : estimate(best.unit, words).bits;
    out.push({ kind: 'repeat', start: i, end: i + best.n * best.L, bits: unitBits + log2(best.n), note: `'${best.unit}' ×${best.n}` });
  }
  return out;
}

const plausible = (d, m) => d >= 1 && d <= 31 && m >= 1 && m <= 12;
function dates(s) {
  const out = [], push = (m, bits, note) => out.push({ kind: 'date', start: m.index, end: m.index + m[0].length, bits, note });
  for (const m of s.matchAll(/(?<!\d)(\d{1,4})([-/._ ])(\d{1,2})\2(\d{1,4})(?!\d)/g)) {
    const [a, b, c] = [m[1], m[3], m[4]].map(Number), ymd = m[1].length === 4;
    if (ymd ? plausible(c, b) || plausible(b, c) : (m[4].length === 2 || m[4].length === 4) && (plausible(a, b) || plausible(b, a))) push(m, log2(365 * 100) + 2, 'date');
  }
  for (const m of s.matchAll(/(?<!\d)(\d{8}|\d{6})(?!\d)/g)) {
    const x = m[1], p = (k, n) => Number(x.slice(k, k + n));
    const ok = x.length === 8 ? plausible(p(6, 2), p(4, 2)) || plausible(p(0, 2), p(2, 2)) || plausible(p(2, 2), p(0, 2))
      : plausible(p(0, 2), p(2, 2)) || plausible(p(2, 2), p(0, 2)) || plausible(p(4, 2), p(2, 2));
    if (ok) push(m, log2(365 * 100), 'date');
  }
  for (const m of s.matchAll(/(?<!\d)(19\d\d|20\d\d)(?!\d)/g)) push(m, log2(150), 'year');
  return out;
}

function keyboard(s) {
  const out = [];
  for (let i = 0; i < s.length - 3;) {
    let j = i, turns = 0, dir = null, shifted = 0;
    while (j + 1 < s.length) {
      const a = KEY.get(s[j]), b = KEY.get(s[j + 1]);
      const k = a && b ? NEAR.findIndex(([dr, dc]) => a[0] + dr === b[0] && a[1] + dc === b[1]) : -1;
      if (k < 0) break;
      if (k !== dir) { turns++; dir = k; }
      if (b[2]) shifted++;
      j++;
    }
    if (j - i + 1 >= 4) {
      const len = j - i + 1;
      out.push({ kind: 'keyboard', start: i, end: j + 1, bits: log2(turns * len * 100) + (shifted || KEY.get(s[i])[2] ? 1 : 0), note: turns === 1 ? 'keyboard row' : 'keyboard walk' });
      i = j + 1;
    } else i++;
  }
  return out;
}

// The cheapest cover of `s` by patterns and brute-forced characters.
function estimate(s, words) {
  const chars = [...s], perChar = log2(poolOf(chars) || 1);
  const all = [...dictionaries(s, words), ...sequences(s), ...repeats(s, words), ...dates(s), ...keyboard(s)];
  const best = [{ bits: 0, via: null }];
  for (let j = 1; j <= s.length; j++) {
    best[j] = { bits: best[j - 1].bits + perChar, via: null };
    for (const m of all) if (m.end === j && best[m.start].bits + m.bits + 1 < best[j].bits) best[j] = { bits: best[m.start].bits + m.bits + 1, via: m };
  }
  const used = [];
  for (let j = s.length; j > 0;) { const v = best[j].via; if (v) { used.unshift(v); j = v.start; } else j--; }
  const rest = chars.filter((_, i) => !used.some((m) => i >= m.start && i < m.end));
  const pieces = used.length + rest.length ? used.length + (rest.length ? 1 : 0) : 0;
  const bits = used.reduce((n, m) => n + m.bits, 0) + rest.length * log2(poolOf(rest) || 1) + Math.max(0, pieces - 1);
  return { bits, used };
}

const VERDICTS = [[16, 'very weak'], [32, 'weak'], [48, 'fair'], [64, 'strong'], [Infinity, 'very strong']];
const round1 = (x) => Math.round(x * 10) / 10;

export function check(password, { words } = {}) {
  if (typeof password !== 'string') throw new TypeError('password must be text');
  const raw = [...password.slice(0, 256)];
  // Astral characters (emoji) become one placeholder each, so positions count characters.
  const s = raw.map((c) => (c.length > 1 ? '' : c)).join('');
  const dict = new Set((words || []).map((w) => String(w).toLowerCase()).filter((w) => w.length >= 4));
  const classes = Object.keys(POOLS).filter((k) => raw.some((c) => classOf(c) === k));
  const poolBits = raw.length * log2(poolOf(raw) || 1);
  const est = raw.length ? estimate(s, dict) : { bits: 0, used: [] };
  const bits = round1(Math.min(est.bits, poolBits));
  const patterns = est.used.map((m) => ({ kind: m.kind, text: raw.slice(m.start, m.end).join(''), start: m.start, end: m.end, note: m.note }));
  const verdict = VERDICTS.find(([max]) => bits < max)[1];
  return {
    length: raw.length, classes, poolBits: round1(poolBits), bits, patterns,
    crack: { online: 2 ** Math.min(bits, 1000) / 10, offline: 2 ** Math.min(bits, 1000) / 1e10 }, verdict, advice: advise(patterns, verdict, raw.length),
  };
}

function advise(patterns, verdict, length) {
  const kinds = new Set(patterns.map((p) => p.kind)), out = [];
  if (kinds.has('common')) out.push('this is one of the most used passwords: attackers try it first');
  if (kinds.has('leet')) out.push('look-alike swaps (@ for a, 0 for o) barely help: attackers try them too');
  if (kinds.has('keyboard')) out.push('avoid keyboard patterns like qwerty or 1qaz');
  if (kinds.has('sequence')) out.push('avoid sequences like abc or 1234');
  if (kinds.has('repeat')) out.push('avoid repeated characters and chunks');
  if (kinds.has('date')) out.push('avoid dates and years, above all ones linked to you');
  if (verdict === 'fair' && kinds.has('word')) out.push('add another word or two');
  if (verdict !== 'strong' && verdict !== 'very strong') {
    if (length < 12) out.push('make it longer: length helps more than symbols');
    out.push('a passphrase of 4+ random words is strong and easy to type');
  } else out.push('use it in one place only, and keep it in a password manager');
  return out;
}

const UNITS = [['second', 1], ['minute', 60], ['hour', 3600], ['day', 86400], ['month', 2629800], ['year', 31557600], ['century', 3155760000]];

export function duration(seconds) {
  if (!(seconds >= 1)) return 'instantly';
  if (seconds >= 4.35e17) return 'longer than the universe has existed';
  let i = UNITS.length - 1;
  while (i > 0 && seconds < UNITS[i][1]) i--;
  const n = Math.round(seconds / UNITS[i][1]), name = UNITS[i][0];
  return n.toLocaleString('en-GB') + ' ' + (n === 1 ? name : name === 'century' ? 'centuries' : name + 's');
}
