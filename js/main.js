import { createLocalStore } from './core/store.js';
import { createData } from './core/data.js';
import { dispatch } from './core/dispatch.js';
import { didYouMean } from './core/completion.js';
import { todayISO, plural } from './core/util.js';
import { THEMES, WIDGETS, isTheme, EXPORT_REMINDER_DAYS } from './core/catalog.js';
import { DAY_NAMES_LONG, MONTH_NAMES, kindSeg } from './core/format.js';
import { daySummary, summaryVisible, summaryRows, summaryCounts, tomorrowLine } from './core/summary.js';
import { createCommands } from './commands/index.js';
import { detectOS, keyLabel } from './core/keys.js';
import { loadDevice } from './core/device.js';
import { newEntryId, makeEntry, visible } from './core/log.js';
import { createSync } from './sync.js';
import { readBounce } from './lib/bounce.js';
import { SYNCED } from './core/merge.js';
import { sweepClip } from './commands/clip.js';
import { isLive, timeLeft } from './core/clip.js';
import { createTranscript } from './ui/transcript.js';
import { createPrompt } from './ui/prompt.js';
import { createPalette } from './ui/palette.js';
import { createGraph } from './ui/graph.js';
import { unwrap, readPrefs, bump, PREFS_KEY } from './core/graph.js';
import { createWidgets } from './ui/widgets.js';
import { h, rich, copyText } from './ui/dom.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const drawerQuery = window.matchMedia('(max-width: 860px)');
// Touch screens: focusing the prompt raises the on-screen keyboard, so the page
// only takes focus when asked (opening the page, tapping the prompt box).
const touchQuery = window.matchMedia('(pointer: coarse)');

const store = createLocalStore();
const data = createData(store);
const state = data.state;
const now = () => new Date();

const transcript = createTranscript($('transcript'), $('turns'), {
  run: (cmd) => { run(cmd); autoFocus(); },
  refocus: () => autoFocus(),
  setInput: (text) => { prompt.set(text); prompt.focus(); },
  onCopyable: (text) => setCopyable(text),
  onExpired: (text) => { if (lastCopyable === text) { lastCopyable = ''; copyEl.hidden = true; } },
});

// The copy button by the prompt: copies the latest result worth copying
// (a calc answer, a uuid, pretty JSON, an epoch …).
const copyEl = $('copy-last');
let lastCopyable = '';
function setCopyable(text) {
  lastCopyable = text;
  copyEl.hidden = false;
  copyEl.title = 'Copy: ' + (text.length > 60 ? text.slice(0, 59) + '…' : text);
  copyEl.textContent = 'copy';
}
copyEl.addEventListener('click', async () => {
  const ok = await copyText(lastCopyable);
  copyEl.textContent = ok ? 'copied' : 'failed';
  setTimeout(() => { copyEl.textContent = 'copy'; }, 1200);
  autoFocus();
});
const fileEl = $('file');

// ---- commands -----------------------------------------------------------------

const device = loadDevice(store, navigator);
const ctxBase = {
  data, store, now,
  os: detectOS(navigator),
  device,
  pageURL: location.origin + location.pathname, // what bounce links point at
  setDeviceName(name) { device.name = name; store.setLocal('device', device); },
  setInput: (text) => { prompt.set(text); prompt.focus(); },
  // After `clear`: drop what isn't stored either, and say how to get it back.
  clearOutput(at, message) {
    transcript.clearUnsaved(at);
    if (message) transcript.notice().head([[message, 'dim'], [' · ', 'faint'], ['undo', 'accent', { run: 'undo' }], [' brings it back', 'faint']]);
  },
  pickFile(accept) {
    return new Promise((resolve) => {
      fileEl.value = '';
      fileEl.accept = accept;
      fileEl.onchange = () => resolve(fileEl.files[0] || null);
      fileEl.oncancel = () => resolve(null);
      fileEl.click();
    });
  },
  download(name, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
  revealPanel(show) { if (show && drawerQuery.matches) setDrawer(true); },
  // Text size for this device (`font`): a factor, 1 = normal.
  fontScale: () => Number(store.getLocal('fontScale')) || 1,
  setFontScale(f) {
    if (f === 1) store.removeLocal('fontScale'); else store.setLocal('fontScale', f);
    root.style.setProperty('--scale', String(f));
    transcript.scroll();
  },
  navigate(url) { location.assign(url); },
  leave(url) { location.replace(url); },
};

// ---- sync ---------------------------------------------------------------------------
// With a private GitHub repo set up (`sync setup`), changes go there a few
// seconds after they are made, and come in when the page opens or comes back
// into view (and every few minutes while it is in view).

const sync = createSync({ data, store, now, device: ctxBase.os, onStatus: (s) => showSyncStatus(s) });
ctxBase.sync = sync;
ctxBase.askSecret = (label) => prompt.askSecret(label);
let authNoticeShown = false;

function showSyncStatus(s) {
  const el = $('status-sync');
  el.hidden = s.state === 'off';
  const look = { ok: ['sync ✓', 'Synced ' + (s.lastSync ? new Date(s.lastSync).toLocaleTimeString() : '')], syncing: ['sync …', 'Syncing'],
    idle: ['sync', 'Waiting to sync'], error: ['sync !', 'Sync failed: ' + (s.message || '')], auth: ['sync !', 'Token refused: run sync token'] }[s.state];
  if (look) { el.textContent = look[0]; el.title = look[1]; }
  el.dataset.state = s.state;
  if (s.state === 'auth' && !authNoticeShown) {
    authNoticeShown = true;
    const out = transcript.notice();
    out.head([['Sync paused', 'strong'], [' · GitHub refused the token (expired or revoked)', 'dim']], 'warn');
    out.line([['Make a new token for the same repository, then run ', 'dim'], ['sync token', 'accent', { run: 'sync token' }]]);
  }
  if (s.state === 'ok') authNoticeShown = false;
}

// A merge from the repo also lands here as a change; the sync that follows
// finds nothing new and only reads.
function syncSoon(ms) {
  if (sync.config) sync.schedule(ms);
}

// ---- shared clip -------------------------------------------------------------------
// A clip from another device is announced once; an expired one is wiped
// (and the wipe syncs).

function announceClip() {
  const c = state.clip;
  if (!isLive(c, now()) || c.device === device.id || store.getLocal('clip-seen') === c.at) return;
  store.setLocal('clip-seen', c.at);
  transcript.notice().head([['Clip from ' + (c.deviceName || 'another device'), 'strong'], [' · ', 'faint'],
    ['clip', 'accent', { run: 'clip' }], [' shows it · ' + timeLeft(c, now()) + ' left', 'dim']], 'info');
}
const sweep = () => sweepClip(data, store, now).catch(() => {});

// ---- shared visual history ------------------------------------------------------------
// What every device ran, merged by time (core/log.js). The view is per device:
// all devices (default), this one, or another one (session show …).

let logView = store.getLocal('logView') || 'all';
function renderLog() {
  transcript.reconcile(visible(state.log, logView, device.id), (e) => ({ other: e.device !== device.id }));
}
ctxBase.logView = () => logView;
ctxBase.setLogView = (v) => {
  logView = v;
  store.setLocal('logView', v);
  renderLog();
};

let currentCtx = ctxBase;
const commands = createCommands(() => currentCtx);
// `pasted`: the texts pasted into the command, one per placeholder (diff takes two).
const ctxFor = (out, pasted) => (currentCtx = Object.assign({}, ctxBase, { out, pasted: pasted || [] }));

// "https://www.google.com/search?q=x" -> "google.com": how an engine is named to the user.
function siteOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
}

const dispatchEnv = () => ({
  isBuiltin: commands.isBuiltin,
  entries: state.aliases.entries,
  defaultEngine: state.aliases.defaultEngine,
});

// Pages opened from the prompt (aliases, searches, later <id> open) wait a
// moment, so a mistyped alias can be stopped: Esc, or running another command,
// cancels. The address bar (?q=) and bounce links still go straight away.
const OPEN_DELAY = 1000;
let pendingOpen = null; // { url, cancel() }

function waitToOpen(url) {
  if (pendingOpen) pendingOpen.cancel();
  return new Promise((resolve) => {
    const done = (go) => { clearTimeout(timer); pendingOpen = null; paintHint(); resolve(go); };
    const timer = setTimeout(() => done(true), OPEN_DELAY);
    pendingOpen = { url, cancel: () => done(false) };
    paintHint();
  });
}
// true when there was something to cancel.
function cancelOpen() {
  if (!pendingOpen) return false;
  pendingOpen.cancel();
  return true;
}

// Called straight from the Enter key handler: nothing before a built-in's
// run() may await, so file pickers still count as user-initiated.
// `shown`: what the transcript echoes when it differs from what runs (a paste
// placeholder instead of the pasted text).
function run(raw, shown, pasted) {
  // `graph <command>` from anywhere but the prompt (a link, ?q=) runs the command.
  if (unwrap(raw) !== null) { raw = unwrap(raw); shown = shown && unwrap(shown) !== null ? unwrap(shown) : shown; }
  const input = raw.trim();
  const echoed = (shown || raw).trim();
  if (!input) return Promise.resolve();
  cancelOpen(); // another command: whatever was about to open doesn't
  // On a phone the drawer covers the output; get it out of the way of the result.
  if (root.classList.contains('drawer-open')) setDrawer(false);
  const res = dispatch(input, dispatchEnv());
  // Every command goes into the shared visual history once it has finished,
  // tagged with this device, except private ones (sync).
  const def = res.kind === 'builtin' ? commands.byName.get(res.name) : null;
  // Help and the like are for now: not in the shared history, gone when the next command runs.
  transcript.dropEphemeral();
  const keep = !(def && (def.private || def.ephemeral));
  const at = now().toISOString();
  const id = newEntryId(device.id, at);
  const out = transcript.turn(echoed, { at, pending: keep ? id : null, ephemeral: !!(def && def.ephemeral) });
  // A shared clip isn't kept for ↑ either.
  const saved = def && def.noHistory ? Promise.resolve() : data.addHistory(input);
  const record = () => (keep ? data.appendLog(makeEntry({ id, at, device: device.id, deviceName: device.name, input: echoed, ops: out.ops })) : Promise.resolve());

  if (res.kind === 'builtin') {
    const ctx = ctxFor(out, pasted);
    // A command alias: the turn says what it ran, so the history shows it.
    if (res.alias) out.line([['→ ', 'faint'], [res.expanded, 'dim']]);
    // A command that opens a page (later <id> open) does it once it is in the history.
    return commands.run(res.name, res.rest, ctx).then(async () => {
      const url = ctx.navigateAfter && /^https?:\/\//i.test(ctx.navigateAfter) ? ctx.navigateAfter : null;
      const go = url ? await waitToOpen(url) : false;
      if (url && !go) out.warn('Cancelled: ' + siteOf(url) + ' not opened');
      await record();
      if (go) { await saved; ctxBase.navigate(url); }
    });
  }
  if (res.kind === 'error') { out.err(res.message); return record(); }

  let target;
  try {
    target = new URL(res.url);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('scheme');
  } catch (e) {
    out.err('Refusing to open ' + res.url);
    return Promise.resolve();
  }
  if (res.kind === 'search') {
    out.head([['Searching ', ''], [siteOf(res.url), 'accent'], [' for ', ''], ['“' + res.query + '”', 'strong']], 'info');
    if (res.fallback) out.dim('No command or alias named ' + input.split(/\s+/)[0] + '; used the default engine (' + res.name + ')');
  } else {
    out.head([['Opening ', ''], [target.host + target.pathname.replace(/\/$/, '') + target.search, 'url']], 'info');
  }
  if (res.note) out.warn(res.note);
  out.dim(res.url);
  // History is written before leaving, so ↑ recalls the command after Back.
  return waitToOpen(target.href).then((go) => {
    if (!go) out.warn('Cancelled: ' + siteOf(target.href) + ' not opened');
    return Promise.all([saved, record()]).then(() => { if (go) ctxBase.navigate(target.href); });
  });
}

// ---- prompt -------------------------------------------------------------------

const completionEnv = () => ({ defs: commands.defs.filter((d) => !d.hidden), entries: state.aliases.entries, history: state.history.items });

const hintEl = $('hint');
// The hint for what's in the prompt now (the prompt repaints it as you type).
function paintHint() {
  hintEl.textContent = '';
  hintEl.appendChild(rich(describe($('prompt').value, '', null, null, null)));
}

function describe(v, ghost, hist, search, secret) {
  if (pendingOpen && !v.trim() && !secret) return [['opening ', 'faint'], [siteOf(pendingOpen.url), 'accent'], [' in 1 s', 'faint'], ['   esc', 'accent'], [' cancels', 'faint']];
  if (secret) return [['hidden input', 'accent'], [' · not shown, not kept in history · ↵ saves · esc cancels', 'faint']];
  if (search) {
    return [['history search ', 'faint'], ['“' + search.query + '”', 'strong'], [': ', 'faint'],
      search.match ? [search.match, 'accent'] : ['no match', 'err'],
      ['   ↵ run · ctrl+r older · tab edit · esc cancel', 'faint']];
  }
  if (hist) return [['history ', 'faint'], [hist.at + '/' + hist.of, 'num'], [' · ↑↓ to walk · esc clears', 'faint']];
  if (graph.view) return graphHint(graph.view, ghost);
  if (!v.trim()) {
    return [['?', 'accent'], [' shortcuts   ', 'faint'], ['/', 'accent'], [' commands   ', 'faint'], ['tab', 'accent'], [' completes', 'faint']];
  }
  const res = dispatch(v, dispatchEnv());
  const tab = ghost ? [['   tab', 'accent'], [' → ' + v.trim().split(/\s+/).pop() + ghost, 'faint']] : [];
  if (res.kind === 'builtin') {
    const def = commands.byName.get(res.name);
    if (res.alias) return [kindSeg('command'), [' ', ''], [res.alias, 'accent'], ['  ↵ runs ', 'faint'], [res.expanded, 'strong'], ...tab];
    return [kindSeg(def.group), [' ', ''], [res.name, 'accent'], [' · ' + def.desc, 'faint'], ...tab];
  }
  if (res.kind === 'redirect') return [kindSeg('alias'), [' ', ''], [res.name, 'accent'], ['  ↵ open ', 'faint'], [res.url, 'url'], ...tab];
  if (res.kind === 'search') {
    const fix = res.fallback ? didYouMean(v.trim().split(/\s+/)[0], completionEnv()) : null;
    return [
      ...(res.fallback ? [] : [kindSeg('engine'), [' ', ''], [res.name, 'accent'], ['  ', '']]),
      ['↵ search ', 'faint'], [siteOf(res.url), 'accent'],
      ...(res.fallback ? [[' (default)', 'faint']] : []),
      [' for ', 'faint'], ['“' + res.query + '”', 'strong'], ...tab,
      ...(fix ? [['   did you mean ', 'faint'], [fix, 'accent'], ['? tab fixes it', 'faint']] : []),
    ];
  }
  return [[res.message, 'err']];
}

// Graph mode (experimental): `graph ` before a command shows the grammar as a
// graph above the prompt (ui/graph.js). Ranking and use counts stay on this device.
const graphPrefs = () => readPrefs(store.getLocal(PREFS_KEY));
const graph = createGraph({
  panel: $('graph'),
  root,
  composer: $('composer'),
  env: () => {
    const p = graphPrefs();
    return { defs: commands.defs, entries: state.aliases.entries, history: state.history.items, counts: p.counts, sort: p.sort };
  },
  onPick: (text) => { prompt.set(text); prompt.focus(); },
  onRun: (keys) => { if (keys.length) store.setLocal(PREFS_KEY, bump(graphPrefs(), keys)); },
});

function graphHint(v, ghost) {
  const enter = v.ambiguous ? [['  ↵', 'accent'], [' runs it as typed', 'faint']]
    : v.run ? [['  ↵', 'accent'], [' runs ', 'faint'], [v.run, 'strong']] : [['  ↵', 'accent'], [' explains graph mode', 'faint']];
  return [['graph mode', 'accent'], ...(ghost ? [['  tab', 'accent'], [' completes', 'faint']] : []), ...enter, ['  esc', 'accent'], [' clears', 'faint']];
}

const prompt = createPrompt({
  input: $('prompt'),
  graph,
  ghostTyped: $('ghost-typed'),
  ghostRest: $('ghost-rest'),
  env: () => completionEnv(),
  history: () => state.history.items,
  hint(v, ghost, hist, search, secret) {
    hintEl.textContent = '';
    hintEl.appendChild(rich(describe(v, ghost, hist, search, secret)));
  },
  onSubmit: run,
  onPalette: () => palette.open(),
  onType: () => transcript.dropEphemeral('completions'),
  doubleTapTab: () => touchQuery.matches,
  onShortcuts: () => run('keys'),
  onEscape() {
    if (cancelOpen()) return true;
    if (root.classList.contains('drawer-open')) { setDrawer(false); return true; }
    return false;
  },
  onList(input, candidates) {
    transcript.dropEphemeral('completions');
    const out = transcript.turn(input, { ephemeral: 'completions' });
    out.head([[plural(candidates.length, 'completion'), 'strong'], [' · keep typing or press tab', 'dim']]);
    out.table(null, candidates.map((c) => [[[c.value, 'accent']], c.kind ? [kindSeg(c.kind)] : [], [[c.label || '', 'dim']]]), { stack: true });
  },
});

// ---- pinned daily summary --------------------------------------------------------
// At the top of the output on every device, each day, until dismissed (the
// dismissal is a setting, so it reaches other devices with the rest).

const pinnedEl = $('pinned');
let pinnedKey = '';
function renderPinned() {
  const today = todayISO(now());
  const show = summaryVisible(state.settings, today);
  const sum = show ? daySummary(state, today) : null;
  const key = show ? JSON.stringify([today, sum.overdue, sum.events, sum.due, sum.tomorrow]) : '';
  if (key === pinnedKey) return;
  pinnedKey = key;
  pinnedEl.hidden = !show;
  pinnedEl.textContent = '';
  if (!show) return;
  const d = now();
  const counts = summaryCounts(sum);
  const rows = summaryRows(sum);
  const MAX = 5;
  pinnedEl.append(
    h('div', { class: 'pin-head' },
      h('span', { class: 'pin-title' }, rich([['Today', 'strong'], [' · ' + DAY_NAMES_LONG[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()], 'dim'],
        ...(counts.length ? [[' · ', 'faint'], ...counts] : [])])),
      h('button', { type: 'button', class: 'pin-close', title: 'Dismiss for today (on every device)', 'aria-label': 'Dismiss for today', 'data-run': 'today dismiss', text: '×' })),
    ...rows.slice(0, MAX).map((r) => h('div', { class: 'pin-row' }, rich(r))),
    h('div', { class: 'pin-row pin-foot' }, rich([
      ...(rows.length ? [] : [['Nothing overdue, due or scheduled today · ', 'dim']]),
      ...(rows.length > MAX ? [['+' + (rows.length - MAX) + ' more · ', 'faint'], ['today', 'accent', { run: 'today' }], [' · ', 'faint']] : []),
      ...tomorrowLine(sum)])),
  );
}
pinnedEl.addEventListener('click', (e) => {
  const link = e.target.closest('[data-run]');
  if (link) { run(link.getAttribute('data-run')); autoFocus(); }
});

// ---- phone key bar ----------------------------------------------------------------
// Touch keyboards have no Esc, Tab, arrows or Ctrl. The keys button under the
// prompt (touch screens only) shows a row of them; the choice is kept on this
// device only.

const KEYBAR = [
  ['esc', 'Escape', 'clear'], ['tab', 'Tab', 'complete'], ['↑', 'ArrowUp', 'older command'], ['↓', 'ArrowDown', 'newer command'],
  ['→', 'ArrowRight', 'accept suggestion'], ['ctrl+r', 'ctrl+r', 'search history'], ['ctrl+w', 'ctrl+w', 'cut word'],
  ['ctrl+u', 'ctrl+u', 'cut to start'], ['ctrl+a', 'ctrl+a', 'line start'], ['ctrl+e', 'ctrl+e', 'line end'],
];
const KEYBAR_PREF = 'browser-hub:keybar';
const keybarEl = $('keybar');
for (const [label, spec, title] of KEYBAR) {
  const b = h('button', { type: 'button', class: 'kb', 'data-key': spec, title, 'aria-label': title, text: keyLabel(label, ctxBase.os) });
  // Keep focus (and the on-screen keyboard) where it is.
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', () => prompt.press(spec));
  keybarEl.appendChild(b);
}
function setKeybar(on) {
  keybarEl.hidden = !on;
  $('keys-toggle').setAttribute('aria-pressed', String(on));
  try { if (on) localStorage.setItem(KEYBAR_PREF, '1'); else localStorage.removeItem(KEYBAR_PREF); } catch (e) { /* not saved */ }
}
$('keys-toggle').addEventListener('click', () => setKeybar(keybarEl.hidden));
try { setKeybar(touchQuery.matches && localStorage.getItem(KEYBAR_PREF) === '1'); } catch (e) { setKeybar(false); }

// ---- palette ------------------------------------------------------------------

const palette = createPalette({
  root: $('palette'),
  input: $('palette-input'),
  list: $('palette-list'),
  source() {
    // `section` heads the group when nothing is typed; `kind` is the label on each row.
    const items = commands.defs.filter((d) => !d.hidden).map((d) => ({ name: d.name, desc: d.desc, kind: d.group, section: 'Built-in · ' + d.group, insert: d.name + ' ' }));
    const mine = state.aliases.entries.filter((e) => !commands.isBuiltin(e.name)).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of mine.filter((x) => x.template)) items.push({ name: e.name, desc: e.template, kind: 'engine', section: 'Your search engines', insert: e.name + ' ' });
    for (const e of mine.filter((x) => !x.template)) items.push({ name: e.name, desc: e.command || e.base, kind: e.command ? 'command' : 'alias', section: 'Your aliases', insert: e.name + ' ' });
    for (const t of THEMES) items.push({ name: 'theme ' + t.id, desc: t.desc, kind: 'theme', section: 'Themes', run: true });
    for (const w of WIDGETS) {
      const isOn = state.settings.widgets.includes(w.id);
      items.push({ name: 'widgets ' + w.id + (isOn ? ' off' : ' on'), desc: (isOn ? 'hide: ' : 'show: ') + w.desc, kind: 'widget', section: 'Widgets', run: true });
    }
    return items;
  },
  onPick(item) {
    prompt.focus();
    if (item.run) run(item.name);
    else prompt.set(item.insert);
  },
  onClose: () => prompt.focus(),
});

// ---- theme and panel ------------------------------------------------------------

function applySettings() {
  const s = state.settings;
  root.setAttribute('data-theme', isTheme(s.theme) ? s.theme : 'auto');
  if (s.panel) root.removeAttribute('data-panel'); else root.setAttribute('data-panel', 'hidden');
  $('status-engine').textContent = state.aliases.defaultEngine;
  $('panel-toggle').setAttribute('aria-pressed', drawerQuery.matches ? String(root.classList.contains('drawer-open')) : String(!!s.panel));
}

function setDrawer(open) {
  root.classList.toggle('drawer-open', open);
  $('scrim').hidden = !open;
  applySettings();
  if (!open) autoFocus();
}

$('status-sync').addEventListener('click', () => { run('sync'); autoFocus(); });

$('panel-toggle').addEventListener('click', () => {
  if (drawerQuery.matches) setDrawer(!root.classList.contains('drawer-open'));
  else data.mutate('settings', (d) => { d.panel = !d.panel; }).catch((e) => transcript.notice().err(e.message));
  autoFocus();
});
$('scrim').addEventListener('click', () => setDrawer(false));
$('panel-close').addEventListener('click', () => setDrawer(false));
drawerQuery.addEventListener('change', () => setDrawer(false));

const widgets = createWidgets({
  listEl: $('widgets'),
  data, store, now,
  run: (cmd) => { if (drawerQuery.matches) setDrawer(false); run(cmd); autoFocus(); },
  setInput: (text) => { if (drawerQuery.matches) setDrawer(false); ctxBase.setInput(text); },
  onClose: (id) => run('widgets ' + id + ' off'),
});

data.onChange((col) => {
  if (col === null || col === 'log') renderLog();
  if (col === null || col === 'clip') announceClip();
  if (col === null || SYNCED.includes(col)) syncSoon(4000);
  if (col === null || col === 'settings' || col === 'aliases') applySettings();
  renderPinned();
  widgets.render();
  prompt.update();
});

// ---- the on-screen keyboard ---------------------------------------------------------
// On a phone the keyboard covers the bottom of the page without resizing it
// (iOS), so the prompt could sit underneath until typing scrolled it into view.
// The app is sized to the visible part instead (the visual viewport) and the
// page kept at the top, so the prompt rests right on top of the keyboard.

const viewport = window.visualViewport;
function fitViewport() {
  if (!viewport) return;
  if (viewport.scale > 1.01) { root.style.removeProperty('--app-h'); return; } // pinch-zoomed: leave the layout alone
  const stick = transcript.atBottom();
  root.style.setProperty('--app-h', Math.round(viewport.height) + 'px');
  if (window.scrollY || viewport.offsetTop) window.scrollTo(0, 0);
  if (stick) transcript.scroll();
}
if (viewport) {
  viewport.addEventListener('resize', fitViewport);
  viewport.addEventListener('scroll', fitViewport);
  $('prompt').addEventListener('focus', () => { fitViewport(); setTimeout(fitViewport, 300); }); // after the keyboard's animation
  fitViewport();
}

// ---- focus and tab lifecycle -------------------------------------------------------

// Refocus that happens on its own (after a widget action, a drawer closing,
// coming back to the tab). Skipped on touch screens so the keyboard stays down.
function autoFocus() {
  if (!touchQuery.matches && !palette.isOpen) prompt.focus();
}

document.addEventListener('click', (e) => {
  if (palette.isOpen) {
    if (!$('palette').contains(e.target)) palette.close();
    return;
  }
  if (touchQuery.matches) {
    // A tap anywhere outside the prompt box dismisses the keyboard; tapping
    // the box (not just the text field) brings it back. The key bar and its
    // toggle leave it as it is.
    if (e.target.closest('#keybar, #keys-toggle')) return;
    if (e.target.closest('.prompt-box')) prompt.focus();
    else if (!e.target.closest('input, textarea, select')) prompt.blur();
    return;
  }
  if (e.target.closest('a, button, input, textarea, select, label')) return;
  if (drawerQuery.matches && $('panel').contains(e.target)) return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return;
  prompt.focus();
});

window.addEventListener('focus', autoFocus);

// Esc cancels a page about to open, wherever the focus is (the prompt handles its own).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target !== $('prompt') && cancelOpen()) e.preventDefault();
});

window.addEventListener('pageshow', (e) => {
  // Also fires when Safari restores the page from the back-forward cache:
  // clear whatever was left in the prompt and take focus again.
  prompt.reset();
  // ...except a command handed over by the address bar (see fromAddressBar).
  if (prefill) { prompt.set(prefill); prefill = null; }
  if (!palette.isOpen) prompt.focus();
  if (e.persisted) reloadAll();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    reloadAll();
    syncSoon(300);
    widgets.start();
    autoFocus();
  } else {
    widgets.stop();
  }
});

function reloadAll() {
  return data.load().catch(() => { /* keep what we have */ });
}

store.subscribe((col) => { data.reload(col).catch(() => {}); });

// ---- start -------------------------------------------------------------------------

async function start() {
  prompt.focus();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* optional */ }

  let loadError = null;
  try {
    await data.load();
  } catch (e) {
    loadError = e;
    store.put = async () => { throw new Error('writes are disabled: ' + e.message); };
  }
  applySettings();
  widgets.render();
  widgets.start();

  const hour = now().getHours();
  const greet = (hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening') +
    (state.settings.name ? ', ' + state.settings.name : '');
  transcript.welcome([
    [[greet, 'strong'], [' · ' + device.name, 'faint']],
    [['help', 'accent'], [' for commands · ', 'dim'], ['find', 'accent'], [' searches everything · ', 'dim'], ['/', 'accent'], [' palette · ', 'dim'],
      ['?', 'accent'], [' keys · anything else searches ', 'dim'], [state.aliases.defaultEngine, 'accent']],
  ]);
  renderLog();
  renderPinned();
  setInterval(renderPinned, 60000); // a new day brings a new summary
  sweep();
  setInterval(sweep, 20000);
  showSyncStatus(sync.status);
  syncSoon(0);
  setInterval(() => { if (document.visibilityState === 'visible') syncSoon(0); }, 5 * 60000);

  const notices = [];
  if (!store.persistent) notices.push(['warn', 'Storage is unavailable (private browsing?); nothing will be saved']);
  if (loadError) notices.push(['err', loadError.message + '; changes are disabled']);
  const age = data.exportAgeDays();
  if (age !== null && age >= EXPORT_REMINDER_DAYS) {
    notices.push(['warn', (state.meta.lastExport ? 'Last export was ' + plural(age, 'day') + ' ago' : 'No export yet; your data is ' + plural(age, 'day') + ' old') +
      '. Browsers can evict site storage: run export']);
  }
  for (const e of state.aliases.entries) {
    if (commands.isBuiltin(e.name)) notices.push(['warn', "Alias '" + e.name + "' is shadowed by a built-in command and is inactive"]);
  }
  if (notices.length) {
    const out = transcript.notice();
    out.head(plural(notices.length, 'notice'), notices.some((n) => n[0] === 'err') ? 'err' : 'warn');
    for (const [kind, text] of notices) out[kind](text);
  }

  if (!(await fromBounceLink())) fromAddressBar();
  transcript.scroll(); // the latest at the bottom, history above
  prompt.update();
  prompt.focus();
}

// `?go=<payload>.<signature>`: a bounce link (lib/bounce.js). Made with one of
// your keys: off to the target straight away. Anyone else's (or a forged one):
// the page shows where it leads and waits for a tap.
async function fromBounceLink() {
  const params = new URLSearchParams(location.search);
  if (!params.has('go')) return false;
  history.replaceState(null, '', location.pathname + location.hash);
  let r;
  try {
    r = await readBounce(params.get('go'), state.settings.bounceKeys);
  } catch (e) {
    transcript.notice().err('This bounce link is damaged: ' + e.message);
    return true;
  }
  const host = new URL(r.url).host;
  if (r.signed) {
    transcript.notice().head([['Bouncing to ', ''], [host, 'url']], 'info');
    ctxBase.leave(r.url);
    return true;
  }
  const out = transcript.notice();
  out.head([['This link goes to ', ''], [host, 'strong']], 'warn');
  out.line([[r.url, 'url']]);
  out.el.querySelector('.body').appendChild(h('div', { class: 'bounce-go' },
    h('a', { class: 'bounce-continue', href: r.url, rel: 'noopener noreferrer', text: 'Continue to ' + host + ' →' })));
  out.dim("It wasn't made on one of your devices, so it waits for you: continue only if you trust where it goes");
  return true;
}

// `?q=<input>`: the page as a browser search engine. Aliases, engines and
// searches go straight to their target (replacing this entry, so Back skips
// the hub). Built-in commands are only put into the prompt: any site can link
// here with a ?q=, and that must never be able to change or delete data.
let prefill = null;
function fromAddressBar() {
  const params = new URLSearchParams(location.search);
  const q = (params.get('q') || '').trim();
  if (!params.has('q')) return;
  history.replaceState(null, '', location.pathname + location.hash);
  if (!q) return;
  const res = dispatch(q, dispatchEnv());
  if (res.kind === 'redirect' || res.kind === 'search') {
    let target;
    try { target = new URL(res.url); } catch (e) { target = null; }
    if (target && (target.protocol === 'http:' || target.protocol === 'https:')) {
      transcript.notice().head([['Opening ', ''], [target.href, 'url']], 'info');
      data.addHistory(q).finally(() => ctxBase.leave(target.href));
      return;
    }
  }
  prompt.set(q);
  prefill = q; // pageshow may still be on its way, and it clears the prompt
  if (res.kind === 'builtin') {
    transcript.notice().head([['From the address bar: ', 'dim'], [q, 'strong'], [' · press Enter to run it', 'dim']], 'info');
  }
}

window.CC = { run, data, commands }; // handy from the console and for tests
start();
