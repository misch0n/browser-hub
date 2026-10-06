// Encryption on this page with Web Crypto, nothing sent anywhere.
//   AES-GCM / AES-CBC with a passphrase (PBKDF2-SHA-256, 210,000 rounds, random
//   salt) or a raw 128/192/256-bit key; the result is one copyable envelope
//     ccx1.<gcm|cbc>.<rounds>.<salt>.<iv>.<ciphertext>   (base64url parts; rounds 0
//   and no salt for a raw key), so decrypting needs only the envelope and the secret.
//   RSA-OAEP (SHA-256) with a PEM or JWK key; key generation; PEM <-> JWK.

import { readPem, secretBytes, spkiFromPkcs1, pkcs8FromPkcs1, b64urlToBytes, bytesToB64url } from './jose.js';

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export const PBKDF2_ROUNDS = 210000;
export const MODES = { gcm: { name: 'AES-GCM', iv: 12 }, cbc: { name: 'AES-CBC', iv: 16 } };

export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export const toB64 = (bytes) => {
  const u = bytesToB64url(bytes).replace(/-/g, '+').replace(/_/g, '/');
  return u + '='.repeat((4 - (u.length % 4)) % 4);
};
const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

// Bytes typed as hex or base64 (either alphabet); 'hex:' / 'base64:' to say which.
export function readBytes(text, what = 'the data') {
  const t = String(text).trim();
  const m = /^(hex|base64|b64):(.*)$/is.exec(t);
  const s = (m ? m[2] : t).replace(/\s+/g, '');
  const kind = m ? (m[1].toLowerCase() === 'hex' ? 'hex' : 'b64') : /^([0-9a-f]{2})+$/i.test(s) ? 'hex' : 'b64';
  if (kind === 'hex') {
    if (!/^([0-9a-f]{2})*$/i.test(s)) throw new Error(what + ' is not valid hex');
    return Uint8Array.from(s.match(/../g) || [], (x) => parseInt(x, 16));
  }
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(s)) throw new Error(what + ' is not hex or base64');
  return b64urlToBytes(s);
}

// What the person typed when asked for the secret: a raw key (hex:… / base64:…,
// 16, 24 or 32 bytes, or an "oct" JWK) or a passphrase (anything else).
export function readSecret(text) {
  const t = String(text);
  if (/^\s*\{/.test(t)) {
    let jwk;
    try { jwk = JSON.parse(t); } catch (e) { throw new Error('the key looks like JSON but is not valid'); }
    if (jwk.kty !== 'oct' || !jwk.k) throw new Error('an AES key as JWK has kty "oct" and k');
    return rawKey(b64urlToBytes(jwk.k));
  }
  if (/^\s*(hex|base64|b64|base64url):/i.test(t)) return rawKey(secretBytes(t.trim()));
  if (!t) throw new Error('the passphrase is empty');
  return { kind: 'passphrase', text: t };
}
function rawKey(bytes) {
  if (![16, 24, 32].includes(bytes.length)) throw new Error('an AES key is 16, 24 or 32 bytes (128, 192 or 256 bits), this one ' + bytes.length);
  return { kind: 'raw', bytes };
}

async function aesKey(secret, mode, salt, rounds) {
  const algo = MODES[mode].name;
  if (secret.kind === 'raw') return subtle().importKey('raw', secret.bytes, algo, false, ['encrypt', 'decrypt']);
  const base = await subtle().importKey('raw', enc.encode(secret.text), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, base, { name: algo, length: 256 }, false, ['encrypt', 'decrypt']);
}

// -> { envelope, mode, iv, salt, rounds, ciphertext, keyKind }
export async function encryptText(text, secretText, mode = 'gcm') {
  if (!MODES[mode]) throw new Error('unknown mode ' + mode + ' (gcm or cbc)');
  const secret = readSecret(secretText);
  const salt = secret.kind === 'raw' ? new Uint8Array(0) : random(16);
  const rounds = secret.kind === 'raw' ? 0 : PBKDF2_ROUNDS;
  const iv = random(MODES[mode].iv);
  const key = await aesKey(secret, mode, salt, rounds);
  const ciphertext = new Uint8Array(await subtle().encrypt({ name: MODES[mode].name, iv }, key, enc.encode(text)));
  const envelope = ['ccx1', mode, rounds, bytesToB64url(salt), bytesToB64url(iv), bytesToB64url(ciphertext)].join('.');
  return { envelope, mode, iv, salt, rounds, ciphertext, keyKind: secret.kind, keyBits: secret.kind === 'raw' ? secret.bytes.length * 8 : 256 };
}

export const isEnvelope = (s) => /^ccx1\.(gcm|cbc)\.\d+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(s).trim());

export function readEnvelope(s) {
  const p = String(s).trim().split('.');
  if (!isEnvelope(s)) throw new Error('not a ccx1 envelope (ccx1.gcm|cbc.rounds.salt.iv.ciphertext)');
  const [, mode, rounds, salt, iv, ct] = p;
  return { mode, rounds: Number(rounds), salt: b64urlToBytes(salt), iv: b64urlToBytes(iv), ciphertext: b64urlToBytes(ct) };
}

const FAILED = 'wrong key or passphrase, or the data was changed';

// The envelope's text, or an Error saying why not.
export async function decryptEnvelope(envelope, secretText) {
  const e = readEnvelope(envelope);
  const secret = readSecret(secretText);
  if (e.rounds && secret.kind === 'raw') throw new Error('this was locked with a passphrase, not a raw key');
  if (!e.rounds && secret.kind !== 'raw') throw new Error('this was locked with a raw key: give it as hex:… or base64:…');
  if (e.rounds > 10000000) throw new Error('too many PBKDF2 rounds (' + e.rounds + ')');
  return decryptWith(e.mode, await aesKey(secret, e.mode, e.salt, e.rounds), e.iv, e.ciphertext);
}

// For data from elsewhere: mode, IV and ciphertext (hex or base64) and a raw key.
export async function decryptRaw(mode, ivText, ctText, secretText) {
  if (!MODES[mode]) throw new Error('unknown mode ' + mode + ' (gcm or cbc)');
  const secret = readSecret(secretText);
  if (secret.kind !== 'raw') throw new Error('without an envelope there is no salt: give the raw key as hex:… or base64:…');
  const iv = readBytes(ivText, 'the IV');
  if (iv.length !== MODES[mode].iv && !(mode === 'gcm' && iv.length >= 8)) throw new Error('an ' + MODES[mode].name + ' IV is ' + MODES[mode].iv + ' bytes, this one ' + iv.length);
  return decryptWith(mode, await aesKey(secret, mode), iv, readBytes(ctText, 'the ciphertext'));
}

async function decryptWith(mode, key, iv, ciphertext) {
  let plain;
  try {
    plain = new Uint8Array(await subtle().decrypt({ name: MODES[mode].name, iv }, key, ciphertext));
  } catch (err) {
    throw new Error(FAILED);
  }
  try { return { text: dec.decode(plain), bytes: plain }; } catch (err) { return { text: null, bytes: plain }; }
}

// ---- keys: PEM and JWK ---------------------------------------------------------------

const RSA_OAEP = { name: 'RSA-OAEP', hash: 'SHA-256' };
const CURVES = ['P-256', 'P-384', 'P-521'];

// The kinds a key can be imported as, tried in turn.
const CANDIDATES = [
  { kind: 'RSA', algo: RSA_OAEP, pub: ['encrypt'], priv: ['decrypt'] },
  ...CURVES.map((c) => ({ kind: 'EC', curve: c, algo: { name: 'ECDSA', namedCurve: c }, pub: ['verify'], priv: ['sign'] })),
  { kind: 'Ed25519', algo: { name: 'Ed25519' }, pub: ['verify'], priv: ['sign'] },
  { kind: 'X25519', algo: { name: 'X25519' }, pub: [], priv: ['deriveBits'] },
];

export function toPem(label, der) {
  const b = toB64(der);
  return '-----BEGIN ' + label + '-----\n' + (b.match(/.{1,64}/g) || []).join('\n') + '\n-----END ' + label + '-----';
}

const PUBLIC_ONLY = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'];
const bareJwk = (jwk) => {
  const { alg: _a, use: _u, key_ops: _k, ext: _e, ...rest } = jwk;
  return rest;
};
export const publicJwk = (jwk) => Object.fromEntries(Object.entries(bareJwk(jwk)).filter(([k]) => !PUBLIC_ONLY.includes(k)));

// A key's text (PEM or JWK) -> { format, isPrivate, der, jwk } with no algorithm yet.
function readKeyText(text) {
  const t = String(text).trim();
  if (t.startsWith('{')) {
    let jwk;
    try { jwk = JSON.parse(t); } catch (e) { throw new Error('the key is not valid JSON (JWK) or PEM'); }
    if (jwk.keys) jwk = jwk.keys[0];
    if (!jwk || !jwk.kty) throw new Error('a JWK has a "kty"');
    return { format: 'jwk', jwk: bareJwk(jwk), isPrivate: !!jwk.d };
  }
  const pem = readPem(t);
  if (!pem) throw new Error('give the key as PEM (-----BEGIN …-----) or JWK ({"kty": …})');
  const L = pem.label;
  if (L === 'PUBLIC KEY') return { format: 'spki', der: pem.der, isPrivate: false };
  if (L === 'RSA PUBLIC KEY') return { format: 'spki', der: spkiFromPkcs1(pem.der), isPrivate: false };
  if (L === 'PRIVATE KEY') return { format: 'pkcs8', der: pem.der, isPrivate: true };
  if (L === 'RSA PRIVATE KEY') return { format: 'pkcs8', der: pkcs8FromPkcs1(pem.der), isPrivate: true };
  if (L === 'EC PRIVATE KEY') throw new Error('convert it to PKCS#8 first: openssl pkcs8 -topk8 -nocrypt -in key.pem');
  if (L === 'ENCRYPTED PRIVATE KEY') throw new Error('the key is passphrase-protected: openssl pkcs8 -in key.pem -nocrypt (decrypt it first)');
  if (L === 'CERTIFICATE') throw new Error('that is a certificate: cert <paste> shows its key');
  throw new Error('not a key: ' + L);
}

function candidatesFor(k) {
  if (k.format !== 'jwk') return CANDIDATES;
  const j = k.jwk;
  if (j.kty === 'RSA') return CANDIDATES.filter((c) => c.kind === 'RSA');
  if (j.kty === 'EC') return CANDIDATES.filter((c) => c.curve === j.crv);
  if (j.kty === 'OKP') return CANDIDATES.filter((c) => c.kind === j.crv);
  if (j.kty === 'oct') throw new Error('an "oct" JWK is a symmetric (AES or HMAC) key: crypt keygen aes shows the forms');
  throw new Error('unknown key type ' + j.kty);
}

// Any PEM or JWK key -> every form: { kind, bits?, curve?, isPrivate, publicPem, publicJwk, privatePem?, privateJwk? }
export async function convertKey(text) {
  const k = readKeyText(text);
  for (const c of candidatesFor(k)) {
    const usages = k.isPrivate ? c.priv : c.pub;
    let key;
    try {
      key = await subtle().importKey(k.format, k.format === 'jwk' ? k.jwk : k.der, c.algo, true, usages);
    } catch (e) {
      continue;
    }
    return describeKey(key, c);
  }
  throw new Error("this browser couldn't read the key (RSA, EC P-256/384/521, Ed25519 and X25519 are known)");
}

async function describeKey(key, c) {
  const jwk = bareJwk(await subtle().exportKey('jwk', key));
  const isPrivate = key.type === 'private';
  const pubJwk = publicJwk(jwk);
  const pub = await subtle().importKey('jwk', pubJwk, c.algo, true, c.pub);
  const r = {
    kind: c.kind, curve: c.curve || null, isPrivate,
    bits: c.kind === 'RSA' ? b64urlToBytes(jwk.n).length * 8 : null,
    publicJwk: pubJwk,
    publicPem: toPem('PUBLIC KEY', new Uint8Array(await subtle().exportKey('spki', pub))),
  };
  if (isPrivate) {
    r.privateJwk = jwk;
    r.privatePem = toPem('PRIVATE KEY', new Uint8Array(await subtle().exportKey('pkcs8', key)));
  }
  r.thumbprint = await jwkThumbprint(pubJwk);
  return r;
}

// RFC 7638: SHA-256 over the required members in order.
export async function jwkThumbprint(jwk) {
  const req = { RSA: ['e', 'kty', 'n'], EC: ['crv', 'kty', 'x', 'y'], OKP: ['crv', 'kty', 'x'] }[jwk.kty];
  if (!req) return null;
  const json = '{' + req.map((k) => JSON.stringify(k) + ':' + JSON.stringify(jwk[k])).join(',') + '}';
  return bytesToB64url(new Uint8Array(await subtle().digest('SHA-256', enc.encode(json))));
}

// ---- RSA-OAEP --------------------------------------------------------------------------

// The most bytes RSA-OAEP with SHA-256 can encrypt with a key of `bits`.
export const oaepLimit = (bits) => bits / 8 - 2 * 32 - 2;

async function rsaKey(text, use) {
  const k = readKeyText(text);
  if (k.format === 'jwk' && k.jwk.kty !== 'RSA') throw new Error('RSA-OAEP needs an RSA key, this is ' + k.jwk.kty);
  if (use === 'encrypt' && k.isPrivate) {
    // A private key holds the public one: encrypt with that.
    const c = await convertKey(text);
    return { key: await subtle().importKey('jwk', c.publicJwk, RSA_OAEP, false, ['encrypt']), bits: c.bits };
  }
  if (use === 'decrypt' && !k.isPrivate) throw new Error('decrypting needs the private key (PRIVATE KEY or a JWK with "d")');
  let key;
  try {
    key = await subtle().importKey(k.format, k.format === 'jwk' ? k.jwk : k.der, RSA_OAEP, true, [use]);
  } catch (e) {
    throw new Error('not an RSA key');
  }
  return { key, bits: key.algorithm.modulusLength };
}

// -> { ciphertext, bits }
export async function rsaEncrypt(keyText, text) {
  const { key, bits } = await rsaKey(keyText, 'encrypt');
  const data = enc.encode(text);
  if (data.length > oaepLimit(bits)) throw new Error('RSA-OAEP with a ' + bits + '-bit key takes at most ' + oaepLimit(bits) + ' bytes; this is ' + data.length + ' (use AES for longer text)');
  return { ciphertext: new Uint8Array(await subtle().encrypt(RSA_OAEP, key, data)), bits };
}

export async function rsaDecrypt(keyText, ctText) {
  const { key, bits } = await rsaKey(keyText, 'decrypt');
  const ct = readBytes(ctText, 'the ciphertext');
  if (ct.length !== bits / 8) throw new Error('a ' + bits + '-bit RSA ciphertext is ' + bits / 8 + ' bytes, this one ' + ct.length);
  let plain;
  try {
    plain = new Uint8Array(await subtle().decrypt(RSA_OAEP, key, ct));
  } catch (e) {
    throw new Error('wrong key, or not RSA-OAEP with SHA-256');
  }
  try { return { text: dec.decode(plain), bytes: plain, bits }; } catch (e) { return { text: null, bytes: plain, bits }; }
}

// ---- key generation --------------------------------------------------------------------

export const KEYGEN = {
  aes: { sizes: [128, 192, 256], fallback: 256 },
  rsa: { sizes: [2048, 3072, 4096], fallback: 2048 },
  ec: { sizes: CURVES, fallback: 'P-256' },
  ed25519: { sizes: [], fallback: null },
};

// kind 'aes' -> { kind, bits, hex, base64, jwk }; others -> convertKey's shape.
export async function generateKey(kind, size) {
  if (kind === 'aes') {
    const bits = Number(size || 256);
    if (!KEYGEN.aes.sizes.includes(bits)) throw new Error('AES keys are 128, 192 or 256 bits');
    const b = random(bits / 8);
    return { kind: 'AES', bits, hex: toHex(b), base64: toB64(b), jwk: { kty: 'oct', k: bytesToB64url(b) } };
  }
  if (kind === 'rsa') {
    const bits = Number(size || 2048);
    if (!KEYGEN.rsa.sizes.includes(bits)) throw new Error('RSA keys here are 2048, 3072 or 4096 bits');
    const pair = await subtle().generateKey({ ...RSA_OAEP, modulusLength: bits, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']);
    return describeKey(pair.privateKey, CANDIDATES[0]);
  }
  if (kind === 'ec') {
    const curve = String(size || 'P-256').toUpperCase().replace(/^P?-?(\d+)$/, 'P-$1');
    const c = CANDIDATES.find((x) => x.curve === curve);
    if (!c) throw new Error('EC curves: P-256, P-384, P-521');
    const pair = await subtle().generateKey(c.algo, true, ['sign', 'verify']);
    return describeKey(pair.privateKey, c);
  }
  if (kind === 'ed25519') {
    const c = CANDIDATES.find((x) => x.kind === 'Ed25519');
    const pair = await subtle().generateKey(c.algo, true, ['sign', 'verify']);
    return describeKey(pair.privateKey, c);
  }
  throw new Error('key kinds: aes, rsa, ec, ed25519');
}
