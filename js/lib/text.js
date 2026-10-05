// Text helpers: random passwords, counting, changing case, IP ranges. Pure,
// apart from the random numbers (crypto.getRandomValues).

// ---- random --------------------------------------------------------------------

// A uniform random integer in [0, n), without modulo bias.
export function randomBelow(n, rand = globalThis.crypto) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    rand.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

export const SETS = {
  lower: 'abcdefghijkmnopqrstuvwxyz', // no l: it reads like 1 and I
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ', // no I, O
  digits: '23456789', // no 0, 1
  symbols: '!#$%&*+-=?@^_~',
};

// `length` characters with at least one of each set in `use`.
export function password(length = 20, use = ['lower', 'upper', 'digits', 'symbols']) {
  const pool = use.map((k) => SETS[k]).join('');
  for (;;) {
    let s = '';
    for (let i = 0; i < length; i++) s += pool[randomBelow(pool.length)];
    if (length < use.length || use.every((k) => [...SETS[k]].some((c) => s.includes(c)))) return s;
  }
}
export const pin = (n = 6) => Array.from({ length: n }, () => String(randomBelow(10))).join('');
export const passphrase = (words, n = 6, sep = '-') => Array.from({ length: n }, () => words[randomBelow(words.length)]).join(sep);
// Bits of entropy for `n` independent picks from `size` choices.
export const bits = (size, n) => Math.floor(n * Math.log2(size));

// ---- count -----------------------------------------------------------------------

export function countText(text) {
  const t = String(text);
  const words = (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length;
  return {
    characters: [...t].length,
    noSpaces: [...t.replace(/\s/g, '')].length,
    bytes: new TextEncoder().encode(t).length,
    words,
    lines: t === '' ? 0 : t.split(/\r\n|\r|\n/).length,
    sentences: (t.match(/[^.!?…]*[\p{L}\p{N}][^.!?…]*([.!?…]+|$)/gu) || []).filter((s) => s.trim()).length,
    paragraphs: t.split(/\n\s*\n/).filter((p) => p.trim()).length,
    readingMinutes: words / 230,
  };
}

// ---- case ---------------------------------------------------------------------------

// 'parseHTTPResponse_code-v2 now' -> ['parse', 'http', 'response', 'code', 'v2', 'now']
export function words(text) {
  return String(text)
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
export const CASES = {
  camel: (ws) => ws.map((w, i) => (i ? cap(w) : w)).join(''),
  pascal: (ws) => ws.map(cap).join(''),
  snake: (ws) => ws.join('_'),
  kebab: (ws) => ws.join('-'),
  constant: (ws) => ws.join('_').toUpperCase(),
  title: (ws) => ws.map(cap).join(' '),
  sentence: (ws) => cap(ws.join(' ')),
  lower: (ws) => ws.join(' '),
  upper: (ws) => ws.join(' ').toUpperCase(),
  dot: (ws) => ws.join('.'),
};
export const CASE_NAMES = { camel: 'camelCase', pascal: 'PascalCase', snake: 'snake_case', kebab: 'kebab-case', constant: 'CONSTANT_CASE',
  title: 'Title Case', sentence: 'Sentence case', lower: 'lower case', upper: 'UPPER CASE', dot: 'dot.case' };

// ---- IP ranges -----------------------------------------------------------------

function v4(s) {
  const p = s.split('.');
  if (p.length !== 4 || !p.every((x) => /^\d{1,3}$/.test(x) && +x <= 255 && (x === '0' || x[0] !== '0'))) return null;
  return p.reduce((a, x) => (a << 8n) | BigInt(x), 0n);
}
function v6(s) {
  let t = s.toLowerCase();
  // A trailing dotted IPv4 part (::ffff:192.0.2.1) is two groups.
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(t);
  if (dotted) {
    const n = v4(dotted[2]);
    if (n === null) return null;
    t = dotted[1] + ((n >> 16n) & 0xffffn).toString(16) + ':' + (n & 0xffffn).toString(16);
  }
  if (!/^[0-9a-f:]+$/.test(t) || (t.match(/::/g) || []).length > 1) return null;
  const [head, rest] = t.includes('::') ? t.split('::') : [t, null];
  const hs = head ? head.split(':') : [];
  const rs = rest ? rest.split(':') : [];
  if (![...hs, ...rs].every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  const fill = 8 - hs.length - rs.length;
  if (rest === null ? fill !== 0 : fill < 1) return null;
  const all = [...hs, ...Array(rest === null ? 0 : fill).fill('0'), ...rs];
  return all.reduce((a, g) => (a << 16n) | BigInt('0x' + g), 0n);
}

export function formatIP(n, family) {
  if (family === 4) return [24n, 16n, 8n, 0n].map((s) => String((n >> s) & 255n)).join('.');
  const g = Array.from({ length: 8 }, (_, i) => ((n >> BigInt(112 - 16 * i)) & 0xffffn).toString(16));
  // The longest run of two or more zero groups becomes ::
  let best = [-1, 0];
  for (let i = 0; i < 8;) {
    if (g[i] !== '0') { i++; continue; }
    let j = i;
    while (j < 8 && g[j] === '0') j++;
    if (j - i > best[1]) best = [i, j - i];
    i = j;
  }
  if (best[1] < 2) return g.join(':');
  return g.slice(0, best[0]).join(':') + '::' + g.slice(best[0] + best[1]).join(':');
}

export function parseIP(s) {
  const t = String(s).trim();
  const a = v4(t);
  if (a !== null) return { family: 4, n: a };
  const b = v6(t.replace(/^\[|\]$/g, ''));
  return b !== null ? { family: 6, n: b } : null;
}

// '10.0.1.5/22' (or a bare address: /32, /128) -> the range, or throws.
export function parseCIDR(s) {
  const m = /^([^/\s]+)(?:\/(\d{1,3}))?$/.exec(String(s).trim());
  const ip = m && parseIP(m[1]);
  if (!ip) throw new Error("'" + s + "' is not an IP address or range (10.0.0.0/22, 2001:db8::/48)");
  const width = ip.family === 4 ? 32 : 128;
  const prefix = m[2] === undefined ? width : +m[2];
  if (prefix > width) throw new Error('an IPv' + ip.family + ' prefix is 0 to ' + width);
  const W = BigInt(width), P = BigInt(prefix);
  const hostMask = (1n << (W - P)) - 1n;
  const network = ip.n & ~hostMask & ((1n << W) - 1n);
  const last = network | hostMask;
  const size = 1n << (W - P);
  return { family: ip.family, prefix, address: ip.n, network, last, size, mask: ((1n << W) - 1n) ^ hostMask };
}

export const contains = (range, ip) => ip.family === range.family && ip.n >= range.network && ip.n <= range.last;

// What kind of address: private, loopback, link-local … (or public).
export function ipKind(ip) {
  const inRange = (cidr) => contains(parseCIDR(cidr), ip);
  const v4kinds = [['10.0.0.0/8', 'private'], ['172.16.0.0/12', 'private'], ['192.168.0.0/16', 'private'], ['127.0.0.0/8', 'loopback'],
    ['169.254.0.0/16', 'link-local'], ['100.64.0.0/10', 'shared (carrier-grade NAT)'], ['224.0.0.0/4', 'multicast'], ['0.0.0.0/8', 'this network'],
    ['192.0.2.0/24', 'documentation'], ['198.51.100.0/24', 'documentation'], ['203.0.113.0/24', 'documentation'], ['255.255.255.255/32', 'broadcast']];
  const v6kinds = [['::1/128', 'loopback'], ['::/128', 'unspecified'], ['fc00::/7', 'unique local (private)'], ['fe80::/10', 'link-local'],
    ['ff00::/8', 'multicast'], ['2001:db8::/32', 'documentation'], ['::ffff:0:0/96', 'IPv4-mapped']];
  for (const [c, k] of ip.family === 4 ? v4kinds : v6kinds) if (inRange(c)) return k;
  return 'public';
}
