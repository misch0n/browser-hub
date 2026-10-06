// Search across everything: notes, tasks, events, snippets, links to read,
// diagrams, your aliases and engines, built-in commands and command history. Pure: documents in, ranked groups out.
//
// Queries:
//   flour milk          every word must match, in any field (any case)
//   "oat milk"          a quoted phrase matches as one piece
//   /^buy\s/i           a regular expression (flags allowed, `i` if none given)
//   in:tasks flour      only one category (notes, tasks, events, snippets, later, diagrams, links, commands, history)
//
// Words match as a whole word (best), the start of a word, anywhere in a
// word, or fuzzily (the letters in order, close together: `pmt` finds
// "payment"). Each result keeps the ranges it matched, for highlighting.

import { tokenize } from './args.js';

export const CATEGORIES = [
  { id: 'tasks', label: 'Tasks', weight: 1 },
  { id: 'notes', label: 'Notes', weight: 1 },
  { id: 'events', label: 'Events', weight: 1 },
  { id: 'snippets', label: 'Snippets', weight: 1 },
  { id: 'later', label: 'Read later', weight: 1 },
  { id: 'diagrams', label: 'Diagrams', weight: 1 },
  { id: 'links', label: 'Your aliases and engines', weight: 1 },
  { id: 'commands', label: 'Built-in commands', weight: 0.8 },
  { id: 'history', label: 'Command history', weight: 0.5 },
];

const isWordChar = (c) => /[\p{L}\p{N}_]/u.test(c);

// Best match of `term` (lower case) in `text`: { score, ranges } or null.
export function matchTerm(term, text) {
  const t = text.toLowerCase();
  let best = null;
  let at = t.indexOf(term);
  while (at >= 0) {
    const startsWord = at === 0 || !isWordChar(t[at - 1]);
    const endsWord = at + term.length === t.length || !isWordChar(t[at + term.length]);
    const score = startsWord && endsWord ? 100 : startsWord ? 70 : 50;
    if (!best || score > best.score) best = { score, ranges: [[at, at + term.length]] };
    if (score === 100) break;
    at = t.indexOf(term, at + 1);
  }
  if (best || term.length < 3) return best;
  // Fuzzy: the letters in order; the tighter the better, a fair way below a real substring.
  let from = 0;
  let fuzzy = null;
  while (from < t.length) {
    const start = t.indexOf(term[0], from);
    if (start < 0) break;
    const ranges = [];
    let j = start;
    for (const ch of term) {
      const k = t.indexOf(ch, j);
      if (k < 0) { j = -1; break; }
      if (ranges.length && ranges[ranges.length - 1][1] === k) ranges[ranges.length - 1][1] = k + 1;
      else ranges.push([k, k + 1]);
      j = k + 1;
    }
    if (j < 0) break;
    const span = j - start;
    if (span <= term.length * 3) {
      const score = 10 + 25 * (term.length / span) - ranges.length;
      if (!fuzzy || score > fuzzy.score) fuzzy = { score, ranges };
    }
    from = start + 1;
  }
  return fuzzy;
}

// '/re/flags' -> RegExp, a string error, or null when `q` isn't a regex.
export function parseRegex(q) {
  const m = /^\/(.+)\/([a-z]*)$/s.exec(q.trim());
  if (!m) return null;
  try {
    const flags = (m[2] || 'i').replace(/[gy]/g, '');
    return new RegExp(m[1], flags);
  } catch (e) {
    return 'not a valid regular expression: ' + e.message;
  }
}

function regexRanges(re, text) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const ranges = [];
  let m;
  while ((m = g.exec(text)) && ranges.length < 20) {
    if (m[0].length === 0) { g.lastIndex++; continue; }
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

// Documents to search: { category, key, title, fields: [{ name, text, weight }], meta?, run?, rank? }
export function documents(state, defs, isBuiltin) {
  const docs = [];
  for (const t of state.tasks.items) {
    docs.push({
      category: 'tasks', key: t.id, title: t.text, run: 'tasks ' + t.id, rank: t.done ? 0.6 : 1,
      fields: [{ name: 'text', text: t.text, weight: 1 }, { name: 'tags', text: t.tags.map((x) => '#' + x).join(' '), weight: 0.8 },
        { name: 'id', text: t.id, weight: 0.6 }],
      task: t,
    });
  }
  for (const n of state.notes.items) {
    docs.push({ category: 'notes', key: n.id, title: n.text, run: 'notes ' + n.id, rank: 1,
      fields: [{ name: 'text', text: n.text, weight: 1 }, { name: 'id', text: n.id, weight: 0.6 }], note: n });
  }
  for (const e of state.events.items) {
    docs.push({ category: 'events', key: e.id, title: e.title, run: 'events ' + e.id, rank: 1,
      fields: [{ name: 'title', text: e.title, weight: 1 }, { name: 'date', text: e.date + (e.time ? ' ' + e.time : ''), weight: 0.7 },
        { name: 'id', text: e.id, weight: 0.6 }], event: e });
  }
  for (const s of state.snippets ? state.snippets.items : []) {
    docs.push({ category: 'snippets', key: s.id, title: s.name, run: 'snippets ' + s.id, rank: 1,
      fields: [{ name: 'name', text: s.name, weight: 1.2 }, { name: 'text', text: s.text, weight: 1 }, { name: 'id', text: s.id, weight: 0.6 }], snippet: s });
  }
  for (const l of state.later ? state.later.items : []) {
    docs.push({ category: 'later', key: l.id, title: l.title || l.url, run: 'later ' + l.id, rank: l.read ? 0.6 : 1,
      fields: [{ name: 'title', text: l.title || '', weight: 1 }, { name: 'url', text: l.url, weight: 0.8 }, { name: 'id', text: l.id, weight: 0.6 }], link: l });
  }
  for (const d of state.diagrams ? state.diagrams.items : []) {
    docs.push({ category: 'diagrams', key: d.id, title: d.name, run: 'diagrams ' + d.id, rank: 1,
      fields: [{ name: 'name', text: d.name, weight: 1.2 }, { name: 'code', text: d.code, weight: 0.8 }, { name: 'id', text: d.id, weight: 0.6 }], diagram: d });
  }
  for (const a of state.aliases.entries) {
    if (isBuiltin && isBuiltin(a.name)) continue;
    docs.push({ category: 'links', key: a.name, title: a.name, run: 'aliases ' + a.name, rank: 1,
      fields: [{ name: 'name', text: a.name, weight: 1.2 }, { name: 'url', text: a.template || a.base, weight: 0.6 }], alias: a });
  }
  for (const d of defs.filter((x) => !x.hidden)) {
    docs.push({ category: 'commands', key: d.name, title: d.name, run: 'help ' + d.name, rank: 1,
      fields: [{ name: 'name', text: d.name, weight: 1.2 }, { name: 'about', text: d.desc, weight: 0.7 }], def: d });
  }
  const seen = new Set();
  for (const h of state.history.items.slice().reverse()) {
    if (seen.has(h) || /^find\s/i.test(h)) continue; // earlier searches would only echo the query
    seen.add(h);
    docs.push({ category: 'history', key: h, title: h, rank: 1, fields: [{ name: 'command', text: h, weight: 1 }] });
  }
  return docs;
}

// -> { error } | { groups: [{ category, label, total, results: [{ doc, score, hits: { field: ranges } }] }], total, regex }
export function search(query, docs, opts = {}) {
  let q = String(query).trim();
  let only = null;
  const inM = /(?:^|\s)in:(\w+)(?=\s|$)/i.exec(q);
  if (inM) {
    only = inM[1].toLowerCase();
    if (!CATEGORIES.some((c) => c.id === only)) return { error: "unknown category '" + inM[1] + "' (" + CATEGORIES.map((c) => c.id).join(', ') + ')' };
    q = (q.slice(0, inM.index) + ' ' + q.slice(inM.index + inM[0].length)).trim();
  }
  if (!q) return { error: 'nothing to search for' };
  const re = parseRegex(q);
  if (typeof re === 'string') return { error: re };
  const terms = re ? null : tokenize(q).map((t) => t.text.toLowerCase()).filter(Boolean);

  const results = [];
  for (const doc of docs) {
    if (only && doc.category !== only) continue;
    const hits = {};
    let score = 0;
    if (re) {
      for (const f of doc.fields) {
        re.lastIndex = 0;
        if (!f.text || !re.test(f.text)) continue;
        hits[f.name] = regexRanges(re, f.text);
        score = Math.max(score, 60 * f.weight);
      }
      if (!score) continue;
    } else {
      let all = true;
      for (const term of terms) {
        let best = null;
        for (const f of doc.fields) {
          const m = f.text ? matchTerm(term, f.text) : null;
          if (m && (!best || m.score * f.weight > best.score)) best = { score: m.score * f.weight, field: f.name, ranges: m.ranges };
        }
        if (!best) { all = false; break; }
        score += best.score;
        (hits[best.field] = hits[best.field] || []).push(...best.ranges);
      }
      if (!all) continue;
      // The whole query as one phrase in the main field ranks higher still.
      if (terms.length > 1 && doc.fields[0].text.toLowerCase().includes(terms.join(' '))) score += 40;
      score /= terms.length;
    }
    const cat = CATEGORIES.find((c) => c.id === doc.category);
    results.push({ doc, score: score * cat.weight * (doc.rank || 1), hits });
  }

  const limit = opts.limit || 8;
  const groups = CATEGORIES.map((c) => {
    const rs = results.filter((r) => r.doc.category === c.id).sort((a, b) => b.score - a.score || (a.doc.title < b.doc.title ? -1 : 1));
    return { category: c.id, label: c.label, total: rs.length, top: rs.length ? rs[0].score : 0, results: only ? rs : rs.slice(0, limit) };
  }).filter((g) => g.total).sort((a, b) => b.top - a.top);
  return { groups, total: results.length, regex: !!re, only };
}

// `text` as segments with the hit ranges marked: [[text, cls], …].
export function highlight(text, ranges, cls = '') {
  if (!ranges || !ranges.length) return [[text, cls]];
  const rs = ranges.slice().sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of rs) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out = [];
  let i = 0;
  for (const [a, b] of merged) {
    if (a > i) out.push([text.slice(i, a), cls]);
    out.push([text.slice(a, b), (cls ? cls + ' ' : '') + 'hl']);
    i = b;
  }
  if (i < text.length) out.push([text.slice(i), cls]);
  return out;
}
