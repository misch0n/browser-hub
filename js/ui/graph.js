import { h, rich } from './dom.js';
import { graphView, accept, pick, isGraph, countKeys } from '../core/graph.js';

// Graph mode's overlay (core/graph.js): while the prompt's text starts with
// `graph `, the screen above the prompt shows the command as a path through
// the grammar. Each word is a column: the node it resolved to on the centre
// line, the nodes that sort before it above and after it below. The last
// column is the word being typed: its best match sits on the centre line as
// you type, ↑↓ move along it, Tab (or a tap) takes it and the next column opens.
// Nothing under the overlay changes; Esc or deleting `graph ` takes it away.
//
// opts: { panel, root (gets .graph-on), composer (its height is kept clear), env() -> graph env,
//         onPick(text) (a tapped node), onRun(keys) (counts a run) }
// Returns { refresh(text) -> view|null, view, selected, move(d), accept() -> text|null,
//           submit() -> { input } | { run } | null }
export function createGraph(opts) {
  const { panel } = opts;
  let view = null;
  let text = '';
  let sel = -1; // in view.fan; -1: typed text nothing matches
  let key = null;
  panel.addEventListener('pointerdown', (e) => e.preventDefault()); // focus (and a phone's keyboard) stay in the prompt
  panel.addEventListener('mousedown', (e) => e.preventDefault());

  // How many nodes fit above (and below) the centre line.
  function reach() {
    const fs = parseFloat(getComputedStyle(panel).fontSize) || 14;
    const free = window.innerHeight - (opts.composer ? opts.composer.offsetHeight : 80) - fs * 10; // the foot, padding
    return Math.max(2, Math.min(7, Math.floor((free / (fs * 1.9) - 1) / 2)));
  }

  function cell(col, ci, i, dist, k) {
    const it = col.items[i];
    if (!it) return h('div', { class: 'g-cell g-blank', 'aria-hidden': 'true' });
    const cls = 'g-cell g-' + it.kind + (it.match ? '' : ' g-miss') + ' g-d' + Math.min(dist, 4);
    const el = h('div', { class: cls, title: it.label || it.value, 'data-col': String(ci), 'data-i': String(i), text: it.value });
    if (dist > k - 1) el.classList.add('g-edge');
    return el;
  }

  function center(col, ci) {
    const it = col.hit ? col.items[col.at] : null;
    const kind = col.kind === 'miss' ? 'miss' : col.kind;
    const el = h('div', { class: 'g-cell g-center g-' + kind + (col.active ? ' selected' : ''), 'data-col': String(ci), 'data-i': it ? String(col.at) : null },
      h('span', { class: 'g-val', text: col.value || '·' }),
      col.sub ? h('span', { class: 'g-sub', text: ' ' + col.sub }) : null,
      col.corrected ? h('span', { class: 'g-sub', text: ' (' + col.typed + ')' }) : null,
      col.kind === 'raw' && !col.pending ? h('span', { class: 'g-sub', text: ' ?' }) : null,
      col.kind === 'miss' && col.value ? h('span', { class: 'g-sub', text: ' no match' }) : null);
    return el;
  }

  // The column being typed in follows ↑↓; the others show what they resolved to.
  function columnOf(c) {
    if (!c.active || sel < 0) return c;
    const it = view.fan[sel];
    const q = view.focus.query;
    const merged = c.typed && q && c.typed !== q ? c.typed.slice(0, c.typed.length - q.length) : ''; // earlier words of free text
    return Object.assign({}, c, { at: sel, hit: true, kind: it.ph ? 'param' : it.kind,
      value: it.ph ? (q ? merged + q : it.value) : it.value, sub: it.ph && q ? it.value : '' });
  }

  function render() {
    const k = reach();
    panel.textContent = '';
    panel.hidden = false;
    opts.root.classList.add('graph-on');
    if (opts.composer) panel.style.setProperty('--composer-h', opts.composer.offsetHeight + 'px');
    const row = h('div', { class: 'g-row' });
    let activeEl = null;
    view.columns.forEach((c0, ci) => {
      const c = columnOf(c0);
      if (ci) row.appendChild(h('div', { class: 'g-join', 'aria-hidden': 'true' }, ...Array.from({ length: k }, () => h('div', { class: 'g-cell g-blank' })),
        h('div', { class: 'g-cell g-arrow', text: '›' }), ...Array.from({ length: k }, () => h('div', { class: 'g-cell g-blank' }))));
      const above = [];
      for (let d = k; d >= 1; d--) above.push(cell(c, ci, c.at - d, d, k));
      const below = [];
      const first = c.hit ? c.at + 1 : c.at;
      for (let d = 0; d < k; d++) below.push(cell(c, ci, first + d, d + 1, k));
      const el = h('div', { class: 'g-col' + (c.active ? ' g-active' : '') + (c.pending ? ' g-pending' : ''), role: c.active ? 'listbox' : null },
        ...above, center(c, ci), ...below);
      if (c.active) activeEl = el;
      row.appendChild(el);
    });
    if (!view.columns.some((c) => c.active) && view.run) {
      row.appendChild(h('div', { class: 'g-join', 'aria-hidden': 'true' }, ...Array.from({ length: k }, () => h('div', { class: 'g-cell g-blank' })),
        h('div', { class: 'g-cell g-arrow', text: '↵' }), ...Array.from({ length: k }, () => h('div', { class: 'g-cell g-blank' }))));
    }
    const it = sel >= 0 ? view.fan[sel] : null;
    const stage = h('div', { class: 'g-frame' }, h('div', { class: 'g-stage' }, row));
    stage.addEventListener('click', (e) => {
      const t = e.target.closest('[data-i]');
      if (!t) return;
      const ci = Number(t.getAttribute('data-col'));
      const i = Number(t.getAttribute('data-i'));
      if (view.columns[ci] && view.columns[ci].active) sel = i;
      const next = pick(text, view, ci, i);
      if (next !== null && next !== text) opts.onPick(next);
      else render();
    });
    panel.append(...[
      h('div', { class: 'g-top' }, rich([['graph', 'accent'], [' · experimental', 'faint'],
        [view.ambiguous ? '  · "' + view.focus.query + '" could be several: choose one' : view.offMap ? '  · not a command here; ↵ runs it as typed' : '', 'warn']])),
      stage,
      h('div', { class: 'g-foot' },
        it ? h('div', { class: 'g-desc' }, rich([[it.value, it.ph ? 'faint' : 'accent'], [it.label ? ' · ' + it.label : '', 'dim']])) : null,
        ...view.lines.map((l) => h('div', { class: 'g-line' }, rich([['› ', 'faint'], [l, 'dim']]))),
        view.more ? h('div', { class: 'g-line' }, rich([['+' + view.more + ' more forms', 'faint']])) : null),
    ].filter(Boolean));
    if (activeEl && activeEl.scrollIntoView) activeEl.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  function hide() {
    if (!panel.hidden) { panel.hidden = true; panel.textContent = ''; }
    opts.root.classList.remove('graph-on');
    key = null;
  }

  function refresh(value) {
    text = value;
    view = isGraph(value) ? graphView(value, opts.env()) : null;
    if (!view) { hide(); return null; }
    if (view.key !== key) {
      key = view.key;
      const active = view.columns.find((c) => c.active);
      sel = active && active.hit ? view.sel : -1;
    }
    if (sel >= view.fan.length) sel = view.fan.length - 1;
    render();
    return view;
  }

  return {
    refresh,
    get view() { return view; },
    get selected() { return view && sel >= 0 ? view.fan[sel] || null : null; },
    // Along the column being typed in; from typed text nothing matches, from where it would sort.
    move(d) {
      if (!view || !view.fan.length) return;
      if (sel < 0) {
        const active = view.columns.find((c) => c.active);
        const at = active ? active.at : 0;
        sel = d > 0 ? Math.min(at, view.fan.length - 1) : Math.max(at - 1, 0);
        return;
      }
      sel = Math.max(0, Math.min(view.fan.length - 1, sel + d));
    },
    accept: () => (view && sel >= 0 ? accept(text, view, sel) : null),
    // Enter: an undecided word takes the chosen node; otherwise the command runs
    // (`graph` alone explains the mode; `graph :sort …` is the graph command itself).
    submit() {
      if (!view) return null;
      if (view.ambiguous) {
        const t = sel >= 0 ? accept(text, view, sel) : null;
        return t === null ? null : { input: t };
      }
      if (!view.run) return { run: 'graph', leave: true };
      if (view.run[0] === ':') return { run: 'graph ' + view.run };
      opts.onRun(countKeys(view));
      return { run: view.run };
    },
  };
}
