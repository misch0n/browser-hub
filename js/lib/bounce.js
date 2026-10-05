// Bounce links: <this page>?go=<payload>.<signature>. The payload is the target
// URL itself (no server, nothing stored), packed small:
//
//   flag   s = https, h = http; upper case (S, H) = deflate-compressed
//   rest   base64url of the address without its scheme
//
// The signature is the first 8 bytes of an HMAC-SHA256 of the payload, with
// a key kept in your synced settings. A link only bounces straight away on a
// device that holds the key it was made with (yours); anywhere else the page
// shows where it leads and waits for a tap, so the address can't be used to
// send people somewhere they didn't choose.

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
export const BOUNCE_MAX = 2000; // characters of target URL

const b64url = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s) => {
  if (!/^[\w-]*$/.test(s)) throw new Error('bad characters');
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
};

async function through(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
const canCompress = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

// The target as given -> its normalised http(s) URL, or null.
export function bounceTarget(input) {
  const t = String(input).trim();
  if (!t || /\s/.test(t)) return null;
  try {
    const u = new URL(/^[a-z][\w+.-]*:/i.test(t) ? t : 'https://' + t);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    return u.href.length <= BOUNCE_MAX ? u.href : null;
  } catch (e) {
    return null;
  }
}

// http(s) URL -> payload
export async function pack(url) {
  const https = url.startsWith('https://');
  const raw = enc.encode(url.slice(https ? 8 : 7));
  let body = raw, flag = https ? 's' : 'h';
  if (canCompress()) {
    const z = await through(raw, new CompressionStream('deflate-raw'));
    if (z.length < raw.length) { body = z; flag = flag.toUpperCase(); }
  }
  return flag + b64url(body);
}

// payload -> http(s) URL, or throws.
export async function unpack(payload) {
  const flag = payload[0];
  if (!'shSH'.includes(flag) || payload.length < 2) throw new Error('not a bounce link');
  let bytes = unb64url(payload.slice(1));
  if (flag === 'S' || flag === 'H') {
    if (!canCompress()) throw new Error("this browser can't unpack it");
    bytes = await through(bytes, new DecompressionStream('deflate-raw'));
  }
  const url = (flag.toLowerCase() === 's' ? 'https://' : 'http://') + dec.decode(bytes);
  const ok = bounceTarget(url);
  if (!ok) throw new Error('it does not lead to a web address');
  return ok;
}

export const newBounceKey = () => b64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));

async function sign(payload, key) {
  const k = await globalThis.crypto.subtle.importKey('raw', unb64url(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', k, enc.encode(payload)));
  return b64url(mac.subarray(0, 8));
}

// -> '<base>?go=<payload>.<sig>'
export async function makeBounce(base, url, key) {
  const payload = await pack(url);
  return base + '?go=' + payload + '.' + (await sign(payload, key));
}

// The ?go= value -> { url, signed } (signed: made with one of `keys`), or throws.
export async function readBounce(param, keys = []) {
  const s = String(param || '');
  const dot = s.lastIndexOf('.');
  const payload = dot > 0 ? s.slice(0, dot) : s;
  const sig = dot > 0 ? s.slice(dot + 1) : '';
  const url = await unpack(payload);
  let signed = false;
  for (const k of keys) {
    try { if (sig && (await sign(payload, k)) === sig) { signed = true; break; } } catch (e) { /* a damaged key */ }
  }
  return { url, signed };
}

// A bounce link (this page's address with ?go=) -> its ?go= value, or null.
export function goParam(text, base) {
  try {
    const u = new URL(String(text).trim());
    if (base && u.origin + u.pathname !== base) return null;
    return u.searchParams.get('go');
  } catch (e) {
    return null;
  }
}
