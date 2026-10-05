// Three-way merge for sync. `base` is what this device last synced (null on
// its first sync), `local` is what it has now, `remote` what the repo has now.
// Each change made on either side since `base` is kept:
//
//   - per item for notes, tasks, events, snippets and links (by id) and aliases (by name);
//   - per key for settings (zones as a set, clock names per zone);
//   - an item changed on both sides keeps this device's version and is
//     reported as a conflict; an item deleted on one side and changed on the
//     other is kept;
//   - two devices that both created, say, t7 offline: the repo's keeps t7,
//     this device's is renumbered;
//   - with no base (first sync), settings and the default engine come from
//     the repo, since that's the setup already in use elsewhere.
//
// Pure: plain collection documents in, merged documents out.

import { mergeLog } from './log.js';
import { mergeClip } from './clip.js';

export const SYNCED = ['meta', 'aliases', 'notes', 'tasks', 'events', 'snippets', 'later', 'settings', 'log', 'clip'];

// JSON with object keys sorted, so equal data compares equal whatever the key order.
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : canonical(x))).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return v === undefined ? 'undefined' : JSON.stringify(v);
}
const same = (a, b) => canonical(a) === canonical(b);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const idNum = (id) => parseInt(String(id).slice(1), 10) || 0;

// One value. `prefer` decides real conflicts: 'local' or 'remote'.
function pick(b, l, r, prefer, onConflict) {
  if (same(l, r)) return { v: l };
  if (same(l, b)) return { v: r };
  if (same(r, b)) return { v: l };
  // Deleted on one side, changed on the other: keep the change.
  if (l === undefined) return { v: r };
  if (r === undefined) return { v: l };
  if (onConflict) onConflict();
  return { v: prefer === 'remote' ? r : l };
}

function byKey(list, key) {
  const m = new Map();
  for (const x of list || []) if (x && x[key] !== undefined) m.set(x[key], x);
  return m;
}

function mergeList(b, l, r, key, out) {
  const bm = byKey(b, key), lm = byKey(l, key), rm = byKey(r, key);
  const keys = [...new Set([...lm.keys(), ...rm.keys(), ...bm.keys()])];
  const merged = [];
  const renumber = [];
  for (const k of keys) {
    const bx = bm.get(k), lx = lm.get(k), rx = rm.get(k);
    if (key === 'id' && bx === undefined && lx !== undefined && rx !== undefined && !same(lx, rx)) {
      merged.push(clone(rx)); // created on both sides under the same id
      renumber.push(clone(lx));
      continue;
    }
    const res = pick(bx, lx, rx, 'local', () => out.conflicts.push(k));
    if (res.v !== undefined) merged.push(clone(res.v));
  }
  return { merged, renumber };
}

function mergeSettings(b, l, r, noBase, out) {
  const keys = new Set([...Object.keys(l || {}), ...Object.keys(r || {})]);
  const m = {};
  for (const k of keys) {
    const bv = b ? b[k] : undefined, lv = l ? l[k] : undefined, rv = r ? r[k] : undefined;
    if (k === 'zones') {
      // A set: each zone added or removed on either side.
      const toMap = (a) => Object.fromEntries((a || []).map((z) => [z, true]));
      const bz = toMap(bv), lz = toMap(lv), rz = toMap(rv);
      const all = [...new Set([...(lv || []), ...(rv || [])])];
      m.zones = all.filter((z) => pick(bz[z], lz[z], rz[z], 'local').v === true);
    } else if (k === 'zoneNames') {
      const names = {};
      for (const z of new Set([...Object.keys(lv || {}), ...Object.keys(rv || {})])) {
        const v = pick(bv && bv[z], lv && lv[z], rv && rv[z], noBase ? 'remote' : 'local').v;
        if (typeof v === 'string') names[z] = v;
      }
      m.zoneNames = names;
    } else if (k === 'summaryDismissed') {
      // Whichever side changed it wins (a dismissal, or `today pin`); when both
      // dismissed, the later day.
      let v = pick(bv, lv, rv, 'local').v;
      if (typeof lv === 'string' && typeof rv === 'string') v = lv > rv ? lv : rv;
      m[k] = v === undefined ? null : v;
    } else {
      const v = pick(bv, lv, rv, noBase ? 'remote' : 'local', noBase ? null : () => out.conflicts.push('settings.' + k)).v;
      if (v !== undefined) m[k] = clone(v);
    }
  }
  return m;
}

// -> { collections, conflicts: [keys], renumbered: [{ from, to }] }
// opts.now: the time, for wiping an expired shared clip (core/clip.js).
export function merge3(base, local, remote, opts = {}) {
  const out = { conflicts: [], renumbered: [] };
  const noBase = !base;
  const B = base || {}, L = local || {}, R = remote || {};
  if (!remote) {
    const collections = clone(local);
    if (collections && collections.clip) collections.clip = mergeClip(collections.clip, null, opts.now, canonical);
    return { collections, ...out };
  }
  const doc = (X, c) => X[c] || {};
  const col = {};

  // Ids first, so renumbered items get numbers past everything both sides used.
  const counters = {};
  for (const X of [doc(L, 'meta'), doc(R, 'meta')]) {
    for (const [p, n] of Object.entries(X.counters || {})) counters[p] = Math.max(counters[p] || 0, n);
  }
  for (const [c, prefix] of [['notes', 'n'], ['tasks', 't'], ['events', 'e'], ['snippets', 's'], ['later', 'l']]) {
    if (!L[c] && !R[c] && !B[c]) continue; // a file from before snippets and links
    const r = mergeList(doc(B, c).items, doc(L, c).items, doc(R, c).items, 'id', out);
    const max = Math.max(counters[prefix] || 0, ...r.merged.map((x) => idNum(x.id)));
    counters[prefix] = max;
    for (const item of r.renumber) {
      counters[prefix] += 1;
      const to = prefix + counters[prefix];
      out.renumbered.push({ from: item.id, to });
      item.id = to;
      r.merged.push(item);
    }
    r.merged.sort((a, b) => idNum(a.id) - idNum(b.id));
    col[c] = { ...doc(R, c), ...doc(L, c), items: r.merged };
  }

  const aliases = mergeList(doc(B, 'aliases').entries, doc(L, 'aliases').entries, doc(R, 'aliases').entries, 'name', out);
  let defaultEngine = pick(doc(B, 'aliases').defaultEngine, doc(L, 'aliases').defaultEngine, doc(R, 'aliases').defaultEngine,
    noBase ? 'remote' : 'local').v;
  const usable = (n) => aliases.merged.some((e) => e.name === n && e.template);
  if (!usable(defaultEngine)) defaultEngine = [doc(L, 'aliases').defaultEngine, doc(R, 'aliases').defaultEngine].find(usable) || defaultEngine;
  col.aliases = { ...doc(R, 'aliases'), ...doc(L, 'aliases'), entries: aliases.merged, defaultEngine };

  col.settings = mergeSettings(base ? doc(B, 'settings') : null, doc(L, 'settings'), doc(R, 'settings'), noBase, out);

  // The visual history: every entry from both sides, clear marks three-way.
  if (L.log || R.log) col.log = mergeLog(base ? B.log : null, L.log, R.log);

  // The shared clip: the newer one, or nothing once it has expired.
  if (L.clip || R.clip) col.clip = mergeClip(L.clip, R.clip, opts.now, canonical);

  const lm = doc(L, 'meta'), rm = doc(R, 'meta');
  const stamps = (k) => [lm[k], rm[k]].filter((x) => typeof x === 'string').sort();
  col.meta = {
    ...rm, ...lm,
    counters,
    created: stamps('created')[0] || lm.created || rm.created,
    lastExport: stamps('lastExport').pop() || null,
  };
  return { collections: col, ...out };
}

// Only the synced collections, in a stable shape for comparing.
export function syncedPart(collections) {
  const out = {};
  for (const c of SYNCED) if (collections && collections[c] !== undefined) out[c] = collections[c];
  return out;
}

export const sameData = (a, b) => same(syncedPart(a), syncedPart(b));
export const sameDoc = same;
