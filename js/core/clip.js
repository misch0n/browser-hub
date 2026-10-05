// The shared clipboard: one item, for a short while.
//
// The sync repository keeps every version of its file in git history, so a
// clip never goes there as text: it is sealed with AES-GCM under a key made
// from a passphrase (PBKDF2), which each device is given once (`clip key`)
// and keeps to itself. Without a passphrase a clip stays on this device.
//
// The synced document (collection `clip`) holds at most one sealed item:
//   { at, expires, device, deviceName, sealed: { v, iter, salt, iv, data } }
// After `expires` it is replaced by { at: <expires>, cleared: true }: every
// device makes the same replacement, so they agree without a conflict. A newer
// clip replaces an older one whichever device it came from.

export const CLIP_TTL = 15 * 60000;
export const CLIP_MAX = 50000; // characters
const ITERATIONS = 210000;

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;

function toB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFor(passphrase, salt, iter) {
  const base = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// What the seal is bound to: moving a sealed text onto other times or another
// device's name makes it fail to open.
const boundTo = (item) => enc.encode(JSON.stringify([item.at, item.expires, item.device]));

// -> the synced item for `text`
export async function seal(text, passphrase, meta) {
  const item = { at: meta.at, expires: meta.expires, device: meta.device, deviceName: meta.deviceName };
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(passphrase, salt, ITERATIONS);
  const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: boundTo(item) }, key, enc.encode(text)));
  return { ...item, sealed: { v: 1, iter: ITERATIONS, salt: toB64(salt), iv: toB64(iv), data: toB64(data) } };
}

// -> the text, or null when the passphrase isn't the one it was sealed with
// (or the item was tampered with).
export async function unseal(item, passphrase) {
  const s = item && item.sealed;
  if (!s || s.v !== 1) return null;
  try {
    const key = await keyFor(passphrase, fromB64(s.salt), s.iter);
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(s.iv), additionalData: boundTo(item) }, key, fromB64(s.data));
    return dec.decode(plain);
  } catch (e) {
    return null;
  }
}

const ms = (iso) => Date.parse(iso || '') || 0;
export const isLive = (item, now) => !!item && !item.cleared && ms(item.expires) > now.getTime();

// The document with an expired item wiped (the same wipe on every device).
export function expire(doc, now) {
  if (!doc || doc.cleared || !doc.expires || isLive(doc, now)) return doc;
  return { at: doc.expires, cleared: true };
}

// Sync: the newer of the two wins (ties: a wipe, else whichever sorts later,
// so both sides pick the same one); an expired one is wiped.
export function mergeClip(local, remote, now, canonical) {
  const l = local || null, r = remote || null;
  let v;
  if (!l || !l.at) v = r;
  else if (!r || !r.at) v = l;
  else if (l.at !== r.at) v = l.at > r.at ? l : r;
  else if (!!l.cleared !== !!r.cleared) v = l.cleared ? l : r;
  else v = canonical(l) >= canonical(r) ? l : r;
  v = v ? JSON.parse(JSON.stringify(v)) : { at: null };
  return now ? expire(v, now) : v;
}

// "14 min", "40 s"
export function timeLeft(item, now) {
  const s = Math.max(0, Math.round((ms(item.expires) - now.getTime()) / 1000));
  return s >= 90 ? Math.round(s / 60) + ' min' : s + ' s';
}
