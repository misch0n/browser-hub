import { h, rich, copyButton } from './dom.js';
import { monthGrid } from './components.js';
import { jsonLines } from '../core/format.js';
import { oneValue, quote } from '../core/args.js';

const MAX_TURNS = 400;

// The Out methods that draw something: recorded, so a turn can be stored in
// the shared history and drawn again later, on any device.
const RECORDED = ['head', 'tone', 'line', 'ok', 'info', 'warn', 'err', 'dim', 'section', 'table', 'kv', 'fields', 'code', 'value', 'calendar'];
const plain = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));

// The scrolling conversation: each command is a turn with the echoed input
// and a reply in the Claude CLI shape:
//
//   › tasks
//   ● 3 open tasks · 1 overdue          <- head, bullet coloured by outcome
//     └ ID  DUE        TASK             <- body, tables / lines / key-values
//
// The Out object below is the whole output API commands use.
//
// opts.run(command) runs a command as if typed: used by links on ids and by
// values edited in place, so every change shows up as the command it is.
// opts.onCopyable(text) hears about each result worth copying (the copy
// button by the prompt copies the latest).
export function createTranscript(scrollEl, listEl, opts = {}) {
  const atBottom = () => scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 40;
  const scroll = () => { scrollEl.scrollTop = scrollEl.scrollHeight; };

  function append(el) {
    const stick = atBottom();
    listEl.appendChild(el);
    while (listEl.childElementCount > MAX_TURNS) listEl.querySelector('.turn').remove();
    if (stick || el.classList.contains('turn')) scroll();
  }

  // The echoed input, with where and when it ran when that isn't here and now.
  function echo(input, meta = {}) {
    return h('div', { class: 'you', title: meta.at ? new Date(meta.at).toLocaleString() + (meta.deviceName ? ' · ' + meta.deviceName : '') : null },
      h('span', { class: 'caret', 'aria-hidden': 'true', text: '›' }), h('span', { class: 'you-text', text: input }),
      meta.other ? h('span', { class: 'you-device', text: meta.deviceName || 'another device' }) : null);
  }

  listEl.addEventListener('click', (e) => {
    const link = e.target.closest('[data-run]');
    if (!link || !opts.run) return;
    // Dragging across a row to copy its text is not a tap.
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && link.contains(sel.anchorNode)) return;
    opts.run(link.getAttribute('data-run'));
  });

  // A field value that turns into a text box when tapped. Enter (or leaving
  // the box with a changed value) runs `<command> <new value>`; Esc cancels.
  function editable(content, edit) {
    const btn = h('button', { type: 'button', class: 'editable', title: 'Edit · ' + edit.command }, rich(content));
    btn.addEventListener('click', () => {
      const input = h('input', {
        type: 'text', class: 'edit-input', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off',
        spellcheck: 'false', enterkeyhint: 'done', 'aria-label': edit.command,
      });
      input.value = edit.current;
      btn.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        const v = input.value;
        input.replaceWith(btn);
        if (save && v !== edit.current && opts.run) {
          // Quote only when the value wouldn't read back as typed.
          opts.run(edit.command + ' ' + (oneValue(v) === v ? v : quote(v)));
        } else if (opts.refocus) {
          opts.refocus();
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
    });
    // `<thing> <id> edit`: start editing the first field straight away.
    if (edit.open) setTimeout(() => { if (btn.isConnected) btn.click(); }, 0);
    return btn;
  }

  function makeOut(turnEl, mode = {}) {
    let reply = null, main = null, body = null, headEl = null;
    let tone = null;

    function ensure() {
      if (reply) return;
      body = h('div', { class: 'body' });
      main = h('div', { class: 'main' }, body);
      reply = h('div', { class: 'reply', 'data-tone': 'neutral' }, h('span', { class: 'bullet', 'aria-hidden': 'true', text: '●' }), main);
      turnEl.appendChild(reply);
    }

    function setTone(t, strong) {
      ensure();
      if (!t) return;
      // Errors win over warnings, warnings over everything else.
      const rank = { err: 3, warn: 2 };
      if ((rank[t] || 0) >= (rank[tone] || 0) && (strong || rank[t] || !tone)) tone = t;
      reply.setAttribute('data-tone', tone);
    }

    // Follow the output only if the reader was already at the bottom, so
    // scrolling back to read something isn't yanked away by new lines.
    function push(el) {
      const stick = atBottom();
      ensure();
      body.appendChild(el);
      if (stick) scroll();
      return el;
    }

    const line = (content, cls) => push(h('div', { class: 'line' + (cls ? ' t-' + cls : '') }, rich(content)));

    const out = {
      head(content, t) {
        ensure();
        if (!headEl) {
          headEl = h('div', { class: 'head' });
          main.insertBefore(headEl, body);
          reply.classList.add('has-head');
        }
        const stick = atBottom();
        headEl.textContent = '';
        headEl.appendChild(rich(content));
        if (stick) scroll();
        if (t) setTone(t, true);
      },
      tone: (t) => setTone(t, true),
      line,
      ok: (text) => { setTone('ok'); line(text, 'ok'); },
      info: (text) => { setTone('info'); line(text, 'info'); },
      warn: (text) => { setTone('warn'); line([['! ', 'warn'], [text, '']]); },
      err: (text) => { setTone('err'); line(text, 'err'); },
      dim: (text) => line(text, 'dim'),
      section: (content) => push(h('div', { class: 'section' }, rich(content))),
      // opts.stack: a name -> description table (help, keys) that stacks each
      // description under its name on narrow screens instead of squeezing it.
      table(columns, rows, opts = {}) {
        const width = Math.max(columns ? columns.length : 0, ...rows.map((r) => (Array.isArray(r) ? r.length : 1)));
        // A row given as { section } is a group heading spanning the table.
        // A row that links somewhere (an id, a name) runs that link wherever it is tapped.
        const rowRun = (r) => {
          for (const c of r) for (const seg of Array.isArray(c) ? c : []) if (seg && seg[2] && seg[2].run) return seg[2].run;
          return null;
        };
        const tbody = h('tbody', null, ...rows.map((r) => (Array.isArray(r)
          ? h('tr', rowRun(r) ? { class: 'tr-run', 'data-run': rowRun(r), title: rowRun(r) } : null, ...r.map((c) => h('td', null, rich(c))))
          : h('tr', { class: 'tr-section' }, h('td', { colspan: String(width) }, rich(r.section))))));
        const thead = columns ? h('thead', null, h('tr', null, ...columns.map((c) => h('th', { text: c })))) : null;
        push(h('div', { class: 'tbl-wrap' }, h('table', { class: opts.stack ? 'tbl tbl-stack' : 'tbl' }, thead, tbody)));
      },
      kv(pairs) {
        push(h('dl', { class: 'kv' }, ...pairs.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', null, rich(v))])));
      },
      // Like kv, with [label, content, { command, current }?] rows: rows with
      // an edit spec can be changed in place.
      fields(rows) {
        push(h('dl', { class: 'kv fields' }, ...rows.flatMap(([k, v, edit]) => [
          h('dt', { text: k }), h('dd', null, edit ? editable(v, edit) : rich(v)),
        ])));
      },
      code(text, lang) {
        const lines = lang === 'json' ? jsonLines(text) : text.split('\n').map((l) => [[l, '']]);
        const pre = h('pre', { class: 'code' }, ...lines.map((segs) => h('div', null, rich(segs.length ? segs : [[' ', '']]))));
        push(h('div', { class: 'code-wrap' }, pre, copyButton(() => text)));
        out.copyable(text);
      },
      value(text) {
        push(h('div', { class: 'value' }, h('span', { class: 'value-text', text }), copyButton(() => text)));
        out.copyable(text);
      },
      // Marks `text` as this command's result for the copy button.
      copyable(text) {
        if (opts.onCopyable && text && !mode.replay) opts.onCopyable(String(text));
      },
      calendar(spec) {
        push(h('div', { class: 'cal-wrap' }, monthGrid(spec)));
      },
    };
    return out;
  }

  // An Out that also keeps what it drew, as plain data: out.ops.
  function recording(out) {
    const ops = [];
    const rec = { ...out, ops };
    for (const m of RECORDED) {
      rec[m] = (...args) => {
        let a = plain(args);
        // An editor opened by `<thing> <id> edit` opens once, not on every replay.
        if (m === 'fields') a = [a[0].map((r) => (r[2] && r[2].open ? [r[0], r[1], { ...r[2], open: false }] : r))];
        ops.push([m, ...a]);
        return out[m](...args);
      };
    }
    return rec;
  }

  // Draws a stored history entry into a new turn element (not yet placed).
  function entryEl(entry, meta) {
    const el = h('article', { class: 'turn', 'data-id': entry.id, 'data-at': entry.at },
      echo(entry.input, { ...meta, at: entry.at, deviceName: entry.deviceName }));
    const out = makeOut(el, { replay: true });
    for (const [m, ...args] of entry.ops || []) {
      try { if (RECORDED.includes(m)) out[m](...args); } catch (e) { /* an entry from a newer version */ }
    }
    return el;
  }

  const byAt = (a, b) => {
    const x = a.dataset.at || '', y = b.dataset.at || '';
    return x < y ? -1 : x > y ? 1 : (a.dataset.id || '') < (b.dataset.id || '') ? -1 : 1;
  };

  return {
    // A turn for one submitted command: echoes the input and returns its Out,
    // which records what it draws (out.ops) and knows its element (out.el).
    turn(input, meta = {}) {
      const el = h('article', { class: 'turn', 'data-at': meta.at || new Date().toISOString() }, echo(input));
      // Becomes a stored entry (data-id) once its command has finished and been saved.
      if (meta.pending) el.setAttribute('data-pending', meta.pending);
      append(el);
      const out = recording(makeOut(el));
      out.el = el;
      return out;
    },
    // Output with no echoed input (startup notices, widget actions); not kept.
    notice() {
      const el = h('article', { class: 'turn notice', 'data-at': new Date().toISOString() });
      append(el);
      return makeOut(el);
    },
    // Shows exactly `entries` (stored history, oldest first) alongside what is
    // on screen but not stored (notices, this tab's unsaved turns), in time
    // order. meta(entry) -> { other } for the echo line.
    reconcile(entries, meta) {
      const stick = atBottom();
      const want = new Set(entries.map((e) => e.id));
      const have = new Map();
      for (const el of [...listEl.querySelectorAll('article.turn[data-pending]')]) {
        if (!want.has(el.dataset.pending)) continue;
        el.setAttribute('data-id', el.dataset.pending);
        el.removeAttribute('data-pending');
      }
      for (const el of [...listEl.querySelectorAll('article.turn[data-id]')]) {
        if (want.has(el.dataset.id)) have.set(el.dataset.id, el);
        else el.remove(); // cleared, or not in this view
      }
      for (const e of entries) if (!have.has(e.id)) have.set(e.id, entryEl(e, meta(e)));
      const turns = [...have.values(), ...listEl.querySelectorAll('article.turn:not([data-id])')].sort(byAt);
      const now = [...listEl.querySelectorAll('article.turn')];
      if (turns.length !== now.length || turns.some((el, i) => el !== now[i])) for (const el of turns) listEl.appendChild(el);
      if (stick) scroll();
    },
    // Removes what isn't stored (notices, unsaved turns) up to `at`.
    clearUnsaved(at) {
      for (const el of [...listEl.querySelectorAll('article.turn:not([data-id])')]) if ((el.dataset.at || '') <= at) el.remove();
    },
    // Always first: above the history, however it arrives.
    welcome(lines) {
      const old = listEl.querySelector('.welcome');
      if (old) old.remove();
      listEl.prepend(h('section', { class: 'welcome' },
        h('div', { class: 'welcome-title' }, h('span', { class: 't-accent', text: '✻ ' }), h('span', { class: 't-strong', text: 'Control Center' })),
        ...lines.map((l) => h('div', { class: 'welcome-line' }, rich(l)))));
    },
    clear() { listEl.textContent = ''; },
    scroll,
  };
}
