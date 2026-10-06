import { SCHEMA } from './util.js';
import { starters, SHIPPED_DEFAULT } from './aliases.js';
import { DEFAULT_THEME, DEFAULT_WIDGETS } from './catalog.js';
import { UNDOABLE, diff, conflicts, apply } from './undo.js';
import { sameDoc } from './merge.js';
import { emptyLog, compact } from './log.js';

export const HISTORY_CAP = 500;
export const UNDO_MAX = 30;
const UNDO_BYTES = 1500000; // keep the undo steps well inside localStorage's ~5 MB

// Schema migrations: MIGRATIONS[n] upgrades the stored collections from
// schema n to n + 1. `collections` maps name -> document and is edited in place.
export const MIGRATIONS = {};

export function migrateCollections(collections, from) {
  for (let v = from; v < SCHEMA; v++) {
    if (MIGRATIONS[v]) MIGRATIONS[v](collections);
  }
  return collections;
}

export const DEFAULTS = {
  meta: (now) => ({ schema: SCHEMA, created: now().toISOString(), lastExport: null, counters: { t: 0, n: 0, e: 0 } }),
  aliases: () => ({ entries: starters(), defaultEngine: SHIPPED_DEFAULT }),
  notes: () => ({ items: [] }),
  tasks: () => ({ items: [] }),
  events: () => ({ items: [] }),
  snippets: () => ({ items: [] }),
  later: () => ({ items: [] }), // links to read later
  foods: () => ({ items: [] }), // your own foods for cook calorie
  diagrams: () => ({ items: [] }), // Mermaid diagrams
  settings: () => ({ zones: [], zoneNames: {}, theme: DEFAULT_THEME, widgets: DEFAULT_WIDGETS.slice(), panel: true,
    summary: 'on', summaryDismissed: null, name: null, bounceKeys: [] }),
  history: () => ({ items: [] }),
  log: () => emptyLog(),
  clip: () => ({ at: null }), // the shared clipboard: one sealed item (core/clip.js)
};

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Stored documents may be old, hand-edited or damaged: every field the code
// relies on gets the default's type back if it is missing or wrong.
function shape(base, stored) {
  if (!isObj(stored)) return base;
  const out = Object.assign({}, stored);
  for (const k of Object.keys(base)) {
    const want = base[k];
    const have = stored[k];
    if (Array.isArray(want)) out[k] = Array.isArray(have) ? have.filter((x) => x !== null && x !== undefined) : want;
    else if (isObj(want)) out[k] = isObj(have) ? Object.assign({}, want, have) : want;
    else if (want !== null && typeof have !== typeof want) out[k] = want;
    else if (have === undefined) out[k] = want;
  }
  return out;
}

export function createData(store, now) {
  now = now || (() => new Date());
  const state = {};
  for (const c of Object.keys(DEFAULTS)) state[c] = DEFAULTS[c](now);
  const listeners = new Set();
  const emit = (col) => listeners.forEach((fn) => { try { fn(col); } catch (e) { /* listener bug */ } });

  // Every read-modify-write runs one at a time, so two commands (or a command
  // and an import) can never interleave and drop each other's changes.
  let chain = Promise.resolve();
  function serial(fn) {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  }

  async function readDoc(col) {
    return shape(DEFAULTS[col](now), await store.get(col));
  }

  // ---- undo ----
  // A command runs inside a transaction: each collection it changes is
  // remembered as it was before, and when it ends the differences become one
  // undo step (core/undo.js). Steps are kept per device, shared by its tabs.
  let tx = null;
  let memSteps = { undo: [], redo: [] };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const loadSteps = () => (store.getLocal ? store.getLocal('undo') : memSteps) || { undo: [], redo: [] };
  function saveSteps(s) {
    s.undo = s.undo.slice(-UNDO_MAX);
    s.redo = s.redo.slice(-UNDO_MAX);
    while (s.undo.length > 1 && JSON.stringify(s).length > UNDO_BYTES) s.undo.shift();
    if (!store.setLocal) { memSteps = s; return; }
    if (!store.setLocal('undo', s)) { s.undo = s.undo.slice(-3); s.redo = []; store.setLocal('undo', s); }
  }

  function noteChange(col, before, after) {
    if (!tx || !UNDOABLE.includes(col)) return;
    if (!(col in tx.before)) tx.before[col] = clone(before);
    tx.after[col] = clone(after);
  }

  // Runs fn() as one undoable step labelled `label` (the command as typed).
  // fn is called synchronously, so a file picker it opens still counts as
  // user-initiated. Resolves to { result, patches }.
  async function transaction(label, fn) {
    const t = { label, before: {}, after: {} };
    tx = t;
    let result;
    try {
      result = await fn();
    } finally {
      if (tx === t) tx = null;
    }
    await serial(async () => {}); // let queued writes land
    const patches = Object.keys(t.before).map((c) => diff(c, t.before[c], t.after[c])).filter(Boolean);
    if (patches.length) {
      const s = loadSteps();
      s.undo.push({ label, at: now().toISOString(), patches });
      s.redo = [];
      saveSteps(s);
    }
    return { result, patches };
  }

  // Undo (dir 'undo') or redo the latest step. Refuses, and keeps the step,
  // when something it touched has changed since, unless force is set.
  // -> { empty } | { conflict: ['tasks t3', …], step } | { step }
  function step(dir, force) {
    return serial(async () => {
      const s = loadSteps();
      const st = s[dir][s[dir].length - 1];
      if (!st) return { empty: true };
      const [from, to] = dir === 'undo' ? ['after', 'before'] : ['before', 'after'];
      const docs = {};
      for (const p of st.patches) docs[p.col] = await readDoc(p.col);
      const bad = st.patches.flatMap((p) => conflicts(docs[p.col], p, from).map((k) => p.col + ' ' + k));
      if (bad.length && !force) return { conflict: bad, step: st };
      for (const p of st.patches) apply(docs[p.col], p, to);
      for (const p of st.patches) {
        await store.put(p.col, docs[p.col]);
        state[p.col] = docs[p.col];
        emit(p.col);
      }
      s[dir].pop();
      s[dir === 'undo' ? 'redo' : 'undo'].push(st);
      saveSteps(s);
      return { step: st };
    });
  }

  const steps = () => loadSteps();

  // ---- sync ----
  // The stored documents of `cols`, read fresh.
  function read(cols) {
    return serial(async () => {
      const out = {};
      for (const c of cols) out[c] = await readDoc(c);
      return out;
    });
  }

  // Writes a merge from sync, but only if this device's data is still what
  // the merge started from (`expected`); otherwise false, and sync retries.
  // Not an undo step: undo still works item by item around it.
  function applySync(merged, expected) {
    return serial(async () => {
      for (const c of Object.keys(expected)) {
        if (!sameDoc(await readDoc(c), expected[c])) return false;
      }
      for (const c of Object.keys(merged)) {
        if (!DEFAULTS[c] || sameDoc(merged[c], expected[c])) continue;
        const doc = shape(DEFAULTS[c](now), merged[c]);
        await store.put(c, doc);
        state[c] = doc;
        emit(c);
      }
      return true;
    });
  }

  // Re-reads the collection from the store, applies fn(doc), saves. Reading
  // fresh each time means a second open tab's changes are never overwritten
  // by a stale copy (last write still wins per collection).
  function mutate(col, fn, opts = {}) {
    return serial(async () => {
      const doc = await readDoc(col);
      const before = tx && opts.record !== false && UNDOABLE.includes(col) ? clone(doc) : null;
      const result = fn(doc);
      await store.put(col, doc);
      if (before) noteChange(col, before, doc);
      state[col] = doc;
      emit(col);
      return result;
    });
  }

  function load() {
    return serial(async () => {
      const meta = await readDoc('meta');
      // A damaged version number must not send the migration loop off for ever.
      if (!Number.isInteger(meta.schema) || meta.schema < 1) meta.schema = 1;
      if (meta.schema > SCHEMA) {
        throw new Error('stored data is from a newer version of this page (schema ' + meta.schema + ')');
      }
      if (meta.schema < SCHEMA) {
        const docs = {};
        for (const c of Object.keys(DEFAULTS)) docs[c] = await readDoc(c);
        migrateCollections(docs, meta.schema);
        docs.meta.schema = SCHEMA;
        for (const c of Object.keys(DEFAULTS)) await store.put(c, docs[c]);
      }
      for (const c of Object.keys(DEFAULTS)) state[c] = await readDoc(c);
      // First run: persist the schema version and the shipped starter engines.
      for (const c of ['meta', 'aliases']) {
        if ((await store.get(c)) === null) await store.put(c, state[c]);
      }
      emit(null);
    });
  }

  function reload(col) {
    if (col === null || col === 'meta') return load();
    if (!DEFAULTS[col]) return Promise.resolve();
    return serial(async () => {
      state[col] = await readDoc(col);
      emit(col);
    });
  }

  // Ids are per collection and never reused: the counter only goes up.
  function allocIds(prefix, count) {
    return mutate('meta', (m) => {
      const ids = [];
      for (let i = 0; i < count; i++) {
        m.counters[prefix] = (m.counters[prefix] || 0) + 1;
        ids.push(prefix + m.counters[prefix]);
      }
      return ids;
    });
  }

  async function allocId(prefix) {
    return (await allocIds(prefix, 1))[0];
  }

  // Adds one command, with its output, to the shared visual history (core/log.js).
  // Never an undo step; old entries drop off past the size limits.
  function appendLog(entry) {
    return mutate('log', (d) => {
      if (d.entries.some((e) => e.id === entry.id)) return;
      d.entries.push(entry);
      Object.assign(d, compact(d));
    }, { record: false }).catch(() => { /* history is best-effort */ });
  }

  // Updates the in-memory history immediately (so the up-arrow sees it) and
  // returns a promise for the persisted write.
  function addHistory(input) {
    const items = state.history.items;
    if (items[items.length - 1] === input) return Promise.resolve();
    items.push(input);
    if (items.length > HISTORY_CAP) items.splice(0, items.length - HISTORY_CAP);
    return mutate('history', (h) => {
      if (h.items[h.items.length - 1] !== input) h.items.push(input);
      if (h.items.length > HISTORY_CAP) h.items.splice(0, h.items.length - HISTORY_CAP);
    }).catch(() => { /* history is best-effort */ });
  }

  function hasUserData() {
    const starterNames = starters().map((e) => e.name);
    return state.notes.items.length > 0 || state.tasks.items.length > 0 || state.events.items.length > 0 ||
      state.snippets.items.length > 0 || state.later.items.length > 0 || state.foods.items.length > 0 || state.diagrams.items.length > 0 ||
      state.settings.zones.length > 0 || Object.keys(state.settings.zoneNames).length > 0 || state.aliases.entries.some((e) => !starterNames.includes(e.name));
  }

  // Days since the last export (or since first use if never exported); null with no data.
  function exportAgeDays() {
    if (!hasUserData()) return null;
    const since = Date.parse(state.meta.lastExport || state.meta.created);
    if (isNaN(since)) return null;
    return Math.floor((now().getTime() - since) / 86400000);
  }

  function markExported() {
    return mutate('meta', (m) => { m.lastExport = now().toISOString(); });
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    state, load, reload, mutate, allocId, allocIds, addHistory, hasUserData, exportAgeDays, markExported, onChange,
    transaction, noteChange, undo: (force) => step('undo', force), redo: (force) => step('redo', force), steps,
    read, applySync, appendLog,
  };
}
