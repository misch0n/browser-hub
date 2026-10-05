// Copies the site into <outdir> with every asset URL stamped with <version>
// (index.html links, and each relative import inside the JS modules), so a
// browser can never combine a new page with a stale cached stylesheet or
// module. GitHub Pages can't set Cache-Control, and Safari keeps old copies.
//
//   node tools/build-site.mjs _site <version>
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [out, version] = process.argv.slice(2);
if (!out || !version || !/^[\w.-]+$/.test(version)) {
  console.error('usage: node tools/build-site.mjs <outdir> <version>');
  process.exit(2);
}
const q = '?v=' + version;
const fail = (msg) => { console.error('build-site: ' + msg); process.exit(1); };

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ['style.css', 'themes.css', 'js']) cpSync(f, join(out, f), { recursive: true });

// index.html: the four entry points.
let html = readFileSync('index.html', 'utf8');
const entries = ['themes.css', 'style.css', 'js/boot.js', 'js/main.js'];
for (const e of entries) {
  const before = html;
  html = html.replace(new RegExp('(href|src)="' + e.replace(/\./g, '\\.') + '"'), '$1="' + e + q + '"');
  if (html === before) fail('index.html no longer references ' + e);
}
writeFileSync(join(out, 'index.html'), html);

// Modules: every relative static import.
let rewritten = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!p.endsWith('.js')) continue;
    const src = readFileSync(p, 'utf8');
    const next = src.replace(/(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g, (m, kw, quote, spec) => {
      rewritten++;
      return kw + quote + spec + q + quote;
    });
    if (/(\bfrom\s+|\bimport\s*\(\s*)['"]\.{1,2}\/[^'"]*\.js['"]/.test(next)) fail('unstamped import left in ' + p);
    writeFileSync(p, next);
  }
};
walk(join(out, 'js'));
if (!rewritten) fail('no module imports found to stamp');
console.log('built ' + out + ' (' + version + '): ' + rewritten + ' module imports stamped');
