// Web addresses in pasted text (tab titles and addresses copied together, a
// note, an email). Pure.
//
//   extractUrls(text) -> { urls: [href], duplicates: n }
//
// Takes http(s):// addresses and ones starting www. (given https://), in the
// order they appear, each once. Punctuation that ends a sentence or closes a
// bracket around the address is left out, unless the address opened that
// bracket itself (…/wiki/Alien_(film)). Anything else (javascript:, file:,
// bare words) is ignored.

const CANDIDATE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const PAIRS = { ')': '(', ']': '[', '}': '{' };

function trimEnd(s) {
  let t = s;
  for (;;) {
    const last = t[t.length - 1];
    if (/[.,;:!?»”’'"]/.test(last)) { t = t.slice(0, -1); continue; }
    if (PAIRS[last]) {
      const opens = t.split(PAIRS[last]).length - 1;
      const closes = t.split(last).length - 1;
      if (closes > opens) { t = t.slice(0, -1); continue; }
    }
    return t;
  }
}

export function extractUrls(text) {
  const urls = [];
  const seen = new Set();
  let duplicates = 0;
  for (const m of String(text || '').matchAll(CANDIDATE)) {
    const raw = trimEnd(m[0]);
    let u;
    try {
      u = new URL(/^www\./i.test(raw) ? 'https://' + raw : raw);
    } catch (e) {
      continue;
    }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname.includes('.')) continue;
    if (seen.has(u.href)) { duplicates++; continue; }
    seen.add(u.href);
    urls.push(u.href);
  }
  return { urls, duplicates };
}
