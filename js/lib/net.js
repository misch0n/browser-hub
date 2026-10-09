// Network checks a web page can make, and what it can't. A browser speaks
// HTTP(S) (and WebSocket) only: no ICMP ping, no raw TCP or UDP, no DNS of its
// own. So "is it up" means an HTTP request, a port is only tested by speaking
// HTTP to it, and DNS goes over HTTPS (DoH) to a public resolver. Every
// function takes `fetch` so tests can stand in for the network.

// Ports the Fetch standard never lets a page connect to (they fail at once).
export const BAD_PORTS = new Set([1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110,
  111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563,
  587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080]);

const PORT_NAMES = { 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 110: 'POP3', 143: 'IMAP', 465: 'SMTPS', 587: 'mail submission',
  993: 'IMAPS', 995: 'POP3S', 6667: 'IRC', 5060: 'SIP', 2049: 'NFS', 389: 'LDAP', 636: 'LDAPS', 123: 'NTP', 137: 'NetBIOS', 139: 'NetBIOS', 161: 'SNMP' };
export const portName = (p) => PORT_NAMES[p] || null;

export const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

export const isLocalHost = (h) => /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i.test(h) || /\.localhost$/i.test(h);

// 'example.com', '10.0.0.1:8080/health', 'http://x/y', '[::1]:3000' plus options
// -> { url, scheme, host, port, path, inferred: [notes] }
export function readTarget(text, opts = {}) {
  let t = String(text).trim();
  if (!t) throw new Error('give a host, IP or URL');
  const notes = [];
  let scheme = opts.scheme || null;
  const sm = /^([a-z][a-z0-9+.-]*):\/\//i.exec(t);
  if (sm) {
    scheme = sm[1].toLowerCase();
    t = t.slice(sm[0].length);
  }
  if (scheme && !['http', 'https', 'ws', 'wss'].includes(scheme)) {
    throw new Error('a browser can only test http, https, ws and wss, not ' + scheme + '://');
  }
  const hm = /^(\[[0-9a-f:.]+\]|[^/:?#\s]+)(?::(\d+))?(\/[^\s]*)?$/i.exec(t.replace(/^([^/?#]*)([?#].*)$/, '$1/$2'));
  if (!hm) throw new Error("that isn't a host, IP or URL");
  const host = hm[1].toLowerCase();
  if (!/^\[[0-9a-f:.]+\]$/.test(host) && !/^[a-z0-9.-]+$/i.test(host)) throw new Error('not a valid host name: ' + host);
  let port = opts.port || (hm[2] ? Number(hm[2]) : null);
  if (port !== null && !(port >= 1 && port <= 65535)) throw new Error('a port is 1 to 65535');
  if (!scheme) {
    scheme = port === 80 || port === 8080 || (isLocalHost(host) && port !== 443) ? 'http' : 'https';
    notes.push('scheme ' + scheme + (port ? ' (guessed from port ' + port + ')' : isLocalHost(host) ? ' (local address)' : ' (the default)'));
  }
  const def = scheme === 'https' || scheme === 'wss' ? 443 : 80;
  if (!port) { port = def; notes.push('port ' + def + ' (the ' + scheme + ' default)'); }
  let path = opts.path || hm[3] || '/';
  if (!path.startsWith('/')) path = '/' + path;
  const url = scheme + '://' + host + (port === def ? '' : ':' + port) + path;
  return { url, scheme, host, port, path, notes };
}

// Why a page can't make this request at all, before trying, or null.
export function blockedBefore(target, pageProtocol) {
  if (BAD_PORTS.has(target.port)) {
    const n = portName(target.port);
    return 'port ' + target.port + (n ? ' (' + n + ')' : '') + ' is on the browsers’ blocked list: no page may connect to it';
  }
  if (pageProtocol === 'https:' && (target.scheme === 'http' || target.scheme === 'ws') && !isLocalHost(target.host)) {
    return 'mixed content: this page is https, and browsers block its connections to plain ' + target.scheme + ':// addresses (only localhost is allowed)' +
      (target.scheme === 'ws' ? '; try wss://' : '');
  }
  return null;
}

const now = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

// The browser's own timing of the last request to `url`: the phases are only
// filled in for servers that send Timing-Allow-Origin (else they read 0).
function timingFor(url) {
  const p = globalThis.performance;
  if (!p || !p.getEntriesByName) return null;
  const e = p.getEntriesByName(url, 'resource').pop();
  if (!e || !e.responseStart) return null;
  const d = (a, b) => Math.max(0, b - a);
  return {
    dns: d(e.domainLookupStart, e.domainLookupEnd), connect: d(e.connectStart, e.secureConnectionStart || e.connectEnd),
    tls: e.secureConnectionStart ? d(e.secureConnectionStart, e.connectEnd) : 0, wait: d(e.requestStart, e.responseStart),
    download: d(e.responseStart, e.responseEnd), protocol: e.nextHopProtocol || null, reused: e.connectStart === e.connectEnd && e.domainLookupStart === e.domainLookupEnd,
  };
}

// One request. -> { ok, mode: 'cors'|'no-cors'|null, ms, status?, statusText?, headers?, url?, redirected?,
//   body?, bodyBytes?, truncated?, error?: 'timeout'|'network', cors: bool }
export async function probe(url, opts = {}) {
  const f = opts.fetch || globalThis.fetch;
  const method = (opts.method || 'GET').toUpperCase();
  const timeout = opts.timeout || 8000;
  const run = async (mode) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    const t0 = now();
    try {
      const init = { method, mode, cache: 'no-store', redirect: 'follow', credentials: 'omit', signal: ctl.signal, referrerPolicy: 'no-referrer' };
      if (opts.body !== undefined && !['GET', 'HEAD'].includes(method)) init.body = opts.body;
      if (opts.headers && mode === 'cors') init.headers = opts.headers;
      const res = await f(url, init);
      const ms = now() - t0;
      let body = null, bodyBytes = null, truncated = false;
      if (mode === 'cors' && method !== 'HEAD' && opts.readBody !== false) {
        try {
          const buf = new Uint8Array(await res.arrayBuffer());
          bodyBytes = buf.length;
          truncated = buf.length > 65536;
          body = new TextDecoder().decode(buf.subarray(0, 65536));
        } catch (e) { /* unreadable */ }
      }
      return { ok: true, mode, ms, timing: timingFor(res.url || url), status: res.status, statusText: res.statusText, type: res.type, url: res.url, redirected: res.redirected,
        headers: res.type === 'opaque' ? [] : [...res.headers.entries()], body, bodyBytes, truncated };
    } catch (e) {
      return { ok: false, mode, ms: now() - t0, error: ctl.signal.aborted ? 'timeout' : 'network', message: e && e.message };
    } finally {
      clearTimeout(timer);
    }
  };
  const first = await run('cors');
  if (first.ok || first.error === 'timeout' || opts.corsOnly) return { ...first, cors: first.ok };
  // A CORS refusal and an unreachable server look the same to a page; no-cors tells them apart.
  if (!['GET', 'HEAD', 'POST'].includes(method)) return { ...first, cors: false, note: 'no-cors only allows GET, HEAD and POST, so this can’t tell a CORS refusal from an unreachable server' };
  const second = await run('no-cors');
  return { ...second, cors: false, corsError: first.message };
}

// ---- WebSocket ------------------------------------------------------------------------
// Opens a connection, waits for the handshake, closes it again. A page learns
// little: a refused handshake (wrong path, not a WebSocket endpoint, a 403, a
// bad certificate, nothing listening) is just an error then close code 1006, with
// no HTTP status. -> { ok: true, ms, protocol, extensions, close: { code, reason, clean } }
//                  | { ok: false, error: 'refused' | 'timeout' | 'invalid', ms, close?, message? }
export function probeSocket(url, opts = {}) {
  const WS = opts.WebSocket || globalThis.WebSocket;
  const timeout = opts.timeout || 8000;
  const t0 = now();
  return new Promise((resolve) => {
    let ws;
    try {
      ws = new WS(url, opts.protocols || []);
    } catch (e) {
      resolve({ ok: false, error: 'invalid', ms: 0, message: e && e.message });
      return;
    }
    let opened = null; // the result once the handshake succeeded
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    const timer = setTimeout(() => {
      try { ws.close(); } catch (e) { /* closing anyway */ }
      finish(opened || { ok: false, error: 'timeout', ms: now() - t0 });
    }, timeout);
    ws.onopen = () => {
      opened = { ok: true, ms: now() - t0, protocol: ws.protocol || '', extensions: ws.extensions || '', close: null };
      try { ws.close(1000, 'check done'); } catch (e) { finish(opened); }
    };
    ws.onclose = (e) => {
      const close = { code: e.code, reason: e.reason || '', clean: !!e.wasClean };
      finish(opened ? { ...opened, close } : { ok: false, error: 'refused', ms: now() - t0, close });
    };
    ws.onerror = () => { /* the close event that follows says how it ended */ };
  });
}

// What a WebSocket close code means (RFC 6455 section 7.4).
export const CLOSE_CODES = { 1000: 'normal closure', 1001: 'going away', 1002: 'protocol error', 1003: 'unsupported data', 1005: 'no status given',
  1006: 'closed abnormally (no close frame: the handshake failed or the connection dropped)', 1007: 'invalid data', 1008: 'policy violation',
  1009: 'message too big', 1010: 'extension required', 1011: 'server error', 1012: 'service restart', 1013: 'try again later', 1015: 'TLS handshake failed' };

// ---- DNS over HTTPS ---------------------------------------------------------------------

export const DNS_TYPES = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, NAPTR: 35, DS: 43, RRSIG: 46, DNSKEY: 48, SVCB: 64, HTTPS: 65, CAA: 257 };
const TYPE_NAMES = Object.fromEntries(Object.entries(DNS_TYPES).map(([k, v]) => [v, k]));
export const typeName = (n) => TYPE_NAMES[n] || 'TYPE' + n;
export const RCODES = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' };
export const RESOLVERS = {
  cloudflare: { name: 'Cloudflare', url: (n, t) => 'https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(n) + '&type=' + t, headers: { accept: 'application/dns-json' } },
  google: { name: 'Google', url: (n, t) => 'https://dns.google/resolve?name=' + encodeURIComponent(n) + '&type=' + t, headers: {} },
};
export const DEFAULT_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'];

// 8.8.4.4 -> 4.4.8.8.in-addr.arpa; IPv6 nibbles under ip6.arpa; else null.
export function reverseName(ip) {
  const s = String(ip).trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((x) => Number(x) <= 255)) return s.split('.').reverse().join('.') + '.in-addr.arpa';
  if (s.includes(':') && /^[0-9a-f:]+$/i.test(s)) {
    const [l, r = ''] = s.split('::');
    const L = l ? l.split(':') : [], R = r ? r.split(':') : [];
    if (s.split('::').length > 2 || L.length + R.length > 8) return null;
    const groups = s.includes('::') ? [...L, ...Array(8 - L.length - R.length).fill('0'), ...R] : L;
    if (groups.length !== 8) return null;
    return groups.map((g) => g.padStart(4, '0')).join('').split('').reverse().join('.') + '.ip6.arpa';
  }
  return null;
}

export function readDomain(text) {
  let s = String(text).trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/\.$/, '');
  if (!s) throw new Error('give a domain name');
  if (!/^[a-z0-9_*.-]+$/.test(s) && !/^[\p{L}\p{N}_.-]+$/u.test(s)) throw new Error('not a domain name: ' + s);
  if (/[^\x00-\x7f]/.test(s)) {
    try { s = new URL('http://' + s).hostname; } catch (e) { throw new Error('not a domain name: ' + s); }
  }
  return s;
}

// One question. -> { name, type, status, rcode, answers: [{name, type, ttl, data}], authority, ad, resolver, ms }
export async function dohQuery(name, type, opts = {}) {
  const f = opts.fetch || globalThis.fetch;
  const r = RESOLVERS[opts.resolver || 'cloudflare'];
  const t0 = now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeout || 8000);
  let res;
  try {
    res = await f(r.url(name, type), { headers: r.headers, signal: ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  } catch (e) {
    throw new Error(ctl.signal.aborted ? r.name + ' DNS didn’t answer in time' : 'couldn’t reach ' + r.name + ' DNS');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(r.name + ' DNS answered HTTP ' + res.status);
  const j = await res.json();
  const rr = (x) => ({ name: String(x.name || '').replace(/\.$/, ''), type: typeName(x.type), ttl: x.TTL, data: String(x.data) });
  return {
    name, type, status: j.Status, rcode: RCODES[j.Status] || 'RCODE' + j.Status, ad: !!j.AD,
    answers: (j.Answer || []).map(rr), authority: (j.Authority || []).map(rr), resolver: r.name, ms: now() - t0,
    comment: j.Comment ? [].concat(j.Comment).join(' ') : null,
  };
}

// ---- public IP ---------------------------------------------------------------------------

export const IP_SOURCES = {
  ipify4: 'https://api.ipify.org?format=json',
  ipify6: 'https://api64.ipify.org?format=json',
  ipapi: (ip) => 'https://ipapi.co/' + (ip ? encodeURIComponent(ip) + '/' : '') + 'json/',
};

async function getJson(f, url, timeout = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await f(url, { signal: ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// -> { v4, v6 } (either may be null) from ipify.
export async function publicIp(opts = {}) {
  const f = opts.fetch || globalThis.fetch;
  const [a, b] = await Promise.allSettled([getJson(f, IP_SOURCES.ipify4), getJson(f, IP_SOURCES.ipify6)]);
  const v4 = a.status === 'fulfilled' ? a.value.ip : null;
  const any = b.status === 'fulfilled' ? b.value.ip : null;
  if (!v4 && !any) throw new Error('couldn’t reach ipify (api.ipify.org)');
  return { v4: v4 || (any && !any.includes(':') ? any : null), v6: any && any.includes(':') ? any : null };
}

// Location and network for an IP (or the caller's own) from ipapi.co.
export async function ipDetails(ip, opts = {}) {
  const f = opts.fetch || globalThis.fetch;
  const j = await getJson(f, IP_SOURCES.ipapi(ip));
  if (j.error) throw new Error(j.reason === 'RateLimited' ? 'ipapi.co’s free limit is used up for now; try later' : j.reason || 'ipapi.co couldn’t look that up');
  return {
    ip: j.ip, city: j.city || null, region: j.region || null, country: j.country_name || null, countryCode: j.country_code || null,
    postal: j.postal || null, latitude: j.latitude ?? null, longitude: j.longitude ?? null, timezone: j.timezone || null,
    org: j.org || null, asn: j.asn || null, network: j.network || null,
  };
}

export function isIp(s) {
  return reverseName(s) !== null;
}
