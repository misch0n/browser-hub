import { h, rich } from './dom.js';
import { graphView, accept, isGraph, countKeys } from '../core/graph.js';

// The panel of graph mode (core/graph.js): above the prompt while its text
// starts with `graph `. It shows the path read so far, every node that can come
// next (the fan; ↑↓ choose, Tab or a tap takes one; non-matches dimmed, not
// hidden), what the chosen node is, and the usage lines still possible.
//
// opts: { panel, env() -> graph env, onPick(text) (a tapped node), onRun(keys) (counts a run) }
// Returns { refresh(text) -> view|null, view, selected, move(d), accept() -> text|null,
//           submit() -> { input } | { run } | null }
export function createGraph(opts) {
  const { panel } = opts;
  let view = null;
  let text = '';
  let sel = 0;
  let key = null;

  function crumbs(v) {
    const segs = [['graph', 'accent']];
    const sep = () => segs.push([' › ', 'faint']);
    for (const n of v.path) {
      sep();
      if (n.kind === 'param') segs.push([n.value, 'num'], [' ' + n.label, 'faint']);
      else if (n.kind === 'raw') segs.push([n.value, 'warn'], [' ?', 'faint']);
      else segs.push([n.value, n.kind === 'word' ? 'strong' : 'accent']);
      if (n.corrected) segs.push([' (' + n.text + ')', 'faint']);
    }
    if (v.ambiguous) {
      sep();
      segs.push([v.focus.query + '?', 'warn'], [' which one?', 'faint']);
      if (v.pending.length) segs.push(['  ' + v.pending.join(' '), 'faint']);
    } else if (v.fan.length) {
      sep();
      segs.push(['…', 'faint']);
    }
    if (v.offMap) segs.push(['   not a command here; ↵ runs it as typed', 'faint']);
    return segs;
  }

  function render() {
    panel.textContent = '';
    panel.hidden = false;
    const fan = h('div', { class: 'g-fan', role: 'listbox', 'aria-label': 'Next steps' });
    view.fan.forEach((it, i) => {
      const b = h('button', {
        type: 'button', role: 'option', 'aria-selected': i === sel ? 'true' : 'false', title: it.label || it.value,
        class: 'g-node g-' + it.kind + (i === sel ? ' selected' : '') + (it.match ? '' : ' g-miss'), text: it.value,
      });
      // Keep focus (and a phone's keyboard) in the prompt.
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        sel = i;
        const t = accept(text, view, i);
        if (t !== null) opts.onPick(t);
        else render();
      });
      fan.appendChild(b);
    });
    const it = view.fan[sel];
    panel.append(...[
      h('div', { class: 'g-crumbs' }, rich(crumbs(view))),
      view.fan.length ? fan : h('div', { class: 'g-empty', text: view.offMap ? 'Nothing known after this word' : 'Nothing more to choose · ↵ runs it' }),
      it ? h('div', { class: 'g-desc' }, rich([[it.value, it.ph ? 'faint' : 'accent'], [it.label ? ' · ' + it.label : '', 'dim']])) : null,
      view.lines.length ? h('div', { class: 'g-lines' }, ...view.lines.map((l) => h('div', { class: 'g-line' }, rich([['› ', 'faint'], [l, 'dim']]))),
        view.more ? h('div', { class: 'g-line' }, rich([['+' + view.more + ' more forms', 'faint']])) : null) : null,
    ].filter(Boolean));
    const s = fan.querySelector('.selected');
    if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest' });
  }

  function refresh(value) {
    text = value;
    view = isGraph(value) ? graphView(value, opts.env()) : null;
    if (!view) {
      if (!panel.hidden) { panel.hidden = true; panel.textContent = ''; }
      key = null;
      return null;
    }
    if (view.key !== key) { key = view.key; sel = 0; }
    if (sel >= view.fan.length) sel = Math.max(0, view.fan.length - 1);
    render();
    return view;
  }

  return {
    refresh,
    get view() { return view; },
    get selected() { return view ? view.fan[sel] || null : null; },
    move(d) {
      if (!view || !view.fan.length) return;
      sel = (sel + d + view.fan.length) % view.fan.length;
    },
    accept: () => (view ? accept(text, view, sel) : null),
    // Enter: an undecided word takes the chosen node; otherwise the command runs
    // (`graph` alone explains the mode; `graph :sort …` is the graph command itself).
    submit() {
      if (!view) return null;
      if (view.ambiguous) {
        const t = accept(text, view, sel);
        return t === null ? null : { input: t };
      }
      if (!view.run) return { run: 'graph', leave: true };
      if (view.run[0] === ':') return { run: 'graph ' + view.run };
      opts.onRun(countKeys(view));
      return { run: view.run };
    },
  };
}
