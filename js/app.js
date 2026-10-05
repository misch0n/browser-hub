(function (CC) {
  'use strict';

  const EXPORT_REMINDER_DAYS = 14;
  const MAX_ROWS = 500;

  const $ = (id) => document.getElementById(id);
  const outputEl = $('output');
  const promptEl = $('prompt');
  const ghostTyped = $('ghost-typed');
  const ghostRest = $('ghost-rest');
  const paletteEl = $('palette');
  const paletteInput = $('palette-input');
  const paletteList = $('palette-list');
  const fileEl = $('file');

  const store = CC.store.createLocalStore();
  const data = CC.createData(store);
  const now = () => new Date();
  const state = data.state;

  // ---- output ---------------------------------------------------------------

  function row(cls) {
    const d = document.createElement('div');
    d.className = 'row' + (cls ? ' ' + cls : '');
    outputEl.appendChild(d);
    while (outputEl.childElementCount > MAX_ROWS) outputEl.firstElementChild.remove();
    return d;
  }

  const scroll = () => { outputEl.scrollTop = outputEl.scrollHeight; };

  const out = {
    line(text, cls) { row(cls).textContent = text; scroll(); },
    parts(list) {
      const d = row();
      for (const [text, cls] of list) {
        if (!text) continue;
        const s = document.createElement('span');
        if (cls) s.className = cls;
        s.textContent = text;
        d.appendChild(s);
      }
      scroll();
    },
    echo(text) {
      const d = row('echo');
      const g = document.createElement('span');
      g.className = 'glyph';
      g.textContent = '❯ ';
      d.appendChild(g);
      d.appendChild(document.createTextNode(text));
      scroll();
    },
  };
  for (const cls of ['err', 'ok', 'warn', 'dim']) out[cls] = (text) => out.line(text, cls);

  // ---- context handed to commands --------------------------------------------

  const ctx = {
    out, data, store, now,
    setInput(text) {
      promptEl.value = text;
      promptEl.setSelectionRange(text.length, text.length);
      updateGhost();
    },
    clearOutput() { outputEl.textContent = ''; },
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
    navigate(url) { location.assign(url); },
  };

  const commands = CC.createCommands(() => ctx);

  const dispatchEnv = () => ({
    isBuiltin: commands.isBuiltin,
    entries: state.aliases.entries,
    defaultEngine: state.aliases.defaultEngine,
  });

  const completionEnv = () => ({
    defs: commands.defs,
    entries: state.aliases.entries,
    history: state.history.items,
  });

  // ---- running input ----------------------------------------------------------

  // Called straight from the Enter key handler: nothing before the built-in's
  // `run` may await, so file pickers still count as user-initiated.
  function run(raw) {
    const input = raw.trim();
    out.echo(raw);
    if (!input) return Promise.resolve();
    const res = CC.dispatch(input, dispatchEnv());
    const saved = data.addHistory(input);

    if (res.kind === 'builtin') return commands.run(res.name, res.rest, ctx);
    if (res.kind === 'error') { out.err(res.message); return Promise.resolve(); }
    return saved.then(() => go(res));
  }

  function go(res) {
    try {
      const u = new URL(res.url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad scheme');
    } catch (e) {
      out.err('refusing to open ' + res.url);
      return;
    }
    if (res.note) out.warn(res.note);
    out.dim('→ ' + res.url);
    ctx.navigate(res.url);
  }

  // ---- prompt: ghost text, completion, history ------------------------------

  function updateGhost() {
    const v = promptEl.value;
    ghostTyped.textContent = '';
    ghostRest.textContent = '';
    if (!v || promptEl.selectionStart !== v.length || promptEl.selectionEnd !== v.length) return;
    const { token, candidates } = CC.completion.complete(v, completionEnv());
    if (!token || !candidates.length) return;
    const rest = candidates[0].value.slice(token.length);
    if (!rest) return;
    ghostTyped.textContent = v;
    ghostRest.textContent = rest;
  }

  function handleTab() {
    const r = CC.completion.applyTab(promptEl.value, completionEnv());
    if (r.input !== undefined) {
      ctx.setInput(r.input);
    } else if (r.list) {
      out.echo(promptEl.value);
      const w = Math.max.apply(null, r.list.map((c) => c.value.length)) + 2;
      for (const c of r.list) out.parts([[c.value.padEnd(w), 'accent'], [c.label || '', 'dim']]);
    }
  }

  let histIdx = -1;
  let draft = '';

  function walkHistory(dir) {
    const items = state.history.items;
    if (dir < 0) {
      if (!items.length) return;
      if (histIdx === -1) { draft = promptEl.value; histIdx = items.length; }
      if (histIdx > 0) histIdx--;
      ctx.setInput(items[histIdx]);
    } else {
      if (histIdx === -1) return;
      histIdx++;
      if (histIdx >= items.length) { histIdx = -1; ctx.setInput(draft); } else ctx.setInput(items[histIdx]);
    }
  }

  promptEl.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    switch (e.key) {
      case 'Enter': {
        e.preventDefault();
        const v = promptEl.value;
        histIdx = -1;
        ctx.setInput('');
        run(v);
        break;
      }
      case 'Tab':
        e.preventDefault(); // focus never leaves the prompt
        handleTab();
        break;
      case 'ArrowUp': e.preventDefault(); walkHistory(-1); break;
      case 'ArrowDown': e.preventDefault(); walkHistory(1); break;
      case 'Escape':
        e.preventDefault();
        histIdx = -1;
        ctx.setInput('');
        break;
      case '/':
        if (promptEl.value === '' && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          openPalette();
        }
        break;
      default:
    }
  });

  promptEl.addEventListener('input', () => { histIdx = -1; updateGhost(); });
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === promptEl) updateGhost();
  });

  // ---- command palette --------------------------------------------------------

  let palItems = [];
  let palSel = 0;

  function fuzzy(q, s) {
    let qi = 0, score = 0, last = -2;
    for (let i = 0; i < s.length && qi < q.length; i++) {
      if (s[i] === q[qi]) { score += (i === last + 1 ? 5 : 1) + (i === 0 ? 3 : 0); last = i; qi++; }
    }
    return qi === q.length ? score - s.length * 0.01 : -1;
  }

  function paletteSource() {
    const items = commands.defs.map((d) => ({ name: d.name, desc: d.desc }));
    for (const e of state.aliases.entries) {
      if (!commands.isBuiltin(e.name)) items.push({ name: e.name, desc: e.template ? 'engine' : 'alias' });
    }
    return items;
  }

  function renderPalette() {
    const q = paletteInput.value.toLowerCase().replace(/\s+/g, '');
    palItems = paletteSource()
      .map((it) => {
        const n = fuzzy(q, it.name);
        const d = n < 0 ? fuzzy(q, it.desc.toLowerCase()) * 0.3 : n;
        return { it, score: q ? (n >= 0 ? n + 10 : d) : 0, ok: !q || n >= 0 || d > 0 };
      })
      .filter((x) => x.ok)
      .sort((a, b) => b.score - a.score || (a.it.name < b.it.name ? -1 : 1))
      .map((x) => x.it);
    palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
    paletteList.textContent = '';
    palItems.forEach((it, i) => {
      const li = document.createElement('li');
      if (i === palSel) li.className = 'selected';
      const n = document.createElement('span');
      n.className = 'name';
      n.textContent = it.name;
      const d = document.createElement('span');
      d.className = 'desc';
      d.textContent = it.desc;
      li.append(n, d);
      li.addEventListener('mousedown', (ev) => { ev.preventDefault(); pickPalette(i); });
      paletteList.appendChild(li);
    });
    const sel = paletteList.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function openPalette() {
    paletteEl.hidden = false;
    paletteInput.value = '';
    palSel = 0;
    renderPalette();
    paletteInput.focus();
  }

  function closePalette() {
    paletteEl.hidden = true;
    promptEl.focus();
  }

  function pickPalette(i) {
    const it = palItems[i];
    closePalette();
    if (it) ctx.setInput(it.name + ' ');
  }

  paletteInput.addEventListener('input', () => { palSel = 0; renderPalette(); });
  paletteInput.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if (e.key === 'Enter') { e.preventDefault(); pickPalette(palSel); }
    else if (e.key === 'Tab') e.preventDefault();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!palItems.length) return;
      palSel = (palSel + (e.key === 'ArrowDown' ? 1 : -1) + palItems.length) % palItems.length;
      renderPalette();
    }
  });

  // ---- focus -------------------------------------------------------------------

  function focusPrompt() {
    if (!paletteEl.hidden) return;
    promptEl.focus();
  }

  document.addEventListener('click', (e) => {
    if (!paletteEl.hidden) {
      if (!paletteEl.contains(e.target)) closePalette();
      return;
    }
    if (e.target.closest('a, button, input')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    promptEl.focus();
  });

  window.addEventListener('focus', focusPrompt);

  window.addEventListener('pageshow', () => {
    // Also fires when Safari restores the page from the back-forward cache.
    ctx.setInput('');
    histIdx = -1;
    focusPrompt();
    reloadAll();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { focusPrompt(); reloadAll(); }
  });

  function reloadAll() {
    return data.load().then(updateGhost, () => { /* keep what we have */ });
  }

  store.subscribe((col) => { data.reload(col).then(updateGhost, () => {}); });

  // ---- start -------------------------------------------------------------------

  const plural = CC.util.plural;

  async function start() {
    focusPrompt();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* optional */ }

    if (!store.persistent) out.warn('storage is unavailable (private browsing?); nothing will be saved');
    try {
      await data.load();
    } catch (e) {
      out.err(e.message);
      store.put = async () => { throw new Error('writes are disabled: ' + e.message); };
    }

    const age = data.exportAgeDays();
    if (age !== null && age >= EXPORT_REMINDER_DAYS) {
      out.warn((state.meta.lastExport ? 'last export was ' + plural(age, 'day') + ' ago' : 'no export yet (data is ' + plural(age, 'day') + ' old)') +
        '; browsers can evict site storage, so run: export');
    }
    for (const e of state.aliases.entries) {
      if (commands.isBuiltin(e.name)) out.warn("alias '" + e.name + "' is shadowed by a built-in command and is inactive");
    }

    const today = CC.util.todayISO(now());
    const events = state.events.items.filter((e) => e.date === today).length;
    const open = state.tasks.items.filter((t) => !t.done && t.due);
    const dueToday = open.filter((t) => t.due === today).length;
    const overdue = open.filter((t) => t.due < today).length;
    const bits = [];
    if (events) bits.push(plural(events, 'event') + ' today');
    if (dueToday) bits.push(plural(dueToday, 'task') + ' due today');
    if (overdue) bits.push(overdue + ' overdue');
    out.dim(bits.length ? bits.join(' · ') + ' — run: agenda' : "type 'help' for commands");

    updateGhost();
    focusPrompt();
  }

  CC.app = { run, ctx, data, commands };
  start();
})((globalThis.CC = globalThis.CC || {}));
