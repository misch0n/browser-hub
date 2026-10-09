import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as A from '../../js/core/aliases.js';
import * as S from '../../js/core/search.js';
import * as P from '../../js/core/paste.js';
import * as C from '../../js/core/completion.js';
import * as Crypt from '../../js/lib/crypt.js';
import { parseUA, uaSummary } from '../../js/lib/ua.js';
import { deviceInfo, features } from '../../js/lib/device.js';
import { utcLong } from '../../js/commands/security.js';
import { makeApp, UAS, fakeEnv } from '../helpers.mjs';

test('crypt lib: AES envelopes with a passphrase or a raw key; RSA-OAEP; keys in every form', async () => {
  const e = await Crypt.encryptText('héllo', 'pass phrase');
  assert.match(e.envelope, /^ccx1\.gcm\.210000\.[\w-]{22}\.[\w-]{16}\.[\w-]+$/);
  assert.equal((await Crypt.decryptEnvelope(e.envelope, 'pass phrase')).text, 'héllo');
  await assert.rejects(Crypt.decryptEnvelope(e.envelope, 'wrong'), /wrong key or passphrase/);
  await assert.rejects(Crypt.decryptEnvelope(e.envelope, 'hex:' + '00'.repeat(32)), /locked with a passphrase/);
  // A changed byte fails the GCM tag.
  const parts = e.envelope.split('.');
  parts[5] = (parts[5][0] === 'A' ? 'B' : 'A') + parts[5].slice(1);
  await assert.rejects(Crypt.decryptEnvelope(parts.join('.'), 'pass phrase'), /changed/);
  // Raw keys: hex, base64, JWK; CBC; the parts decrypt without the envelope.
  const key = '000102030405060708090a0b0c0d0e0f';
  const c = await Crypt.encryptText('raw', 'hex:' + key, 'cbc');
  assert.match(c.envelope, /^ccx1\.cbc\.0\.\.[\w-]{22}\.[\w-]+$/);
  assert.equal((await Crypt.decryptEnvelope(c.envelope, 'base64:AAECAwQFBgcICQoLDA0ODw==')).text, 'raw');
  assert.equal((await Crypt.decryptRaw('cbc', Crypt.toHex(c.iv), Crypt.toB64(c.ciphertext), '{"kty":"oct","k":"AAECAwQFBgcICQoLDA0ODw"}')).text, 'raw');
  await assert.rejects(Crypt.decryptRaw('cbc', '00', 'AA', 'hunter2'), /no salt/);
  assert.throws(() => Crypt.readSecret('hex:0011'), /16, 24 or 32 bytes/);
  assert.equal(Crypt.readSecret('plain words').kind, 'passphrase');
  // RSA: generate, encrypt with the public key (or the private one), decrypt with the private one.
  const pair = await Crypt.generateKey('rsa', 2048);
  assert.equal(pair.bits, 2048);
  assert.match(pair.publicPem, /^-----BEGIN PUBLIC KEY-----\n[\s\S]+\n-----END PUBLIC KEY-----$/);
  const ct = await Crypt.rsaEncrypt(pair.publicPem, 'to you');
  assert.equal(ct.ciphertext.length, 256);
  assert.equal((await Crypt.rsaDecrypt(pair.privatePem, Crypt.toB64(ct.ciphertext))).text, 'to you');
  assert.equal((await Crypt.rsaDecrypt(JSON.stringify(pair.privateJwk), Crypt.toHex(ct.ciphertext))).text, 'to you');
  await assert.rejects(Crypt.rsaEncrypt(pair.publicPem, 'x'.repeat(191)), /at most 190 bytes/);
  await assert.rejects(Crypt.rsaDecrypt(pair.publicPem, 'AA'), /needs the private key/);
  // Conversions round-trip, and the thumbprint matches RFC 7638's example key.
  const back = await Crypt.convertKey(JSON.stringify(pair.publicJwk));
  assert.equal(back.publicPem, pair.publicPem);
  assert.equal(back.isPrivate, false);
  const rfc = { kty: 'RSA', e: 'AQAB', n: '0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw' };
  assert.equal(await Crypt.jwkThumbprint(rfc), 'NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs');
  for (const [kind, size, curve] of [['ec', 'P-384', 'P-384'], ['ec', '521', 'P-521'], ['ed25519', undefined, null]]) {
    const k = await Crypt.generateKey(kind, size);
    assert.equal(k.curve, curve);
    assert.equal((await Crypt.convertKey(k.privatePem)).publicPem, k.publicPem);
    assert.equal((await Crypt.convertKey(JSON.stringify(k.privateJwk))).privatePem, k.privatePem);
  }
  const aes = await Crypt.generateKey('aes', 192);
  assert.equal(aes.hex.length, 48);
  await assert.rejects(Crypt.generateKey('aes', 100), /128, 192 or 256/);
  await assert.rejects(Crypt.convertKey('-----BEGIN EC PRIVATE KEY-----\nAAAA\n-----END EC PRIVATE KEY-----'), /PKCS#8/);
  await assert.rejects(Crypt.convertKey('{"kty":"oct","k":"AA"}'), /symmetric/);
});

test('crypt command: passphrase asked twice, envelope decrypts; RSA with a pasted key; keygen; private', async () => {
  const app = await makeApp();
  const answers = [];
  app.ctx.askSecret = async () => answers.shift();
  answers.push('tr0ub4dor', 'tr0ub4dor');
  const enc = await app.run('crypt encrypt meet at noon');
  assert.equal(enc[0], '# Encrypted · AES-GCM · passphrase, PBKDF2-SHA-256 × 210,000');
  assert.equal(enc.tone, 'ok');
  const envelope = enc[1].slice(2);
  assert.equal(enc.copied, envelope);
  answers.push('tr0ub4dor');
  assert.deepEqual((await app.run('crypt decrypt ' + envelope)).slice(0, 2), ['# Decrypted · 12 bytes', '= meet at noon']);
  answers.push('nope');
  const bad = await app.run('crypt decrypt ' + envelope);
  assert.equal(bad[0], 'err: wrong key or passphrase, or the data was changed');
  answers.push('one', 'two');
  assert.equal((await app.run('crypt encrypt cbc x'))[0], 'err: The passphrases differ: nothing encrypted');
  answers.push('');
  assert.equal((await app.run('crypt encrypt x'))[0], '# Cancelled');
  answers.push('hex:' + '11'.repeat(32)); // a raw key is not asked twice
  const raw = await app.run('crypt encrypt cbc multi\nline');
  assert.equal(raw[0], '# Encrypted · AES-CBC · 256-bit key');
  answers.push('base64:' + Buffer.alloc(32, 0x11).toString('base64'));
  assert.deepEqual((await app.run('crypt decrypt ' + raw[1].slice(2))).slice(1, 3), ['multi', 'line']);
  assert.match((await app.run('crypt decrypt something'))[0], /^err: Not a ccx1 envelope/);
  // RSA: the key is the PEM block wherever it is; the rest is the message.
  const pair = await Crypt.generateKey('rsa', 2048);
  const r = await app.run('crypt encrypt rsa ' + pair.publicPem + ' hi there');
  assert.match(r[0], /^# Encrypted · RSA-OAEP, SHA-256 · 2048-bit key · 256 bytes$/);
  const d = await app.run('crypt decrypt rsa ' + r[1].slice(2) + ' ' + pair.privatePem);
  assert.equal(d[1], '= hi there');
  assert.match((await app.run('crypt encrypt rsa hello'))[0], /^err: crypt encrypt rsa <public key/);
  // keygen and key
  const g = await app.run('crypt keygen aes 128');
  assert.equal(g[0], '# AES key · 128 bits · random, made on this page');
  assert.match(g[2], /^= [0-9a-f]{32}$/);
  const ec = await app.run('crypt keygen ec P-256');
  assert.equal(ec[0], '# New key pair · EC P-256');
  assert.ok(ec.includes('## Private key · PEM (PKCS#8)  keep it secret'));
  assert.match(ec[ec.length - 1], /sign with jwt sign ES256$/);
  const k = await app.run('crypt key ' + pair.publicPem);
  assert.equal(k[0], '# public key · RSA 2048 bits');
  assert.ok(!k.some((l) => /Private key/.test(l)));
  assert.equal(k.copied, pair.publicPem);
  assert.match((await app.run('crypt keygen dsa'))[0], /^err: key kinds/);
  assert.equal((await app.run('crypt'))[0], '# Usage · crypt');
  const def = app.commands.byName.get('crypt');
  assert.equal(def.private, true);
  assert.equal(def.noHistory, true);
  assert.deepEqual(def.complete(['keygen']).map((x) => x.value), ['aes', 'rsa', 'ec', 'ed25519']);
  assert.deepEqual(def.complete(['keygen', 'rsa']).map((x) => x.value), ['2048', '3072', '4096']);
});

test('cert command: certificates, chains, requests; validity against today', async () => {
  const fx = (n) => readFileSync(new URL('../fixtures/x509/' + n, import.meta.url), 'utf8');
  const app = await makeApp();
  app.setNow(new Date('2026-10-06T12:00:00Z'));
  const leaf = await app.run('cert ' + fx('ec-leaf.pem'));
  assert.match(leaf[0], /^# leaf\.example\.test · certificate · valid · \d+ days left$/);
  assert.equal(leaf.tone, 'ok');
  assert.ok(leaf.includes('issuer: CN=Example Test Root CA, O=Example Trust, C=US'));
  assert.ok(leaf.includes('valid from: Saturday, 15 March 2025, 08:30 UTC'));
  assert.ok(leaf.includes('names: leaf.example.test, URI:https://leaf.example.test/id, IP:10.1.2.3'));
  assert.ok(leaf.includes('key: EC P-256 · 256 bits'));
  assert.ok(leaf.includes('signature: ecdsa-with-SHA384'));
  assert.ok(leaf.includes('CA: no'));
  assert.ok(leaf.includes('SHA-256: 0C:72:42:E4:CE:E4:2D:47:7B:8F:AE:C6:10:39:DF:F9:6B:76:84:2F:2C:42:AE:4D:40:01:A9:01:CA:66:28:03'));
  assert.equal(leaf.copied.slice(0, 5), '0C:72');
  const chain = await app.run('cert ' + fx('ec-leaf.pem') + '\n' + fx('ec-ca.pem'));
  assert.equal(chain[0], '# 2 blocks · in order');
  assert.match(chain.find((l) => l.startsWith('## 2.')), /^## 2\. Example Test Root CA · root CA · /);
  const csr = await app.run('cert ' + fx('csr.pem'));
  assert.equal(csr[0], '# csr.example.test · certificate request');
  assert.ok(csr.includes('names: csr.example.test, alt.example.test, IP:198.51.100.7, IP:fe80::1:2'));
  assert.ok(csr.includes('key: RSA 3072 bits · exponent 65537'));
  assert.ok(csr.includes('challenge password: present (not shown)'));
  assert.ok(!csr.some((l) => l.includes('fixture-secret')));
  app.setNow(new Date('2060-01-01T00:00:00Z'));
  const old = await app.run('cert ' + fx('ec-leaf.pem'));
  assert.match(old[0], /expired \d+ days ago$/);
  assert.equal(old.tone, 'err');
  assert.match((await app.run('cert hello'))[0], /^err: /);
  assert.equal(utcLong(new Date('2025-01-05T03:04:00Z')), 'Sunday, 5 January 2025, 03:04 UTC');
});

test('ua lib: browsers that carry each other’s tokens, frozen versions, devices, bots', () => {
  const s = (k) => uaSummary(parseUA(UAS[k]));
  assert.equal(s('macChrome'), 'Chrome 130 on macOS · desktop');
  assert.equal(s('edge'), 'Edge 130 on Windows · desktop');
  assert.equal(s('firefox'), 'Firefox 131 on Windows · desktop');
  assert.equal(s('iphone'), 'Safari 17 on iOS 17.6 · phone');
  assert.equal(s('crios'), 'Chrome 130 on iOS 17.6 · phone');
  assert.equal(s('reduced'), 'Chrome 130 on Android · phone');
  assert.equal(s('samsung'), 'Samsung Internet 26 on Android 14 · phone');
  assert.equal(s('webview'), 'Android WebView 127 on Android 14 · phone');
  assert.equal(s('ipad'), 'Safari 16 on iPadOS 16.4 · tablet');
  assert.equal(s('googlebot'), 'Googlebot 2.1 (bot)');
  assert.equal(s('ie'), 'Internet Explorer 11 on Windows 7 · desktop');
  assert.equal(s('opera'), 'Opera 114 on Linux · desktop');
  assert.equal(uaSummary(parseUA('curl/8.4.0')), 'curl 8.4.0 (bot)');
  assert.deepEqual(parseUA(UAS.samsung).device, { type: 'phone', vendor: 'Samsung', model: 'SM-S918B' });
  assert.deepEqual(parseUA(UAS.webview).device, { type: 'phone', vendor: 'Google', model: 'Pixel 8' });
  assert.equal(parseUA(UAS.crios).engine.name, 'WebKit');
  assert.equal(parseUA(UAS.firefox).engine.name, 'Gecko');
  assert.ok(parseUA(UAS.edge).notes.some((n) => /Windows 11/.test(n)));
  assert.ok(parseUA(UAS.macChrome).notes.some((n) => /10\.15\.7/.test(n)));
  assert.ok(parseUA(UAS.reduced).notes.some((n) => /reduced/.test(n)));
  assert.equal(parseUA('').browser.name, null);
});

test('device lib and commands: sections from what the browser reports; ua defaults to this browser', async () => {
  const sections = await deviceInfo(fakeEnv());
  const row = (t, k) => sections.find((s) => s.title === t).rows.find((r) => r[0] === k);
  assert.deepEqual(row('Screen', 'screen'), ['screen', '1512 × 982', 'CSS pixels']);
  assert.deepEqual(row('Screen', 'physical'), ['physical', '3024 × 1964', 'about, at 2× pixel ratio']);
  assert.equal(row('Screen', 'orientation')[1], 'landscape');
  assert.equal(row('Display and input', 'colour scheme')[1], 'dark');
  assert.equal(row('Display and input', 'pointer')[1], 'fine (mouse or pen)');
  assert.deepEqual(row('Language and place', 'language'), ['language', 'en-GB', 'then bg']);
  assert.equal(row('Hardware', 'memory')[1], 'at least 8 GB');
  assert.equal(row('Network and storage', 'storage')[1], '2.5 MB used of 60.0 GB');
  assert.equal(row('Network and storage', 'connection')[1], '4g');
  // Client hints tell Windows 11 from 10.
  const win = await deviceInfo(fakeEnv({ navigator: { userAgentData: { getHighEntropyValues: async () => ({ platform: 'Windows', platformVersion: '15.0.0', architecture: 'x86', bitness: '64', fullVersionList: [{ brand: 'Not)A;Brand', version: '99' }, { brand: 'Google Chrome', version: '130.0.6723.92' }] }) } } }));
  const hw = win.find((s) => s.title === 'Hardware').rows;
  assert.deepEqual(hw.find((r) => r[0] === 'system'), ['system', 'Windows 11', 'from client hints']);
  assert.equal(hw.find((r) => r[0] === 'browser')[1], 'Google Chrome 130.0.6723.92');
  const f = features(fakeEnv());
  assert.equal(f.find((x) => x.name === 'Service workers').ok, true);
  assert.equal(f.find((x) => x.name === 'WebGPU').ok, false);
  assert.equal(f.find((x) => x.name === 'Web Crypto').ok, true);

  const app = await makeApp();
  app.ctx.env = fakeEnv();
  const d = await app.run('device');
  assert.equal(d[0], '# Chrome 130 on macOS · desktop · as this browser reports it');
  assert.ok(d.includes('## Screen'));
  assert.ok(d.includes('window: 1200 × 800  the page’s viewport'));
  assert.ok(d.some((l) => l.startsWith('✓ Service workers')));
  const df = await app.run('device features');
  assert.match(df[0], /^# Web platform features · \d+ of \d+ here$/);
  assert.ok(!df.includes('## Screen'));
  assert.equal((await app.run('device nonsense'))[0], 'err: device, or device features');
  const u = await app.run('ua');
  assert.equal(u[0], '# Chrome 130 on macOS · desktop · this browser');
  assert.ok(u.includes('engine: Blink 130.0.0.0'));
  assert.equal(u[u.length - 1], UAS.macChrome);
  const other = await app.run('ua ' + UAS.samsung);
  assert.equal(other[0], '# Samsung Internet 26 on Android 14 · phone');
  assert.ok(other.includes('device: phone · Samsung · SM-S918B'));
});
