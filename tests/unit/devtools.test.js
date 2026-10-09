import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as U from '../../js/core/util.js';
import * as A from '../../js/core/aliases.js';
import * as R from '../../js/core/repeat.js';
import * as S from '../../js/core/search.js';
import * as Merge from '../../js/core/merge.js';
import * as M from '../../js/lib/misc.js';
import * as Z from '../../js/lib/zones.js';
import { MON, makeApp } from '../helpers.mjs';

test('qr command: drawn from the text, too long refused', async () => {
  const app = await makeApp();
  assert.deepEqual(await app.run('qr https://example.com'), ['# QR code · 19 bytes · version 2 · error correction Q', 'QR Q https://example.com', 'dim: https://example.com · save it with SVG or PNG']);
  assert.match((await app.run('qr ' + 'x'.repeat(3000)))[0], /^err: too long for a QR code: 3000 bytes \(at most 2331 at level M\)/);
  assert.match((await app.run('qr'))[0], /^# Usage/);
});

test('developer helpers: md5, jwt, diff, cron, colour', async () => {
  const Dv = await import('../../js/lib/dev.js');
  // RFC 1321 test suite, plus multi-block and UTF-8 input.
  const md5 = { '': 'd41d8cd98f00b204e9800998ecf8427e', a: '0cc175b9c0f1b6a831c399e269772661', abc: '900150983cd24fb0d6963f7d28e17f72',
    'message digest': 'f96b697d7cb7938d525a2f31aaf161d0', abcdefghijklmnopqrstuvwxyz: 'c3fcd3d76192e4007dfb496cca67e13b',
    '12345678901234567890123456789012345678901234567890123456789012345678901234567890': '57edf4a22be3c955ac49da2e2107b67a',
    'The quick brown fox jumps over the lazy dog': '9e107d9d372bb6826bd81d3542a419d6' };
  for (const [k, v] of Object.entries(md5)) assert.equal(Dv.md5(k), v, k);
  assert.equal(Dv.md5('a'.repeat(1000)), 'cabe45dcc9ae5b66ba86600cca6b8ba8');
  assert.equal(Dv.md5('héllo wörld'), execFileSync('md5sum', { input: 'héllo wörld' }).toString().slice(0, 32));

  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const tok = b({ alg: 'RS256' }) + '.' + b({ sub: 'u1', exp: 1 }) + '.sig';
  assert.deepEqual(Dv.decodeJWT('Bearer ' + tok), { header: { alg: 'RS256' }, payload: { sub: 'u1', exp: 1 }, signature: 'sig' });
  assert.throws(() => Dv.decodeJWT('a.b'), /header isn't base64url JSON/);
  assert.throws(() => Dv.decodeJWT('nodots'), /three parts/);

  const ops = Dv.diffLists(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']);
  assert.deepEqual(ops, [['=', 'a'], ['-', 'b'], ['+', 'x'], ['=', 'c'], ['=', 'd'], ['+', 'e']]);
  const long = Array.from({ length: 30 }, (_, i) => 'line ' + i);
  const changed = long.slice(); changed[15] = 'changed';
  assert.deepEqual(Dv.diffView(Dv.diffLists(long, changed)).map((l) => l.op + ' ' + l.text),
    ['… 13 unchanged lines', '= line 13', '= line 14', '- line 15', '+ changed', '= line 16', '= line 17', '… 12 unchanged lines']);
  assert.throws(() => Dv.diffLists(Array.from({ length: 3000 }, (_, i) => 'a' + i), Array.from({ length: 3000 }, (_, i) => 'b' + i)), /too large/);

  const cron = (e) => Dv.describeCron(Dv.parseCron(e));
  assert.equal(cron('*/15 * * * *'), 'Every 15 minutes');
  assert.equal(cron('30 9 * * 1-5'), 'At 09:30, on Monday to Friday');
  assert.equal(cron('0 9,17 * * mon-fri'), 'At 09:00 and 17:00, on Monday to Friday');
  assert.equal(cron('@hourly'), 'At minute 0 of every hour');
  assert.equal(cron('0 0 1 1 *'), 'At 00:00, on day 1 of the month, in January');
  assert.equal(cron('23 0-20/2 * * *'), 'At minute 23, every 2 hours from 00:00 to 20:00');
  assert.equal(cron('*/10 9-17 * * 1-5'), 'Every 10 minutes, from 09:00 to 17:59, on Monday to Friday');
  assert.equal(cron('0 0 * * 7'), 'At 00:00, on Sunday'); // 7 is Sunday too
  const next = (e, n) => Dv.cronNext(Dv.parseCron(e), MON, n).map((d) => U.toISO(d) + ' ' + U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes()));
  assert.deepEqual(next('30 9 * * 1-5', 3), ['2026-10-06 09:30', '2026-10-07 09:30', '2026-10-08 09:30']);
  assert.deepEqual(next('0 12 * * *', 1), ['2026-10-06 12:00']); // strictly after now (12:00)
  assert.deepEqual(next('0 0 1,15 * 1', 3), ['2026-10-12 00:00', '2026-10-15 00:00', '2026-10-19 00:00']); // day or weekday
  assert.deepEqual(next('0 0 */2 * 1', 2), ['2026-10-19 00:00', '2026-11-09 00:00']); // */2 isn't a restriction: odd days AND Mondays
  assert.deepEqual(next('0 0 29 2 *', 1), ['2028-02-29 00:00']);
  assert.deepEqual(next('0 0 30 2 *', 1), []);
  for (const [bad, msg] of [['* * *', /5 fields/], ['61 * * * *', /'61' is not a minute/], ['5-1 * * * *', /runs backwards/], ['* * * foo *', /'foo' is not a month/], ['*/0 * * * *', /step/]]) {
    assert.throws(() => Dv.parseCron(bad), msg, bad);
  }

  const c = Dv.parseColor;
  assert.deepEqual(c('#0af'), { r: 0, g: 170, b: 255, a: 1 });
  assert.deepEqual(c('00AAFF'), { r: 0, g: 170, b: 255, a: 1 });
  assert.deepEqual(c('rgb(0 170 255 / 50%)'), { r: 0, g: 170, b: 255, a: 0.5 });
  assert.deepEqual(c('rgba(0, 170, 255, 0.5)'), { r: 0, g: 170, b: 255, a: 0.5 });
  assert.deepEqual(c('hsl(200, 100%, 50%)'), { r: 0, g: 170, b: 255, a: 1 });
  assert.equal(c('nope'), null);
  assert.equal(Dv.toHex(c('#00aaff80')), '#00aaff80');
  assert.deepEqual(Dv.toHsl(c('#00aaff')), { h: 200, s: 100, l: 50 });
  assert.equal(Dv.contrast(c('#000'), c('#fff')).toFixed(1), '21.0');
  assert.equal(Dv.contrast(c('#777'), c('#fff')).toFixed(2), '4.48');
});

test('developer commands: hash, jwt (kept nowhere), url, regex, diff, cron, color', async () => {
  const app = await makeApp();
  const h = await app.run('hash hello');
  assert.deepEqual(h.slice(1, 5), ['MD5 | 5d41402abc4b2a76b9719d911017c592', 'SHA-1 | aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d',
    'SHA-256 | 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    'SHA-512 | 9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043']);
  assert.equal(h.copied, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.deepEqual(await app.run('hash sha384 abc'), ['# SHA-384 · 3 bytes of UTF-8',
    '= cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7']);
  assert.equal(app.commands.byName.get('hash').private, true);

  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(MON.getTime() / 1000) + 7200;
  const j = await app.run('jwt ' + b({ alg: 'HS256', typ: 'JWT' }) + '.' + b({ sub: 'user-1', exp }) + '.c2ln');
  assert.equal(j[0], '# JWT · HS256 · valid, expires in 2 hours');
  assert.equal(j.tone, 'ok');
  assert.ok(j.includes('subject: user-1'));
  assert.ok(j.includes('expires: Monday 5 October 14:00 · in 2 hours'));
  const old = await app.run('jwt ' + b({ alg: 'none' }) + '.' + b({ exp: 1 }) + '.');
  assert.match(old[0], /^# JWT · none · expired \d+ years ago$/);
  assert.equal(old.tone, 'err');
  assert.equal(app.commands.byName.get('jwt').noHistory, true);
  assert.equal(app.commands.byName.get('jwt').private, true);

  const u = await app.run('url example.com/a%20b?q=hello%20world&x=1#top');
  assert.deepEqual(u.slice(0, 6), ['# example.com · https', 'scheme: https', 'host: example.com', 'port: 443 (default)', 'path: /a b', 'fragment: top']);
  assert.deepEqual(u.slice(6), ['## Query · 2 parameters', 'q | hello world', 'x | 1']);
  assert.equal((await app.run('url encode a&b=c d'))[0], '= a%26b%3Dc%20d');
  assert.equal((await app.run('url decode a%26b%3Dc%20d'))[0], '= a&b=c d');
  assert.equal((await app.run('url decode %zz'))[0], 'err: Not valid percent-encoding: %zz');

  const r = await app.run('regex /(\\d{3})-(\\d{4})/ call 555-1234 or 555-9876');
  assert.deepEqual(r, ['# 2 matches · /(\\d{3})-(\\d{4})/', 'call 555-1234 or 555-9876', '| # | at | match | groups',
    '1 | 5 | 555-1234 | 1=555  2=1234', '2 | 17 | 555-9876 | 1=555  2=9876']);
  assert.equal((await app.run('regex /^(?<user>[^@]+)@(?<domain>.+)$/ me@example.com'))[3], '1 | 0 | me@example.com | user=me  domain=example.com');
  assert.equal((await app.run('regex /a|/ ba'))[0], '# 3 matches · /a|/'); // empty matches don't loop for ever
  assert.equal((await app.run('regex /[/]x/'))[0], '# Valid · 0 groups · add some text after it to try it');
  assert.match((await app.run('regex /(/ x'))[0], /^err: Invalid regular expression/);
  assert.equal((await app.run('regex /zz/ abc'))[0], '# No match · /zz/');

  assert.deepEqual(await app.run('diff "the quick brown fox" "the quick red fox"'), ['# Differs · 2 words changed', '− the quick brown fox', '+ the quick red fox']);
  app.ctx.pasted = ['one\ntwo\nthree', 'one\n2\nthree\nfour'];
  assert.deepEqual(await app.run('diff x'), ['# Differs · −1 +2 · 3 lines → 4 lines', '  one', '- two', '+ 2', '  three', '+ four']);
  app.ctx.pasted = [];
  assert.equal((await app.run('diff "same" "same"'))[0], '# Identical · 1 line');
  assert.match((await app.run('diff only-one'))[0], /^# Usage/);

  const cr = await app.run('cron 30 9 * * 1-5');
  assert.deepEqual(cr.slice(0, 3), ['# At 09:30, on Monday to Friday · 30 9 * * 1-5', '## Next runs · your time', 'Tuesday 6 October | 09:30 | in 21 hours']);
  assert.equal((await app.run('cron 0 0 30 2 *'))[1], 'warn: never runs (no such date)');

  const col = await app.run('color #0af');
  assert.deepEqual(col, ['# #00aaff', 'SWATCH #00aaff | #ffffff Aa #00aaff on white | #000000 Aa #00aaff on black', 'hex: #00aaff', 'rgb: rgb(0 170 255)',
    'hsl: hsl(200 100% 50%)', 'on white: 2.56:1 fails', 'on black: 8.19:1 AAA']);
  const pair = await app.run('color #777 on white');
  assert.match(pair[0], /^err: Not a colour: 'white'/);
  const ok = await app.run('color #595959 on #fff');
  assert.equal(ok[0], '# 7.00:1 contrast · AAA');
  assert.equal(ok.tone, 'ok');
  assert.equal((await app.run('color #777 on #fff')).tone, 'warn');
});

test('text helpers: passwords, counting, case, IP ranges', async () => {
  const T = await import('../../js/lib/text.js');
  // Uniform: values past the last whole multiple are drawn again, not folded.
  const seq = [0xffffffff, 7];
  const fake = { getRandomValues: (a) => { a[0] = seq.shift(); return a; } };
  assert.equal(T.randomBelow(10, fake), 7);
  for (let i = 0; i < 50; i++) {
    const p = T.password(12);
    assert.equal(p.length, 12);
    assert.ok(/[a-z]/.test(p) && /[A-Z]/.test(p) && /[2-9]/.test(p) && /[!#$%&*+\-=?@^_~]/.test(p), p);
    assert.ok(!/[lIO01]/.test(p), p);
  }
  assert.match(T.password(30, ['lower', 'upper', 'digits']), /^[a-zA-Z2-9]{30}$/);
  assert.match(T.pin(8), /^\d{8}$/);
  const { WORDS } = await import('../../js/lib/wordlist.js');
  assert.equal(WORDS.length, 7776);
  assert.equal(new Set(WORDS).size, 7776);
  assert.equal(T.passphrase(WORDS, 6).split('-').length, 6);
  assert.equal(T.bits(7776, 6), 77);

  assert.deepEqual(T.countText('Hello world. It’s here!\n\nSecond para'), { characters: 36, noSpaces: 30, bytes: 38, words: 6, lines: 3,
    sentences: 3, paragraphs: 2, readingMinutes: 6 / 230 });
  assert.equal(T.countText('👍🏽 ok').characters, 5); // code points, not UTF-16 units
  assert.equal(T.countText('').lines, 0);

  assert.deepEqual(T.words('parseHTTPResponse_code-v2 now'), ['parse', 'http', 'response', 'code', 'v2', 'now']);
  const ws = T.words('user account ID');
  assert.deepEqual(Object.fromEntries(Object.entries(T.CASES).map(([k, f]) => [k, f(ws)])), {
    camel: 'userAccountId', pascal: 'UserAccountId', snake: 'user_account_id', kebab: 'user-account-id', constant: 'USER_ACCOUNT_ID',
    title: 'User Account Id', sentence: 'User account id', lower: 'user account id', upper: 'USER ACCOUNT ID', dot: 'user.account.id' });

  const ip = (s) => { const r = T.parseIP(s); return r && T.formatIP(r.n, r.family); };
  assert.equal(ip('2001:0db8:0000:0000:0001:0000:0000:0001'), '2001:db8::1:0:0:1'); // the first longest zero run
  assert.equal(ip('::ffff:192.0.2.1'), '::ffff:c000:201');
  assert.equal(ip('[::1]'), '::1');
  assert.equal(ip('1:0:0:2:0:0:0:3'), '1:0:0:2::3');
  for (const bad of ['1::2::3', '12345::', '1:2:3:4:5:6:7', '256.1.1.1', '1.2.3', '01.2.3.4', 'x']) assert.equal(T.parseIP(bad), null, bad);
  const r = T.parseCIDR('172.20.5.9/12');
  assert.deepEqual([T.formatIP(r.network, 4), T.formatIP(r.last, 4), T.formatIP(r.mask, 4), r.size], ['172.16.0.0', '172.31.255.255', '255.240.0.0', 1048576n]);
  assert.equal(T.parseCIDR('0.0.0.0/0').size, 2n ** 32n);
  assert.throws(() => T.parseCIDR('::/129'), /0 to 128/);
  assert.equal(T.contains(T.parseCIDR('2001:db8::/32'), T.parseIP('2001:db8:ffff::1')), true);
  assert.equal(T.contains(T.parseCIDR('10.0.0.0/8'), T.parseIP('::1')), false);
  assert.deepEqual(['10.1.1.1', '8.8.8.8', '100.64.0.1', 'fe80::1', '2606:4700::1111'].map((s) => T.ipKind(T.parseIP(s))),
    ['private', 'public', 'shared (carrier-grade NAT)', 'link-local', 'public']);
});

test('text commands: pw (kept out of the shared history), count, case, cidr', async () => {
  const app = await makeApp();
  const pw = await app.run('pw');
  assert.match(pw[0], /^# New password · 122 bits/);
  assert.match(pw[1], /^= .{20}$/);
  assert.equal(app.commands.byName.get('pw').private, true);
  assert.match((await app.run('pw words 4'))[1], /^= [a-z-]+(-[a-z-]+){3}$/);
  assert.match((await app.run('pw pin'))[1], /^= \d{6}$/);
  assert.equal((await app.run('pw 7'))[0], 'err: Length: 8 to 128');
  assert.equal((await app.run('pw words 2'))[0], 'err: Words: 3 to 12');
  assert.match((await app.run('pw nonsense'))[0], /^# Usage/);
  assert.equal(app.data.steps().undo.length, 0);

  assert.deepEqual((await app.run('count one two three')).slice(0, 2), ['# 3 words · 13 characters', 'characters: 13 · 11 without spaces']);
  const cs = await app.run('case user account id');
  assert.equal(cs[3], 'snake_case | user_account_id');
  assert.deepEqual(await app.run('case kebab parseHTTPResponse'), ['# kebab-case', '= parse-http-response']);
  const c = await app.run('cidr 10.0.1.5/22');
  assert.deepEqual(c, ['# 10.0.0.0/22 · IPv4 · private', 'address: 10.0.1.5 (inside the range)', 'network: 10.0.0.0/22', 'netmask: 255.255.252.0',
    'wildcard: 0.0.3.255', 'first: 10.0.0.1', 'last: 10.0.3.254', 'broadcast: 10.0.3.255', 'addresses: 1,024 · 1,022 usable hosts']);
  assert.equal((await app.run('cidr 10.0.0.0/22 10.0.3.9'))[0], '# 10.0.3.9 is in 10.0.0.0/22');
  assert.equal((await app.run('cidr 10.0.0.0/22 10.0.4.1')).tone, 'err');
  assert.deepEqual((await app.run('cidr 2001:db8::/48')).slice(0, 4), ['# 2001:db8::/48 · IPv6 · documentation', 'network: 2001:db8::/48', 'first: 2001:db8::',
    'last: 2001:db8:0:ffff:ffff:ffff:ffff:ffff']);
  assert.deepEqual(await app.run('cidr 10.0.0.1/31'), ['# 10.0.0.0/31 · IPv4 · private', 'address: 10.0.0.1 (inside the range)', 'network: 10.0.0.0/31',
    'netmask: 255.255.255.254', 'wildcard: 0.0.0.1', 'first: 10.0.0.0', 'last: 10.0.0.1', 'addresses: 2']);
});

test('bounce: the address packed into the link, signed with your synced key, damage and forgery caught', async () => {
  const B = await import('../../js/lib/bounce.js');
  const base = 'https://misch0n.github.io/browser-hub/';
  const key = B.newBounceKey();
  for (const u of ['https://example.com/a/rather/long/path?with=query&and=query&and=query&utm_source=x', 'http://a.example/ü?x=ж', 'example.com']) {
    const t = B.bounceTarget(u);
    const link = await B.makeBounce(base, t, key);
    assert.ok(link.startsWith(base + '?go='));
    assert.match(link, /^[\w:/.?=-]+$/); // nothing that needs escaping
    assert.deepEqual(await B.readBounce(B.goParam(link, base), [key]), { url: t, signed: true });
    assert.deepEqual(await B.readBounce(B.goParam(link, base), [B.newBounceKey()]), { url: t, signed: false }); // someone else's
  }
  // Long repetitive addresses are compressed (S), short ones are not (s).
  assert.equal((await B.pack('https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'))[0], 'S');
  assert.equal((await B.pack('https://example.com/'))[0], 's');
  assert.equal((await B.pack('http://example.com/'))[0], 'h');
  // Forged: a changed payload with the old signature is not signed; a damaged one fails.
  const link = await B.makeBounce(base, 'https://example.com/', key);
  const go = B.goParam(link, base);
  const forged = (await B.pack('https://evil.example/')) + go.slice(go.lastIndexOf('.'));
  assert.deepEqual(await B.readBounce(forged, [key]), { url: 'https://evil.example/', signed: false });
  await assert.rejects(B.readBounce('x!!', [key]), /not a bounce link/);
  await assert.rejects(B.readBounce('S' + 'AAAA', [key]));
  // Never anything but a web address.
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'not a url', 'localhostx', 'https://x.example/' + 'a'.repeat(2000)]) {
    assert.equal(B.bounceTarget(bad), null, bad);
  }
  const js = 's' + Buffer.from('alert(1)').toString('base64url');
  await assert.rejects(B.readBounce('j' + js.slice(1)), /not a bounce link/);
  assert.equal(B.goParam('https://elsewhere.example/?go=abc', base), null); // another page's link

  // The command: a key is made once and synced; bounce <bounce link> says where it goes.
  const app = await makeApp();
  app.ctx.pageURL = base;
  const made = await app.run('bounce example.com/some/page');
  assert.match(made[0], /^# Bounce link to example\.com · \d+ characters$/);
  assert.equal(app.data.state.settings.bounceKeys.length, 1);
  const bl = made[1].slice(2);
  assert.ok(bl.startsWith(base + '?go=s'));
  await app.run('bounce example.org');
  assert.equal(app.data.state.settings.bounceKeys.length, 1); // reused
  assert.equal(app.data.steps().undo.length, 0); // the key isn't an undo step
  assert.deepEqual((await app.run('bounce ' + bl)).slice(0, 3), ['# Goes to example.com', '= https://example.com/some/page', 'dim: Made with your key: it bounces straight away on your devices']);
  assert.equal((await app.run('bounce ' + base + '?go=x!!'))[0], 'err: This bounce link is damaged: not a bounce link');
  assert.equal((await app.run('bounce javascript:alert(1)'))[0], "err: 'javascript:alert(1)' is not a web address (https://…, at most 2,000 characters)");

  // Keys made on two devices offline are both kept by sync, so both devices' links verify everywhere.
  const m = Merge.merge3({ settings: { bounceKeys: [] } }, { settings: { bounceKeys: ['a'] } }, { settings: { bounceKeys: ['b'] } });
  assert.deepEqual(m.collections.settings.bounceKeys, ['a', 'b']);
  assert.deepEqual(m.conflicts, []);
});

test('developer tools 2: JWT signatures, bases, text, CSV, escaping, references', async () => {
  const J = await import('../../js/lib/jose.js');
  const nodeCrypto = await import('node:crypto');
  // The jwt.io example token, signed by someone else with HS256.
  const jwtio = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  assert.deepEqual(await J.verifyJwt(jwtio, 'your-256-bit-secret'), { valid: true, alg: 'HS256' });
  assert.deepEqual(await J.verifyJwt(jwtio, 'wrong secret'), { valid: false, alg: 'HS256', reason: 'the signature does not match this key' });
  assert.equal((await J.verifyJwt(jwtio, 'hex:' + Buffer.from('your-256-bit-secret').toString('hex'))).valid, true);
  for (const alg of ['HS384', 'HS512']) {
    const t = await J.signJwt({ sub: 'me' }, alg, 'k3y');
    assert.deepEqual(await J.verifyJwt(t, 'k3y'), { valid: true, alg });
  }
  // RSA, RSA-PSS, EC, Ed25519: tokens signed by Node's own crypto verify with our code, ours with Node's.
  const b64u = (b) => Buffer.from(b).toString('base64url');
  const nodeToken = (alg, sign) => { const input = b64u(JSON.stringify({ alg, typ: 'JWT' })) + '.' + b64u(JSON.stringify({ sub: 'n' })); return input + '.' + b64u(sign(input)); };
  const rsa = nodeCrypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pemOf = (k, type) => k.export({ type, format: 'pem' });
  for (const [alg, hash] of [['RS256', 'sha256'], ['RS384', 'sha384'], ['RS512', 'sha512']]) {
    const t = nodeToken(alg, (input) => nodeCrypto.sign(hash, Buffer.from(input), rsa.privateKey));
    for (const pub of [pemOf(rsa.publicKey, 'spki'), pemOf(rsa.publicKey, 'pkcs1'), JSON.stringify(rsa.publicKey.export({ format: 'jwk' }))]) {
      assert.deepEqual(await J.verifyJwt(t, pub), { valid: true, alg }, alg);
    }
    for (const priv of [pemOf(rsa.privateKey, 'pkcs8'), pemOf(rsa.privateKey, 'pkcs1'), JSON.stringify(rsa.privateKey.export({ format: 'jwk' }))]) {
      const ours = await J.signJwt({ sub: 'o' }, alg, priv);
      const [h, p, s] = ours.split('.');
      assert.ok(nodeCrypto.verify(hash, Buffer.from(h + '.' + p), rsa.publicKey, Buffer.from(s, 'base64url')), alg + ' signed by us');
    }
  }
  const ps = await J.signJwt({ sub: 'p' }, 'PS256', pemOf(rsa.privateKey, 'pkcs8'));
  assert.equal((await J.verifyJwt(ps, pemOf(rsa.publicKey, 'spki'))).valid, true);
  for (const [alg, curve, hash] of [['ES256', 'prime256v1', 'sha256'], ['ES384', 'secp384r1', 'sha384'], ['ES512', 'secp521r1', 'sha512']]) {
    const ec = nodeCrypto.generateKeyPairSync('ec', { namedCurve: curve });
    const t = nodeToken(alg, (input) => nodeCrypto.sign(hash, Buffer.from(input), { key: ec.privateKey, dsaEncoding: 'ieee-p1363' }));
    assert.deepEqual(await J.verifyJwt(t, pemOf(ec.publicKey, 'spki')), { valid: true, alg });
    assert.deepEqual(await J.verifyJwt(t, JSON.stringify(ec.publicKey.export({ format: 'jwk' }))), { valid: true, alg });
    const ours = await J.signJwt({ sub: 'e' }, alg, pemOf(ec.privateKey, 'pkcs8'));
    const [h, p, s] = ours.split('.');
    assert.ok(nodeCrypto.verify(hash, Buffer.from(h + '.' + p), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), alg);
    // Tampered payload: invalid.
    const bad = [h, b64u(JSON.stringify({ sub: 'admin' })), s].join('.');
    assert.equal((await J.verifyJwt(bad, pemOf(ec.publicKey, 'spki'))).valid, false);
  }
  const ed = nodeCrypto.generateKeyPairSync('ed25519');
  const edTok = nodeToken('EdDSA', (input) => nodeCrypto.sign(null, Buffer.from(input), ed.privateKey));
  assert.deepEqual(await J.verifyJwt(edTok, pemOf(ed.publicKey, 'spki')), { valid: true, alg: 'EdDSA' });
  // Wrong kinds of keys are explained.
  await assert.rejects(J.verifyJwt(nodeToken('RS256', () => Buffer.alloc(256)), pemOf(rsa.privateKey, 'pkcs8')), /give the public key/);
  await assert.rejects(J.signJwt({}, 'RS256', pemOf(rsa.publicKey, 'spki')), /give the private key/);
  await assert.rejects(J.signJwt({}, 'ES256', JSON.stringify(nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' }))), /private key/);
  assert.equal((await J.verifyJwt(b64u('{"alg":"none"}') + '.' + b64u('{}') + '.', 'x')).valid, false);
  await assert.rejects(J.verifyJwt('a.b', 'x'), /three parts/);

  // Bases.
  const B = await import('../../js/lib/numbase.js');
  assert.deepEqual(B.parseNumber('0xff'), { value: 255n, base: 16 });
  assert.deepEqual(B.parseNumber('-0b1010'), { value: -10n, base: 2 });
  assert.deepEqual(B.parseNumber('zz', 36), { value: 1295n, base: 36 });
  assert.deepEqual(B.parseNumber('1_000_000'), { value: 1000000n, base: 10 });
  assert.throws(() => B.parseNumber('12', 2), /'2' is not a base-2 digit/);
  assert.equal(B.toBase(2n ** 100n, 16), '1' + '0'.repeat(25));
  assert.equal(B.toBase(1000n, 7), '2626');
  assert.deepEqual([B.fitWidth(255n), B.fitWidth(256n), B.fitWidth(-128n), B.fitWidth(-129n), B.fitWidth(2n ** 64n)], [8, 16, 8, 16, 128]);
  const v = B.widthView(-2n, 16);
  assert.deepEqual([v.unsigned, v.signed, v.hex, v.bytesBE, v.bytesLE], [65534n, -2n, 'fffe', 'ff fe', 'fe ff']);
  assert.equal(B.widthView(0x12345678n, 32).bytesLE, '78 56 34 12');
  assert.throws(() => B.widthView(256n, 8), /doesn't fit in 8 bits/);

  // Text.
  const T = await import('../../js/lib/textops.js');
  assert.deepEqual(T.dedupe('a\nb\na\nB'), { text: 'a\nb\nB', removed: 1 });
  assert.equal(T.sortLines('b\nA\nc10\nc9'), 'A\nb\nc9\nc10');
  assert.equal(T.sortLines('10 x\n2 y\n33 z', { numeric: true, desc: true }), '33 z\n10 x\n2 y');
  assert.equal(T.sortLines('b\na\nb\n', { unique: true }), 'a\nb');
  assert.equal(T.trimText('  a  \n\n\n  b\n\n'), 'a\n\nb');
  assert.deepEqual(T.replaceText('a.b.c', '.', '-'), { text: 'a-b-c', count: 2 });
  assert.deepEqual(T.replaceText('4px 8px', '/(\\d+)px/g', '$1rem'), { text: '4rem 8rem', count: 2 });
  assert.deepEqual(T.stats('one two\nthree ✓'), { lines: 2, words: 4, characters: 15, bytes: 17 });
  assert.equal(T.lorem(5, 'words'), 'Lorem ipsum dolor sit amet');
  assert.equal(T.lorem(2, 'paragraphs').split('\n\n').length, 2);
  assert.equal(T.lorem(3, 'sentences').split('. ').length, 3);

  // CSV.
  const V = await import('../../js/lib/csv.js');
  assert.deepEqual(V.parseDelimited('a,"b ""q"", c",d\n1,"2\nline",3\n', ','), [['a', 'b "q", c', 'd'], ['1', '2\nline', '3']]);
  assert.equal(V.detectDelimiter('a;b;c\n1;2,5;3\n4;5;6'), ';');
  assert.equal(V.detectDelimiter('a\tb\n1\t2'), '\t');
  assert.equal(V.detectDelimiter('a|b|c\n1|2|3'), '|');
  assert.equal(V.detectDelimiter('name,age\nbob,30'), ',');
  const c = V.readCsv('name,age,city\nbob,30,Sofia\nalice,25,"Plovdiv, BG"');
  assert.deepEqual([c.header, c.columns, c.numeric, c.rows[1][2]], [true, ['name', 'age', 'city'], [false, true, false], 'Plovdiv, BG']);
  assert.equal(V.readCsv('1,2\n3,4').header, false);
  assert.equal(V.readCsv('a,b\n1', {}).rows[0][1], ''); // short rows padded

  // Escaping.
  const E = await import('../../js/lib/escape.js');
  const lit = Object.fromEntries(E.literals('a\\b "c" it\'s').map((x) => [x.lang, x.code]));
  assert.equal(lit.js, '"a\\\\b \\"c\\" it\'s"');
  assert.equal(JSON.parse(lit.json), 'a\\b "c" it\'s');
  assert.equal(lit.python, "'a\\\\b \"c\" it\\'s'");
  assert.equal(lit.csharp, '"a\\\\b \\"c\\" it\'s"   or   @"a\\b ""c"" it\'s"');
  assert.equal(lit.go, '"a\\\\b \\"c\\" it\'s"   or   `a\\b "c" it\'s`');
  assert.equal(lit.rust, '"a\\\\b \\"c\\" it\'s"   or   r#"a\\b "c" it\'s"#');
  const rx = E.readRegex('/a\\/b\\d+/gi');
  assert.deepEqual(rx, { source: 'a/b\\d+', flags: 'gi' });
  const code = Object.fromEntries(E.regexCode(rx.source, rx.flags).map((x) => [x.lang, x.code]));
  assert.equal(code.python, "re.compile(r'a/b\\d+', re.IGNORECASE)");
  assert.equal(code.java, 'Pattern.compile("a/b\\\\d+", Pattern.CASE_INSENSITIVE)');
  assert.equal(code.go, 'regexp.MustCompile(`(?i)a/b\\d+`)');
  assert.equal(code.php, "preg_match('#a/b\\\\d+#i', $subject)");
  assert.equal(code.rust, 'Regex::new(r"(?i)a/b\\d+").unwrap()');
  assert.ok(E.regexCode('x', 's').find((x) => x.lang === 'ruby').code === '/x/m'); // JavaScript s is Ruby m
  assert.throws(() => E.regexCode('x', 'q'), /unknown flag q/);
  // The JavaScript output is valid JavaScript for the same pattern.
  assert.equal(new Function('return ' + code.js.split('   or   ')[1])().source, new RegExp('a/b\\d+').source);

  // References.
  const R = await import('../../js/lib/reference.js');
  assert.deepEqual(R.findStatus('404').map((r) => r[1]), ['Not Found']);
  assert.ok(R.findStatus('4xx').every((r) => r[0] >= 400 && r[0] < 500) && R.findStatus('4xx').length > 20);
  assert.deepEqual(R.findStatus('rate limit').map((r) => r[0]), [429]);
  assert.equal(new Set(R.HTTP_STATUS.map((r) => r[0])).size, R.HTTP_STATUS.length);
  assert.deepEqual(R.findMime('png'), [{ ext: 'png', type: 'image/png', by: 'extension' }]);
  assert.deepEqual(R.findMime('photo.JPG'), [{ ext: 'jpg', type: 'image/jpeg', by: 'extension' }]);
  assert.deepEqual(R.findMime('image/jpeg'), [{ type: 'image/jpeg', exts: ['jpg', 'jpeg', 'jpe'], by: 'type' }]);
  assert.ok(R.findMime('video/*').length >= 8);
  assert.deepEqual(R.findMime('nope/none'), []);
});

test('developer tools 2: the commands', async () => {
  const app = await makeApp();
  // jwt verify: the secret asked for (hidden); a pasted key after the token; sign.
  const jwtio = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  let answer = 'your-256-bit-secret';
  app.ctx.askSecret = async () => answer;
  const ok = await app.run('jwt verify ' + jwtio);
  assert.equal(ok[0], '# JWT · HS256 · no expiry · signature ✓');
  assert.equal(ok[1], '✓ Signature valid · HS256, checked with Web Crypto on this page');
  answer = 'nope';
  const bad = await app.run('jwt verify ' + jwtio);
  assert.equal(bad.tone, 'err');
  assert.equal(bad[1], '✗ Signature not valid · the signature does not match this key');
  assert.equal((await app.run('jwt ' + jwtio + ' your-256-bit-secret'))[1], '✓ Signature valid · HS256, checked with Web Crypto on this page');
  answer = 'k';
  const signed = await app.run('jwt sign HS256 {"sub":"me","n":1}');
  assert.match(signed[0], /^# Signed · HS256 · \d+ characters$/);
  const tok = signed[1].slice(2);
  assert.equal((await app.run('jwt ' + tok + ' k'))[1].slice(0, 17), '✓ Signature valid');
  assert.match((await app.run('jwt sign RS256 {"a":1}'))[0], /^err: RS256 signs with a private key/);
  assert.match((await app.run('jwt sign XX1 {}'))[0], /^err: Unknown algorithm XX1/);
  assert.equal(app.commands.byName.get('jwt').noHistory, true);

  assert.deepEqual((await app.run('base 255')).slice(0, 5), ['# 255 · read as base 10 · 8 bits of magnitude', 'binary: 1111 1111', 'octal: 377', 'decimal: 255', 'hex: FF']);
  assert.ok((await app.run('base -2 bits 16')).includes('bytes, little-endian: FE FF'));
  assert.equal((await app.run('base 12 from 2'))[0], "err: '2' is not a base-2 digit");
  assert.equal((await app.run('base 1000 to 7')).copied, '2626');
  assert.equal((await app.run('text dedupe a\nb\na'))[0], '# Deduplicated · 1 duplicate removed · 2 lines left');
  assert.deepEqual((await app.run('text replace "a b" x a b c a b')).slice(0, 2), ['# Replaced · 2 matches', 'x c x']);
  assert.deepEqual(await app.run('text upper hello world'), ['# Upper case', 'HELLO WORLD']);
  assert.match((await app.run('text frobnicate x'))[0], /^# Usage · text/);
  const h = await app.run('hmac sha256 key The quick brown fox jumps over the lazy dog');
  assert.equal(h[2], '= f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8'); // the published example
  assert.equal(h[4], '= 97yD9DBThCSxMpjmqm+xQ+9NWaFJRhdZl0edvC0aPNg=');
  assert.equal((await app.run('hmac sha1 hex:0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b "Hi There"'))[2], '= b617318655057264e28bc0b6fb378c8ef146be00'); // RFC 2202
  assert.equal(app.commands.byName.get('hmac').private, true);
  const esc = await app.run('escape /^\\d{3}$/i');
  assert.ok(esc.includes('Python | re.compile(r\'^\\d{3}$\', re.IGNORECASE)'));
  assert.deepEqual((await app.run('http 418')).slice(0, 1), ["# 418 I'm a teapot · Client error"]);
  assert.ok((await app.run('http 3xx')).includes('## 3xx Redirection'));
  assert.deepEqual(await app.run('mime png'), ['# .png is', '= image/png', 'dim: Also .apng'].slice(0, 2));
  const csv = await app.run('csv name,age\nbob,30\nalice,25');
  assert.equal(csv[0], '# 2 rows × 2 columns · comma-separated · first row is the header');
  assert.match(csv[1], /^DATATABLE /);
  const jtree = await app.run('json tree {"a":[1,2]}');
  assert.deepEqual(jtree, ['# Valid JSON · 1 key (object)', 'JSONTREE {"a":[1,2]}']);
  const bad2 = await app.run('json {"a": 1,, }');
  assert.equal(bad2[0], 'err: Invalid JSON at line 1, column 9: Expected double-quoted property name');
  assert.equal((await app.run('json min {"a": 1}'))[2], '= {"a":1}');
});

test('barcode command: types, check digits worked out, options first, replay spec; qr through it', async () => {
  const app = await makeApp();
  const b = await app.run('barcode HELLO-123');
  assert.match(b[0], /^# Code 128 · 9 characters · \d+ px wide$/);
  assert.equal(b[1], 'BARCODE {"type":"code128","text":"HELLO-123"}');
  assert.equal(b.copied, 'HELLO-123');
  const ean = await app.run('barcode ean 590123412345');
  assert.match(ean[0], /^# EAN-13 · 13 characters · check digit 7 added · /);
  assert.equal(ean[1], 'BARCODE {"type":"ean13","text":"5901234123457"}');
  assert.match((await app.run('barcode upca 03600029145'))[0], /check digit 2 added/);
  assert.match((await app.run('barcode ean13 5901234123457'))[0], /^# EAN-13 · 13 characters · \d+ px wide$/);
  const c39 = await app.run('barcode code39 check widget-7');
  assert.match(c39[0], /^# Code 39 · 9 characters · check character - added/);
  assert.equal(c39[1], 'BARCODE {"type":"code39","text":"WIDGET-7-"}');
  const opts = await app.run('barcode itf height 100 scale 3 margin 4 notext 1234567890');
  assert.equal(opts[1], 'BARCODE {"type":"itf","height":100,"scale":3,"margin":4,"showText":false,"text":"1234567890"}');
  // Words that look like options are text once the text has started.
  assert.equal((await app.run('barcode order notext 5'))[1], 'BARCODE {"type":"code128","text":"order notext 5"}');
  assert.match((await app.run('barcode ean13 12345'))[0], /^err: /);
  assert.match((await app.run('barcode code39 lower~case'))[0], /^err: Code 39 can't encode "~"/);
  assert.equal((await app.run('barcode height 5 x'))[0], 'err: height is 10 to 600 px');
  assert.equal((await app.run('barcode scale 20 x'))[0], 'err: scale is 1 to 10 px per bar');
  assert.equal((await app.run('barcode'))[0], '# Usage · barcode');
  assert.equal((await app.run('barcode qr hello'))[1], 'QR M hello'.replace('M', (await app.run('qr hello'))[1].split(' ')[1]));
  assert.deepEqual(app.commands.byName.get('barcode').complete([]).map((x) => x.value), ['code128', 'code39', 'ean13', 'ean8', 'upca', 'itf', 'codabar', 'qr']);
});
