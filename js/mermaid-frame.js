// Runs inside mermaid-frame.html, a hidden same-origin frame: loads Mermaid on
// first use and turns diagram code into a standalone SVG document.
//   window.renderDiagram(code) -> Promise<{ svg, width, height }> (rejects with the parse error)

let mermaidP = null;
function mermaid() {
  return (mermaidP ??= import('./vendor/mermaid-12.1.0/mermaid.esm.min.mjs').then((m) => {
    // strict: no click handlers or scripts in labels; plain SVG text (no HTML
    // labels), so the drawing works as an image and can be painted to a PNG.
    m.default.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', htmlLabels: false, flowchart: { htmlLabels: false }, fontFamily: 'Helvetica, Arial, sans-serif' });
    return m.default;
  }));
}

let n = 0;
window.renderDiagram = async (code) => {
  const m = await mermaid();
  const id = 'd' + ++n;
  let svg;
  try {
    ({ svg } = await m.render(id, code));
  } finally {
    // A failed render leaves its scratch element behind.
    for (const el of document.querySelectorAll('#' + id + ', #d' + id)) el.remove();
  }
  let doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(svg, 'text/html');
  const el = doc.querySelector('svg');
  const box = (el.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const width = Math.max(1, Math.ceil(box[2] || 0)), height = Math.max(1, Math.ceil(box[3] || 0));
  el.setAttribute('width', String(width));
  el.setAttribute('height', String(height));
  el.removeAttribute('style'); // max-width: as an image it has its own size
  return { svg: new XMLSerializer().serializeToString(el), width, height };
};

window.dispatchEvent(new Event('mermaid-frame-ready'));
