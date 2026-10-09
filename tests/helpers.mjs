// Shared by the unit tests (tests/unit/*.test.js): the fixed clock, fake
// storage, network and browser, a recording Out, and makeApp(), which wires the
// real data layer and commands together without a DOM.
import assert from 'node:assert/strict';
import { dispatch } from '../js/core/dispatch.js';
import { edit, actionFor, historySearch } from '../js/core/lineedit.js';
import * as K from '../js/core/keys.js';
import { loadDevice, defaultDeviceName, detectBrowser } from '../js/core/device.js';
import { createLocalStore } from '../js/core/store.js';
import { createData, DEFAULTS } from '../js/core/data.js';
import { createCommands } from '../js/commands/index.js';

const MON = new Date(2026, 9, 5, 12, 0); // Monday 2026-10-05, local time

const builtinNames = new Set(['n', 'notes', 't', 'tasks', 'help']);

const isBuiltin = (n) => builtinNames.has(n);

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    _m: m,
  };
}

const flat = (c) => (c === null || c === undefined ? '' : typeof c === 'string' ? c : c.swatch ? '[' + c.swatch + ']' : c.map((s) => (s.swatch ? '[' + s.swatch + ']' : s[0])).join(''));

function recorder() {
  const lines = [];
  let tone = null;
  const rank = { err: 3, warn: 2 };
  const setTone = (t, strong) => {
    if (!t) return;
    if ((rank[t] || 0) >= (rank[tone] || 0) && (strong || rank[t] || !tone)) tone = t;
  };
  const out = {
    head: (c, t) => { lines.push('# ' + flat(c)); setTone(t, true); },
    tone: (t) => setTone(t, true),
    line: (c) => lines.push(flat(c)),
    ok: (t) => { setTone('ok'); lines.push('ok: ' + t); },
    info: (t) => { setTone('info'); lines.push('info: ' + t); },
    warn: (t) => { setTone('warn'); lines.push('warn: ' + t); },
    err: (t) => { setTone('err'); lines.push('err: ' + t); },
    dim: (t) => lines.push('dim: ' + t),
    section: (c) => lines.push('## ' + flat(c)),
    table: (cols, rows) => {
      if (cols) lines.push('| ' + cols.join(' | '));
      for (const r of rows) lines.push(Array.isArray(r) ? r.map(flat).join(' | ') : '## ' + flat(r.section));
    },
    kv: (pairs) => pairs.forEach(([k, v]) => lines.push(k + ': ' + flat(v))),
    // Editable rows show the command a tap would run: `field: value  [n edit n1.text]`.
    fields: (rows) => rows.forEach(([k, v, e]) => lines.push(k + ': ' + flat(v) + (e ? '  [' + e.command + ' = ' + e.current + ']' : ''))),
    code: (text) => lines.push(...text.split('\n')),
    value: (text) => { lines.push('= ' + text); lines.copied = text; }, // the page's value() also marks it copyable
    copyable: (text) => { lines.copied = text; },
    qr: (text, ecl) => lines.push('QR ' + ecl + ' ' + text),
    barcode: (spec) => lines.push('BARCODE ' + JSON.stringify(spec)),
    diagram: (code, name) => lines.push('DIAGRAM ' + (name || '') + ': ' + code.split('\n')[0]),
    diagramEditor: (spec) => { lines.push('EDITOR ' + spec.title + ' · ' + spec.save.label + ' · ' + (spec.save.command || spec.save.input) + ' · ' + spec.code.split('\n')[0]); lines.editor = spec; },
    jsonTree: (text) => lines.push('JSONTREE ' + text),
    dataTable: (spec) => lines.push('DATATABLE ' + JSON.stringify(spec)),
    ticker: (spec) => lines.push('TICKER ' + spec.kind + ' ' + spec.id),
    swatch: (items) => lines.push('SWATCH ' + items.map((i) => i.color + (i.text ? ' ' + i.text.value + ' ' + i.text.color : '') + (i.label ? ' ' + i.label : '')).join(' | ')),
    calendar: (spec) => lines.push('CAL ' + spec.year + '-' + spec.month + ' marks=' + spec.marks.sort((a, b) => a - b).join(',')),
  };
  return { out, lines, tone: () => tone };
}

async function makeApp(storage) {
  storage = storage || fakeStorage();
  const store = createLocalStore(storage);
  let clock = new Date(MON);
  const data = createData(store, () => clock);
  await data.load();
  const base = {
    data, store, now: () => clock,
    setInput(t) { base.inputSet = t; },
    clearOutput() {},
    pickFile: async () => base.nextFile || null,
    download(name, text) { base.downloaded = { name, text }; },
    device: loadDevice(store, { platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 Safari/537.36' }),
    setDeviceName(name) { base.device.name = name; store.setLocal('device', base.device); },
  };
  let ctx = base;
  const commands = createCommands(() => ctx);
  const run = async (input) => {
    const rec = recorder();
    const res = dispatch(input, { isBuiltin: commands.isBuiltin, entries: data.state.aliases.entries, defaultEngine: data.state.aliases.defaultEngine });
    if (res.kind === 'error') { // as main.js reports it
      const r = ['err: ' + res.message];
      Object.defineProperty(r, 'tone', { value: 'err', enumerable: false });
      return r;
    }
    assert.equal(res.kind, 'builtin', input);
    ctx = Object.assign(base, { out: rec.out });
    await commands.run(res.name, res.rest, ctx);
    const r = rec.lines.slice();
    Object.defineProperty(r, 'tone', { value: rec.tone(), enumerable: false });
    Object.defineProperty(r, 'copied', { value: rec.lines.copied, enumerable: false });
    Object.defineProperty(r, 'editor', { value: rec.lines.editor, enumerable: false });
    return r;
  };
  return { run, data, store, storage, ctx: base, commands, setNow: (d) => { clock = d; } };
}

const UAS = {
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  crios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  reduced: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  webview: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1',
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  ie: 'Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko',
  opera: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/114.0.0.0',
};

function fakeEnv(over = {}) {
  const media = new Set(over.media || ['(prefers-color-scheme: dark)', '(pointer: fine)', '(hover: hover)']);
  return {
    navigator: { userAgent: UAS.macChrome, language: 'en-GB', languages: ['en-GB', 'bg'], hardwareConcurrency: 8, deviceMemory: 8, platform: 'MacIntel', maxTouchPoints: 0, onLine: true, cookieEnabled: true,
      clipboard: { writeText() {} }, serviceWorker: {}, storage: { estimate: async () => ({ usage: 2.5e6, quota: 6e10 }), persisted: async () => false },
      connection: { effectiveType: '4g', downlink: 10, rtt: 50 }, ...(over.navigator || {}) },
    screen: { width: 1512, height: 982, colorDepth: 30, orientation: { type: 'landscape-primary' } },
    devicePixelRatio: 2, innerWidth: 1200, innerHeight: 800,
    matchMedia: (q) => ({ matches: media.has(q) }),
    Intl, WebAssembly: {}, crypto: globalThis.crypto, indexedDB: {}, Worker() {},
    ...(over.env || {}),
  };
}

function fakeNet(routes) {
  const calls = [];
  const f = (url, init = {}) => {
    calls.push({ url, mode: init.mode, method: init.method, headers: init.headers, body: init.body });
    const u = new URL(url);
    const r = routes[u.host] || routes[u.hostname];
    if (!r) return Promise.reject(new TypeError('Failed to fetch'));
    if (r === 'hang') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    if (r === 'opaque') {
      return init.mode === 'no-cors' ? Promise.resolve({ status: 0, statusText: '', type: 'opaque', url: '', redirected: false, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) })
        : Promise.reject(new TypeError('Failed to fetch'));
    }
    const res = r(u, init);
    return Promise.resolve(new Response([101, 204, 205, 304].includes(res.status) ? null : res.body ?? '', { status: res.status || 200, headers: res.headers || {} }));
  };
  f.calls = calls;
  return f;
}

const graphEnv = (app, extra = {}) => Object.assign({ defs: app.commands.defs, entries: app.data.state.aliases.entries, history: [], counts: {}, sort: 'freq' }, extra);

const fanOf = (v) => v.fan.map((f) => f.value);

export { MON, builtinNames, isBuiltin, fakeStorage, flat, recorder, makeApp, UAS, fakeEnv, fakeNet, graphEnv, fanOf };
