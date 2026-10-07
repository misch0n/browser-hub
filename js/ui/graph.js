import { h, rich } from './dom.js';
import { graphView, take, pick, isGraph, countKeys } from '../core/graph.js';

// Graph mode's overlay (core/graph.js): while the prompt's text starts with
// `graph `, the screen above the prompt shows where the command is in its graph.
// It is a display beside an unchanged input: typing, Tab, ↑↓ and Esc work as in
// normal mode; a tap puts a node into the prompt.
//   - the path: the words so far as they resolved (a typo shows what it became);
//   - the backward pane: for each word passed, the other choices there, a to z
//     (reference: a tap swaps that word);
//   - the forward pane: the letter tree of the word at the cursor, drawn fisheye
//     (near the cursor large and sharp, further out smaller, big far branches
//     folded), each word with the slot that follows it; typos apart; open slots
//     with their shape and recent values.
//
// opts: { panel, root (gets .graph-on), composer (its height is kept clear), env() -> graph env,
//         onPick(text) (a tapped node), onRun(keys) (counts a run) }
// Returns { refresh(text) -> view|null, view, best, submit() -> { run, leave? } | null }
const FOLD = [0, 8, 3, 2]; // a branch this deep folds when it holds more words than this (deeper: 1)
const NEXT_DEPTH = 2; // deeper words show their next slot only on the best match's branch

export function createGraph(opts) {
  const { panel } = opts;
  let view = null;
  let text = '';
  panel.addEventListener('pointerdown', (e) => e.preventDefault()); // focus (and a phone's keyboard) stay in the prompt
  panel.addEventListener('mousedown', (e) => e.preventDefault());
  panel.addEventListener('click', (e) => {
    const t = e.target.closest('[data-take], [data-col]');
    if (!t || !view) return;
    const next = t.hasAttribute('data-take')
      ? take(text, view, t.getAttribute('data-take'), t.getAttribute('data-done') === '1')
      : pick(text, view, Number(t.getAttribute('data-col')), Number(t.getAttribute('data-i')));
    if (next !== null && next !== text) opts.onPick(next);
  });

  const bestOf = (fw) => fw.words.find((w) => w.best) || null;

  // The words so far, as they resolved.
  function pathLine() {
    const parts = [];
    view.columns.forEach((c, i) => {
      if (i) parts.push(h('span', { class: 'g-sep', text: ' › ' }));
      const cls = 'g-step g-' + (c.active ? 'here' : c.kind) + (c.pending ? ' g-pending' : '');
      parts.push(h('span', { class: cls },
        h('span', { class: 'g-val', text: c.active ? (c.typed || '') : c.value || '·' }),
        c.sub && !c.active ? h('span', { class: 'g-sub', text: ' ' + c.sub }) : null,
        c.corrected ? h('span', { class: 'g-sub', text: ' (' + c.typed + ')' }) : null,
        c.kind === 'raw' && !c.pending ? h('span', { class: 'g-sub', text: ' ?' }) : null));
    });
    if (!view.columns.some((c) => c.active)) parts.push(h('span', { class: 'g-sep', text: view.columns.length ? ' › ' : '' }), h('span', { class: 'g-step g-here' }));
    if (!view.columns.length) parts.push(h('span', { class: 'g-sep', text: ' type a command, or tap a word below' }));
    return h('div', { class: 'g-path' }, ...parts);
  }

  // One plain list per word passed: its siblings a to z, the chosen one marked.
  function backPane() {
    const lists = [];
    view.columns.forEach((c, ci) => {
      if (c.active || c.pending || !c.items.length) return;
      const items = c.items.map((it, i) => ({ it, i }))
        .sort((a, b) => (a.it.ph - b.it.ph) || (a.it.value.toLowerCase() < b.it.value.toLowerCase() ? -1 : a.it.value.toLowerCase() > b.it.value.toLowerCase() ? 1 : 0));
      lists.push(h('ol', { class: 'g-list', 'aria-label': 'choices for ' + c.value },
        ...items.map(({ it, i }) => h('li', {
          class: 'g-' + it.kind + (c.hit && i === c.at ? ' g-chosen' : ''),
          title: it.label || it.value, 'data-col': String(ci), 'data-i': String(i), text: it.value,
        }))));
    });
    return lists.length ? h('div', { class: 'g-back' }, ...lists) : null;
  }

  // The letter tree at the cursor. `on`: the node lies on the best match's branch.
  function treeNode(n, depth, prefix, on, best) {
    const letters = prefix + n.edge;
    const word = n.word;
    const hot = depth === 0 || (on && !!best && best.value.toLowerCase().startsWith(letters.toLowerCase()));
    const fold = depth > 0 && !hot && n.children.length && n.size > (FOLD[depth] ?? 1);
    const d = Math.min(depth, 4);
    const label = h('span', {
      class: 'f-label f-d' + d + (hot ? ' f-hot' : '') + (word ? ' f-word g-' + word.kind : ''),
      'data-take': word && !fold ? word.value : letters, 'data-done': word && !fold ? '1' : '0',
      title: word ? word.value + (word.label ? ' · ' + word.label : '') : letters + '…',
    },
    depth === 0 ? h('span', { class: 'f-typed', text: n.edge }) : document.createTextNode(n.edge),
    fold ? h('span', { class: 'f-fold', text: '… ' + n.size }) : null);
    const row = h('div', { class: 'f-node' + (depth === 0 ? ' f-root' : '') });
    row.appendChild(h('div', { class: 'f-head' }, label,
      word && !fold && (depth <= NEXT_DEPTH || hot) ? nextOf(word, n.children.length > 0) : null));
    if (!fold && n.children.length) {
      row.appendChild(h('div', { class: 'f-kids' },
        ...n.children.map((c) => treeNode(c, depth + 1, letters, hot, best))));
    }
    return row;
  }

  // What follows a word; only ↵ when longer words go on from it (the tree stays readable).
  function nextOf(word, inner) {
    const bits = inner ? '' : word.next.slice(0, 5).join('  ');
    if (!bits && !word.end) return null;
    return h('span', { class: 'f-next' }, rich([[word.end ? ' ↵' : '', 'ok'], [bits ? '  › ' + bits + (word.next.length > 5 ? '  …' : '') : '', 'faint']]));
  }

  function forwardPane() {
    const fw = view.forward;
    const best = bestOf(fw);
    const parts = [];
    if (fw.words.length || !fw.slots.length) {
      const root = treeNode(fw.trie, 0, '', true, best);
      if (!fw.words.length) root.appendChild(h('div', { class: 'f-none', text: fw.query ? 'no word starts like this' : 'nothing more: ↵ runs it' }));
      parts.push(root);
    }
    if (fw.typos.length) {
      parts.push(h('div', { class: 'f-typos' }, h('span', { class: 'f-tag', text: 'typo? ' }),
        ...fw.typos.slice(0, 6).map((w) => h('span', { class: 'f-label f-word g-' + w.kind, 'data-take': w.value, 'data-done': '1', text: w.value }))));
    }
    for (const s of fw.slots) {
      parts.push(h('div', { class: 'f-slot' + (s.takes ? ' f-hot' : '') },
        h('span', { class: 'f-shape', text: s.display }),
        h('span', { class: 'f-tag', text: s.rest ? ' free text' : s.type === 'text' ? ' a value' : ' a ' + s.type }),
        ...s.recent.map((r) => h('span', { class: 'f-recent', 'data-take': r, 'data-done': '1', title: 'used before', text: r }))));
    }
    return h('div', { class: 'g-fwd' }, ...parts);
  }

  function foot() {
    const best = bestOf(view.forward);
    const lines = best && best.reach.length ? best.reach : view.lines;
    const more = best && best.reach.length ? best.more : view.more;
    return h('div', { class: 'g-foot' },
      best ? h('div', { class: 'g-desc' }, rich([[best.value, 'accent'], [best.label ? ' · ' + best.label : '', 'dim']])) : null,
      ...lines.map((l) => h('div', { class: 'g-line' }, rich([['› ', 'faint'], [l, 'dim']]))),
      more ? h('div', { class: 'g-line' }, rich([['+' + more + ' more forms', 'faint']])) : null);
  }

  function render() {
    panel.textContent = '';
    panel.hidden = false;
    opts.root.classList.add('graph-on');
    if (opts.composer) panel.style.setProperty('--composer-h', opts.composer.offsetHeight + 'px');
    const note = view.ambiguous ? '  · "' + view.focus.query + '" could be several: keep typing or tap one'
      : view.offMap ? '  · not a command here; ↵ runs it as typed' : '';
    panel.append(
      h('div', { class: 'g-top' }, rich([['graph', 'accent'], [' · experimental', 'faint'], [note, 'warn']])),
      pathLine(),
      h('div', { class: 'g-panes' }, ...[backPane(), forwardPane()].filter(Boolean)),
      foot());
    // Each list scrolled to its chosen word (lists are positioned, so offsetTop is within them).
    for (const el of panel.querySelectorAll('.g-chosen')) {
      const list = el.parentElement;
      list.scrollTop = Math.max(0, el.offsetTop - list.clientHeight / 2);
    }
  }

  function hide() {
    if (!panel.hidden) { panel.hidden = true; panel.textContent = ''; }
    opts.root.classList.remove('graph-on');
  }

  function refresh(value) {
    text = value;
    view = isGraph(value) ? graphView(value, opts.env()) : null;
    if (!view) { hide(); return null; }
    render();
    return view;
  }

  return {
    refresh,
    get view() { return view; },
    get best() { return view ? bestOf(view.forward) : null; },
    // Enter: the command as resolved, or as typed when a word is still undecided
    // (`graph` alone explains the mode; `graph :sort …` is the graph command itself).
    submit() {
      if (!view) return null;
      const run = view.ambiguous ? text.replace(/^\s*graph\s+/i, '').trim() : view.run;
      if (!run) return { run: 'graph', leave: true };
      if (run[0] === ':') return { run: 'graph ' + run };
      opts.onRun(countKeys(view));
      return { run };
    },
  };
}
