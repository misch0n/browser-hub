// JSON Web Tokens: signatures checked and made with Web Crypto, nothing sent
// anywhere. HS256/384/512 with a shared secret; RS, PS and ES 256/384/512 and
// EdDSA with a PEM (SPKI, PKCS#8, PKCS#1, or a certificate's key) or a JWK.

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();

export function b64urlToBytes(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  while (t.length % 4) t += '=';
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
}
export function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const jsonPart = (o) => bytesToB64url(enc.encode(JSON.stringify(o)));

export const ALGS = {
  HS256: { kind: 'hmac', hash: 'SHA-256' }, HS384: { kind: 'hmac', hash: 'SHA-384' }, HS512: { kind: 'hmac', hash: 'SHA-512' },
  RS256: { kind: 'rsa', name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, RS384: { kind: 'rsa', name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' }, RS512: { kind: 'rsa', name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' },
  PS256: { kind: 'rsa', name: 'RSA-PSS', hash: 'SHA-256', saltLength: 32 }, PS384: { kind: 'rsa', name: 'RSA-PSS', hash: 'SHA-384', saltLength: 48 }, PS512: { kind: 'rsa', name: 'RSA-PSS', hash: 'SHA-512', saltLength: 64 },
  ES256: { kind: 'ec', name: 'ECDSA', curve: 'P-256', hash: 'SHA-256', size: 32 }, ES384: { kind: 'ec', name: 'ECDSA', curve: 'P-384', hash: 'SHA-384', size: 48 },
  ES512: { kind: 'ec', name: 'ECDSA', curve: 'P-521', hash: 'SHA-512', size: 66 },
  EdDSA: { kind: 'ed', name: 'Ed25519' },
};

// ---- keys ----------------------------------------------------------------------------

// A shared secret as typed; 'hex:…' or 'base64:…' for binary ones.
export function secretBytes(text) {
  const s = String(text);
  const m = /^(hex|base64|b64|base64url):(.*)$/is.exec(s.trim());
  if (!m) return enc.encode(s);
  if (m[1].toLowerCase() === 'hex') {
    const h = m[2].replace(/\s+/g, '');
    if (!/^([0-9a-f]{2})*$/i.test(h)) throw new Error('not valid hex');
    return Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
  }
  try { return b64urlToBytes(m[2]); } catch (e) { throw new Error('not valid base64'); }
}

// DER helpers: wrap PKCS#1 RSA keys so Web Crypto takes them.
function derLen(n) {
  if (n < 128) return [n];
  const b = [];
  while (n) { b.unshift(n & 255); n >>= 8; }
  return [0x80 | b.length, ...b];
}
const der = (tag, bytes) => Uint8Array.from([tag, ...derLen(bytes.length), ...bytes]);
const RSA_ALG_ID = Uint8Array.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
export const spkiFromPkcs1 = (pk) => der(0x30, [...RSA_ALG_ID, ...der(0x03, [0, ...pk])]);
export const pkcs8FromPkcs1 = (pk) => der(0x30, [0x02, 0x01, 0x00, ...RSA_ALG_ID, ...der(0x04, pk)]);

// The SubjectPublicKeyInfo inside a certificate: Certificate → tbsCertificate →
// its 7th element (version is explicit [0] when present).
function readTLV(b, i) {
  const tag = b[i];
  let len = b[i + 1], off = i + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + b[off + k];
    off += n;
  }
  if (off + len > b.length) throw new Error('truncated DER');
  return { tag, start: i, off, len, end: off + len };
}
export function spkiFromCertificate(cert) {
  const c = readTLV(cert, 0);
  const tbs = readTLV(cert, c.off);
  let i = tbs.off;
  const fields = [];
  while (i < tbs.end) { const t = readTLV(cert, i); fields.push(t); i = t.end; }
  const at = fields[0].tag === 0xa0 ? 6 : 5;
  const spki = fields[at];
  if (!spki) throw new Error("couldn't find the certificate's public key");
  return cert.slice(spki.start, spki.end);
}

// PEM text -> { label, der } (the first block).
export function readPem(text) {
  const m = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(String(text));
  if (!m) return null;
  return { label: m[1], der: b64urlToBytes(m[2].replace(/[^A-Za-z0-9+/=]/g, '')) };
}

function keyAlgorithm(spec, usage) {
  if (spec.kind === 'hmac') return { name: 'HMAC', hash: spec.hash };
  if (spec.kind === 'rsa') return { name: spec.name, hash: spec.hash };
  if (spec.kind === 'ec') return { name: 'ECDSA', namedCurve: spec.curve };
  return { name: 'Ed25519' };
}

// key text (PEM, JWK JSON, or a secret for HS) -> CryptoKey for `use` ('verify' | 'sign').
export async function importJwtKey(alg, text, use) {
  const spec = ALGS[alg];
  if (!spec) throw new Error('unsupported algorithm ' + alg);
  const algo = keyAlgorithm(spec);
  const t = String(text).trim();
  if (spec.kind === 'hmac') {
    if (t.startsWith('{')) return subtle().importKey('jwk', JSON.parse(t), algo, false, [use]);
    return subtle().importKey('raw', secretBytes(text), algo, false, [use]);
  }
  if (t.startsWith('{')) {
    let jwk;
    try { jwk = JSON.parse(t); } catch (e) { throw new Error('the key is not valid JSON (JWK) or PEM'); }
    if (jwk.keys) jwk = jwk.keys[0]; // a JWK set: the first key
    const { alg: _a, use: _u, key_ops: _k, ...bare } = jwk;
    if (use === 'sign' && !bare.d) throw new Error('signing needs a private key (this JWK has no "d")');
    if (use === 'verify' && bare.d) { delete bare.d; delete bare.p; delete bare.q; delete bare.dp; delete bare.dq; delete bare.qi; }
    return subtle().importKey('jwk', bare, algo, false, [use]);
  }
  const pem = readPem(t);
  if (!pem) throw new Error('give the key as PEM (-----BEGIN …-----) or JWK ({"kty": …})');
  const label = pem.label;
  if (use === 'verify') {
    if (label === 'PUBLIC KEY') return subtle().importKey('spki', pem.der, algo, false, ['verify']);
    if (label === 'RSA PUBLIC KEY') return subtle().importKey('spki', spkiFromPkcs1(pem.der), algo, false, ['verify']);
    if (label === 'CERTIFICATE') return subtle().importKey('spki', spkiFromCertificate(pem.der), algo, false, ['verify']);
    throw new Error('to verify, give the public key (PUBLIC KEY, RSA PUBLIC KEY or CERTIFICATE), not ' + label);
  }
  if (label === 'PRIVATE KEY') return subtle().importKey('pkcs8', pem.der, algo, false, ['sign']);
  if (label === 'RSA PRIVATE KEY') return subtle().importKey('pkcs8', pkcs8FromPkcs1(pem.der), algo, false, ['sign']);
  if (label === 'EC PRIVATE KEY') throw new Error('convert it to PKCS#8 first: openssl pkcs8 -topk8 -nocrypt -in key.pem');
  throw new Error('to sign, give the private key (PRIVATE KEY or RSA PRIVATE KEY), not ' + label);
}

function signParams(spec) {
  if (spec.kind === 'hmac') return { name: 'HMAC' };
  if (spec.kind === 'rsa') return spec.name === 'RSA-PSS' ? { name: 'RSA-PSS', saltLength: spec.saltLength } : { name: spec.name };
  if (spec.kind === 'ec') return { name: 'ECDSA', hash: spec.hash };
  return { name: 'Ed25519' };
}

// ---- tokens ---------------------------------------------------------------------------

export function splitJwt(token) {
  const t = String(token).trim().replace(/^bearer\s+/i, '');
  const parts = t.split('.');
  if (parts.length !== 3) throw new Error('a signed JWT has three parts separated by dots');
  const json = (p, what) => {
    try { return JSON.parse(new TextDecoder().decode(b64urlToBytes(p))); } catch (e) { throw new Error('the ' + what + " isn't base64url JSON"); }
  };
  return { header: json(parts[0], 'header'), payload: json(parts[1], 'payload'), signingInput: parts[0] + '.' + parts[1], signature: parts[2] };
}

// -> { valid, alg, reason? } (throws only on a bad key or token).
export async function verifyJwt(token, keyText, opts = {}) {
  const t = splitJwt(token);
  const alg = t.header.alg;
  if (!alg || alg === 'none') return { valid: false, alg: alg || 'none', reason: 'the token is unsigned (alg none): nothing to verify' };
  if (!ALGS[alg]) throw new Error('unsupported algorithm ' + alg);
  if (opts.expectAlg && opts.expectAlg !== alg) return { valid: false, alg, reason: 'expected ' + opts.expectAlg + ', the token says ' + alg };
  const key = await importJwtKey(alg, keyText, 'verify');
  let sig;
  try { sig = b64urlToBytes(t.signature); } catch (e) { return { valid: false, alg, reason: 'the signature is not base64url' }; }
  const spec = ALGS[alg];
  if (spec.kind === 'ec' && sig.length !== spec.size * 2) return { valid: false, alg, reason: 'an ' + alg + ' signature is ' + spec.size * 2 + ' bytes (r‖s), this one ' + sig.length };
  const ok = await subtle().verify(signParams(spec), key, sig, enc.encode(t.signingInput));
  return ok ? { valid: true, alg } : { valid: false, alg, reason: 'the signature does not match this key' };
}

// header defaults to { alg, typ: 'JWT' } -> the token.
export async function signJwt(payload, alg, keyText, header = {}) {
  if (!ALGS[alg]) throw new Error('unsupported algorithm ' + alg + ' (' + Object.keys(ALGS).join(', ') + ')');
  const key = await importJwtKey(alg, keyText, 'sign');
  const input = jsonPart({ alg, typ: 'JWT', ...header }) + '.' + jsonPart(payload);
  const sig = new Uint8Array(await subtle().sign(signParams(ALGS[alg]), key, enc.encode(input)));
  return input + '.' + bytesToB64url(sig);
}
