// Number bases with BigInt: any size, bases 2 to 36, and fixed-width views
// (two's complement, bytes in big- and little-endian order).

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const PREFIX = { '0x': 16, '0b': 2, '0o': 8 };

// '0xff', '-0b1010', '1_000_000', 'ff' (with from = 16), 'z' (from = 36) -> BigInt, or throws.
export function parseNumber(text, from) {
  let s = String(text).trim().toLowerCase().replace(/[_\s']/g, '');
  let neg = false;
  if (s.startsWith('-')) { neg = true; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  let base = from || 10;
  const p = PREFIX[s.slice(0, 2)];
  if (p && (!from || from === p)) { base = p; s = s.slice(2); } else if (!from && /^[0-9a-f]+h$/.test(s) && /[a-f]/.test(s)) { base = 16; s = s.slice(0, -1); }
  if (!s) throw new Error('no digits');
  if (base < 2 || base > 36) throw new Error('bases go from 2 to 36');
  let n = 0n;
  const B = BigInt(base);
  for (const ch of s) {
    const d = DIGITS.indexOf(ch);
    if (d < 0 || d >= base) throw new Error("'" + ch + "' is not a base-" + base + ' digit');
    n = n * B + BigInt(d);
  }
  return { value: neg ? -n : n, base };
}

export function toBase(n, base) {
  if (base < 2 || base > 36) throw new Error('bases go from 2 to 36');
  return n < 0n ? '-' + (-n).toString(base) : n.toString(base);
}

// '11010110' -> '1101 0110' (groups from the right).
export function group(s, size, sep = ' ') {
  const neg = s.startsWith('-');
  const d = neg ? s.slice(1) : s;
  const out = [];
  for (let i = d.length; i > 0; i -= size) out.unshift(d.slice(Math.max(0, i - size), i));
  return (neg ? '-' : '') + out.join(sep);
}

// The smallest standard width that holds n (signed when negative), or null past 128 bits.
export function fitWidth(n) {
  for (const w of [8, 16, 32, 64, 128]) {
    const W = BigInt(w);
    if (n < 0n ? n >= -(1n << (W - 1n)) : n < (1n << W)) return w;
  }
  return null;
}

// n in `bits` bits: { bits, unsigned, signed, binary, hex, bytesBE, bytesLE } or throws when it doesn't fit.
export function widthView(n, bits) {
  const W = BigInt(bits);
  const mod = 1n << W;
  if (n >= mod || n < -(mod >> 1n)) throw new Error(n + " doesn't fit in " + bits + ' bits');
  const u = ((n % mod) + mod) % mod; // two's complement pattern
  const signed = u >= (mod >> 1n) ? u - mod : u;
  const hex = u.toString(16).padStart(bits / 4, '0');
  const bytes = hex.match(/../g);
  return {
    bits, unsigned: u, signed,
    binary: group(u.toString(2).padStart(bits, '0'), 4),
    hex: group(hex, 4),
    bytesBE: bytes.join(' '),
    bytesLE: bytes.slice().reverse().join(' '),
  };
}
