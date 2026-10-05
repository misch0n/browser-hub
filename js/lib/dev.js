// Developer helpers, all offline: MD5, JWT decoding, line diffs, cron
// schedules and colours. Pure functions; the commands are in commands/dev.js.

import { b64decode } from './misc.js';

// ---- MD5 (RFC 1321) — WebCrypto has the SHA family but not this ----------------

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(text) {
  const msg = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  const len = msg.length;
  const total = (((len + 8) >>> 6) + 1) * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, bits >>> 0, true);
  dv.setUint32(total - 4, Math.floor(bits / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < total; off += 64) {
    const M = Array.from({ length: 16 }, (_, i) => dv.getUint32(off + i * 4, true));
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const t = d;
      d = c;
      c = b;
      const x = (a + f + K[i] + M[g]) >>> 0;
      b = (b + ((x << S[i]) | (x >>> (32 - S[i])))) >>> 0;
      a = t;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map((w) => Array.from({ length: 4 }, (_, i) => ((w >>> (8 * i)) & 0xff).toString(16).padStart(2, '0')).join('')).join('');
}

// ---- JWT ---------------------------------------------------------------------------

// -> { header, payload, signature } (signature not checked: no key here), or throws.
export function decodeJWT(token) {
  const parts = String(token).trim().replace(/^bearer\s+/i, '').split('.');
  if (parts.length !== 3 && parts.length !== 2) throw new Error('a JWT has three parts separated by dots');
  const part = (s, what) => {
    try {
      return JSON.parse(b64decode(s));
    } catch (e) {
      throw new Error('the ' + what + " isn't base64url JSON");
    }
  };
  return { header: part(parts[0], 'header'), payload: part(parts[1], 'payload'), signature: parts[2] || '' };
}

// ---- diff ----------------------------------------------------------------------

// Longest common subsequence of two lists -> [['=' | '-' | '+', item]].
export function diffLists(a, b, limit = 4e6) {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf), B = b.slice(pre, b.length - suf);
  if (A.length * B.length > limit) throw new Error('too large to compare here (' + A.length + ' × ' + B.length + ' differing lines)');
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const mid = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { mid.push(['=', A[i]]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) mid.push(['-', A[i++]]);
    else mid.push(['+', B[j++]]);
  }
  while (i < n) mid.push(['-', A[i++]]);
  while (j < m) mid.push(['+', B[j++]]);
  return [...a.slice(0, pre).map((x) => ['=', x]), ...mid, ...a.slice(a.length - suf).map((x) => ['=', x])];
}

// A unified-style view: changes with `context` lines around them, the rest folded.
// -> [{ op: '=' | '-' | '+' | '…', text }]
export function diffView(ops, context = 2) {
  const keep = ops.map(() => false);
  ops.forEach(([op], i) => {
    if (op === '=') return;
    for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true;
  });
  const out = [];
  for (let i = 0; i < ops.length;) {
    if (keep[i]) { out.push({ op: ops[i][0], text: ops[i][1] }); i++; continue; }
    let j = i;
    while (j < ops.length && !keep[j]) j++;
    out.push({ op: '…', text: (j - i) + ' unchanged line' + (j - i === 1 ? '' : 's') });
    i = j;
  }
  return out;
}

// ---- cron ------------------------------------------------------------------------

const MONTHS3 = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS3 = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MACROS = { '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *' };
const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12, names: MONTHS3, base: 1 },
  { name: 'day of week', min: 0, max: 7, names: DAYS3, base: 0 },
];

function cronField(text, f) {
  const value = (s) => {
    const i = f.names ? f.names.indexOf(s.toLowerCase()) : -1;
    const v = i >= 0 ? i + f.base : /^\d+$/.test(s) ? +s : NaN;
    if (!(v >= f.min && v <= f.max)) throw new Error("'" + s + "' is not a " + f.name + ' (' + f.min + '-' + f.max + ')');
    return v;
  };
  const set = new Set();
  for (const part of text.split(',')) {
    const m = /^(\*|[\w]+(?:-[\w]+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error("can't read '" + part + "' in the " + f.name + ' field');
    let lo = f.min, hi = f.max;
    if (m[1] !== '*') {
      const [a, b] = m[1].split('-');
      lo = value(a);
      hi = b !== undefined ? value(b) : m[2] ? f.max : lo;
    }
    const step = m[2] ? +m[2] : 1;
    if (step < 1) throw new Error('a step must be 1 or more');
    if (lo > hi) throw new Error("'" + part + "' runs backwards");
    for (let v = lo; v <= hi; v += step) set.add(f.name === 'day of week' && v === 7 ? 0 : v);
  }
  return set;
}

// -> { fields: [Set ×5], parts: [text ×5] } or throws.
export function parseCron(expr) {
  const src = MACROS[String(expr).trim().toLowerCase()] || String(expr).trim();
  const parts = src.split(/\s+/);
  if (parts.length !== 5) throw new Error('a cron schedule has 5 fields: minute hour day-of-month month day-of-week (got ' + parts.length + ')');
  const fields = parts.map((p, i) => cronField(p, FIELDS[i]));
  return { fields, parts };
}

function dayMatches(c, d) {
  const dom = c.fields[2].has(d.getDate());
  const dow = c.fields[4].has(d.getDay());
  // cron's rule: with both days restricted, either one will do ('*/2' counts as unrestricted).
  if (c.parts[2][0] !== '*' && c.parts[4][0] !== '*') return dom || dow;
  return dom && dow;
}

// The next `n` times after `from` (local time).
export function cronNext(c, from, n = 5) {
  const out = [];
  const hours = [...c.fields[1]].sort((a, b) => a - b);
  const mins = [...c.fields[0]].sort((a, b) => a - b);
  let day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const first = new Date(from.getTime() + 60000 - (from.getTime() % 60000));
  for (let guard = 0; out.length < n && guard < 366 * 8; guard++) {
    if (c.fields[3].has(day.getMonth() + 1) && dayMatches(c, day)) {
      for (const h of hours) {
        for (const m of mins) {
          const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
          if (t >= first && t.getHours() === h && out.length < n) out.push(t);
        }
      }
    }
    day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  }
  return out;
}

const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n) => String(n).padStart(2, '0');

// [1,2,3,5] -> [[1,3],[5,5]]
function runs(values) {
  const v = [...values].sort((a, b) => a - b);
  const out = [];
  for (const x of v) {
    const last = out[out.length - 1];
    if (last && x === last[1] + 1) last[1] = x; else out.push([x, x]);
  }
  return out;
}
const listWords = (xs) => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
function named(values, names) {
  return listWords(runs(values).map(([a, b]) => (a === b ? names(a) : b === a + 1 ? names(a) + ', ' + names(b) : names(a) + ' to ' + names(b))));
}
// A regular step from the first value: { step, from, to } or null.
function stepOf(set) {
  const v = [...set].sort((a, b) => a - b);
  if (v.length < 3) return null;
  const step = v[1] - v[0];
  for (let i = 1; i < v.length; i++) if (v[i] - v[i - 1] !== step) return null;
  return step > 1 ? { step, from: v[0], to: v[v.length - 1] } : null;
}

// In words: 'At 09:30, Monday to Friday'.
export function describeCron(c) {
  const [mi, ho, dom, mon, dow] = c.fields;
  const all = (i) => c.parts[i] === '*';
  let time;
  if (mi.size * ho.size <= 6 && !all(0) && !all(1)) {
    time = 'at ' + listWords([...ho].sort((a, b) => a - b).flatMap((h) => [...mi].sort((a, b) => a - b).map((m) => pad(h) + ':' + pad(m))));
  } else {
    const ms = stepOf(mi);
    const everyMin = all(0) || (ms && ms.from === 0 && ms.to + ms.step > 59);
    const minute = all(0) ? 'every minute' : everyMin ? 'every ' + ms.step + ' minutes'
      : mi.size === 1 ? 'at minute ' + [...mi][0] : 'at minutes ' + named(mi, String);
    const hs = stepOf(ho);
    const hour = all(1) ? (everyMin ? '' : ' of every hour')
      : hs ? ', every ' + hs.step + ' hours' + (hs.from === 0 && hs.to + hs.step > 23 ? '' : ' from ' + pad(hs.from) + ':00 to ' + pad(hs.to) + ':00')
        : ', from ' + named(ho, (h) => pad(h) + ':00').replace(/ to (\d\d):00/g, ' to $1:59');
    time = minute + hour;
  }
  const days = [];
  if (!all(2)) days.push('on day ' + named(dom, String) + ' of the month');
  if (!all(4)) days.push((all(2) ? 'on ' : 'or on ') + named(dow, (d) => DAY_FULL[d]));
  if (!all(3)) days.push('in ' + named(mon, (m) => MONTH_FULL[m - 1]));
  const s = [time, ...days].join(', ');
  return s[0].toUpperCase() + s.slice(1);
}

// ---- colour --------------------------------------------------------------------

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// '#0af', '#00aaff', '#00aaff80', 'rgb(0 170 255 / .5)', 'rgb(0,170,255)', 'hsl(200, 100%, 50%)'
// -> { r, g, b, a } (0-255, alpha 0-1) or null.
export function parseColor(input) {
  const s = String(input).trim().toLowerCase();
  let m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? +(parseInt(h.slice(6, 8), 16) / 255).toFixed(3) : 1 };
  }
  m = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(s);
  if (!m) return null;
  const nums = m[2].split(/\s*[,/]\s*|\s+/).filter(Boolean);
  if (nums.length < 3 || nums.length > 4) return null;
  const num = (x, scale) => (x.endsWith('%') ? (parseFloat(x) / 100) * scale : parseFloat(x));
  const a = nums[3] !== undefined ? clamp(num(nums[3], 1), 0, 1) : 1;
  if (m[1].startsWith('rgb')) {
    const [r, g, b] = nums.slice(0, 3).map((x) => clamp(Math.round(num(x, 255)), 0, 255));
    return [r, g, b].some(isNaN) ? null : { r, g, b, a };
  }
  const h = ((parseFloat(nums[0]) % 360) + 360) % 360;
  const sat = clamp(parseFloat(nums[1]) / 100, 0, 1), l = clamp(parseFloat(nums[2]) / 100, 0, 1);
  if ([h, sat, l].some(isNaN)) return null;
  const k = (n) => (n + h / 30) % 12;
  const f = (n) => l - sat * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255), a };
}

export function toHex({ r, g, b, a }) {
  const h = (v) => v.toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b) + (a < 1 ? h(Math.round(a * 255)) : '');
}

export function toHsl({ r, g, b }) {
  const [R, G, B] = [r, g, b].map((v) => v / 255);
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// WCAG relative luminance and contrast ratio.
export function luminance({ r, g, b }) {
  const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrast(x, y) {
  const [a, b] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (a + 0.05) / (b + 0.05);
}
