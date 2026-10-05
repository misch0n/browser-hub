import { createLocalStore } from './core/store.js';
import { createData } from './core/data.js';
import { dispatch } from './core/dispatch.js';
import { todayISO, plural } from './core/util.js';
import { THEMES, WIDGETS, isTheme, EXPORT_REMINDER_DAYS } from './core/catalog.js';
import { DAY_NAMES_LONG, MONTH_NAMES } from './core/format.js';
import { createCommands } from './commands/index.js';
import { SHORTCUTS } from './commands/meta.js';
import { createTranscript } from './ui/transcript.js';
import { createPrompt } from './ui/prompt.js';
import { createPalette } from './ui/palette.js';
import { createWidgets } from './ui/widgets.js';
import { rich } from './ui/dom.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const drawerQuery = window.matchMedia('(max-width: 860px)');

const store = createLocalStore();
const data = createData(store);
const state = data.state;
const now = () => new Date();

const transcript = createTranscript($('transcript'), $('turns'));
const fileEl = $('file');

// ---- commands -----------------------------------------------------------------

const ctxBase = {
  data, store, now,
  setInput: (text) => { prompt.set(text); prompt.focus(); },
  clearOutput: () => transcript.clear(),
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
  navigate(url) { location.assign(url); },
};

let currentCtx = ctxBase;
const commands = createCommands(() => currentCtx);
const ctxFor = (out) => (currentCtx = Object.assign({}, ctxBase, { out }));

const dispatchEnv = () => ({
  isBuiltin: commands.isBuiltin,
  entries: state.aliases.entries,
  defaultEngine: state.aliases.defaultEngine,
});

// Called straight from the Enter key handler: nothing before a built-in's
// run() may await, so file pickers still count as user-initiated.
function run(raw) {
  const input = raw.trim();
  if (!input) return Promise.resolve();
  // On a phone the drawer covers the output; get it out of the way of the result.
  if (root.classList.contains('drawer-open')) setDrawer(false);
  const out = transcript.turn(input);
  const res = dispatch(input, dispatchEnv());
  const saved = data.addHistory(input);

  if (res.kind === 'builtin') return commands.run(res.name, res.rest, ctxFor(out));
  if (res.kind === 'error') { out.err(res.message); return Promise.resolve(); }

  let target;
  try {
    target = new URL(res.url);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('scheme');
  } catch (e) {
    out.err('Refusing to open ' + res.url);
    return Promise.resolve();
  }
  if (res.kind === 'search') {
    out.head([['Searching ', ''], [res.name, 'accent'], [' for ', ''], ['“' + input + '”', 'strong']], 'info');
  } else {
    out.head([['Opening ', ''], [target.host + target.pathname.replace(/\/$/, '') + target.search, 'url']], 'info');
  }
  if (res.note) out.warn(res.note);
  out.dim(res.url);
  // History is written before leaving, so ↑ recalls the command after Back.
  return saved.then(() => ctxBase.navigate(res.url));
}

// ---- prompt -------------------------------------------------------------------

const hintEl = $('hint');

function describe(v, ghost, hist) {
  if (hist) return [['history ', 'faint'], [hist.at + '/' + hist.of, 'num'], [' · ↑↓ to walk · esc clears', 'faint']];
  if (!v.trim()) {
    return [['?', 'accent'], [' shortcuts   ', 'faint'], ['/', 'accent'], [' commands   ', 'faint'], ['tab', 'accent'], [' completes', 'faint']];
  }
  const res = dispatch(v, dispatchEnv());
  const tab = ghost ? [['   tab', 'accent'], [' → ' + v.trim().split(/\s+/).pop() + ghost, 'faint']] : [];
  if (res.kind === 'builtin') {
    const def = commands.byName.get(res.name);
    return [[res.name, 'accent'], [' · ' + def.desc, 'faint'], ...tab];
  }
  if (res.kind === 'redirect') return [['↵ open ', 'faint'], [res.url, 'url'], ...tab];
  if (res.kind === 'search') return [['↵ search ', 'faint'], [res.name, 'accent'], ...tab];
  return [[res.message, 'err']];
}

const prompt = createPrompt({
  input: $('prompt'),
  ghostTyped: $('ghost-typed'),
  ghostRest: $('ghost-rest'),
  env: () => ({ defs: commands.defs, entries: state.aliases.entries, history: state.history.items }),
  history: () => state.history.items,
  hint(v, ghost, hist) {
    hintEl.textContent = '';
    hintEl.appendChild(rich(describe(v, ghost, hist)));
  },
  onSubmit: run,
  onPalette: () => palette.open(),
  onShortcuts() {
    const out = transcript.turn('?');
    out.head([['Shortcuts', 'strong']]);
    out.kv(SHORTCUTS.map(([k, v]) => [k, [[v, 'dim']]]));
  },
  onEscape() {
    if (root.classList.contains('drawer-open')) { setDrawer(false); return true; }
    return false;
  },
  onList(input, candidates) {
    const out = transcript.turn(input);
    out.head([[plural(candidates.length, 'completion'), 'strong'], [' · keep typing or press tab', 'dim']]);
    out.table(null, candidates.map((c) => [[[c.value, 'accent']], [[c.label || '', 'dim']]]));
  },
});

// ---- palette ------------------------------------------------------------------

const palette = createPalette({
  root: $('palette'),
  input: $('palette-input'),
  list: $('palette-list'),
  source() {
    const items = commands.defs.map((d) => ({ name: d.name, desc: d.desc, kind: d.group.toLowerCase(), insert: d.name + ' ' }));
    for (const e of state.aliases.entries) {
      if (!commands.isBuiltin(e.name)) items.push({ name: e.name, desc: e.template || e.base, kind: e.template ? 'engine' : 'alias', insert: e.name + ' ' });
    }
    for (const t of THEMES) items.push({ name: 'theme ' + t.id, desc: t.desc, kind: 'theme', run: true });
    for (const w of WIDGETS) items.push({ name: 'widgets ' + w.id, desc: (state.settings.widgets.includes(w.id) ? 'hide: ' : 'show: ') + w.desc, kind: 'widget', run: true });
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
  if (!open) prompt.focus();
}

$('panel-toggle').addEventListener('click', () => {
  if (drawerQuery.matches) setDrawer(!root.classList.contains('drawer-open'));
  else data.mutate('settings', (d) => { d.panel = !d.panel; }).catch((e) => transcript.notice().err(e.message));
  prompt.focus();
});
$('scrim').addEventListener('click', () => setDrawer(false));
$('panel-close').addEventListener('click', () => setDrawer(false));
drawerQuery.addEventListener('change', () => setDrawer(false));

const widgets = createWidgets({
  listEl: $('widgets'),
  data, store, now,
  run: (cmd) => { if (drawerQuery.matches) setDrawer(false); run(cmd); prompt.focus(); },
  setInput: (text) => { if (drawerQuery.matches) setDrawer(false); ctxBase.setInput(text); },
  onClose: (id) => run('widgets ' + id + ' off'),
});

data.onChange((col) => {
  if (col === null || col === 'settings' || col === 'aliases') applySettings();
  widgets.render();
  prompt.update();
});

// ---- focus and tab lifecycle -------------------------------------------------------

document.addEventListener('click', (e) => {
  if (palette.isOpen) {
    if (!$('palette').contains(e.target)) palette.close();
    return;
  }
  if (e.target.closest('a, button, input, textarea, select, label')) return;
  if (drawerQuery.matches && $('panel').contains(e.target)) return;
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) return;
  prompt.focus();
});

window.addEventListener('focus', () => { if (!palette.isOpen) prompt.focus(); });

window.addEventListener('pageshow', (e) => {
  // Also fires when Safari restores the page from the back-forward cache:
  // clear whatever was left in the prompt and take focus again.
  prompt.reset();
  if (!palette.isOpen) prompt.focus();
  if (e.persisted) reloadAll();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    reloadAll();
    widgets.start();
    if (!palette.isOpen) prompt.focus();
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

  const d = now();
  const today = todayISO(d);
  const events = state.events.items.filter((e) => e.date === today).length;
  const open = state.tasks.items.filter((t) => !t.done);
  const due = open.filter((t) => t.due === today).length;
  const overdue = open.filter((t) => t.due && t.due < today).length;
  const summary = [[DAY_NAMES_LONG[d.getDay()] + ' ' + d.getDate() + ' ' + MONTH_NAMES[d.getMonth()], 'dim']];
  if (events) summary.push([' · ', 'faint'], [plural(events, 'event') + ' today', 'date']);
  if (due) summary.push([' · ', 'faint'], [due + ' due today', 'warn']);
  if (overdue) summary.push([' · ', 'faint'], [overdue + ' overdue', 'err']);
  transcript.welcome([
    [['help', 'accent'], [' for commands · ', 'dim'], ['/', 'accent'], [' palette · ', 'dim'], ['?', 'accent'], [' shortcuts · anything else searches ', 'dim'], [state.aliases.defaultEngine, 'accent']],
    summary,
  ]);

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

  prompt.update();
  prompt.focus();
}

window.CC = { run, data, commands }; // handy from the console and for tests
start();
