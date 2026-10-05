import { SCHEMA } from './core/util.js';
import { merge3, syncedPart, sameData, SYNCED } from './core/merge.js';
import { b64encode, b64decode } from './lib/misc.js';

// Sync with a file in a private GitHub repository, through the REST API.
//
// The token and the settings live on this device only (store.setLocal):
// never exported, never synced, never shown. When GitHub refuses the token
// (expired, revoked), sync stops and says so; `sync token` sets a new one.
//
// Each sync: read the repo's file, merge it with what this device has
// (core/merge.js, three-way against what was last synced), write the result
// here if it changed, and push it if the repo's copy differs. A push that
// races another device's (GitHub answers 409) starts over.
//
// opts: { data, store, now(), fetch, device: 'mac' | …, onStatus(status) }

const API = 'https://api.github.com';
const DEFAULT_PATH = 'browser-hub.json';
export const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export class SyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'auth' | 'forbidden' | 'missing' | 'conflict' | 'network' | 'bad-file' | 'github'
  }
}

export function createSync(opts) {
  const { data, store, now } = opts;
  const fetchFn = opts.fetch || ((...a) => globalThis.fetch(...a));
  let cfg = store.getLocal('sync');
  let running = null;
  let again = false;
  let timer = null;
  let status = cfg ? { state: 'idle', lastSync: cfg.lastSync || null } : { state: 'off' };

  const token = () => store.getLocal('sync-token');
  const setStatus = (s) => {
    status = { ...status, ...s };
    if (opts.onStatus) opts.onStatus(status);
  };
  const save = () => store.setLocal('sync', cfg);

  async function api(method, path, body, tok) {
    let res;
    try {
      res = await fetchFn(API + path, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + (tok || token()),
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new SyncError('network', "can't reach GitHub (offline?)");
    }
    let json = null;
    try { json = await res.json(); } catch (e) { /* empty body */ }
    return { status: res.status, json };
  }

  function fail(res, what) {
    const msg = res.json && res.json.message ? res.json.message : 'HTTP ' + res.status;
    if (res.status === 401) return new SyncError('auth', 'GitHub refused the token (expired or revoked)');
    if (res.status === 403) return new SyncError('forbidden', 'GitHub refused ' + what + ': ' + msg);
    if (res.status === 404) return new SyncError('missing', what + ' not found (or the token can\'t see it)');
    if (res.status === 409 || res.status === 422) return new SyncError('conflict', 'the file changed while syncing');
    return new SyncError('github', 'GitHub said ' + msg + ' (' + res.status + ')');
  }

  const repoPath = (c) => '/repos/' + c.repo;
  const filePath = (c) => repoPath(c) + '/contents/' + c.path.split('/').map(encodeURIComponent).join('/');

  // The repo must exist, be private, and be writable with this token.
  async function checkRepo(repo, tok) {
    const res = await api('GET', '/repos/' + repo, null, tok);
    if (res.status !== 200) throw fail(res, 'the repository ' + repo);
    if (!res.json.private) throw new SyncError('forbidden', repo + ' is public: your notes and tasks would be visible to everyone. Use a private repository');
    if (res.json.permissions && res.json.permissions.push === false) throw new SyncError('forbidden', 'the token can read ' + repo + ' but not write to it');
    return { branch: res.json.default_branch || null };
  }

  // -> { sha, collections } or null when the file isn't there yet.
  async function readRemote() {
    const ref = cfg.branch ? '?ref=' + encodeURIComponent(cfg.branch) : '';
    const res = await api('GET', filePath(cfg) + ref);
    if (res.status === 404) return null;
    if (res.status !== 200) throw fail(res, 'the sync file');
    let b64 = res.json.content;
    if (!b64 && res.json.sha) { // over 1 MB: the contents API leaves it out
      const blob = await api('GET', repoPath(cfg) + '/git/blobs/' + res.json.sha);
      if (blob.status !== 200) throw fail(blob, 'the sync file');
      b64 = blob.json.content;
    }
    let file;
    try {
      file = JSON.parse(b64decode(b64 || ''));
    } catch (e) {
      throw new SyncError('bad-file', cfg.path + ' in ' + cfg.repo + ' is not a sync file (not JSON)');
    }
    if (!file || typeof file !== 'object' || !file.collections) throw new SyncError('bad-file', cfg.path + ' is not a sync file');
    if (file.schema > SCHEMA) throw new SyncError('bad-file', 'the repo was synced by a newer version of this page; reload it');
    return { sha: res.json.sha, collections: syncedPart(file.collections) };
  }

  async function writeRemote(collections, sha) {
    const file = { app: 'control-center', schema: SCHEMA, updatedAt: now().toISOString(), by: opts.device || 'browser', collections };
    const body = {
      message: 'Sync from ' + (opts.device || 'browser'),
      content: b64encode(JSON.stringify(file, null, 1) + '\n'),
      ...(sha ? { sha } : {}),
      ...(cfg.branch ? { branch: cfg.branch } : {}),
    };
    const res = await api('PUT', filePath(cfg), body);
    if (res.status !== 200 && res.status !== 201) throw fail(res, 'saving the sync file');
    return res.json.content.sha;
  }

  async function once() {
    for (let attempt = 0; attempt < 4; attempt++) {
      // Another tab of this device may have synced since: start from its
      // record of the last sync, or a stale base would turn another device's
      // change into a false conflict.
      cfg = store.getLocal('sync') || cfg;
      const remote = await readRemote();
      const local = syncedPart(await data.read(SYNCED));
      const base = cfg.base || null;
      const m = merge3(base, local, remote ? remote.collections : null);
      if (!sameData(m.collections, local) && !(await data.applySync(m.collections, local))) continue; // changed meanwhile
      let sha = remote ? remote.sha : null;
      if (!remote || !sameData(m.collections, remote.collections)) {
        try {
          sha = await writeRemote(m.collections, sha);
        } catch (e) {
          if (e.kind === 'conflict') continue;
          throw e;
        }
      }
      cfg.base = m.collections;
      cfg.sha = sha;
      cfg.lastSync = now().toISOString();
      save();
      return { conflicts: m.conflicts, renumbered: m.renumbered, pulled: !sameData(m.collections, local), pushed: sha !== (remote && remote.sha) };
    }
    throw new SyncError('conflict', 'other devices kept changing the file; try again');
  }

  // Runs a sync now (or right after the one in flight).
  async function syncNow() {
    if (!cfg) return { off: true };
    if (!token()) {
      setStatus({ state: 'auth', message: 'no token on this device' });
      throw new SyncError('auth', 'no token on this device');
    }
    if (running) { again = true; return running; }
    setStatus({ state: 'syncing' });
    running = (async () => {
      try {
        const r = await once();
        setStatus({ state: 'ok', lastSync: cfg.lastSync, message: null, conflicts: r.conflicts, renumbered: r.renumbered });
        return r;
      } catch (e) {
        setStatus({ state: e.kind === 'auth' ? 'auth' : 'error', message: e.message });
        throw e;
      } finally {
        running = null;
        if (again) { again = false; schedule(0); }
      }
    })();
    return running;
  }

  // A sync shortly after local changes settle.
  function schedule(ms = 4000) {
    if (!cfg || status.state === 'auth') return;
    clearTimeout(timer);
    timer = setTimeout(() => { syncNow().catch(() => {}); }, ms);
  }

  async function setup(repo, path, tok) {
    if (!REPO_RE.test(repo)) throw new SyncError('missing', "'" + repo + "' is not owner/repository");
    const { branch } = await checkRepo(repo, tok);
    store.setLocal('sync-token', tok);
    cfg = { repo, path: path || DEFAULT_PATH, branch, base: null, sha: null, lastSync: null };
    save();
    setStatus({ state: 'idle', message: null, lastSync: null });
    return syncNow();
  }

  async function setToken(tok) {
    if (!cfg) throw new SyncError('missing', 'sync is not set up');
    await checkRepo(cfg.repo, tok);
    store.setLocal('sync-token', tok);
    setStatus({ state: 'idle', message: null });
    return syncNow();
  }

  function off() {
    clearTimeout(timer);
    store.removeLocal('sync');
    store.removeLocal('sync-token');
    cfg = null;
    setStatus({ state: 'off', message: null, lastSync: null });
  }

  return {
    syncNow, schedule, setup, setToken, off,
    get config() { return cfg ? { repo: cfg.repo, path: cfg.path, branch: cfg.branch, lastSync: cfg.lastSync } : null; },
    get status() { return status; },
    get hasToken() { return !!token(); },
    tokenHint() {
      const t = token();
      return t ? t.slice(0, Math.min(11, t.length - 4)) + '…' + t.slice(-4) : null;
    },
  };
}
