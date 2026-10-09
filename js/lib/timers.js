// Timers and stopwatches as data. An entry keeps when it started (and, for a
// timer, how long it runs); everything live is worked out from that and the
// clock, so it survives reloads and reads the same on every device. A timer
// keeps counting past zero (how long it has been done) until it's stopped. Pure.
//
//   parseDuration('10m' | '1h30m' | '90s' | '1:30' | '1:02:03' | '25') -> ms | null (a bare number is minutes)
//   status(item, now) -> { running, elapsed, remaining (timers), done, over (ms past the end), end (ms, timers) }
//   laps(item) -> [{ n, at (ms from start), split (ms since the previous) }]
//   clock(ms) -> '4:05', '1:02:03', '0:00.4' (tenths under a minute when asked)
//   spoken(ms) -> '1 h 2 min', '45 s', '3 days 2 h'
//   findEntry(items, spec) -> the entry a recorded ticker means, or null (see below)

const UNIT = { d: 86400000, h: 3600000, m: 60000, min: 60000, s: 1000, sec: 1000 };
const MAX = 7 * 86400000;

export function parseDuration(text) {
  const t = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  let ms = null;
  if (/^\d+(\.\d+)?$/.test(t)) ms = Number(t) * 60000;
  else if (/^\d{1,3}:\d{2}(:\d{2})?$/.test(t)) {
    const p = t.split(':').map(Number);
    if (p.slice(1).some((x) => x > 59)) return null;
    ms = (p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]) * 1000;
  } else {
    const re = /(\d+(?:\.\d+)?)(d|h|min|m|sec|s)/g;
    let m, used = '';
    ms = 0;
    while ((m = re.exec(t))) { ms += Number(m[1]) * UNIT[m[2]]; used += m[0]; }
    if (used !== t) return null;
  }
  ms = Math.round(ms);
  return ms >= 1000 && ms <= MAX ? ms : null;
}

export function status(item, now) {
  const start = Date.parse(item.start);
  const end = item.stop ? Date.parse(item.stop) : now.getTime();
  const elapsed = Math.max(0, end - start);
  const s = { running: !item.stop, elapsed };
  if (item.kind === 'timer') {
    s.remaining = item.duration - elapsed;
    s.done = s.remaining <= 0;
    s.over = s.done ? -s.remaining : 0;
    s.end = start + item.duration;
  }
  return s;
}

export function laps(item) {
  const start = Date.parse(item.start);
  let prev = start;
  return (item.laps || []).map((iso, i) => {
    const t = Date.parse(iso);
    const lap = { n: i + 1, at: t - start, split: t - prev };
    prev = t;
    return lap;
  });
}

const p2 = (n) => String(n).padStart(2, '0');

export function clock(ms, tenths = false) {
  const neg = ms < 0;
  const a = Math.abs(ms);
  const total = Math.floor(a / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  let out = h ? h + ':' + p2(m) + ':' + p2(s) : m + ':' + p2(s);
  if (tenths && total < 60) out += '.' + Math.floor((a % 1000) / 100);
  return (neg ? '-' : '') + out;
}

export function spoken(ms) {
  const total = Math.round(Math.abs(ms) / 1000);
  const d = Math.floor(total / 86400), h = Math.floor((total % 86400) / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  if (d) return d + (d === 1 ? ' day' : ' days') + (h ? ' ' + h + ' h' : '');
  if (h) return h + ' h' + (m ? ' ' + m + ' min' : '');
  if (m) return m + ' min' + (s && m < 10 ? ' ' + s + ' s' : '');
  return s + ' s';
}

// The entry a ticker recorded in the shared history stands for, as it is now.
// Its id can have changed (sync renumbers ids made on two devices at once),
// and an id can now belong to another entry, so it is matched by when it was
// created (and, for tickers recorded before that was kept, by its start).
export function findEntry(items, spec) {
  const same = (x) => x.kind === spec.kind && (spec.created ? x.created === spec.created : x.start === spec.start);
  return items.find((x) => x.id === spec.id && same(x)) || items.find(same) ||
    (!spec.created && items.find((x) => x.id === spec.id && x.kind === spec.kind)) || null; // an old ticker of a restarted entry
}
