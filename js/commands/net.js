import { plural } from '../core/util.js';
import { tokenize } from '../core/args.js';
import { readTarget, blockedBefore, probe, probeSocket, CLOSE_CODES, METHODS, dohQuery, readDomain, reverseName, DNS_TYPES, DEFAULT_TYPES, RESOLVERS, publicIp, ipDetails, isIp } from '../lib/net.js';

// request, ping, dns, ip: what a web page can find out about the network.

const LIMITS = 'A page can only make HTTP(S) requests and WebSocket connections: no ICMP ping, no raw TCP or UDP, and some ports are blocked outright.';
const ms = (n) => (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ms';
const seconds = (s) => {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s)?$/i.exec(String(s));
  if (!m) return null;
  const v = Number(m[1]) * (m[2] && m[2].toLowerCase() === 'ms' ? 1 : 1000);
  return Math.min(Math.max(v, 100), 60000);
};
const pageProtocol = (ctx) => {
  try { return new URL(ctx.pageURL || globalThis.location.href).protocol; } catch (e) { return 'https:'; }
};
const statusTone = (s) => (s < 400 ? 'ok' : s < 500 ? 'warn' : 'err');

// The options after the target: port N, path P, scheme S, timeout T, header "K: V", body <rest>.
function readOptions(rest) {
  const toks = tokenize(rest);
  const o = { headers: {} };
  let method = null, target = null;
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i].text, lw = w.toLowerCase(), next = toks[i + 1];
    if (!toks[i].quoted && METHODS.includes(w.toUpperCase()) && !method && !target) { method = w.toUpperCase(); continue; }
    if (!toks[i].quoted && next && ['port', 'path', 'scheme', 'timeout', 'header', 'count'].includes(lw)) {
      i++;
      if (lw === 'port') o.port = Number(next.text);
      else if (lw === 'path') o.path = next.text;
      else if (lw === 'scheme') o.scheme = next.text.toLowerCase();
      else if (lw === 'timeout') o.timeout = seconds(next.text);
      else if (lw === 'count') o.count = Number(next.text);
      else {
        const h = /^([^:]+):\s*(.*)$/.exec(next.text);
        if (!h) throw new Error('header "Name: value"');
        o.headers[h[1].trim()] = h[2];
      }
      continue;
    }
    if (!toks[i].quoted && lw === 'body') { o.body = rest.slice(toks[i].end).replace(/^\s/, ''); break; }
    if (target) throw new Error('unexpected "' + w + '"');
    target = w;
  }
  if (o.port !== undefined && !(o.port >= 1 && o.port <= 65535)) throw new Error('a port is 1 to 65535');
  if (o.timeout === null) throw new Error('timeout is seconds (5 or 5s) or 500ms');
  if (o.scheme && !['http', 'https'].includes(o.scheme)) throw new Error('scheme is http or https');
  return { method: method || (o.body !== undefined ? 'POST' : 'GET'), target, o };
}

function prettyBody(text, type) {
  if (/json/i.test(type || '') || /^\s*[[{]/.test(text)) {
    try { return { text: JSON.stringify(JSON.parse(text), null, 2), lang: 'json' }; } catch (e) { /* not JSON */ }
  }
  const lines = text.split('\n');
  return { text: lines.slice(0, 60).join('\n') + (lines.length > 60 ? '\n… ' + (lines.length - 60) + ' more lines' : ''), lang: null };
}

// request ws(s)://…: does the handshake succeed? Opened, then closed again at once.
async function socketCheck(ctx, target, timeout) {
  const { out } = ctx;
  const r = await probeSocket(target.url, { timeout, WebSocket: ctx.WebSocket });
  const via = [[' · ' + target.url, 'dim']];
  const closeSeg = (c) => [[String(c.code), 'num'], [' ' + (CLOSE_CODES[c.code] || (c.code >= 4000 ? 'the application\u2019s own code' : 'unknown')), 'dim'], [c.reason ? ' · \u201c' + c.reason + '\u201d' : '', '']];
  if (r.ok) {
    out.head([['WebSocket open', ''], [' · handshake in ' + ms(r.ms), 'dim'], ...via], 'ok');
    const rows = [['handshake', [['accepted (101 Switching Protocols)', 'ok']]]];
    if (r.protocol) rows.push(['subprotocol', [[r.protocol, '']]]);
    if (r.extensions) rows.push(['extensions', [[r.extensions, '']]]);
    if (r.close) rows.push(['closed', closeSeg(r.close)]);
    if (target.notes.length) rows.push(['assumed', [[target.notes.join(', '), 'faint']]]);
    out.kv(rows);
    out.dim('Opened and closed again straight away; nothing was sent');
    return;
  }
  if (r.error === 'timeout') {
    out.head([['No handshake', ''], [' in ' + timeout / 1000 + ' s', 'dim'], ...via], 'err');
    out.line([['Nothing answered in time: the host may drop packets on that port, be down, or be very slow.', '']]);
  } else if (r.error === 'invalid') {
    return out.err('Can\u2019t open that address: ' + (r.message || target.url));
  } else {
    out.head([['Refused', ''], [' after ' + ms(r.ms), 'dim'], ...via], 'err');
    out.line([['The handshake didn\u2019t succeed: nothing listening, not a WebSocket endpoint at that path, refused (401/403/404), or an untrusted certificate. Browsers don\u2019t show the HTTP status of a refused handshake.', '']]);
    if (r.close) out.kv([['closed', closeSeg(r.close)]]);
    out.line([['Is the server up? ', 'dim'], ['request ' + target.url.replace(/^ws/, 'http'), 'accent', { run: 'request ' + target.url.replace(/^ws/, 'http') }]]);
  }
  if (target.notes.length) out.dim('Assumed ' + target.notes.join(', '));
}

export default function register(add, { usage }) {
  add({
    name: 'request', group: 'Network', desc: 'test a URL, host or port from this browser: status, timing, headers, body',
    usage: ['request <url | host[:port][/path]>', 'request [GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS] <target>', 'request wss://<host>[/path]',
      'request <host> port <n> path <p> scheme http|https', 'request <target> timeout <seconds>', 'request <target> header "Name: value"', 'request POST <target> body <text>'],
    examples: ['request example.com', 'request https://api.github.com/zen', 'request HEAD 1.1.1.1', 'request localhost:3000/health',
      'request POST https://httpbin.org/post body {"a":1}', 'request example.com port 8443 timeout 3', 'request wss://echo.websocket.org', 'request ws://localhost:8080/socket'],
    complete: (prev) => (prev.length === 0 ? METHODS.map((m) => ({ value: m })) : prev.length >= 1 ? ['port', 'path', 'scheme', 'timeout', 'header', 'body'].map((v) => ({ value: v })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      if (!rest.trim()) return usage(ctx, this);
      let req, target;
      try {
        req = readOptions(rest);
        if (!req.target) return usage(ctx, this);
        target = readTarget(req.target, req.o);
      } catch (e) {
        return out.err(e.message);
      }
      const blocked = blockedBefore(target, pageProtocol(ctx));
      if (blocked) {
        out.head([['Can’t test from a page', ''], [' · ' + target.url, 'dim']], 'err');
        out.line([[blocked, '']]);
        out.dim(LIMITS + ' Try curl or a terminal for this one.');
        return;
      }
      const timeout = req.o.timeout || 8000;
      if (target.scheme === 'ws' || target.scheme === 'wss') return socketCheck(ctx, target, timeout);
      const r = await probe(target.url, { method: req.method, timeout, fetch: ctx.fetch, headers: req.o.headers, body: req.o.body });
      const via = [[' · ' + req.method + ' ' + target.url, 'dim']];
      if (!r.ok) {
        if (r.error === 'timeout') {
          out.head([['No answer', ''], [' in ' + timeout / 1000 + ' s', 'dim'], ...via], 'err');
          out.line([['Nothing came back in time: the host may drop packets on that port, be down, or be very slow.', '']]);
        } else {
          out.head([['Unreachable', ''], [' after ' + ms(r.ms), 'dim'], ...via], 'err');
          out.line([['The browser got no answer it would accept: the name may not resolve, the connection was refused or reset, the TLS certificate is not trusted, or nothing speaks ' + target.scheme.toUpperCase() + ' on port ' + target.port + '. Browsers don’t say which.', '']]);
          if (r.note) out.dim(r.note);
          out.line([['Check the name: ', 'dim'], ['dns ' + target.host, 'accent', { run: 'dns ' + target.host.replace(/^\[|\]$/g, '') }]]);
        }
        if (target.notes.length) out.dim('Assumed ' + target.notes.join(', '));
        out.dim(LIMITS);
        return;
      }
      if (r.mode === 'no-cors') {
        out.head([['Reachable', ''], [' · answered in ' + ms(r.ms), 'dim'], ...via], 'ok');
        out.line([['The server answered, but doesn’t let pages from other sites read the answer (no CORS headers), so the browser hides its status, headers and body.', '']]);
        if (target.notes.length) out.dim('Assumed ' + target.notes.join(', '));
        out.dim('An answer, any status, counts as reachable · ' + LIMITS);
        return;
      }
      const type = (r.headers.find(([k]) => k === 'content-type') || [])[1] || '';
      out.head([[r.status + (r.statusText ? ' ' + r.statusText : ''), 'strong'], [' · ' + ms(r.ms), 'dim'], ...via], statusTone(r.status));
      const rows = [];
      if (r.redirected && r.url) rows.push(['redirected to', [[r.url, '']]]);
      if (r.timing && !r.timing.reused && (r.timing.dns || r.timing.connect || r.timing.tls)) {
        rows.push(['timing', [[['DNS ' + ms(r.timing.dns), 'connect ' + ms(r.timing.connect), r.timing.tls ? 'TLS ' + ms(r.timing.tls) : null, 'wait ' + ms(r.timing.wait), 'download ' + ms(r.timing.download)].filter(Boolean).join(' · '), '']]]);
      } else if (r.timing) {
        rows.push(['timing', [['wait ' + ms(r.timing.wait) + ' · download ' + ms(r.timing.download), ''], [r.timing.reused ? '  (connection reused)' : '', 'faint']]]);
      }
      if (r.timing && r.timing.protocol) rows.push(['protocol', [[r.timing.protocol, '']]]);
      if (type) rows.push(['type', [[type, '']]]);
      if (r.bodyBytes !== null) rows.push(['size', [[plural(r.bodyBytes, 'byte'), 'num'], [r.truncated ? '  (first 64 kB shown)' : '', 'faint']]]);
      rows.push(['CORS', [['readable by pages', 'ok'], ['  (the server sends Access-Control-Allow-Origin)', 'faint']]]);
      if (target.notes.length) rows.push(['assumed', [[target.notes.join(', '), 'faint']]]);
      out.kv(rows);
      if (r.headers.length) {
        out.section([['Headers', ''], ['  the ones the server lets pages see', 'faint']]);
        out.table(null, r.headers.map(([k, v]) => [[[k, 'dim']], [[v, '']]]), { stack: true });
      }
      if (r.body) {
        const b = prettyBody(r.body, type);
        out.section('Body');
        out.code(b.text, b.lang);
      }
    },
  });

  add({
    name: 'ping', group: 'Network', desc: 'is a host up? a few HTTP(S) requests and their times (a browser can’t send ICMP)',
    usage: ['ping <host | url>', 'ping <host> count <n>'],
    examples: ['ping example.com', 'ping 1.1.1.1 count 8', 'ping localhost:8000'],
    async run(ctx, rest) {
      const { out } = ctx;
      if (!rest.trim()) return usage(ctx, this);
      let req, target;
      try {
        req = readOptions(rest);
        if (!req.target) return usage(ctx, this);
        target = readTarget(req.target, req.o);
      } catch (e) {
        return out.err(e.message);
      }
      if (target.scheme === 'ws' || target.scheme === 'wss') return out.err('ping speaks HTTP; for a WebSocket: request ' + target.url);
      const blocked = blockedBefore(target, pageProtocol(ctx));
      if (blocked) return out.err(blocked);
      const count = Math.min(Math.max(Number(req.o.count) || 4, 1), 10);
      const times = [];
      const rows = [];
      let lost = 0;
      for (let i = 1; i <= count; i++) {
        const r = await probe(target.url, { method: 'HEAD', timeout: req.o.timeout || 5000, fetch: ctx.fetch, readBody: false });
        if (r.ok) {
          times.push(r.ms);
          rows.push([[[String(i), 'faint']], [[ms(r.ms), 'num']], [[r.mode === 'cors' ? 'HTTP ' + r.status : 'answered', 'dim']], [[i === 1 ? 'includes DNS, connect and TLS' : '', 'faint']]]);
        } else {
          lost++;
          rows.push([[[String(i), 'faint']], [[r.error === 'timeout' ? 'timeout' : 'failed', 'err']], [['', '']], [['', '']]]);
          if (i === 1 && r.error !== 'timeout') break;
        }
      }
      const sent = rows.length;
      const tone = !times.length ? 'err' : lost ? 'warn' : 'ok';
      const sorted = times.slice().sort((a, b) => a - b);
      const avg = times.reduce((a, b) => a + b, 0) / (times.length || 1);
      out.head(times.length ? [[target.host, 'strong'], [' · ' + times.length + ' of ' + sent + ' answered · min ' + ms(sorted[0]) + ' · avg ' + ms(avg) + ' · max ' + ms(sorted[sorted.length - 1]), 'dim']]
        : [[target.host, 'strong'], [' · no answer', 'dim']], tone);
      out.table(null, rows);
      out.dim('HTTP ' + (req.o.port || target.port) + ' round trips (HEAD ' + target.url + '), not ICMP: browsers can’t ping. request ' + target.host + ' shows more.');
    },
  });

  const TYPES = Object.keys(DNS_TYPES);
  add({
    name: 'dns', group: 'Network', desc: 'look up DNS records over HTTPS (Cloudflare or Google): A, AAAA, MX, TXT, CNAME, NS…',
    usage: ['dns <domain>', 'dns <domain> <type> [type…]', 'dns <IP address>', 'dns <domain> via google'],
    examples: ['dns example.com', 'dns gmail.com mx', 'dns _dmarc.github.com txt', 'dns 1.1.1.1', 'dns example.com aaaa via google'],
    complete: (prev) => (prev.length >= 1 ? [...TYPES.map((t) => ({ value: t.toLowerCase(), label: t })), { value: 'via' }] : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const words = rest.trim().split(/\s+/).filter(Boolean);
      if (!words.length) return usage(ctx, this);
      let resolver = 'cloudflare';
      const vi = words.findIndex((w) => w.toLowerCase() === 'via');
      if (vi >= 0) {
        resolver = (words[vi + 1] || '').toLowerCase();
        if (!RESOLVERS[resolver]) return out.err('via cloudflare or via google');
        words.splice(vi, 2);
      }
      const types = words.slice(1).map((t) => t.toUpperCase());
      const bad = types.find((t) => !DNS_TYPES[t]);
      if (bad) return out.err('Unknown record type ' + bad + ' (' + TYPES.join(', ') + ')');
      let name;
      const rev = reverseName(words[0]);
      try { name = rev || readDomain(words[0]); } catch (e) { return out.err(e.message); }
      const ask = rev ? ['PTR'] : types.length ? types : DEFAULT_TYPES;
      let results;
      try {
        results = await Promise.all(ask.map((t) => dohQuery(name, t, { resolver, fetch: ctx.fetch })));
      } catch (e) {
        return out.err(e.message);
      }
      const first = results[0];
      const label = rev ? words[0] : name;
      if (first.rcode === 'NXDOMAIN') {
        out.head([[label, 'strong'], [' · no such domain (NXDOMAIN)', 'dim']], 'err');
        out.dim('Asked ' + first.resolver + ' over HTTPS');
        return;
      }
      const failed = results.filter((r) => r.status !== 0);
      const seen = new Set();
      const rows = [];
      for (const r of results) {
        for (const a of r.answers) {
          const key = a.type + ' ' + a.name + ' ' + a.data;
          if (seen.has(key)) continue; // a CNAME comes back with every type
          seen.add(key);
          const data = ['CNAME', 'NS', 'PTR'].includes(a.type) ? a.data.replace(/\.$/, '') : a.type === 'MX' ? a.data.replace(/\.$/, '') : a.data;
          const target = a.type === 'MX' ? data.split(/\s+/)[1] : ['CNAME', 'NS', 'PTR'].includes(a.type) ? data : null;
          const run = target ? { run: 'dns ' + target } : ['A', 'AAAA'].includes(a.type) ? { run: 'dns ' + data } : null;
          rows.push([[[a.type, 'accent']], [[data, 'strong', ...(run ? [run] : [])]], [[a.name !== name ? a.name : '', 'faint']], [[ttl(a.ttl), 'faint']]]);
        }
      }
      const ad = results.every((r) => r.ad);
      out.head([[label, 'strong'], [' · ' + plural(rows.length, 'record') + ' · ' + first.resolver + (ad ? ' · DNSSEC ✓' : ''), 'dim']], rows.length ? 'ok' : 'warn');
      if (rows.length) out.table(['type', 'value', 'name', 'TTL'], rows, { stack: true });
      const empty = results.filter((r) => r.status === 0 && !results.some((x) => x.answers.some((a) => a.type === r.type))).map((r) => r.type);
      if (empty.length) out.dim('No ' + empty.join(', ') + ' records');
      for (const r of failed) out.warn(r.type + ': ' + r.rcode + (r.comment ? ' · ' + r.comment : ''));
      out.dim('Asked ' + first.resolver + ' over HTTPS (they see the name) · ' + ms(Math.max(...results.map((r) => r.ms))) + (rev ? '' : ' · tap a value to follow it'));
    },
  });

  add({
    name: 'ip', group: 'Network', private: true, // your address and place stay out of the shared history
    desc: 'your public IP address (ipify), and where an address is and whose network (ipapi.co)',
    usage: ['ip', 'ip more', 'ip <address>'],
    examples: ['ip', 'ip more', 'ip 1.1.1.1', 'ip 2606:4700:4700::1111'],
    complete: (prev) => (prev.length === 0 ? [{ value: 'more' }] : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const arg = rest.trim();
      if (!arg) {
        let r;
        try { r = await publicIp({ fetch: ctx.fetch }); } catch (e) { return out.err(e.message); }
        out.head([['Your public IP', 'strong'], [' · as the internet sees this browser', 'dim']], 'ok');
        const rows = [];
        if (r.v4) rows.push(['IPv4', [[r.v4, 'num strong']]]);
        rows.push(['IPv6', r.v6 ? [[r.v6, 'num strong']] : [['none: this connection has no IPv6', 'faint']]]);
        out.kv(rows);
        out.line([['Where and whose network: ', 'dim'], ['ip more', 'accent', { run: 'ip more' }]]);
        out.dim('From ipify.org (they see the address when asked) · behind a VPN or proxy this is its address · kept out of the shared history');
        out.copyable(r.v4 || r.v6);
        return;
      }
      if (arg.toLowerCase() !== 'more' && !isIp(arg)) return out.err('ip, ip more, or ip <IPv4 or IPv6 address> (dns <name> for names)');
      let d;
      try { d = await ipDetails(arg.toLowerCase() === 'more' ? null : arg, { fetch: ctx.fetch }); } catch (e) { return out.err(e.message); }
      const place = [d.city, d.region, d.country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ');
      out.head([[d.ip, 'num strong'], [place ? ' · ' + place : '', 'dim']], 'ok');
      const rows = [];
      if (place) rows.push(['place', [[place, ''], [d.postal ? '  ' + d.postal : '', 'faint']]]);
      if (d.latitude !== null) rows.push(['near', [[d.latitude + ', ' + d.longitude, 'num'], ['  roughly: the network’s location, not the device’s', 'faint']]]);
      if (d.timezone) rows.push(['time zone', [[d.timezone, '']]]);
      if (d.org) rows.push(['network', [[d.org, 'strong']]]);
      if (d.asn) rows.push(['ASN', [[d.asn, 'num']]]);
      if (d.network) rows.push(['range', [[d.network, 'num', { run: 'cidr ' + d.network }]]]);
      out.kv(rows);
      out.dim('From ipapi.co (they see the address asked about) · kept out of the shared history');
      out.copyable(d.ip);
    },
  });
}

function ttl(s) {
  if (s === undefined || s === null) return '';
  if (s < 120) return s + ' s';
  if (s < 3600) return Math.round(s / 60) + ' min';
  if (s < 86400) return Math.round(s / 3600) + ' h';
  return Math.round(s / 86400) + ' d';
}
