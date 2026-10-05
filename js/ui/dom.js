// Tiny DOM builder. Text always goes in through textContent / text nodes,
// never innerHTML, so stored or imported text can't become markup.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

// Rich content -> nodes. Accepts a string, a Node, a segment list
// ([[text, cls], ...]) or a { swatch: themeId } colour preview.
export function rich(content) {
  if (content === null || content === undefined) return document.createTextNode('');
  if (typeof content === 'string' || typeof content === 'number') return document.createTextNode(String(content));
  if (content instanceof Node) return content;
  if (content.swatch) return swatch(content.swatch);
  const frag = document.createDocumentFragment();
  for (const seg of content) {
    if (!seg) continue;
    if (seg.swatch) { frag.appendChild(swatch(seg.swatch)); continue; }
    const [text, cls] = seg;
    if (!text) continue;
    frag.appendChild(cls ? h('span', { class: cls.split(' ').map((c) => 't-' + c).join(' '), text }) : document.createTextNode(text));
  }
  return frag;
}

// A row of colour chips rendered with the given theme's own variables.
export function swatch(themeId) {
  return h('span', { class: 'swatch', 'data-theme': themeId, 'aria-hidden': 'true' },
    ...['bg', 'fg', 'accent', 'ok', 'err', 'info'].map((k) => h('i', { class: 'sw-' + k })));
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const ta = h('textarea', { class: 'offscreen', readonly: true });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) { /* unsupported */ }
    ta.remove();
    return ok;
  }
}

export function copyButton(getText) {
  const b = h('button', { class: 'copy', type: 'button', title: 'Copy to clipboard', text: 'copy' });
  b.addEventListener('click', async () => {
    const ok = await copyText(getText());
    b.textContent = ok ? 'copied' : 'failed';
    setTimeout(() => { b.textContent = 'copy'; }, 1200);
  });
  return b;
}
