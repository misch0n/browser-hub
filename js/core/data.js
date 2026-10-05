import { SCHEMA } from './util.js';
import { starters, SHIPPED_DEFAULT } from './aliases.js';
import { DEFAULT_THEME, DEFAULT_WIDGETS } from './catalog.js';

export const HISTORY_CAP = 500;

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
  settings: () => ({ zones: [], theme: DEFAULT_THEME, widgets: DEFAULT_WIDGETS.slice(), panel: true }),
  history: () => ({ items: [] }),
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

  // Re-reads the collection from the store, applies fn(doc), saves. Reading
  // fresh each time means a second open tab's changes are never overwritten
  // by a stale copy (last write still wins per collection).
  function mutate(col, fn) {
    return serial(async () => {
      const doc = await readDoc(col);
      const result = fn(doc);
      await store.put(col, doc);
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
      state.settings.zones.length > 0 || state.aliases.entries.some((e) => !starterNames.includes(e.name));
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

  return { state, load, reload, mutate, allocId, allocIds, addHistory, hasUserData, exportAgeDays, markExported, onChange };
}
