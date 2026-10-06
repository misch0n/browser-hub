// What this browser says about itself and the device: screen, window, input,
// language and time zone, hardware hints, network hints, storage, and which web
// platform features it has. Read from `g` (globalThis on the page) so tests can
// hand in a fake. Nothing here leaves the page.

const yes = (v) => (v ? 'yes' : 'no');
const has = (fn) => { try { return !!fn(); } catch (e) { return false; } };

const FEATURES = [
  ['Service workers', (g) => 'serviceWorker' in g.navigator],
  ['WebAssembly', (g) => typeof g.WebAssembly === 'object'],
  ['WebGL 2', (g) => !!g.WebGL2RenderingContext],
  ['WebGPU', (g) => 'gpu' in g.navigator],
  ['Passkeys (WebAuthn)', (g) => !!g.PublicKeyCredential],
  ['Web Share', (g) => typeof g.navigator.share === 'function'],
  ['Clipboard', (g) => !!(g.navigator.clipboard && g.navigator.clipboard.writeText)],
  ['Notifications', (g) => 'Notification' in g],
  ['Geolocation', (g) => 'geolocation' in g.navigator],
  ['Bluetooth', (g) => 'bluetooth' in g.navigator],
  ['USB', (g) => 'usb' in g.navigator],
  ['Serial', (g) => 'serial' in g.navigator],
  ['HID', (g) => 'hid' in g.navigator],
  ['NFC', (g) => 'NDEFReader' in g],
  ['Vibration', (g) => typeof g.navigator.vibrate === 'function'],
  ['File System Access', (g) => typeof g.showOpenFilePicker === 'function'],
  ['Payment Request', (g) => 'PaymentRequest' in g],
  ['Speech synthesis', (g) => 'speechSynthesis' in g],
  ['Speech recognition', (g) => 'SpeechRecognition' in g || 'webkitSpeechRecognition' in g],
  ['Screen wake lock', (g) => 'wakeLock' in g.navigator],
  ['Gamepads', (g) => typeof g.navigator.getGamepads === 'function'],
  ['View transitions', (g) => !!(g.document && typeof g.document.startViewTransition === 'function')],
  ['Popover', (g) => !!(g.HTMLElement && 'popover' in g.HTMLElement.prototype)],
  ['Web Crypto', (g) => !!(g.crypto && g.crypto.subtle)],
  ['IndexedDB', (g) => 'indexedDB' in g],
  ['Web Workers', (g) => 'Worker' in g],
  ['WebTransport', (g) => 'WebTransport' in g],
  ['WebCodecs', (g) => 'VideoEncoder' in g],
];

export function features(g) {
  return FEATURES.map(([name, test]) => ({ name, ok: has(() => test(g)) }));
}

function mq(g, q) {
  return has(() => g.matchMedia(q).matches);
}

function firstMatch(g, list) {
  for (const [q, label] of list) if (mq(g, q)) return label;
  return null;
}

function gpu(g) {
  try {
    const c = g.document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  } catch (e) {
    return null;
  }
}

// -> [{ title, rows: [[label, value, note?]] }]; values are strings.
export async function deviceInfo(g = globalThis) {
  const n = g.navigator || {};
  const s = g.screen || {};
  const dpr = g.devicePixelRatio || 1;
  const sections = [];

  const screen = [
    ['screen', s.width + ' × ' + s.height, 'CSS pixels'],
    ['physical', Math.round(s.width * dpr) + ' × ' + Math.round(s.height * dpr), 'about, at ' + +dpr.toFixed(3) + '× pixel ratio'],
    ['window', g.innerWidth + ' × ' + g.innerHeight, 'the page’s viewport'],
  ];
  if (g.visualViewport && (Math.round(g.visualViewport.height) !== g.innerHeight || g.visualViewport.scale !== 1)) {
    screen.push(['visible', Math.round(g.visualViewport.width) + ' × ' + Math.round(g.visualViewport.height), g.visualViewport.scale !== 1 ? 'zoomed ' + +g.visualViewport.scale.toFixed(2) + '×' : 'keyboard or bars take the rest']);
  }
  if (s.orientation && s.orientation.type) screen.push(['orientation', s.orientation.type.replace('-primary', '').replace('-secondary', ' (upside down)')]);
  if (s.colorDepth) screen.push(['colour depth', s.colorDepth + ' bits', firstMatch(g, [['(dynamic-range: high)', 'HDR'], ['(color-gamut: p3)', 'wide gamut (P3)']]) || undefined]);
  sections.push({ title: 'Screen', rows: screen });

  const look = [
    ['colour scheme', mq(g, '(prefers-color-scheme: dark)') ? 'dark' : 'light'],
    ['reduced motion', yes(mq(g, '(prefers-reduced-motion: reduce)'))],
    ['more contrast', yes(mq(g, '(prefers-contrast: more)'))],
    ['pointer', firstMatch(g, [['(pointer: fine)', 'fine (mouse or pen)'], ['(pointer: coarse)', 'coarse (touch)'], ['(pointer: none)', 'none']]) || 'unknown'],
    ['hover', yes(mq(g, '(hover: hover)'))],
    ['touch points', String(n.maxTouchPoints || 0)],
  ];
  if (mq(g, '(display-mode: standalone)')) look.push(['display', 'installed app (standalone)']);
  sections.push({ title: 'Display and input', rows: look });

  let zone = null;
  try { zone = g.Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* none */ }
  const offset = -new Date().getTimezoneOffset();
  const place = [
    ['language', n.language || 'unknown', n.languages && n.languages.length > 1 ? 'then ' + n.languages.slice(1).join(', ') : undefined],
    ['time zone', zone || 'unknown', 'UTC' + (offset >= 0 ? '+' : '−') + String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0') + ':' + String(Math.abs(offset) % 60).padStart(2, '0')],
  ];
  try {
    const loc = new g.Intl.NumberFormat().resolvedOptions().locale;
    if (loc) place.push(['number format', new g.Intl.NumberFormat().format(1234567.89), loc]);
  } catch (e) { /* none */ }
  sections.push({ title: 'Language and place', rows: place });

  const hw = [];
  if (n.hardwareConcurrency) hw.push(['CPU threads', String(n.hardwareConcurrency)]);
  if (n.deviceMemory) hw.push(['memory', (n.deviceMemory >= 8 ? 'at least ' : 'about ') + n.deviceMemory + ' GB', 'rounded, and capped at 8 by the browser']);
  hw.push(['platform', n.platform || 'unknown']);
  if (n.userAgentData) {
    try {
      const hi = await n.userAgentData.getHighEntropyValues(['platformVersion', 'architecture', 'bitness', 'model', 'fullVersionList']);
      if (hi.platform) {
        let v = hi.platformVersion || '';
        if (hi.platform === 'Windows' && v) v = Number(v.split('.')[0]) >= 13 ? '11' : '10';
        hw.push(['system', hi.platform + (v ? ' ' + v : ''), 'from client hints']);
      }
      if (hi.architecture) hw.push(['architecture', hi.architecture + (hi.bitness ? ' ' + hi.bitness + '-bit' : '')]);
      if (hi.model) hw.push(['model', hi.model]);
      const brands = (hi.fullVersionList || []).filter((b) => !/Not.?A.?Brand/i.test(b.brand));
      if (brands.length) hw.push(['browser', brands.map((b) => b.brand + ' ' + b.version).join(', '), 'full versions, from client hints']);
    } catch (e) { /* not given */ }
  }
  const renderer = gpu(g);
  if (renderer) hw.push(['graphics', renderer]);
  const battery = n.getBattery ? await n.getBattery().catch(() => null) : null;
  if (battery) hw.push(['battery', Math.round(battery.level * 100) + '%', battery.charging ? 'charging' : 'on battery']);
  sections.push({ title: 'Hardware', rows: hw });

  const net = [['online', yes(n.onLine !== false)]];
  const c = n.connection;
  if (c) {
    if (c.effectiveType) net.push(['connection', c.effectiveType + (c.type ? ' · ' + c.type : ''), 'the browser’s estimate']);
    if (c.downlink) net.push(['downlink', '≈ ' + c.downlink + ' Mbit/s', c.rtt ? 'round trip ≈ ' + c.rtt + ' ms' : undefined]);
    if (c.saveData) net.push(['data saver', 'on']);
  }
  net.push(['cookies', n.cookieEnabled === false ? 'blocked' : 'allowed']);
  if (n.doNotTrack === '1' || n.globalPrivacyControl) net.push(['privacy signals', [n.globalPrivacyControl ? 'Global Privacy Control' : '', n.doNotTrack === '1' ? 'Do Not Track' : ''].filter(Boolean).join(', ')]);
  if (n.storage && n.storage.estimate) {
    try {
      const est = await n.storage.estimate();
      const persisted = n.storage.persisted ? await n.storage.persisted() : false;
      net.push(['storage', mb(est.usage) + ' used of ' + mb(est.quota), persisted ? 'kept (persistent)' : 'may be cleared when space runs low']);
    } catch (e) { /* none */ }
  }
  sections.push({ title: 'Network and storage', rows: net });
  return sections;
}

const mb = (b) => (b == null ? '?' : b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' kB');
