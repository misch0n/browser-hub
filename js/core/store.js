import { SCHEMA } from './util.js';

// The only module that touches localStorage. Everything else goes through
// this interface, so a server-backed store can replace it later.
//   get(collection)        -> Promise<document | null>
//   put(collection, value) -> Promise<void>
//   exportAll()            -> Promise<{schema, exportedAt, collections}>
//   importAll(data)        -> Promise<void>  (replaces the given collections)
//   usage()                -> Promise<bytes used by this app, or null>
//   subscribe(fn)          -> unsubscribe    (fn(collection) when another tab writes; null = everything)
//   getLocal(name) / setLocal(name, value) / removeLocal(name)
//                          per-device values (undo steps, sync settings and token): never
//                          exported or synced; setLocal returns false when it can't save

export const COLLECTIONS = ['meta', 'aliases', 'notes', 'tasks', 'events', 'settings', 'history'];
const PREFIX = 'cc:';
const LOCAL = 'cc-device:';

function isQuotaError(e) {
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    e.code === 22 || e.code === 1014);
}

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

export function createLocalStore(storage) {
  let persistent = true;
  if (!storage) {
    try {
      storage = globalThis.localStorage;
      storage.getItem(PREFIX + 'probe');
    } catch (e) {
      storage = null;
    }
  }
  if (!storage) {
    storage = memoryStorage();
    persistent = false;
  }

  const key = (c) => PREFIX + c;

  return {
    persistent,

    async get(collection) {
      const raw = storage.getItem(key(collection));
      if (raw === null) return null;
      try {
        return JSON.parse(raw);
      } catch (e) {
        // Keep the unreadable text around rather than silently overwriting it.
        try { storage.setItem(PREFIX + 'bak:' + collection, raw); } catch (e2) { /* ignore */ }
        return null;
      }
    },

    async put(collection, value) {
      try {
        storage.setItem(key(collection), JSON.stringify(value));
      } catch (e) {
        if (isQuotaError(e)) throw new Error('storage is full; delete some data or run: export');
        throw new Error('could not save ' + collection + ': ' + (e && e.message ? e.message : e));
      }
    },

    async exportAll() {
      const collections = {};
      for (const c of COLLECTIONS) {
        const v = await this.get(c);
        if (v !== null) collections[c] = v;
      }
      return { app: 'control-center', schema: SCHEMA, exportedAt: new Date().toISOString(), collections };
    },

    async importAll(data) {
      for (const c of COLLECTIONS) {
        if (data && data.collections && data.collections[c] !== undefined) {
          await this.put(c, data.collections[c]);
        }
      }
    },

    async usage() {
      if (typeof storage.key !== 'function') return null;
      let chars = 0;
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && k.startsWith(PREFIX)) chars += k.length + (storage.getItem(k) || '').length;
      }
      return chars * 2; // UTF-16
    },

    getLocal(name) {
      try {
        const raw = storage.getItem(LOCAL + name);
        return raw === null ? null : JSON.parse(raw);
      } catch (e) {
        return null;
      }
    },

    setLocal(name, value) {
      try {
        storage.setItem(LOCAL + name, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },

    removeLocal(name) {
      try { storage.removeItem(LOCAL + name); } catch (e) { /* nothing to remove */ }
    },

    subscribe(fn) {
      const handler = (e) => {
        if (e.storageArea && e.storageArea !== storage) return;
        if (e.key === null) return fn(null); // storage.clear() in another tab
        if (e.key.startsWith(PREFIX)) fn(e.key.slice(PREFIX.length));
      };
      globalThis.addEventListener('storage', handler);
      return () => globalThis.removeEventListener('storage', handler);
    },
  };
}
