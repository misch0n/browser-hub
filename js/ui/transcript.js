import { h, rich, copyButton } from './dom.js';
import { monthGrid } from './components.js';
import { jsonLines } from '../core/format.js';
import { oneValue, quote } from '../core/args.js';

const MAX_TURNS = 200;

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
export function createTranscript(scrollEl, listEl, opts = {}) {
  const atBottom = () => scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 40;
  const scroll = () => { scrollEl.scrollTop = scrollEl.scrollHeight; };

  function append(el) {
    const stick = atBottom();
    listEl.appendChild(el);
    while (listEl.childElementCount > MAX_TURNS) listEl.firstElementChild.remove();
    if (stick || el.classList.contains('turn')) scroll();
  }

  listEl.addEventListener('click', (e) => {
    const link = e.target.closest('[data-run]');
    if (link && opts.run) opts.run(link.getAttribute('data-run'));
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
    return btn;
  }

  function makeOut(turnEl) {
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
      table(columns, rows) {
        const width = Math.max(columns ? columns.length : 0, ...rows.map((r) => (Array.isArray(r) ? r.length : 1)));
        // A row given as { section } is a group heading spanning the table.
        const tbody = h('tbody', null, ...rows.map((r) => (Array.isArray(r)
          ? h('tr', null, ...r.map((c) => h('td', null, rich(c))))
          : h('tr', { class: 'tr-section' }, h('td', { colspan: String(width) }, rich(r.section))))));
        const thead = columns ? h('thead', null, h('tr', null, ...columns.map((c) => h('th', { text: c })))) : null;
        push(h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, thead, tbody)));
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
      },
      value(text) {
        push(h('div', { class: 'value' }, h('span', { class: 'value-text', text }), copyButton(() => text)));
      },
      calendar(spec) {
        push(h('div', { class: 'cal-wrap' }, monthGrid(spec)));
      },
    };
    return out;
  }

  return {
    // A turn for one submitted command: echoes the input and returns its Out.
    turn(input) {
      const el = h('article', { class: 'turn' },
        h('div', { class: 'you' }, h('span', { class: 'caret', 'aria-hidden': 'true', text: '›' }), h('span', { class: 'you-text', text: input })));
      append(el);
      return makeOut(el);
    },
    // Output with no echoed input (startup notices, widget actions).
    notice() {
      const el = h('article', { class: 'turn notice' });
      append(el);
      return makeOut(el);
    },
    welcome(lines) {
      append(h('section', { class: 'welcome' },
        h('div', { class: 'welcome-title' }, h('span', { class: 't-accent', text: '✻ ' }), h('span', { class: 't-strong', text: 'Control Center' })),
        ...lines.map((l) => h('div', { class: 'welcome-line' }, rich(l)))));
    },
    clear() { listEl.textContent = ''; },
    scroll,
  };
}
