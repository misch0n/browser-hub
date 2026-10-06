// Text utilities for `text`: lines deduplicated, sorted, trimmed; find and
// replace; lorem ipsum. Pure functions on strings.

export const lines = (t) => String(t).replace(/\r\n?/g, '\n').split('\n');

// -> { text, removed }
export function dedupe(text, { ignoreCase = false } = {}) {
  const seen = new Set();
  const out = [];
  for (const l of lines(text)) {
    const k = ignoreCase ? l.toLowerCase() : l;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return { text: out.join('\n'), removed: lines(text).length - out.length };
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
// opts: { desc, numeric (by the first number in each line), unique, ignoreCase }
export function sortLines(text, opts = {}) {
  let ls = lines(text).filter((l, i, a) => !(i === a.length - 1 && l === '')); // a final newline isn't a line
  if (opts.unique) ls = [...new Set(ls)];
  const num = (l) => { const m = /-?\d+(?:\.\d+)?/.exec(l); return m ? Number(m[0]) : Infinity; };
  ls.sort(opts.numeric ? (a, b) => num(a) - num(b) || collator.compare(a, b) : opts.ignoreCase === false ? (a, b) => (a < b ? -1 : a > b ? 1 : 0) : collator.compare);
  if (opts.desc) ls.reverse();
  return ls.join('\n');
}

// Each line trimmed, runs of blank lines squeezed to one, blank ends removed.
export function trimText(text) {
  const out = [];
  for (const l of lines(text).map((x) => x.replace(/\s+$/, '').replace(/^\s+/, ''))) {
    if (l === '' && (out.length === 0 || out[out.length - 1] === '')) continue;
    out.push(l);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

// find: a literal, or /regex/flags. -> { text, count }
export function replaceText(text, find, replacement) {
  const m = /^\/(.+)\/([a-z]*)$/s.exec(find);
  let re;
  if (m) re = new RegExp(m[1], m[2].includes('g') ? m[2] : m[2] + 'g');
  else re = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  let count = 0;
  const out = String(text).replace(re, (...args) => {
    count++;
    if (!m) return replacement;
    // $1 … $9 and $& in a regex replacement, as in JavaScript.
    const groups = args.slice(1, -2);
    return replacement.replace(/\$(\d|&)/g, (_, g) => (g === '&' ? args[0] : groups[Number(g) - 1] ?? ''));
  });
  return { text: out, count };
}

export function stats(text) {
  const t = String(text);
  return {
    lines: t === '' ? 0 : lines(t).length,
    words: (t.match(/\S+/g) || []).length,
    characters: [...t].length,
    bytes: new TextEncoder().encode(t).length,
  };
}

// ---- lorem ipsum ---------------------------------------------------------------------

const WORDS = ('lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut ' +
  'enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in ' +
  'reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in ' +
  'culpa qui officia deserunt mollit anim id est laborum').split(' ');

// A deterministic stream from the classic passage (the same every time, so it's reproducible).
function wordStream(n, offset = 0) {
  return Array.from({ length: n }, (_, i) => WORDS[(i + offset) % WORDS.length]);
}
const sentence = (ws) => ws[0][0].toUpperCase() + ws.join(' ').slice(1) + '.';

// unit: 'words' | 'sentences' | 'paragraphs'
export function lorem(count, unit = 'paragraphs') {
  if (unit.startsWith('word')) return sentence(wordStream(count)).replace(/\.$/, '');
  const sentences = (k, off) => Array.from({ length: k }, (_, i) => sentence(wordStream(8 + ((i * 5 + off) % 9), (i * 13 + off * 7) % WORDS.length)));
  if (unit.startsWith('sentence')) return sentences(count, 0).join(' ');
  return Array.from({ length: count }, (_, p) => sentences(5, p).join(' ')).join('\n\n');
}
