// The visual history: every command you ran, with what it printed, on every
// device. Each entry is replayable output data (not HTML), tagged with the
// device it ran on, and entries from all devices are shown merged, ordered by
// their timestamps.
//
// log = { entries: [entry], cleared: { all: iso | null, devices: { [deviceId]: iso } } }
// entry = { id, at, device, deviceName, input, ops: [[method, ...args]] }
//
// `clear` doesn't delete: it sets a mark, and entries at or before it are
// hidden (on every device, once synced). Undo moves the mark back.

export const MAX_ENTRIES = 300;
export const MAX_ENTRY_BYTES = 20000;
export const MAX_LOG_BYTES = 800000;

export const emptyLog = () => ({ entries: [], cleared: { all: null, devices: {} } });

const byTime = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function newEntryId(device, at, random = Math.random) {
  return device + '-' + Date.parse(at).toString(36) + '-' + Math.floor(random() * 1e6).toString(36);
}

// An entry, with output too large to keep cut down to its heading.
export function makeEntry({ id, at, device, deviceName, input, ops }) {
  const e = { id, at, device, deviceName, input: String(input).slice(0, 2000), ops };
  if (JSON.stringify(e).length > MAX_ENTRY_BYTES) {
    const head = ops.find((o) => o[0] === 'head');
    e.ops = [...(head ? [head] : []), ['dim', 'The output was too long to keep in history · run it again to see it']];
  }
  return e;
}

export function isHidden(entry, cleared) {
  const c = cleared || {};
  if (c.all && entry.at <= c.all) return true;
  const mine = c.devices && c.devices[entry.device];
  return !!(mine && entry.at <= mine);
}

// Oldest dropped first, past MAX_ENTRIES or MAX_LOG_BYTES.
export function compact(log) {
  const entries = log.entries.slice().sort(byTime);
  let bytes = 0;
  let keep = entries.length;
  for (let i = entries.length - 1; i >= 0; i--) {
    bytes += JSON.stringify(entries[i]).length;
    if (entries.length - i > MAX_ENTRIES || bytes > MAX_LOG_BYTES) { keep = entries.length - 1 - i; break; }
  }
  return { ...log, entries: entries.slice(entries.length - keep) };
}

// What to show: view 'all' (every device), 'current' (this one), or a device id.
export function visible(log, view, deviceId) {
  const want = view === 'current' ? deviceId : view && view !== 'all' ? view : null;
  return log.entries.filter((e) => !isHidden(e, log.cleared) && (!want || e.device === want)).sort(byTime);
}

// One row per device: { device, name, count, first, last } (visible entries only).
export function sessions(log) {
  const by = new Map();
  for (const e of log.entries.slice().sort(byTime)) {
    if (isHidden(e, log.cleared)) continue;
    const s = by.get(e.device) || { device: e.device, name: e.deviceName, count: 0, first: e.at, last: e.at };
    s.count += 1;
    s.last = e.at;
    s.name = e.deviceName || s.name;
    by.set(e.device, s);
  }
  return [...by.values()].sort((a, b) => (a.last < b.last ? 1 : -1));
}

const later = (a, b) => (!a ? b || null : !b ? a : a > b ? a : b);

// Three-way for the clear marks (a mark moved back by undo is kept if the
// other side didn't move it), union for entries: they never change once
// written, and the newest are kept.
export function mergeLog(base, local, remote) {
  const B = base || emptyLog(), L = local || emptyLog(), R = remote || emptyLog();
  const pickMark = (b, l, r) => (l === r ? l : l === b ? r : r === b ? l : later(l, r));
  const bc = B.cleared || {}, lc = L.cleared || {}, rc = R.cleared || {};
  const devices = {};
  const ids = new Set([...Object.keys(lc.devices || {}), ...Object.keys(rc.devices || {})]);
  for (const d of ids) {
    const v = pickMark((bc.devices || {})[d] || null, (lc.devices || {})[d] || null, (rc.devices || {})[d] || null);
    if (v) devices[d] = v;
  }
  const cleared = { all: pickMark(bc.all || null, lc.all || null, rc.all || null), devices };
  const seen = new Map();
  for (const e of [...(L.entries || []), ...(R.entries || [])]) if (e && e.id && !seen.has(e.id)) seen.set(e.id, e);
  return compact({ ...R, ...L, entries: [...seen.values()], cleared });
}
