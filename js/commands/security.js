import { plural } from '../core/util.js';
import { MONTH_NAMES, DAY_NAMES_LONG } from '../core/format.js';
import { encryptText, decryptEnvelope, decryptRaw, isEnvelope, rsaEncrypt, rsaDecrypt, generateKey, convertKey, readSecret, toHex, toB64, KEYGEN, PBKDF2_ROUNDS, MODES } from '../lib/crypt.js';
import { pemBlocks, decodeCertificate, decodeCsr, fingerprints } from '../lib/x509.js';

// crypt (AES and RSA encryption, keys) and cert (certificates and requests).

const PEM_RE = /-----BEGIN ([A-Z0-9 ]+)-----[\s\S]*?-----END \1-----/;

// A key (a PEM block anywhere, or a JWK object at the start) and the text around it.
function splitKey(text) {
  const m = PEM_RE.exec(text);
  if (m) return { key: m[0], rest: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).trim() };
  const t = text.trimStart();
  if (t.startsWith('{')) {
    for (let i = t.indexOf('}'); i >= 0; i = t.indexOf('}', i + 1)) {
      try { JSON.parse(t.slice(0, i + 1)); return { key: t.slice(0, i + 1), rest: t.slice(i + 1).trim() }; } catch (e) { /* keep looking */ }
    }
  }
  return { key: null, rest: text.trim() };
}

const pad2 = (n) => String(n).padStart(2, '0');
// 'Monday, 15 March 2025, 08:30 UTC'
export function utcLong(d) {
  return DAY_NAMES_LONG[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MONTH_NAMES[d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ', ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ' UTC';
}
const dayCount = (ms) => plural(Math.round(Math.abs(ms) / 86400000), 'day');

function keySummary(k) {
  if (!k) return 'unknown';
  if (k.algorithm === 'RSA') return 'RSA ' + k.bits + ' bits' + (k.exponent ? ' · exponent ' + k.exponent : '');
  if (k.algorithm === 'EC') return 'EC ' + (k.curve || '') + (k.bits ? ' · ' + k.bits + ' bits' : '');
  return k.algorithm + (k.bits ? ' · ' + k.bits + ' bits' : '');
}

const extValue = (exts, name) => (exts.find((e) => e.name === name) || {}).value;

export default function register(add, { usage }) {
  const SUBS = ['encrypt', 'decrypt', 'keygen', 'key'];
  add({
    name: 'crypt', group: 'Security', private: true, noHistory: true, // keys and plain text: kept nowhere
    desc: 'encrypt and decrypt with AES (passphrase or key) or RSA; make keys; PEM ⇄ JWK',
    usage: ['crypt encrypt [gcm|cbc] <text>', 'crypt decrypt <ccx1 envelope>', 'crypt decrypt gcm|cbc <iv> <ciphertext>',
      'crypt encrypt rsa <public key> <text>', 'crypt decrypt rsa <private key> <ciphertext>',
      'crypt keygen aes [128|192|256]', 'crypt keygen rsa [2048|3072|4096]', 'crypt keygen ec [P-256|P-384|P-521]', 'crypt keygen ed25519', 'crypt key <PEM or JWK>'],
    examples: ['crypt encrypt meet at noon   (asks for a passphrase, hidden)', 'crypt decrypt ccx1.gcm.210000.…', 'crypt keygen aes',
      'crypt encrypt rsa <paste a public key> hello', 'crypt decrypt rsa <paste the private key> <base64>', 'crypt keygen rsa 3072', 'crypt key <paste a PEM key>'],
    complete: (prev) => (prev.length === 0 ? SUBS.map((v) => ({ value: v }))
      : prev.length === 1 && prev[0] === 'encrypt' ? ['gcm', 'cbc', 'rsa'].map((v) => ({ value: v }))
        : prev.length === 1 && prev[0] === 'decrypt' ? ['gcm', 'cbc', 'rsa'].map((v) => ({ value: v }))
          : prev.length === 1 && prev[0] === 'keygen' ? Object.keys(KEYGEN).map((v) => ({ value: v }))
            : prev.length === 2 && prev[0] === 'keygen' && KEYGEN[prev[1]] ? KEYGEN[prev[1]].sizes.map((v) => ({ value: String(v) })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest.trim());
      const sub = m && m[1].toLowerCase();
      const body = m ? (m[2] || '').trim() : '';
      const fail = (e) => out.err(e.message);
      const shown = (text, bytes) => (text !== null ? text : toHex(bytes));

      if (sub === 'keygen') {
        const [kind, size] = body.toLowerCase().split(/\s+/);
        if (!kind) return usage(ctx, this);
        let k;
        try { k = await generateKey(kind, size); } catch (e) { return fail(e); }
        if (k.kind === 'AES') {
          out.head([['AES key', 'ok'], [' · ' + k.bits + ' bits · random, made on this page', 'dim']], 'ok');
          out.section('hex');
          out.value(k.hex);
          out.section('base64');
          out.value(k.base64);
          out.section('JWK');
          out.code(JSON.stringify(k.jwk), 'json');
          out.dim('Use it as hex:' + k.hex.slice(0, 8) + '… when crypt asks for the key · shown once, kept nowhere');
          out.copyable(k.hex);
          return;
        }
        return showKey(out, k, 'New ');
      }

      if (sub === 'key' || sub === 'convert') {
        if (!body) return usage(ctx, this);
        let k;
        try { k = await convertKey(body); } catch (e) { return fail(e); }
        return showKey(out, k, '');
      }

      if (sub === 'encrypt') {
        const r = /^(gcm|cbc|rsa)\b\s*([\s\S]*)$/i.exec(body);
        const mode = r ? r[1].toLowerCase() : 'gcm';
        const text = r ? r[2] : body;
        if (mode === 'rsa') {
          const { key, rest: msg } = splitKey(text);
          if (!key || !msg) return out.err('crypt encrypt rsa <public key: PEM or JWK> <text>');
          let res;
          try { res = await rsaEncrypt(key, msg); } catch (e) { return fail(e); }
          out.head([['Encrypted', 'ok'], [' · RSA-OAEP, SHA-256 · ' + res.bits + '-bit key · ' + plural(res.ciphertext.length, 'byte'), 'dim']], 'ok');
          out.value(toB64(res.ciphertext));
          out.dim('base64 · only the private key opens it: crypt decrypt rsa <private key> <this>');
          return;
        }
        if (!text) return usage(ctx, this);
        let secret = await ctx.askSecret('Passphrase, or the key as hex:… / base64:… (hidden)');
        if (!secret) return out.head('Cancelled', 'dim');
        let kind;
        try { kind = readSecret(secret).kind; } catch (e) { return fail(e); }
        if (kind === 'passphrase') {
          const again = await ctx.askSecret('The same passphrase again (hidden)');
          if (again === null || again === undefined || again === '') return out.head('Cancelled', 'dim');
          if (again !== secret) return out.err('The passphrases differ: nothing encrypted');
        }
        let res;
        try { res = await encryptText(text, secret, mode); } catch (e) { return fail(e); }
        secret = null;
        out.head([['Encrypted', 'ok'], [' · ' + MODES[mode].name + ' · ' + (res.keyKind === 'raw' ? res.keyBits + '-bit key' : 'passphrase, PBKDF2-SHA-256 × ' + PBKDF2_ROUNDS.toLocaleString('en')), 'dim']], 'ok');
        out.value(res.envelope);
        out.section([['The parts', ''], ['  for other tools', 'faint']]);
        out.kv([
          ['IV', [[toHex(res.iv), 'num']]],
          ...(res.salt.length ? [['salt', [[toHex(res.salt), 'num']]]] : []),
          ['ciphertext', [[toB64(res.ciphertext), 'num'], [mode === 'gcm' ? '  (the last 16 bytes are the tag)' : '  (PKCS#7 padded)', 'faint']]],
        ]);
        out.dim('Decrypt with: crypt decrypt <the line above> · the passphrase is not stored; lose it and the text is gone');
        out.copyable(res.envelope);
        return;
      }

      if (sub === 'decrypt') {
        if (!body) return usage(ctx, this);
        const r = /^(gcm|cbc|rsa)\b\s*([\s\S]*)$/i.exec(body);
        if (r && r[1].toLowerCase() === 'rsa') {
          const { key, rest: ct } = splitKey(r[2]);
          if (!key || !ct) return out.err('crypt decrypt rsa <private key: PEM or JWK> <ciphertext>');
          let res;
          try { res = await rsaDecrypt(key, ct); } catch (e) { return fail(e); }
          out.head([['Decrypted', 'ok'], [' · RSA-OAEP, SHA-256 · ' + res.bits + '-bit key' + (res.text === null ? ' · not UTF-8 text, shown as hex' : ''), 'dim']], 'ok');
          out.value(shown(res.text, res.bytes));
          return;
        }
        let parts = null;
        if (r) {
          parts = r[2].split(/\s+/).filter(Boolean);
          if (parts.length !== 2) return out.err('crypt decrypt ' + r[1].toLowerCase() + ' <iv> <ciphertext> (hex or base64)');
        } else if (!isEnvelope(body)) {
          return out.err('Not a ccx1 envelope. For data from elsewhere: crypt decrypt gcm|cbc <iv> <ciphertext>');
        }
        const secret = await ctx.askSecret(parts ? 'The key as hex:… or base64:… (hidden)' : 'Passphrase or key (hidden)');
        if (!secret) return out.head('Cancelled', 'dim');
        let res;
        try {
          res = parts ? await decryptRaw(r[1].toLowerCase(), parts[0], parts[1], secret) : await decryptEnvelope(body, secret);
        } catch (e) {
          return fail(e);
        }
        out.head([['Decrypted', 'ok'], [' · ' + plural(res.bytes.length, 'byte') + (res.text === null ? ' · not UTF-8 text, shown as hex' : ''), 'dim']], 'ok');
        if (res.text !== null && res.text.includes('\n')) out.code(res.text);
        else out.value(shown(res.text, res.bytes));
        return;
      }
      return usage(ctx, this);
    },
  });

  function showKey(out, k, prefix) {
    const what = k.kind + (k.bits ? ' ' + k.bits + ' bits' : '') + (k.curve ? ' ' + k.curve : '');
    out.head([[prefix + (k.isPrivate ? 'key pair' : 'public key'), 'ok'], [' · ' + what, 'dim']], 'ok');
    out.section('Public key · PEM (SPKI)');
    out.code(k.publicPem);
    out.section('Public key · JWK');
    out.code(JSON.stringify(k.publicJwk, null, 2), 'json');
    if (k.isPrivate) {
      out.section([['Private key · PEM (PKCS#8)', ''], ['  keep it secret', 'warn']]);
      out.code(k.privatePem);
      out.section('Private key · JWK');
      out.code(JSON.stringify(k.privateJwk, null, 2), 'json');
    }
    if (k.thumbprint) out.kv([['JWK thumbprint', [[k.thumbprint, 'num'], ['  SHA-256, RFC 7638', 'faint']]]]);
    out.dim((prefix ? 'Made on this page with Web Crypto' : 'Read on this page') + ' · not kept in history' + (k.kind === 'RSA' ? ' · encrypt with crypt encrypt rsa <public key> <text>' : ' · sign with jwt sign ' + (k.kind === 'Ed25519' ? 'EdDSA' : 'ES' + (k.curve || '').slice(2).replace('521', '512'))));
    out.copyable(k.isPrivate ? k.privatePem : k.publicPem);
  }

  add({
    name: 'cert', group: 'Security', desc: 'decode an X.509 certificate or request: names, dates, SANs, key, fingerprints',
    usage: ['cert <PEM certificate(s)>', 'cert <PEM certificate request>', 'cert <base64 or hex DER>'],
    examples: ['cert <paste -----BEGIN CERTIFICATE-----…>', 'cert <paste a whole chain>', 'cert <paste -----BEGIN CERTIFICATE REQUEST-----…>'],
    async run(ctx, rest) {
      const { out } = ctx;
      const text = ctx.pasted && ctx.pasted.length === 1 ? ctx.pasted[0] : rest;
      if (!text.trim()) return usage(ctx, this);
      let blocks;
      try { blocks = pemBlocks(text); } catch (e) { return out.err(e.message); }
      const now = ctx.now();
      if (blocks.length > 1) out.head([[plural(blocks.length, 'block') + ' · in order', 'strong']]);
      let worst = null;
      for (const [i, b] of blocks.entries()) {
        try {
          if (/REQUEST/.test(b.label)) await showCsr(out, b.der, blocks.length > 1 ? i + 1 : 0);
          else if (/CERTIFICATE|DER/.test(b.label)) {
            const t = await showCert(out, b.der, now, blocks.length > 1 ? i + 1 : 0);
            if (t === 'err' || (t === 'warn' && worst !== 'err')) worst = t;
          } else out.warn('Block ' + (i + 1) + ' is a ' + b.label + ', not a certificate' + (/KEY/.test(b.label) ? ' (crypt key <paste> reads keys)' : ''));
        } catch (e) {
          out.err((blocks.length > 1 ? 'Block ' + (i + 1) + ': ' : '') + e.message);
        }
      }
      if (worst) out.tone(worst);
    },
  });

  async function showCert(out, der, now, n) {
    const c = decodeCertificate(der);
    const fp = await fingerprints(der);
    const cn = (c.subject.attrs.find((a) => a.name === 'CN') || {}).value || c.subject.dn || '(no subject)';
    const from = new Date(c.validity.notBefore), to = new Date(c.validity.notAfter);
    const left = to - now;
    const state = now < from ? ['not valid yet · starts in ' + dayCount(from - now), 'warn']
      : left < 0 ? ['expired ' + dayCount(left) + ' ago', 'err']
        : left < 30 * 86400000 ? ['valid · expires in ' + dayCount(left), 'warn'] : ['valid · ' + dayCount(left) + ' left', 'ok'];
    const bc = extValue(c.extensions, 'basicConstraints');
    const isCA = bc && bc.ca;
    const segs = [[(n ? n + '. ' : '') + cn, 'strong'], [' · ' + (isCA ? (c.selfSigned ? 'root CA' : 'intermediate CA') : c.selfSigned ? 'self-signed' : 'certificate') + ' · ', 'dim'], [state[0], state[1]]];
    if (n) out.section(segs); else out.head(segs, state[1]);
    const rows = [
      ['subject', [[c.subject.dn || '(empty)', '']]],
      ['issuer', c.selfSigned ? [['itself (self-signed)', 'dim']] : [[c.issuer.dn, '']]],
      ['valid from', [[utcLong(from), '']]],
      ['valid until', [[utcLong(to), state[1] === 'ok' ? '' : state[1]]]],
    ];
    if (c.sans.length) rows.push(['names', [[c.sans.map((s) => s.replace(/^DNS:/, '')).join(', '), 'strong']]]);
    rows.push(['key', [[keySummary(c.publicKey), '']]]);
    rows.push(['signature', [[c.signatureAlgorithm.name, ''], [/sha1|md5/i.test(c.signatureAlgorithm.name) ? '  weak: no longer trusted' : '', 'warn']]]);
    rows.push(['serial', [[c.serialNumber, 'num']]]);
    if (bc) rows.push(['CA', [[isCA ? 'yes' + (bc.pathLen !== null && bc.pathLen !== undefined ? ' · up to ' + plural(bc.pathLen, 'CA') + ' below' : '') : 'no', '']]]);
    const ku = extValue(c.extensions, 'keyUsage');
    if (ku) rows.push(['key usage', [[ku.join(', '), '']]]);
    const eku = extValue(c.extensions, 'extKeyUsage');
    if (eku) rows.push(['extended usage', [[eku.join(', '), '']]]);
    const aia = extValue(c.extensions, 'authorityInfoAccess');
    if (aia && aia.ocsp && aia.ocsp.length) rows.push(['OCSP', [[aia.ocsp.join(', '), 'dim']]]);
    if (aia && aia.caIssuers && aia.caIssuers.length) rows.push(['issuer cert', [[aia.caIssuers.join(', '), 'dim']]]);
    const crl = extValue(c.extensions, 'cRLDistributionPoints');
    if (crl && crl.length) rows.push(['CRL', [[crl.join(', '), 'dim']]]);
    const shownExt = ['basicConstraints', 'keyUsage', 'extKeyUsage', 'authorityInfoAccess', 'cRLDistributionPoints', 'subjectAltName'];
    const others = c.extensions.filter((e) => !shownExt.includes(e.name)).map((e) => e.name + (e.critical ? ' (critical)' : ''));
    if (others.length) rows.push(['also', [[others.join(', '), 'faint']]]);
    rows.push(['SHA-256', [[fp.sha256, 'num']]]);
    rows.push(['SHA-1', [[fp.sha1, 'num faint']]]);
    out.kv(rows);
    if (!n) out.dim('Decoded on this page · the signature and chain are not checked');
    out.copyable(fp.sha256);
    return state[1];
  }

  async function showCsr(out, der, n) {
    const r = decodeCsr(der);
    const cn = (r.subject.attrs.find((a) => a.name === 'CN') || {}).value || r.subject.dn || '(no subject)';
    const segs = [[(n ? n + '. ' : '') + cn, 'strong'], [' · certificate request', 'dim']];
    if (n) out.section(segs); else out.head(segs);
    const rows = [['subject', [[r.subject.dn || '(empty)', '']]]];
    if (r.sans.length) rows.push(['names', [[r.sans.map((s) => s.replace(/^DNS:/, '')).join(', '), 'strong']]]);
    rows.push(['key', [[keySummary(r.publicKey), '']]]);
    rows.push(['signature', [[r.signatureAlgorithm.name, '']]]);
    const ku = extValue(r.extensions, 'keyUsage');
    if (ku) rows.push(['key usage', [[ku.join(', '), '']]]);
    const eku = extValue(r.extensions, 'extKeyUsage');
    if (eku) rows.push(['extended usage', [[eku.join(', '), '']]]);
    if (r.attributes.some((a) => a.name === 'challengePassword')) rows.push(['challenge password', [['present (not shown)', 'warn']]]);
    out.kv(rows);
    if (!n) out.dim('Decoded on this page · the request’s own signature is not checked');
  }
}
