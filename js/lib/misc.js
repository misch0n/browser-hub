import { pad2, parseISO } from '../core/util.js';

export function uuid() {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
}

export function b64encode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function b64decode(text) {
  let s = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  let bin;
  try {
    bin = atob(s);
  } catch (e) {
    throw new Error('not valid base64');
  }
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (e) {
    throw new Error('decoded bytes are not valid UTF-8 text');
  }
}

export function prettyJson(text) {
  return JSON.stringify(JSON.parse(text), null, 2);
}

// --- epoch ---------------------------------------------------------------

export function fmtUTC(d) { return d.toISOString().replace('.000Z', 'Z'); }

export function fmtLocal(d) {
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
    ' ' + sign + pad2(Math.floor(a / 60)) + ':' + pad2(a % 60);
}

// Number -> Date (seconds, or milliseconds when it is clearly too large for seconds).
// 'YYYY-MM-DD[ T]HH:MM[:SS][Z|+HH:MM]' -> Date (local time when no zone given).
export function parseEpochInput(s) {
  s = s.trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    const d = new Date(Math.abs(n) >= 1e11 ? n : n * 1000);
    if (isNaN(d.getTime())) throw new Error('timestamp out of range');
    return d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(s);
  if (!m) throw new Error('expected a unix timestamp or YYYY-MM-DD[ HH:MM[:SS]][Z]');
  const [y, mo, da, h = '0', mi = '0', se = '0'] = m.slice(1, 7);
  if (!parseISO(y + '-' + mo + '-' + da) || +h > 23 || +mi > 59 || +se > 59) throw new Error('invalid date');
  let d;
  if (m[7]) {
    let off = 0;
    if (m[7].toUpperCase() !== 'Z') {
      const t = m[7].replace(':', '');
      off = (t[0] === '-' ? -1 : 1) * (+t.slice(1, 3) * 60 + +t.slice(3, 5));
    }
    d = new Date(Date.UTC(+y, +mo - 1, +da, +h, +mi, +se) - off * 60000);
  } else {
    d = new Date(+y, +mo - 1, +da, +h, +mi, +se);
  }
  if (isNaN(d.getTime())) throw new Error('invalid date');
  return d;
}

// Human description of how far `d` is from `now` ("in 3 days", "2 hours ago").
export function relative(d, now) {
  const s = Math.round((d.getTime() - now.getTime()) / 1000);
  const a = Math.abs(s);
  const units = [[31536000, 'year'], [2592000, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute'], [1, 'second']];
  if (a < 1) return 'now';
  for (const [size, name] of units) {
    if (a >= size) {
      const n = Math.floor(a / size);
      const t = n + ' ' + name + (n === 1 ? '' : 's');
      return s > 0 ? 'in ' + t : t + ' ago';
    }
  }
  return 'now';
}
