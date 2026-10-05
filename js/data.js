(function (CC) {
  'use strict';

  const HISTORY_CAP = 500;

  // Schema migrations: MIGRATIONS[n] upgrades the stored collections from
  // schema n to n + 1. `collections` maps name -> document and is edited in place.
  const MIGRATIONS = {};

  function migrateCollections(collections, from) {
    for (let v = from; v < CC.SCHEMA; v++) {
      if (MIGRATIONS[v]) MIGRATIONS[v](collections);
    }
    return collections;
  }

  const DEFAULTS = {
    meta: (now) => ({ schema: CC.SCHEMA, created: now().toISOString(), lastExport: null, counters: { t: 0, n: 0, e: 0 } }),
    aliases: () => ({ entries: CC.aliases.starters(), defaultEngine: CC.aliases.SHIPPED_DEFAULT }),
    notes: () => ({ items: [] }),
    tasks: () => ({ items: [] }),
    events: () => ({ items: [] }),
    settings: () => ({ zones: [] }),
    history: () => ({ items: [] }),
  };

  function createData(store, now) {
    now = now || (() => new Date());
    const state = {};
    for (const c of Object.keys(DEFAULTS)) state[c] = DEFAULTS[c](now);

    async function readDoc(col) {
      const v = await store.get(col);
      const base = DEFAULTS[col](now);
      return v && typeof v === 'object' && !Array.isArray(v) ? Object.assign(base, v) : base;
    }

    // Re-reads the collection from the store, applies fn(doc), saves. Reading
    // fresh each time means a second open tab's changes are never overwritten
    // by a stale copy (last write still wins per collection).
    async function mutate(col, fn) {
      const doc = await readDoc(col);
      const result = fn(doc);
      await store.put(col, doc);
      state[col] = doc;
      return result;
    }

    async function load() {
      state.meta = await readDoc('meta');
      if (state.meta.schema > CC.SCHEMA) {
        throw new Error('stored data is from a newer version of this page (schema ' + state.meta.schema + ')');
      }
      if (state.meta.schema < CC.SCHEMA) {
        const names = Object.keys(DEFAULTS);
        const docs = {};
        for (const c of names) docs[c] = await readDoc(c);
        migrateCollections(docs, state.meta.schema);
        docs.meta.schema = CC.SCHEMA;
        for (const c of names) await store.put(c, docs[c]);
      }
      for (const c of Object.keys(DEFAULTS)) state[c] = await readDoc(c);
      // First run: persist the schema version and the shipped starter engines.
      for (const c of ['meta', 'aliases']) {
        if ((await store.get(c)) === null) await store.put(c, state[c]);
      }
    }

    async function reload(col) {
      if (col === null) return load();
      if (DEFAULTS[col]) state[col] = await readDoc(col);
    }

    // Ids are per collection and never reused: the counter only goes up.
    async function allocIds(prefix, count) {
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
      const starterNames = CC.aliases.starters().map((e) => e.name);
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

    async function markExported() {
      await mutate('meta', (m) => { m.lastExport = now().toISOString(); });
    }

    return { state, load, reload, mutate, allocId, allocIds, addHistory, hasUserData, exportAgeDays, markExported, DEFAULTS };
  }

  CC.createData = createData;
  CC.dataInternals = { HISTORY_CAP, MIGRATIONS, migrateCollections };
})((globalThis.CC = globalThis.CC || {}));
