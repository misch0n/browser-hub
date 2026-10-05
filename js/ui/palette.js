import { h } from './dom.js';

// Subsequence match: consecutive and word-start hits score higher.
export function fuzzy(q, s) {
  let qi = 0, score = 0, last = -2;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] === q[qi]) {
      score += (i === last + 1 ? 5 : 1) + (i === 0 || s[i - 1] === ' ' ? 3 : 0);
      last = i;
      qi++;
    }
  }
  return qi === q.length ? score - s.length * 0.01 : -1;
}

// opts: { root, input, list, source() -> [{ name, desc, kind, insert }], onPick(item), onClose() }
export function createPalette(opts) {
  const { root, input, list } = opts;
  let items = [];
  let sel = 0;

  function render() {
    const q = input.value.toLowerCase().replace(/\s+/g, ' ').trim();
    items = opts.source()
      .map((it) => {
        const n = q ? fuzzy(q, it.name) : 0;
        const d = q && n < 0 ? fuzzy(q, it.desc.toLowerCase()) : -1;
        return { it, score: n >= 0 ? n + 10 : d * 0.3, ok: !q || n >= 0 || d >= 0 };
      })
      .filter((x) => x.ok)
      .sort((a, b) => b.score - a.score || (a.it.name < b.it.name ? -1 : 1))
      .map((x) => x.it);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    list.textContent = '';
    if (!items.length) list.appendChild(h('li', { class: 'empty', text: 'No matches' }));
    items.forEach((it, i) => {
      const li = h('li', { class: i === sel ? 'selected' : '', role: 'option', 'aria-selected': i === sel ? 'true' : 'false' },
        h('span', { class: 'p-name', text: it.name }),
        h('span', { class: 'p-desc', text: it.desc }),
        h('span', { class: 'p-kind', text: it.kind }));
      li.addEventListener('mousedown', (ev) => { ev.preventDefault(); pick(i); });
      list.appendChild(li);
    });
    const s = list.querySelector('.selected');
    if (s) s.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    root.hidden = false;
    input.value = '';
    sel = 0;
    render();
    input.focus();
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    opts.onClose();
  }

  function pick(i) {
    const it = items[i];
    close();
    if (it) opts.onPick(it);
  }

  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
    else if (e.key === 'Tab') e.preventDefault();
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      render();
    }
  });

  return { open, close, get isOpen() { return !root.hidden; } };
}
