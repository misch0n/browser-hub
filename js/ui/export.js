import { h } from './dom.js';
import { qrPath } from '../lib/qr.js';

// Saving drawn codes as files. PNGs are painted straight onto a canvas from
// the same geometry as the SVG (no image loading, so the page's CSP stays as it is).

export function saveBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// A canvas, or a promise of a PNG blob (drawings that load first).
const savePng = (name, png) => (png && typeof png.then === 'function' ? png.then((b) => saveBlob(name, b), () => {}) : png.toBlob((b) => b && saveBlob(name, b), 'image/png'));
const saveSvg = (name, svg) => saveBlob(name, new Blob([svg], { type: 'image/svg+xml' }));

// A file name (without extension) from what the code holds: 'qr-misch0n-github-io'
export function fileName(prefix, text) {
  const slug = String(text).toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return prefix + (slug ? '-' + slug : '');
}

export function qrSvgString(modules, scale = 8, quiet = 4) {
  const n = modules.length + 2 * quiet;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + n * scale + '" height="' + n * scale + '" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges">' +
    '<rect width="' + n + '" height="' + n + '" fill="#fff"/><path fill="#000" d="' + qrPath(modules, quiet) + '"/></svg>';
}

export function qrCanvas(modules, scale = 10, quiet = 4) {
  const n = modules.length + 2 * quiet;
  const c = document.createElement('canvas');
  c.width = c.height = n * scale;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000';
  modules.forEach((row, y) => row.forEach((on, x) => { if (on) g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale); }));
  return c;
}

// geometry: barcodeGeometry(); drawn at `ratio` × its px size for a sharp PNG.
export function barcodeCanvas(geo, ratio = 2) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(geo.width * ratio);
  c.height = Math.ceil(geo.height * ratio);
  const g = c.getContext('2d');
  g.scale(ratio, ratio);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, geo.width, geo.height);
  g.fillStyle = '#000';
  for (const [x, w] of geo.bars) g.fillRect(x, geo.top, w, geo.barHeight);
  if (geo.text) {
    g.font = geo.text.size + 'px ' + geo.text.font;
    g.textAlign = 'center';
    g.fillText(geo.text.value, geo.text.x, geo.text.y);
  }
  return c;
}

// The row of "SVG" "PNG" buttons under a code; getPng gives a canvas or a promise of a PNG blob.
// extra: more buttons first.
export function exportRow(name, getSvg, getPng, extra = []) {
  const btn = (label, title, fn) => {
    const b = h('button', { class: 'copy', type: 'button', title, text: label });
    b.addEventListener('click', fn);
    return b;
  };
  return h('div', { class: 'export-row' }, ...extra.map((x) => btn(x.label, x.title || x.label, x.click)),
    btn('SVG', 'Save as SVG (scales to any size)', () => saveSvg(name + '.svg', getSvg())),
    btn('PNG', 'Save as PNG', () => savePng(name + '.png', getPng())));
}
