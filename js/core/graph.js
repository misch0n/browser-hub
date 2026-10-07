import { distance, useCounts } from './completion.js';

// Graph mode (experimental, opt-in): input that starts with `graph ` is read as
// a position in the command grammar rather than a prefix to complete. Nodes are
// commands, their words (subcommands, known values) and typed placeholders;
// edges are what may come next. The page shows everything reachable from where
// the input is (the fan), so composing a command is choosing, not recalling.
//
// The grammar is read from what the commands already declare: each def's
// `usage` lines (literal words, <placeholders>, [optional parts], a|b) and its
// `complete(prev)` (known values: ids, food names, fields). Nothing about
// running changes: `run` is the text after `graph `, byte for byte, except
// that a mistyped word that resolves to one known word is replaced by it.
//
//   graphView(text, env) -> view | null (null when `text` isn't in graph mode)
//     env: { defs: [all defs, hidden too], entries: [alias entries], history: [strings],
//            counts: { 'cook convert': n, … }, sort: 'freq' | 'alpha' }
//     view: { path: [node], focus: { start, end, query }, ambiguous, offMap,
//             fan: [{ value, label, kind, ph, match }] (the nodes that can come next, in a stable
//             order), sel (the best match in fan), columns: [column] (one per word: see
//             settledColumn), lines: [usage line], run, canEnd, key,
//             forward (the tree ahead of the cursor: see forwardOf) }
//   commandNode(def) -> the command's tree in the graph    neighbors(node, prev) -> what can follow it
//   accept(text, view, i) -> text with fan item i taken (null when it can't be)
//   pick(text, view, col, i) -> text with item i of column col taken
//   back(text) -> text with the last whole word removed (null when there is none)
//   leave(text) -> the text without `graph `     countKeys(view) -> node paths to count

export const KEYWORD = 'graph';
const PREFIX = /^(\s*graph\s+)/i;
export const SORTS = ['freq', 'alpha'];
const MAX_EXPANSIONS = 400; // linear forms of one usage line ([a] [b] [c] … doubles each time)
const MAX_STATES = 2000;
const MAX_LINES = 4; // usage lines under the fan

export const isGraph = (text) => PREFIX.test(String(text));
export function leave(text) {
  const m = PREFIX.exec(text);
  return m ? text.slice(m[1].length) : text;
}

// ---- usage lines -------------------------------------------------------------------
// 'cook convert <amount> <measure> <ingredient>', 'n <id> [edit [<field> [<value>]] | rm]',
// 'barcode code128|code39 <text>', 'font bigger | smaller' …

function lexUsage(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '[' || c === ']' || c === '|') { out.push(c); i++; continue; }
    let w = '';
    let glued = 0; // brackets inside a word ('/<regex>/[flags]', '09:00[:SS]') belong to it
    while (i < s.length) {
      const ch = s[i];
      if (ch === '<' || ch === '"') {
        const j = s.indexOf(ch === '<' ? '>' : '"', i + 1);
        const end = j < 0 ? s.length : j + 1;
        w += s.slice(i, end);
        i = end;
        continue;
      }
      if (ch === '[') { glued++; w += ch; i++; continue; }
      if (ch === ']') { if (!glued) break; glued--; w += ch; i++; continue; }
      if (/\s/.test(ch)) break;
      w += ch;
      i++;
    }
    out.push(w);
  }
  return out;
}

// Bare words in usage that name a value rather than being typed as they are,
// inside [ ] only ('[food]', '[key]'; but 'crypt key <PEM>', 'ping <host> count <n>').
const PH_WORDS = new Set(['food', 'weight', 'temperature', 'doneness', 'filter', 'title', 'code', 'name', 'key', 'directory', 'timestamp',
  'date', 'template', 'command', 'digits', 'length', 'count', 'percent', 'n', 'month', 'year', 'type', 'flags', 'max', 'min', 'amount']);
// Placeholders that take the rest of the line (free text).
const REST = /^(text|words|phrase|title|code|expr|paste|message|payload|ciphertext|command|search words|arguments|…)/;
const NUMBER = /^(amount|n|length|count|digits|max|min|seconds|percent|px|sides|k|number|bars|timestamp|year|week|modifier|weight)\b/;
// Placeholders that are one word even at the end of a line.
const SINGLE = /^(id( \| name)?|name|zone|field|device|code|month|type|alg|extension \| file name|domain|IP address|address|host( \| url)?)$/;

function typeOf(name) {
  if (NUMBER.test(name)) return 'number';
  if (/date/.test(name)) return 'date';
  if (name === 'HH:MM') return 'time';
  if (/^url\b|target/.test(name)) return 'url';
  return 'text';
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A placeholder element. `re` is set when the word has literal parts
// ('due:<date>', 'f<n>', '#tag', 'x<count>'), so only matching tokens fit it.
function placeholder(word, bare) {
  const quoted = /^"<([^>]*)>"$/.exec(word);
  const m = /^<([^>]*)>$/.exec(word) || quoted || (bare ? [word, word] : null);
  const name = m ? m[1].trim() : word.replace(/…$/, '').trim() || '…';
  let re = quoted ? /^"/ : null;
  if (!m && word !== '…') {
    const parts = word.split(/(<[^>]*>|\[[^\]]*\])/).filter(Boolean)
      .map((p) => (p[0] === '<' ? '.+' : p[0] === '[' ? '(?:' + escapeRe(p.slice(1, -1)).replace(/<[^>]*>/g, '.+') + ')?' : escapeRe(p)));
    re = new RegExp('^' + parts.join('') + '$', 'i');
  }
  const type = m ? typeOf(name) : 'text';
  const display = m ? '<' + name + (type !== 'text' ? ':' + type : '') + '>' : word;
  return { ph: name, type, re, rest: REST.test(name) || /…$/.test(word), display: quoted ? '"' + display + '"' : display };
}

const isLiteral = (w) => /^[a-z@.+±-]?[a-z0-9@._+±-]*$/i.test(w) && !/^(YYYY|HH|MM)/.test(w) && !/^\d+[-:]/.test(w);

// One usage word: literal alternatives ('next|last'), a placeholder, or a mix ('top|up|<n>').
function wordElements(w, inBrackets) {
  if (/…$/.test(w) || /^".*"$/.test(w) || w.includes('[') || w.includes('/') || w.includes(':')) return [placeholder(w)];
  const alts = w.split(/\|(?![^<]*>)/).filter(Boolean); // not the | in '<id | name>'
  const els = [];
  const lits = [];
  for (const a of alts) {
    if (inBrackets && PH_WORDS.has(a)) els.push(placeholder(a, true));
    else if (isLiteral(a)) lits.push(a);
    else els.push(placeholder(a));
  }
  if (lits.length) els.unshift({ lit: lits.map((a) => a.toLowerCase()), words: lits });
  return els;
}

// Usage tokens -> tree: { seq: [item] } with items { el } | { opt: [seq] } | { alt: [seq] }.
// Inside [ ] a lone | separates whole sequences; outside it joins its neighbours
// ('font bigger | smaller').
function parseTokens(tokens) {
  let i = 0;
  let depth = 0; // inside [ ]
  function seq(inBrackets) {
    const items = [];
    while (i < tokens.length) {
      const t = tokens[i];
      if (t === ']') break;
      if (t === '|') {
        if (inBrackets) break;
        i++;
        const prev = items.pop();
        const next = item();
        if (prev && next) items.push({ alt: [[prev], [next]] });
        else if (prev || next) items.push(prev || next);
        continue;
      }
      const it = item();
      if (it) items.push(it);
    }
    return items;
  }
  function item() {
    const t = tokens[i];
    if (t === undefined || t === ']' || t === '|') return null;
    i++;
    if (t === '[') {
      depth++;
      const alts = [seq(true)];
      while (tokens[i] === '|') { i++; alts.push(seq(true)); }
      if (tokens[i] === ']') i++;
      depth--;
      return { opt: alts };
    }
    const els = wordElements(t, depth > 0);
    return els.length === 1 ? { el: els[0] } : { alt: els.map((e) => [{ el: e }]) };
  }
  return seq(false);
}

// Every linear form of a sequence (optional parts in and out), capped.
function expand(items) {
  let forms = [[]];
  for (const it of items) {
    let choices;
    if (it.el) choices = [[it.el]];
    else if (it.opt) choices = [[], ...it.opt.flatMap(expand)];
    else choices = it.alt.flatMap(expand);
    const next = [];
    for (const f of forms) for (const c of choices) if (next.length < MAX_EXPANSIONS) next.push(f.concat(c));
    forms = next;
  }
  return forms;
}

// A usage line without its command name -> [{ seq: [element], line }].
export function parseUsage(line) {
  const tokens = lexUsage(String(line));
  tokens.shift(); // the command's own name
  return expand(parseTokens(tokens)).map((seq) => {
    // The last placeholder of a form takes what is left ('cook convert 2 cups plain flour').
    const last = seq[seq.length - 1];
    if (last && last.ph && !last.rest && !last.re && last.type !== 'number' && !SINGLE.test(last.ph)) seq[seq.length - 1] = Object.assign({}, last, { rest: true });
    return { seq, line };
  });
}

const parsed = new WeakMap();
function formsOf(def) {
  if (!parsed.has(def)) parsed.set(def, (def.usage || []).flatMap(parseUsage));
  return parsed.get(def);
}

// ---- the command graph -------------------------------------------------------------
// The explicit structure everything else reads: each command's usage forms
// merged into a tree of element nodes (forms sharing a start share nodes).
//   node: { id, kind: 'command' | 'word' | 'param', name (the command), el (the
//           usage element: { lit, words } or a placeholder), children: [node],
//           end (a complete command can stop here), lines: [usage lines through it],
//           level (words from the command), depth (longest path below) }
// A free-text placeholder (el.rest) can take any number of words: reading stays on it.
// Known values (ids, fields, foods) aren't nodes: they come from the command's
// complete() for the path so far (neighbors()).

let nodeN = 0;
const tries = new WeakMap();
const elKey = (el) => (el.lit ? 'w:' + el.words.join('|') : 'p:' + el.display + (el.rest ? '…' : '') + (el.re ? '/' + el.re.source : ''));

// The tree of one command (built once per def).
export function commandNode(def) {
  if (tries.has(def)) return tries.get(def);
  const root = { id: ++nodeN, kind: 'command', name: def.name, def, el: null, children: [], end: !def.usage || !def.usage.length, lines: [], level: 0, depth: 0 };
  const addLine = (n, line) => { if (!n.lines.includes(line)) n.lines.push(line); };
  for (const form of formsOf(def)) {
    let n = root;
    addLine(n, form.line);
    for (const el of form.seq) {
      const key = elKey(el);
      let c = n.children.find((x) => x.key === key);
      if (!c) {
        c = { id: ++nodeN, key, kind: el.lit ? 'word' : 'param', name: def.name, def, el, children: [], end: false, lines: [], level: n.level + 1, depth: 0 };
        n.children.push(c);
      }
      addLine(c, form.line);
      n = c;
    }
    n.end = true;
  }
  const depth = (n) => (n.depth = n.children.reduce((m, c) => Math.max(m, 1 + depth(c)), 0));
  depth(root);
  // The fullest continuations first, so a value is named after its place in the
  // whole line ('cook oven chicken': <food>, not <doneness>).
  const order = (n) => { n.children.sort((a, b) => b.depth - a.depth); n.children.forEach(order); };
  order(root);
  tries.set(def, root);
  return root;
}

// What can follow a node: its child words and placeholders, and the values the
// command knows there (from its complete() for the words so far).
//   -> [{ value, label, kind: 'word' | 'param', node?, el? }]
export function neighbors(node, prev = []) {
  const out = [];
  const seen = new Set();
  const word = (value, label, child) => {
    const k = value.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ value, label: label || '', kind: 'word', node: child || null });
  };
  let known = [];
  try { known = node.def && node.def.complete ? node.def.complete(prev.map((p) => p.toLowerCase())) || [] : []; } catch (e) { known = []; }
  for (const k of known) if (k && typeof k.value === 'string') word(k.value, k.label);
  for (const c of node.children) {
    if (c.el.lit) c.el.words.forEach((w) => word(w, '', c));
    else out.push({ value: c.el.display, label: c.el.rest ? 'free text' : 'a value', kind: 'param', node: c, el: c.el });
  }
  return out;
}

// ---- fuzzy matching ----------------------------------------------------------------
// Tiers, best first: 5 the same word, 4 its start, 3 one typo, 2 one typo in its
// start or two in a long word, 1 its letters in order from the first. 0: no match.
export function tier(query, value) {
  const q = query.toLowerCase();
  const v = String(value).toLowerCase();
  if (!q) return 0;
  if (q === v) return 5;
  if (v.startsWith(q)) return 4;
  if (q.length >= 3 && distance(q, v) === 1) return 3;
  if (q.length >= 3 && v.length > q.length && distance(q, v.slice(0, q.length)) === 1) return 2;
  if (q.length >= 5 && distance(q, v) === 2) return 2;
  if (q.length >= 2 && q[0] === v[0]) {
    let j = 0;
    for (let i = 0; i < v.length && j < q.length; i++) if (v[i] === q[j]) j++;
    if (j === q.length) return 1;
  }
  return 0;
}

// The best match for `query` among `cands`: { pick } when one word wins,
// { top } when several tie for the best tier, {} when nothing is close.
export function resolveWord(query, cands) {
  let best = 0;
  let top = [];
  for (const c of cands) {
    const t = tier(query, c.value);
    if (t > best) { best = t; top = [c]; } else if (t && t === best) top.push(c);
  }
  if (!top.length) return {};
  if (top.length === 1) return { pick: top[0], tier: best };
  return { top, tier: best };
}

// ---- levels: what can come next ------------------------------------------------------

const SORT_DEF = { name: ':sort', desc: 'rank the graph: by use (freq) or a to z (alpha)', usage: [':sort freq|alpha'] };

function rootLevel(env) {
  const builtins = new Set(env.defs.map((d) => d.name));
  const lits = env.defs.filter((d) => !d.hidden && d.name !== KEYWORD).map((d) => ({ value: d.name, label: d.desc, kind: 'command' }));
  for (const e of env.entries) {
    if (builtins.has(e.name)) continue; // shadowed by a built-in: inactive
    lits.push({ value: e.name, label: e.command || e.template || e.base, kind: e.command ? 'alias' : e.template ? 'engine' : 'alias' });
  }
  lits.push({ value: SORT_DEF.name, label: SORT_DEF.desc, kind: 'graph' });
  return { root: true, lits, phs: [], canEnd: false, takers: [] };
}

// The pseudo-def for a user alias: an engine takes words, an alias may take more.
function entryDef(e) {
  return { name: e.name, usage: [e.template ? e.name + ' <search words>' : e.name + ' [arguments]'] };
}

function defFor(name, env) {
  const n = name.toLowerCase();
  if (n === SORT_DEF.name) return SORT_DEF;
  const def = env.defs.find((d) => d.name === n);
  if (def) return def;
  const e = env.entries.find((x) => x.name === n);
  return e ? entryDef(e) : null;
}

// The words and placeholders that can follow, from the positions that matched
// best so far (a typed word beats a placeholder taking it) and from the
// command's own completion. A position: { node, in (inside free text), score }.
function levelOf(def, prev, states) {
  const lits = [];
  const seen = new Set();
  const addLit = (value, label) => {
    const k = value.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    lits.push({ value, label: label || '', kind: 'word' });
  };
  let known = [];
  try { known = def.complete ? def.complete(prev.map((p) => p.toLowerCase())) || [] : []; } catch (e) { known = []; }
  for (const k of known) if (k && typeof k.value === 'string') addLit(k.value, k.label);
  const best = states.reduce((m, s) => Math.max(m, s.score), -1);
  // The fullest forms first, so a value is named after its place in the whole line
  // ('cook oven chicken': <food>, not <doneness>).
  const primary = states.filter((s) => s.score === best);
  const lines = [...new Set(primary.flatMap((s) => s.node.lines))];
  primary.sort((a, b) => (b.node.level + b.node.depth) - (a.node.level + a.node.depth));
  const phs = [];
  const addPh = (el) => { if (!phs.includes(el) && !phs.some((p) => p.display === el.display)) phs.push(el); };
  let canEnd = !def.usage || !def.usage.length;
  for (const s of primary) {
    if (s.in) addPh(s.node.el); // free text can go on
    if (s.node.end) canEnd = true;
    for (const c of s.node.children) {
      if (c.el.lit) c.el.words.forEach((w) => addLit(w));
      else addPh(c.el);
    }
  }
  // Free text can take the next word unless a known word clearly beat it ('t t1 dne': done, not text).
  const takers = states.filter((s) => s.in && s.score >= best - 1);
  return { def, prev, states, lits, phs, canEnd, lines, takers };
}

// Moves every position over one token. Strength: a literal word 2, a placeholder
// with literal parts 1, a plain placeholder 0. A word the command knows (an id
// from its completion) counts as literal for a one-word placeholder (<id>),
// unless a literal word in the usage matches it too.
function advance(states, text, value, known) {
  const next = new Map();
  const put = (node, inRest, score) => {
    const k = node.id + (inRest ? '+' : '');
    const old = next.get(k);
    if (!old || old.score < score) next.set(k, { node, in: inRest, score });
  };
  const lower = String(value).toLowerCase();
  const litHit = states.some((s) => s.node.children.some((c) => c.el.lit && c.el.lit.includes(lower)));
  const bonus = known && !litHit ? 2 : 0;
  for (const s of states) {
    if (s.in) put(s.node, true, s.score);
    for (const c of s.node.children) {
      const el = c.el;
      if (el.lit) { if (el.lit.includes(lower)) put(c, false, s.score + 2); continue; }
      if (el.re) { if (el.re.test(text)) put(c, el.rest, s.score + 1 + (el.rest ? 0 : bonus)); continue; }
      put(c, el.rest, s.score + (el.rest ? 0 : bonus));
    }
  }
  return [...next.values()].slice(0, MAX_STATES);
}
const startOf = (def) => [{ node: commandNode(def), in: false, score: 0 }];

// Does a placeholder take this text? (A number placeholder wants something numeric.)
function phTakes(el, text) {
  if (el.re) return el.re.test(text);
  if (el.type === 'number') return /^[-+]?[\d.,½¼¾⅓⅔⅛]/.test(text);
  return true;
}

// ---- reading the input -----------------------------------------------------------------

// Words of the input with where they are; a quoted phrase and a paste placeholder are one word.
function lexInput(body, offset) {
  const out = [];
  const re = /\[Pasted text #\d+[^\]]*\]|"[^"]*"?|\S+/g;
  let m;
  while ((m = re.exec(body))) out.push({ text: m[0], start: offset + m.index, end: offset + m.index + m[0].length });
  return out;
}

// One committed word at a level -> { node } or { ambiguous: [cands] }.
function matchWord(level, tok, env) {
  const t = tok.text;
  const lower = t.toLowerCase();
  if (level.root) {
    const exact = level.lits.find((c) => c.value.toLowerCase() === lower) ||
      (defFor(t, env) ? { value: lower, kind: 'command', label: '' } : null); // hidden names still work
    if (exact) return { node: { value: exact.value, text: t, kind: exact.kind === 'graph' ? 'graph' : 'command' } };
  } else {
    const exact = level.lits.find((c) => c.value.toLowerCase() === lower);
    if (exact) return { node: { value: exact.value, text: t, kind: 'word' } };
    // A placeholder takes it as it is: free text is never "corrected".
    // Named after the closest fit: literal parts, then the fullest form's placeholder
    // that suits it (not a number for a word; not an <id> the command doesn't know).
    const ph = level.phs.find((el) => el.re && el.re.test(t)) ||
      level.phs.find((el) => !el.re && phTakes(el, t) && !/^id\b/.test(el.ph)) || level.phs.find((el) => !el.re);
    const inRest = level.takers[0];
    if (ph || inRest) {
      const el = ph || inRest.node.el;
      return { node: { value: t, text: t, kind: 'param', label: el.display, rest: !!el.rest } };
    }
  }
  const r = resolveWord(t, level.lits);
  if (r.pick) return { node: { value: r.pick.value, text: t, kind: level.root ? 'command' : 'word', corrected: true } };
  if (r.top) return { ambiguous: r.top };
  return { node: { value: t, text: t, kind: 'raw' } };
}
function nextLevel(level, node, env, prev) {
  if (level.root) {
    const def = defFor(node.value, env);
    if (!def) return null;
    return levelOf(def, [], startOf(def));
  }
  const states = advance(level.states, node.text, node.value, node.kind === 'word');
  return levelOf(level.def, prev, states);
}

// The nodes of a level in a stable order, so the ones around the chosen node
// stay put while you type: by use (freq) or a to z, placeholders and :sort last.
// Each carries how well it matches `query` (t: tier; 0.5 a placeholder that takes it).
function order(level, query, env, pathKey) {
  if (!level) return [];
  const uses = level.root ? useCounts(env.history || []) : {};
  const counts = env.counts || {};
  const freq = (v) => (counts[(pathKey ? pathKey + ' ' : '') + v.toLowerCase()] || 0) + (uses[v.toLowerCase()] || 0);
  const items = [
    ...level.lits.map((c) => ({ value: c.value, label: c.label, kind: c.kind, ph: false, t: tier(query, c.value) })),
    ...level.phs.map((el) => ({ value: el.display, label: el.rest ? 'free text, as many words as you like' : 'a value you type', kind: 'param', ph: true, rest: !!el.rest, t: query && phTakes(el, query) ? 0.5 : 0 })),
  ];
  for (const it of items) it.match = !query || it.t > 0;
  const last = (it) => (it.ph ? 2 : it.kind === 'graph' ? 1 : 0);
  const byFreq = env.sort !== 'alpha';
  // Placeholders keep the grammar's order (free text being typed first).
  const alpha = (a, b) => (a.value.toLowerCase() < b.value.toLowerCase() ? -1 : a.value.toLowerCase() > b.value.toLowerCase() ? 1 : 0);
  items.sort((a, b) => (last(a) - last(b)) || (a.ph ? 0 : (byFreq ? freq(b.value) - freq(a.value) : 0) || alpha(a, b)));
  return items;
}

// The best match: the highest tier, the first in order on a tie (so by use, then a to z). -1: none.
function best(items) {
  let at = -1;
  items.forEach((it, i) => { if (it.t > 0 && (at < 0 || it.t > items[at].t)) at = i; });
  return at;
}

// Where a word nothing knows would sort among the words of a level.
function slot(items, word) {
  const w = word.toLowerCase();
  const i = items.findIndex((it) => it.ph || it.kind === 'graph' || it.value.toLowerCase() > w);
  return i < 0 ? items.length : i;
}

const nodeKey = (n) => (n.kind === 'param' ? n.label || '<value>' : n.value.toLowerCase());

// One column of the picture: the nodes of a level in order, and the one at its centre.
//   { items, at (index of the centre, or where it would sort), hit (items[at] is it),
//     value, sub (a placeholder's name), kind, corrected, typed, start, end, active, pending }
function settledColumn(items, node, tok) {
  const col = { items, value: node.value, sub: '', kind: node.kind, corrected: !!node.corrected, typed: node.text, start: tok.start, end: tok.end };
  if (node.kind === 'param') {
    col.at = items.findIndex((it) => it.ph && it.value === node.label);
    col.sub = node.label;
  } else if (node.kind !== 'raw') {
    col.at = items.findIndex((it) => !it.ph && it.value.toLowerCase() === node.value.toLowerCase());
  } else col.at = -1;
  col.hit = col.at >= 0;
  if (!col.hit) col.at = slot(items, node.value);
  return col;
}

export function graphView(text, env) {
  const m = PREFIX.exec(String(text));
  if (!m) return null;
  const offset = m[1].length;
  const body = text.slice(offset);
  const tokens = lexInput(body, offset);
  const trailing = !body || /\s$/.test(body);
  const committed = trailing ? tokens : tokens.slice(0, -1);
  const partial = trailing ? { text: '', start: text.length, end: text.length } : tokens[tokens.length - 1];

  const path = [];
  const columns = [];
  let level = rootLevel(env);
  const prev = [];
  let focus = { start: partial.start, end: partial.end, query: partial.text };
  let ambiguous = false;
  let pending = [];
  let fixes = [];
  let offMap = false; // after a word nothing knows: the rest is kept as typed
  const keyOf = () => path.filter((n) => n.kind !== 'raw').map(nodeKey).join(' ');
  for (let i = 0; i < committed.length; i++) {
    const tok = committed[i];
    if (offMap || !level) {
      const node = { value: tok.text, text: tok.text, kind: 'raw' };
      path.push(node);
      columns.push(settledColumn([], node, tok));
      continue;
    }
    const r = matchWord(level, tok, env);
    if (r.ambiguous) {
      ambiguous = true;
      focus = { start: tok.start, end: tok.end, query: tok.text };
      pending = committed.slice(i + 1).concat(trailing ? [] : [partial]);
      break;
    }
    const node = r.node;
    const items = order(level, '', env, keyOf());
    path.push(node);
    // Words of one free-text placeholder share a column ('buy oat milk').
    const before = columns[columns.length - 1];
    if (node.kind === 'param' && node.rest && before && before.kind === 'param' && before.sub === node.label && before.rest) {
      before.value += ' ' + node.text;
      before.typed = before.value;
      before.end = tok.end;
    } else {
      const col = settledColumn(items, node, tok);
      col.rest = !!node.rest;
      columns.push(col);
    }
    if (node.corrected) fixes.push({ start: tok.start, end: tok.end, value: node.value });
    if (node.kind === 'raw' && level.root) { offMap = true; level = null; continue; }
    if (!level.root) prev.push(node.value);
    level = nextLevel(level, node, env, prev);
  }
  const pathKey = keyOf();
  const fan = order(level, focus.query, env, pathKey);
  // The column being typed in: the best match at its centre; typed text that
  // nothing matches sits where it would sort.
  let sel = 0;
  if (fan.length || focus.query) {
    const at = focus.query ? best(fan) : 0;
    const col = { items: fan, at, hit: at >= 0, value: '', sub: '', kind: 'miss', typed: focus.query, start: focus.start, end: focus.end, active: true };
    if (col.hit) {
      const it = fan[at];
      sel = at;
      Object.assign(col, it.ph ? { value: focus.query || it.value, sub: focus.query ? it.value : '', kind: 'param' } : { value: it.value, kind: it.kind });
    } else {
      col.at = slot(fan, focus.query);
      col.value = focus.query;
    }
    // More words of the free text before it: one column.
    const before = columns[columns.length - 1];
    if (col.kind === 'param' && fan[at].rest && focus.query && before && before.kind === 'param' && before.rest && before.sub === col.sub) {
      Object.assign(before, { items: fan, at, hit: true, value: before.value + ' ' + focus.query, typed: before.value + ' ' + focus.query, end: focus.end, active: true });
    } else columns.push(col);
  }
  for (const tok of pending) columns.push(Object.assign(settledColumn([], { value: tok.text, text: tok.text, kind: 'raw' }, tok), { pending: true }));

  // What Enter runs: the text as typed, with resolved words put right.
  let run = null;
  let canEnd = !!(level && level.canEnd);
  let last = null;
  if (!ambiguous) {
    if (!trailing && level && !offMap) {
      const r = matchWord(level, partial, env);
      if (r.ambiguous) ambiguous = true;
      else {
        last = r.node;
        if (last.corrected) fixes = fixes.concat([{ start: partial.start, end: partial.end, value: last.value }]);
      }
    }
    if (!ambiguous) {
      let s = text;
      for (const f of fixes.slice().reverse()) s = s.slice(0, f.start) + f.value + s.slice(f.end);
      run = leave(s).trim();
      if (last && level && !level.root) {
        const after = levelOf(level.def, prev.concat(last.value), advance(level.states, last.text, last.value, last.kind === 'word'));
        canEnd = after.canEnd;
      } else if (last && level && level.root) {
        const def = defFor(last.value, env);
        canEnd = !!def && levelOf(def, [], startOf(def)).canEnd;
      }
    }
  }
  return {
    path,
    full: last ? path.concat([last]) : path, // with the word being typed, once it resolves
    pending,
    focus,
    ambiguous,
    offMap,
    fan,
    sel,
    columns,
    lines: level && level.lines ? level.lines.slice(0, MAX_LINES) : [],
    more: level && level.lines ? Math.max(0, level.lines.length - MAX_LINES) : 0,
    run,
    canEnd,
    pathKey,
    key: focus.start + '\u0000' + focus.query + '\u0000' + pathKey,
    forward: forwardOf(offMap ? null : level, fan, sel, focus.query, path, prev, env),
  };
}

// ---- the forward pane ------------------------------------------------------------------
// From the cursor on: the letter tree of the words that can stand here (the ones
// the typed letters start), for each the next slot and the complete commands
// still reachable through it, and the open slots with recent values from history.
// Matching goes one word at a time, so this is the tree of one slot, rooted at
// the cursor; choosing a word moves the root to that word's next slot.
//   forward: { query, trie, words: [branch], typos: [branch], slots: [slot], more }
//   trie node: { edge (the letters on the way in; the root's is what's typed),
//                word (the branch ending here, or null), children: [node], size (words below) }
//   branch: { value, label, kind, rest (letters still to type), best, end (a complete
//             command once taken), next: [names of the slot after it], reach: [usage lines], more }
//   slot: { display, type, rest (free text), takes (what's typed fits), recent: [values] }
// The words keep the fan's stable order (by use or a to z); typos are words the
// typed letters reach only by a typo, or by their letters in order when nothing
// starts with them (shown apart, so a wrong landing is visible).

const MAX_BRANCHES = 60; // words that get their next slot worked out
const MAX_NEXT = 8;
const MAX_REACH = 3;
const MAX_RECENT = 3;

// Radix tree of `words` (branches), below the typed letters.
function letterTree(query, words) {
  const root = { edge: query, word: null, children: [], size: 0 };
  for (const w of words) {
    let n = root;
    n.size++;
    for (const ch of w.rest) {
      let c = n.children.find((x) => x.edge === ch);
      if (!c) { c = { edge: ch, word: null, children: [], size: 0 }; n.children.push(c); }
      c.size++;
      n = c;
    }
    if (!n.word) n.word = w;
  }
  // One child and no word ending here: merge the letters into one edge.
  const squash = (n) => {
    for (const c of n.children) {
      while (c.children.length === 1 && !c.word) {
        const only = c.children[0];
        c.edge += only.edge;
        c.word = only.word;
        c.children = only.children;
      }
      squash(c);
    }
  };
  squash(root);
  return root;
}

// What taking `value` at `level` leads to: the next slot's names, the usage lines
// through it and whether it completes a command.
function after(level, value, env, prev) {
  let lv = null;
  if (level.root) {
    const def = defFor(value, env);
    lv = def ? levelOf(def, [], startOf(def)) : null;
  } else lv = levelOf(level.def, prev.concat(value), advance(level.states, value, value, true));
  if (!lv) return { next: [], reach: [], more: 0, end: true };
  const names = [...lv.lits.map((c) => c.value), ...lv.phs.map((el) => el.display)];
  return { next: names.slice(0, MAX_NEXT), reach: lv.lines.slice(0, MAX_REACH), more: Math.max(0, lv.lines.length - MAX_REACH), end: lv.canEnd };
}

// The command a history line is, by its own name (short names count as the command they stand for).
function canonical(word, env) {
  const def = defFor(word, env);
  return def ? (def.aliasOf || def.name) : String(word).toLowerCase();
}

// Values typed into this level's slots before, newest first: the word that came
// after the same path in history (the rest of the line for free text).
function recentValues(level, path, env) {
  const out = new Map(level.phs.map((el) => [el.display, []]));
  if (!path.length) return out;
  const want = path.map((n) => n.value.toLowerCase());
  const head = canonical(want[0], env);
  const hist = env.history || [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const line = isGraph(hist[i]) ? leave(hist[i]) : String(hist[i]);
    const toks = lexInput(line, 0);
    if (toks.length <= path.length || canonical(toks[0].text, env) !== head) continue;
    if (!want.every((w, k) => k === 0 || toks[k].text.toLowerCase() === w)) continue;
    const tok = toks[path.length];
    const r = matchWord(level, tok, env);
    if (!r.node || r.node.kind !== 'param' || !out.has(r.node.label)) continue;
    const value = r.node.rest ? line.slice(tok.start).trim() : tok.text;
    const list = out.get(r.node.label);
    if (list.length < MAX_RECENT * 3 && !list.includes(value)) list.push(value);
  }
  return out;
}

function forwardOf(level, fan, sel, query, path, prev, env) {
  const view = { query, trie: letterTree(query, []), words: [], typos: [], slots: [], more: 0 };
  if (!level) return view;
  const q = query.toLowerCase();
  const best = fan[sel] && fan[sel].t > 0 ? fan[sel] : null;
  const branch = (it) => ({ value: it.value, label: it.label || '', kind: it.kind, rest: it.value.slice(query.length), best: it === best });
  for (const it of fan) {
    if (it.ph) continue;
    if (!q || it.value.toLowerCase().startsWith(q)) view.words.push(branch(it));
    else if (it.t > 0) view.typos.push(Object.assign(branch(it), { rest: it.value, t: it.t }));
  }
  // Letters merely in order (tier 1) only count when nothing starts with what's typed.
  view.typos = view.typos.filter((w) => w.t > 1 || !view.words.length).map(({ t, ...w }) => w);
  view.words.concat(view.typos).forEach((w, i) => {
    if (i < MAX_BRANCHES) Object.assign(w, after(level, w.value, env, prev));
    else Object.assign(w, { next: [], reach: [], more: 0, end: false });
  });
  view.trie = letterTree(query, view.words);
  if (!level.root) {
    const recent = recentValues(level, path, env);
    for (const it of fan) {
      if (!it.ph) continue;
      const el = level.phs.find((p) => p.display === it.value);
      const all = recent.get(it.value) || [];
      const fits = all.filter((v) => !q || v.toLowerCase().startsWith(q));
      view.slots.push({ display: it.value, type: el ? el.type : 'text', rest: !!it.rest, takes: !!query && it.t > 0, recent: (q ? fits : all).slice(0, MAX_RECENT) });
    }
  }
  return view;
}

// ---- editing -------------------------------------------------------------------------

// Takes fan item `i`: a word replaces the word being matched; a placeholder that
// already has its value moves on to the next word.
export function accept(text, view, i) {
  const it = view && view.fan[i];
  if (!it) return null;
  const { start, end, query } = view.focus;
  if (it.ph) {
    if (!query || !it.match || end !== text.length) return null;
    return text + ' ';
  }
  const after = text.slice(end);
  return text.slice(0, start) + it.value + (/^\s/.test(after) ? after : ' ' + after.replace(/^\s*/, ''));
}

// A node picked in an earlier column: that word becomes it, and what followed
// goes (it depended on the old word). The column being typed in takes it as Tab does.
export function pick(text, view, col, i) {
  const c = view && view.columns[col];
  const it = c && c.items[i];
  if (!it) return null;
  if (c.active) return accept(text, view, i);
  if (it.ph) return c.kind === 'param' && c.sub === it.value ? text : text.slice(0, c.start);
  return text.slice(0, c.start) + it.value + ' ';
}

// Backspace right after a whole word: remove the word (back to its parent node).
export function back(text) {
  const m = PREFIX.exec(text);
  if (!m || !/\s$/.test(text)) return null;
  const body = text.slice(m[1].length);
  if (!body.trim()) return null;
  return m[1] + body.replace(/\S+\s+$/, '');
}

// The node paths a run counts towards (for ranking by use): 'cook', 'cook convert', …
export function countKeys(view) {
  if (!view || view.ambiguous || view.offMap) return [];
  const keys = [];
  const parts = [];
  for (const n of view.full || view.path) {
    if (n.kind === 'raw') break;
    parts.push(nodeKey(n));
    keys.push(parts.join(' '));
  }
  return [...new Set(keys)];
}

// ---- preferences (device-local, store key 'graph') -------------------------------------
// { sort: 'freq' | 'alpha', counts: { '<node path>': n } }. Read from storage, so checked.

export const PREFS_KEY = 'graph';
const MAX_COUNTS = 400;
const MAX_KEY = 120;

export function readPrefs(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const counts = {};
  if (p.counts && typeof p.counts === 'object') {
    for (const [k, v] of Object.entries(p.counts)) {
      if (k.length <= MAX_KEY && Number.isInteger(v) && v > 0) counts[k] = v;
    }
  }
  return { sort: SORTS.includes(p.sort) ? p.sort : 'freq', counts };
}

// Adds one use to each path; the least used go once there are too many.
export function bump(prefs, keys) {
  const counts = Object.assign({}, prefs.counts);
  for (const k of keys) if (k.length <= MAX_KEY) counts[k] = (counts[k] || 0) + 1;
  const all = Object.entries(counts);
  if (all.length > MAX_COUNTS) {
    all.sort((a, b) => b[1] - a[1]);
    return { sort: prefs.sort, counts: Object.fromEntries(all.slice(0, MAX_COUNTS)) };
  }
  return { sort: prefs.sort, counts };
}

// `graph cook convert 2 cups flour` reaching the page another way (a link, the
// address bar) runs `cook convert 2 cups flour`. null when there's no command in it.
export function unwrap(input) {
  const m = /^\s*graph\s+([^:\s][\s\S]*)$/i.exec(String(input));
  return m ? m[1].trim() : null;
}
