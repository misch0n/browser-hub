// User-agent strings read into browser, engine, OS and device. Order matters:
// many browsers carry each other's tokens (Edge says Chrome and Safari too).
// Today's browsers freeze parts of the string (Windows 11 still says
// "Windows NT 10.0", macOS always "10_15_7", Android "K"), so the result says
// when a value can't be told from the string alone.

const BOTS = [
  ['Googlebot', /Googlebot(?:-\w+)?\/([\d.]+)/], ['Bingbot', /bingbot\/([\d.]+)/i], ['DuckDuckBot', /DuckDuck(?:Go-Favicons-)?Bot\/?([\d.]*)/i],
  ['Applebot', /Applebot\/([\d.]+)/], ['YandexBot', /YandexBot\/([\d.]+)/], ['Baiduspider', /Baiduspider\/?([\d.]*)/],
  ['GPTBot', /GPTBot\/([\d.]+)/], ['ClaudeBot', /ClaudeBot\/([\d.]+)/], ['facebookexternalhit', /facebookexternalhit\/([\d.]+)/],
  ['Twitterbot', /Twitterbot\/([\d.]+)/], ['Slackbot', /Slackbot(?:-LinkExpanding)?\s?([\d.]*)/], ['Discordbot', /Discordbot\/([\d.]+)/],
  ['curl', /^curl\/([\d.]+)/], ['Wget', /^Wget\/([\d.]+)/], ['python-requests', /python-requests\/([\d.]+)/], ['Go HTTP client', /^Go-http-client\/([\d.]+)/],
  ['HeadlessChrome', /HeadlessChrome\/([\d.]+)/],
];

// [name, pattern] first match wins.
const BROWSERS = [
  ['Edge', /\bEdg(?:e|A|iOS)?\/([\d.]+)/], ['Opera', /\b(?:OPR|OPT|Opera)\/([\d.]+)/], ['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
  ['Vivaldi', /Vivaldi\/([\d.]+)/], ['Yandex Browser', /YaBrowser\/([\d.]+)/], ['UC Browser', /UCBrowser\/([\d.]+)/],
  ['DuckDuckGo', /\bDdg\/([\d.]+)/], ['Brave', /\bBrave\/([\d.]+)/], ['Firefox', /\b(?:Firefox|FxiOS)\/([\d.]+)/],
  ['Chrome', /\b(?:Chrome|CriOS|HeadlessChrome)\/([\d.]+)/], ['Facebook app', /\bFBAV\/([\d.]+)/], ['Instagram app', /\bInstagram ([\d.]+)/],
  ['Safari', /Version\/([\d.]+).*Safari\//], ['Safari', /AppleWebKit\/[\d.]+.*Mobile\/\w+$/], ['Internet Explorer', /(?:MSIE |Trident\/.*rv:)([\d.]+)/],
];

const WINDOWS = { '10.0': '10 or 11', '6.3': '8.1', '6.2': '8', '6.1': '7', '6.0': 'Vista', '5.1': 'XP', '5.2': 'XP x64' };

function os(ua) {
  let m;
  if ((m = /Windows NT ([\d.]+)/.exec(ua))) return { name: 'Windows', version: WINDOWS[m[1]] || m[1], note: m[1] === '10.0' ? 'Windows 11 also says NT 10.0; only client hints tell them apart' : null };
  if ((m = /(?:iPhone|CPU) OS ([\d_]+)/.exec(ua)) && /iPhone|iPad|iPod/.test(ua)) return { name: /iPad/.test(ua) ? 'iPadOS' : 'iOS', version: m[1].replace(/_/g, '.') };
  if ((m = /Mac OS X ([\d_.]+)/.exec(ua))) {
    const v = m[1].replace(/_/g, '.');
    return { name: 'macOS', version: v, note: v === '10.15.7' ? 'browsers freeze macOS at 10.15.7: the real version is unknown' : null };
  }
  if ((m = /Android ?([\d.]*)/.exec(ua))) return { name: 'Android', version: m[1] || null, note: m[1] === '10' && /; K\)/.test(ua) ? 'reduced user agent: Android version and model hidden' : null };
  if ((m = /CrOS \S+ ([\d.]+)/.exec(ua))) return { name: 'ChromeOS', version: m[1] };
  if (/HarmonyOS/.test(ua)) return { name: 'HarmonyOS', version: (/HarmonyOS ([\d.]+)/.exec(ua) || [])[1] || null };
  if (/Ubuntu/.test(ua)) return { name: 'Ubuntu', version: null };
  if (/Fedora/.test(ua)) return { name: 'Fedora', version: null };
  if (/Linux/.test(ua)) return { name: 'Linux', version: null };
  if (/FreeBSD/.test(ua)) return { name: 'FreeBSD', version: null };
  return { name: null, version: null };
}

function device(ua, osName) {
  let m;
  if (/iPad/.test(ua)) return { type: 'tablet', vendor: 'Apple', model: 'iPad' };
  if (/iPhone/.test(ua)) return { type: 'phone', vendor: 'Apple', model: 'iPhone' };
  if (/iPod/.test(ua)) return { type: 'player', vendor: 'Apple', model: 'iPod touch' };
  if (/Macintosh/.test(ua)) return { type: 'desktop', vendor: 'Apple', model: 'Mac', note: 'iPads ask for desktop sites as a Mac too' };
  if (/SmartTV|SMART-TV|Tizen.*TV|Web0S|webOS.*TV|AFT\w+|CrKey|BRAVIA|Roku/i.test(ua)) return { type: 'tv', vendor: null, model: null };
  if (/PlayStation|Xbox|Nintendo/.test(ua)) return { type: 'console', vendor: (/PlayStation|Xbox|Nintendo/.exec(ua) || [])[0], model: null };
  if (osName === 'Android') {
    const model = (m = /Android[^;)]*;\s*(?:[a-z]{2}[-_][a-z]{2};\s*)?([^;)]+?)(?:\s+Build\/[^;)]*)?(?:;|\))/i.exec(ua)) ? m[1].trim() : null;
    const known = model && model !== 'K' ? model : null;
    const vendor = !known ? null : /^SM-|^GT-|Samsung/i.test(known) ? 'Samsung' : /^Pixel/i.test(known) ? 'Google' : /^(Redmi|Mi |M\d{4}|2\d{3})/i.test(known) ? 'Xiaomi'
      : /^(CPH|OPPO)/i.test(known) ? 'OPPO' : /^(ONEPLUS|[A-Z]{2}\d{4})/i.test(known) ? 'OnePlus' : /^moto/i.test(known) ? 'Motorola' : /^(HUAWEI|[A-Z]{3}-[A-Z]\d{2})/.test(known) ? 'Huawei' : null;
    return { type: /Mobile/.test(ua) ? 'phone' : 'tablet', vendor, model: known };
  }
  if (/Mobile|Opera Mini|IEMobile/.test(ua)) return { type: 'phone', vendor: null, model: null };
  if (/Windows|CrOS|Linux|X11/.test(ua)) return { type: 'desktop', vendor: null, model: null };
  return { type: null, vendor: null, model: null };
}

function engine(ua, browser) {
  let m;
  if (/iPhone|iPad|iPod/.test(ua)) return { name: 'WebKit', version: (/AppleWebKit\/([\d.]+)/.exec(ua) || [])[1] || null, note: 'every browser on iOS before 17.4 used WebKit' };
  if ((m = /Gecko\/[\d.]+.*Firefox\/([\d.]+)/.exec(ua))) return { name: 'Gecko', version: m[1] };
  if ((m = /Trident\/([\d.]+)/.exec(ua))) return { name: 'Trident', version: m[1] };
  if ((m = /Chrome\/([\d.]+)/.exec(ua))) return { name: 'Blink', version: m[1] };
  if ((m = /AppleWebKit\/([\d.]+)/.exec(ua))) return { name: 'WebKit', version: m[1] };
  if ((m = /Presto\/([\d.]+)/.exec(ua))) return { name: 'Presto', version: m[1] };
  return { name: browser.name === 'Firefox' ? 'Gecko' : null, version: null };
}

// -> { ua, bot, browser: {name, version, major}, engine, os, device, notes: [] }
export function parseUA(input) {
  const ua = String(input || '').trim();
  const r = { ua, bot: null, browser: { name: null, version: null, major: null }, engine: null, os: null, device: null, notes: [] };
  for (const [name, re] of BOTS) {
    const m = re.exec(ua);
    if (m) { r.bot = { name, version: m[1] || null }; break; }
  }
  if (!r.bot && /bot\b|crawler|spider|crawl|slurp|fetch\b/i.test(ua)) r.bot = { name: (/([\w-]*(?:bot|crawler|spider))\b/i.exec(ua) || [, 'a crawler'])[1], version: null };
  for (const [name, re] of BROWSERS) {
    const m = re.exec(ua);
    if (m) { r.browser = { name, version: m[1] || null, major: m[1] ? m[1].split('.')[0] : null }; break; }
  }
  if (r.browser.name === 'Chrome' && /\bwv\)|; wv\b/.test(ua)) r.browser.name = 'Android WebView';
  if (/(?:iPhone|iPad|iPod)/.test(ua) && /CriOS|FxiOS|EdgiOS|OPT\//.test(ua)) r.notes.push('on iOS this browser uses Apple’s WebKit, not its own engine');
  r.os = os(ua);
  r.device = device(ua, r.os.name);
  r.engine = engine(ua, r.browser);
  if (r.os.note) r.notes.push(r.os.note);
  if (r.device.note && !r.bot) r.notes.push(r.device.note);
  if (r.browser.name === 'Chrome' && /\.0\.0\.0$/.test(r.browser.version || '')) r.notes.push('Chrome reports only its major version (' + r.browser.major + '); the rest is zeroed');
  if (r.bot) r.device = { type: 'bot', vendor: null, model: null };
  return r;
}

// A one-line summary: "Chrome 130 on macOS · desktop"
export function uaSummary(p) {
  if (p.bot) return p.bot.name + (p.bot.version ? ' ' + p.bot.version : '') + ' (bot)';
  const b = p.browser.name ? p.browser.name + (p.browser.major ? ' ' + p.browser.major : '') : 'Unknown browser';
  const o = p.os && p.os.name ? ' on ' + p.os.name + (p.os.version && !p.os.note ? ' ' + p.os.version : '') : '';
  return b + o + (p.device && p.device.type ? ' · ' + p.device.type : '');
}
