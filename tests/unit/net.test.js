import test from 'node:test';
import assert from 'node:assert/strict';
import * as A from '../../js/core/aliases.js';
import * as Net from '../../js/lib/net.js';
import { makeApp, fakeNet } from '../helpers.mjs';

test('net lib: targets, blocked ports and mixed content, reverse names', () => {
  const t = Net.readTarget('example.com');
  assert.equal(t.url, 'https://example.com/');
  assert.deepEqual(t.notes, ['scheme https (the default)', 'port 443 (the https default)']);
  assert.equal(Net.readTarget('10.0.0.5:8080/health').url, 'http://10.0.0.5:8080/health');
  assert.equal(Net.readTarget('localhost:3000').url, 'http://localhost:3000/');
  assert.equal(Net.readTarget('example.com:443').url, 'https://example.com/');
  assert.equal(Net.readTarget('example.com', { port: 8443, path: 'v1' }).url, 'https://example.com:8443/v1');
  assert.equal(Net.readTarget('http://[::1]:5173/x?y=1').url, 'http://[::1]:5173/x?y=1');
  assert.equal(Net.readTarget('example.com?q=1').url, 'https://example.com/?q=1');
  assert.equal(Net.readTarget('wss://x.org').url, 'wss://x.org/'); // WebSocket: request checks the handshake
  assert.throws(() => Net.readTarget('ftp://x.org'), /http, https, ws and wss/);
  assert.throws(() => Net.readTarget('x.org:70000'), /1 to 65535/);
  assert.match(Net.blockedBefore(Net.readTarget('example.com:22'), 'https:'), /port 22 \(SSH\) is on the browsers’ blocked list/);
  assert.match(Net.blockedBefore(Net.readTarget('http://example.com'), 'https:'), /mixed content/);
  assert.equal(Net.blockedBefore(Net.readTarget('http://localhost:8000'), 'https:'), null);
  assert.equal(Net.blockedBefore(Net.readTarget('http://example.com'), 'http:'), null);
  assert.equal(Net.reverseName('8.8.4.4'), '4.4.8.8.in-addr.arpa');
  assert.equal(Net.reverseName('2001:db8::1'), '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa');
  assert.equal(Net.reverseName('example.com'), null);
  assert.equal(Net.reverseName('300.1.1.1'), null);
  assert.equal(Net.readDomain('https://Example.COM:8080/path'), 'example.com');
  assert.equal(Net.readDomain('bücher.de'), 'xn--bcher-kva.de');
});

test('request: a readable answer, a CORS-refusing one, an unreachable one, a timeout, a blocked port', async () => {
  const app = await makeApp();
  app.ctx.pageURL = 'https://misch0n.github.io/browser-hub/';
  app.ctx.fetch = fakeNet({
    'api.test': (u, init) => ({ status: 200, body: JSON.stringify({ ok: true, method: init.method, path: u.pathname }), headers: { 'content-type': 'application/json' } }),
    'gone.test': () => ({ status: 404, body: 'not here', headers: { 'content-type': 'text/plain' } }),
    'nocors.test': 'opaque',
    'slow.test': 'hang',
  });
  const ok = await app.run('request api.test/v1/zen');
  assert.match(ok[0], /^# 200 · [\d.]+ ms · GET https:\/\/api\.test\/v1\/zen$/);
  assert.equal(ok.tone, 'ok');
  assert.ok(ok.includes('type: application/json'));
  assert.ok(ok.includes('CORS: readable by pages  (the server sends Access-Control-Allow-Origin)'));
  assert.ok(ok.includes('assumed: scheme https (the default), port 443 (the https default)'));
  assert.ok(ok.includes('  "path": "/v1/zen"'));
  const post = await app.run('request POST https://api.test/x header "X-Mine: 1" body {"a":1}');
  assert.ok(post.includes('  "method": "POST",'), post.join("\n"));
  assert.deepEqual(app.ctx.fetch.calls.at(-1).headers, { 'X-Mine': '1' });
  assert.equal(app.ctx.fetch.calls.at(-1).body, '{"a":1}');
  assert.equal((await app.run('request api.test body hi'))[0].includes('POST'), true); // a body means POST
  const nf = await app.run('request gone.test');
  assert.match(nf[0], /^# 404 · /);
  assert.equal(nf.tone, 'warn');
  const opaque = await app.run('request nocors.test');
  assert.match(opaque[0], /^# Reachable · answered in [\d.]+ ms · GET https:\/\/nocors\.test\/$/);
  assert.equal(app.ctx.fetch.calls.at(-1).mode, 'no-cors');
  const down = await app.run('request nowhere.test');
  assert.match(down[0], /^# Unreachable after /);
  assert.equal(down.tone, 'err');
  assert.ok(down.includes('Check the name: dns nowhere.test'));
  const slow = await app.run('request slow.test timeout 200ms');
  assert.match(slow[0], /^# No answer in 0\.2 s/);
  const ssh = await app.run('request example.com port 22');
  assert.equal(ssh[0], '# Can’t test from a page · https://example.com:22/');
  assert.match(ssh[1], /port 22 \(SSH\) is on the browsers’ blocked list/);
  const mixed = await app.run('request http://example.com');
  assert.match(mixed[1], /mixed content/);
  assert.match((await app.run('request example.com port 99999'))[0], /^err: a port is 1 to 65535/);
  assert.match((await app.run('request example.com timeout soon'))[0], /^err: timeout is seconds/);
  assert.equal((await app.run('request'))[0], '# Usage · request');
});

test('ping: HTTP round trips, min/avg/max; stops when the first fails', async () => {
  const app = await makeApp();
  app.ctx.pageURL = 'https://misch0n.github.io/browser-hub/';
  app.ctx.fetch = fakeNet({ 'up.test': () => ({ status: 204 }), 'nocors.test': 'opaque' });
  const p = await app.run('ping up.test count 3');
  assert.match(p[0], /^# up\.test · 3 of 3 answered · min [\d.]+ ms · avg [\d.]+ ms · max [\d.]+ ms$/);
  assert.equal(app.ctx.fetch.calls.filter((c) => c.method === 'HEAD').length, 3);
  assert.match(p[1], /^1 \| [\d.]+ ms \| HTTP 204 \| includes DNS, connect and TLS$/);
  assert.match(p.at(-1), /not ICMP: browsers can’t ping/);
  assert.match((await app.run('ping nocors.test count 2'))[1], /\| answered \|/);
  const down = await app.run('ping down.test');
  assert.equal(down[0], '# down.test · no answer');
  assert.equal(down.length, 3); // head, one failed row, the note
});

test('dns: records over HTTPS, followable; NXDOMAIN; reverse lookups; Google instead', async () => {
  const app = await makeApp();
  const answers = {
    A: [{ name: 'www.example.com.', type: 5, TTL: 300, data: 'example.com.' }, { name: 'example.com.', type: 1, TTL: 3600, data: '93.184.215.14' }],
    AAAA: [{ name: 'www.example.com.', type: 5, TTL: 300, data: 'example.com.' }],
    MX: [{ name: 'www.example.com.', type: 5, TTL: 300, data: 'example.com.' }, { name: 'example.com.', type: 15, TTL: 86400, data: '10 mail.example.com.' }],
  };
  const doh = (u, init) => {
    const name = u.searchParams.get('name'), type = u.searchParams.get('type');
    if (name === 'nope.test') return { body: JSON.stringify({ Status: 3, AD: false }) };
    if (name === '1.1.1.1.in-addr.arpa') return { body: JSON.stringify({ Status: 0, Answer: [{ name: '1.1.1.1.in-addr.arpa.', type: 12, TTL: 1800, data: 'one.one.one.one.' }] }) };
    return { body: JSON.stringify({ Status: 0, AD: true, Answer: answers[type] || [] }), headers: { 'x-accept': init.headers.accept || '' } };
  };
  app.ctx.fetch = fakeNet({ 'cloudflare-dns.com': doh, 'dns.google': doh });
  const d = await app.run('dns www.example.com');
  assert.equal(d[0], '# www.example.com · 3 records · Cloudflare · DNSSEC ✓');
  assert.deepEqual(d.slice(1, 5), ['| type | value | name | TTL', 'CNAME | example.com |  | 5 min', 'A | 93.184.215.14 | example.com | 1 h', 'MX | 10 mail.example.com | example.com | 1 d']);
  assert.equal(d[5], 'dim: No AAAA, TXT, NS records');
  assert.equal(app.ctx.fetch.calls.length, 6);
  assert.ok(app.ctx.fetch.calls.every((c) => c.headers.accept === 'application/dns-json'));
  const mx = await app.run('dns www.example.com mx via google');
  assert.equal(mx[0], '# www.example.com · 2 records · Google · DNSSEC ✓');
  assert.match(app.ctx.fetch.calls.at(-1).url, /^https:\/\/dns\.google\/resolve\?name=www\.example\.com&type=MX$/);
  const nx = await app.run('dns nope.test');
  assert.equal(nx[0], '# nope.test · no such domain (NXDOMAIN)');
  assert.equal(nx.tone, 'err');
  const ptr = await app.run('dns 1.1.1.1');
  assert.equal(ptr[0], '# 1.1.1.1 · 1 record · Cloudflare');
  assert.equal(ptr[2], 'PTR | one.one.one.one |  | 30 min');
  assert.match((await app.run('dns example.com XYZ'))[0], /^err: Unknown record type XYZ/);
  assert.equal((await app.run('dns example.com via quad9'))[0], 'err: via cloudflare or via google');
  app.ctx.fetch = fakeNet({});
  assert.equal((await app.run('dns example.com'))[0], 'err: couldn’t reach Cloudflare DNS');
});

test('ip: the public address from ipify, details from ipapi.co; kept out of the shared history', async () => {
  const app = await makeApp();
  const details = { ip: '203.0.113.9', city: 'Sofia', region: 'Sofia-Capital', country_name: 'Bulgaria', country_code: 'BG', postal: '1000', latitude: 42.69, longitude: 23.32, timezone: 'Europe/Sofia', org: 'Example Telecom', asn: 'AS64500', network: '203.0.113.0/24' };
  app.ctx.fetch = fakeNet({
    'api.ipify.org': () => ({ body: JSON.stringify({ ip: '203.0.113.9' }) }),
    'api64.ipify.org': () => ({ body: JSON.stringify({ ip: '2001:db8::9' }) }),
    'ipapi.co': (u) => ({ body: JSON.stringify(u.pathname === '/json/' ? details : u.pathname === '/8.8.8.8/json/' ? { ...details, ip: '8.8.8.8', city: 'Mountain View', region: 'California', country_name: 'United States', org: 'GOOGLE' } : { error: true, reason: 'RateLimited' }) }),
  });
  const ip = await app.run('ip');
  assert.deepEqual(ip.slice(0, 3), ['# Your public IP · as the internet sees this browser', 'IPv4: 203.0.113.9', 'IPv6: 2001:db8::9']);
  assert.equal(ip.copied, '203.0.113.9');
  const more = await app.run('ip more');
  assert.equal(more[0], '# 203.0.113.9 · Sofia, Sofia-Capital, Bulgaria');
  assert.ok(more.includes('network: Example Telecom'));
  assert.ok(more.includes('range: 203.0.113.0/24'));
  assert.ok(more.includes('time zone: Europe/Sofia'));
  assert.equal((await app.run('ip 8.8.8.8'))[0], '# 8.8.8.8 · Mountain View, California, United States');
  assert.equal((await app.run('ip 1.2.3.4'))[0], 'err: ipapi.co’s free limit is used up for now; try later');
  assert.match((await app.run('ip example.com'))[0], /^err: ip, ip more, or ip <IPv4 or IPv6 address>/);
  assert.equal(app.commands.byName.get('ip').private, true);
  app.ctx.fetch = fakeNet({ 'api.ipify.org': () => ({ body: JSON.stringify({ ip: '203.0.113.9' }) }) });
  assert.equal((await app.run('ip'))[2], 'IPv6: none: this connection has no IPv6');
});

// A stand-in WebSocket: behaviour by host. accept: opens, then closes cleanly
// when asked; refuse: error then close 1006; silent: never answers.
function fakeSocket(log = []) {
  return class FakeWS {
    constructor(url, protocols) {
      this.url = url;
      log.push(url);
      const host = new URL(url).host;
      if (host.startsWith('bad')) throw new SyntaxError('The URL is invalid');
      this.protocol = '';
      this.extensions = '';
      setTimeout(() => {
        if (host.startsWith('accept')) {
          this.protocol = host.includes('chat') ? 'chat.v1' : '';
          this.extensions = 'permessage-deflate';
          this.onopen && this.onopen();
        } else if (host.startsWith('refuse')) {
          this.onerror && this.onerror({});
          this.onclose && this.onclose({ code: 1006, reason: '', wasClean: false });
        }
      }, 5);
    }
    close(code = 1005, reason = '') { setTimeout(() => this.onclose && this.onclose({ code, reason, wasClean: true }), 1); }
  };
}

test('WebSocket check: accepted, refused, silent, mixed content; ping points to request', async () => {
  const WS = fakeSocket();
  let r = await Net.probeSocket('wss://accept.test/live', { WebSocket: WS });
  assert.equal(r.ok, true);
  assert.deepEqual(r.close, { code: 1000, reason: 'check done', clean: true });
  assert.equal(r.extensions, 'permessage-deflate');
  r = await Net.probeSocket('wss://refuse.test/', { WebSocket: WS });
  assert.deepEqual([r.ok, r.error, r.close.code], [false, 'refused', 1006]);
  r = await Net.probeSocket('wss://silent.test/', { WebSocket: WS, timeout: 100 });
  assert.deepEqual([r.ok, r.error], [false, 'timeout']);
  r = await Net.probeSocket('wss://bad.test/', { WebSocket: WS });
  assert.equal(r.error, 'invalid');

  const app = await makeApp();
  app.ctx.pageURL = 'https://misch0n.github.io/browser-hub/';
  app.ctx.WebSocket = WS;
  let out = await app.run('request wss://accept-chat.test/socket');
  assert.match(out[0], /^# WebSocket open · handshake in .* · wss:\/\/accept-chat\.test\/socket$/);
  assert.equal(out.tone, 'ok');
  assert.ok(out.includes('handshake: accepted (101 Switching Protocols)'));
  assert.ok(out.includes('subprotocol: chat.v1'));
  assert.ok(out.includes('closed: 1000 normal closure · “check done”'));
  out = await app.run('request wss://refuse.test/nope');
  assert.match(out[0], /^# Refused/);
  assert.ok(out.includes('closed: 1006 closed abnormally (no close frame: the handshake failed or the connection dropped)'));
  assert.ok(out.some((l) => /request https:\/\/refuse\.test\/nope/.test(l)));
  out = await app.run('request wss://silent.test timeout 0.2');
  assert.match(out[0], /^# No handshake in 0\.2 s/);
  // From an https page, ws:// goes only to this machine.
  assert.match((await app.run('request ws://example.com/socket'))[1], /mixed content.*try wss:\/\//);
  out = await app.run('request ws://accept.localhost:3000/');
  assert.match(out[0], /WebSocket open/);
  assert.match((await app.run('ping wss://accept.test'))[0], /^err: ping speaks HTTP; for a WebSocket: request wss:\/\/accept\.test\//);
});
