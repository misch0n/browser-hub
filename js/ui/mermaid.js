// Drawing Mermaid diagrams for the page. Mermaid needs inline styles, which the
// hub's CSP refuses, so it runs in a hidden same-origin frame
// (mermaid-frame.html) and the SVG it makes is shown as an <img> from a blob:
// URL: an image, so nothing in it can run or restyle the page.
//
//   renderMermaid(code) -> Promise<{ svg, width, height }>   (rejects with Mermaid's message)
//   svgImage(svg, w, h) -> <img>;  svgToPng(svg, scale) -> Promise<Blob>

let frameP = null;
const version = new URL(import.meta.url).search; // ?v=… on deployed builds

function frame() {
  return (frameP ??= new Promise((resolve, reject) => {
    const f = document.createElement('iframe');
    f.className = 'mermaid-frame';
    f.setAttribute('aria-hidden', 'true');
    f.tabIndex = -1;
    f.src = new URL('../../mermaid-frame.html' + version, import.meta.url).href;
    const timer = setTimeout(() => { frameP = null; f.remove(); reject(new Error('the diagram renderer didn’t load')); }, 20000);
    f.addEventListener('load', () => {
      const w = f.contentWindow;
      const ready = () => { clearTimeout(timer); resolve(w); };
      if (w.renderDiagram) ready(); else w.addEventListener('mermaid-frame-ready', ready, { once: true });
    }, { once: true });
    document.body.append(f);
  }));
}

// One drawing at a time: Mermaid keeps global state while it lays out.
let queue = Promise.resolve();
export function renderMermaid(code) {
  const job = queue.then(async () => {
    const w = await frame();
    try {
      return await w.renderDiagram(String(code));
    } catch (e) {
      throw new Error(cleanError(e));
    }
  });
  queue = job.catch(() => {});
  return job;
}

// Mermaid's parse errors carry a caret drawing and token lists: keep the gist.
export function cleanError(e) {
  const msg = String((e && (e.message || e.str)) || e || 'could not draw this');
  const lines = msg.split('\n').map((l) => l.trim()).filter(Boolean);
  const head = lines[0] || msg;
  const expect = lines.find((l) => /^Expecting /.test(l));
  return (head + (expect ? ' · ' + expect.replace(/, got .*$/, '').slice(0, 160) : '')).slice(0, 300);
}

const blobURL = (svg) => URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));

export function svgImage(svg, width, height, alt) {
  const img = document.createElement('img');
  img.className = 'diagram-img';
  img.alt = alt || 'diagram';
  img.width = width;
  img.height = height;
  const url = blobURL(svg);
  img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
  img.src = url;
  return img;
}

export async function svgToPng(svg, scale = 2) {
  const url = blobURL(svg);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('couldn’t read the drawing')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = Math.ceil(img.naturalWidth * scale);
    c.height = Math.ceil(img.naturalHeight * scale);
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('couldn’t make the PNG'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
