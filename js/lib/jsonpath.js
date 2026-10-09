// A small jq/JSONPath-like query over parsed JSON. Pure.
//
//   query(value, expr) -> { results: [{ path: '$.a.b[0]', value }] } | { error, at }
//   parse(expr)        -> { steps: [{ deep, sel }] } | { error, at }
//   pathOf(segments)   -> '$.store.book[0]["first name"]' from ['store', 'book', 0, 'first name']
//
// Syntax: an optional leading `$` or `.`, then steps:
//   .key  ["odd key"]  ['odd key']  [0]  [-1] (from the end)  [*] and .* (every child)
//   [1:3] [::-1] (slices, as in Python)  ..key ..* ..[0] (every descendant, document order)
// A bare `.` or `$` is the root. After a dot, keys are letters, digits, _ and $;
// anything else goes in brackets. A missing key or index is no result, not an error.
// `at` is the character offset in expr where the problem is.

const IDENT = /[A-Za-z0-9_$]/;

export function pathOf(segments) {
  return '$' + segments.map((s) => typeof s === 'number' ? `[${s}]` : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s) ? '.' + s : `[${JSON.stringify(s)}]`).join('');
}

const shown = (c) => c === ' ' ? 'space' : c === '\t' ? 'tab' : JSON.stringify(c);

export function parse(expr) {
  const s = String(expr ?? '');
  const steps = [];
  let i = 0;
  const fail = (error, at = i) => ({ error, at });
  const ident = () => { const a = i; while (i < s.length && IDENT.test(s[i])) i++; return s.slice(a, i); };
  const ws = () => { while (s[i] === ' ' || s[i] === '\t') i++; };

  // [ ... ]: a quoted key, an index, a slice or *. Returns a selector or { error, at }.
  function bracket() {
    const open = i++;
    ws();
    let sel;
    if (s[i] === '*') { i++; sel = { wild: true }; }
    else if (s[i] === '"' || s[i] === "'") {
      const q = s[i++], start = i - 1;
      let key = '';
      for (;;) {
        if (i >= s.length) return fail('unclosed string', start);
        const c = s[i++];
        if (c === q) break;
        if (c === '\\') {
          const e = s[i++];
          if (e === undefined) return fail('unclosed string', start);
          key += { n: '\n', t: '\t', r: '\r' }[e] ?? e;
        } else key += c;
      }
      sel = { key };
    } else {
      const nums = [];
      for (let n = 0; n < 3; n++) {
        ws();
        const m = /^-?\d+/.exec(s.slice(i));
        if (m) { nums.push(Number(m[0])); i += m[0].length; } else nums.push(null);
        ws();
        if (s[i] !== ':' || n === 2) break;
        i++;
      }
      if (nums.length === 1) {
        if (nums[0] === null) {
          if (i >= s.length) return fail('unclosed [', open);
          return s[i] === ']' ? fail('empty brackets', open) : fail(`unexpected ${shown(s[i])} in brackets`);
        }
        sel = { index: nums[0] };
      } else {
        if (nums[2] === 0) return fail("slice step can't be 0", open);
        sel = { slice: nums };
      }
    }
    ws();
    if (i >= s.length) return fail('unclosed [', open);
    if (s[i] !== ']') return fail(`unexpected ${shown(s[i])} in brackets`);
    i++;
    return sel;
  }

  // What follows a dot (or two): a key, *, or brackets.
  function afterDot(deep) {
    const at = i;
    if (s[i] === '*') { i++; return { deep, sel: { wild: true } }; }
    if (s[i] === '[') { const sel = bracket(); return sel.error ? sel : { deep, sel }; }
    const key = ident();
    if (!key) return fail(i >= s.length ? `expected a key after ${deep ? '..' : '.'}` : `unexpected ${shown(s[i])}`, at);
    return { deep, sel: { key } };
  }

  ws();
  if (s[i] === '$') i++;
  else if (IDENT.test(s[i] || '')) steps.push({ deep: false, sel: { key: ident() } });
  if (s.slice(i).trim() === '.') return { steps }; // `.` or `$.` alone: the root
  while (i < s.length) {
    let step;
    if (s.startsWith('..', i)) { i += 2; step = afterDot(true); }
    else if (s[i] === '.') { i++; step = afterDot(false); }
    else if (s[i] === '[') { const sel = bracket(); step = sel.error ? sel : { deep: false, sel }; }
    else if (/\s/.test(s[i]) && !s.slice(i).trim()) break;
    else return fail(`unexpected ${shown(s[i])}`);
    if (step.error) return step;
    steps.push(step);
  }
  return { steps };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The indexes a slice picks from an array of length n, Python style.
function sliceIndexes([start, end, step], n) {
  step = step ?? 1;
  const norm = (x, dflt) => x === null ? dflt : x < 0 ? Math.max(x + n, step < 0 ? -1 : 0) : Math.min(x, step < 0 ? n - 1 : n);
  const out = [];
  const a = norm(start, step < 0 ? n - 1 : 0), b = norm(end, step < 0 ? -1 : n);
  for (let k = a; step > 0 ? k < b : k > b; k += step) out.push(k);
  return out;
}

// The children of `node` a selector picks, as [segment, value] in order.
function select(node, sel) {
  if (sel.key !== undefined) return isObj(node) && Object.hasOwn(node, sel.key) ? [[sel.key, node[sel.key]]] : [];
  if (sel.wild) return Array.isArray(node) ? node.map((v, k) => [k, v]) : isObj(node) ? Object.entries(node) : [];
  if (!Array.isArray(node)) return [];
  if (sel.slice) return sliceIndexes(sel.slice, node.length).map((k) => [k, node[k]]);
  const k = sel.index < 0 ? sel.index + node.length : sel.index;
  return k >= 0 && k < node.length ? [[k, node[k]]] : [];
}

// Every descendant matching `sel`, in document order: a match comes before the
// matches inside it.
function descend(node, path, sel, out) {
  const hits = new Map(select(node, sel).map(([k]) => [k, true]));
  const children = Array.isArray(node) ? node.map((v, k) => [k, v]) : isObj(node) ? Object.entries(node) : [];
  for (const [k, v] of children) {
    if (hits.has(k)) out.push({ segs: [...path, k], value: v });
    descend(v, [...path, k], sel, out);
  }
}

export function query(value, expr) {
  const p = parse(expr);
  if (p.error) return p;
  let nodes = [{ segs: [], value }];
  for (const { deep, sel } of p.steps) {
    const next = [];
    for (const n of nodes) {
      if (deep) descend(n.value, n.segs, sel, next);
      else for (const [k, v] of select(n.value, sel)) next.push({ segs: [...n.segs, k], value: v });
    }
    nodes = next;
  }
  return { results: nodes.map((n) => ({ path: pathOf(n.segs), value: n.value })) };
}
