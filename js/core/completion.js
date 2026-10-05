// Prefix completion, case-insensitive. Unknown words get no candidates.
// env: {
//   defs: [{ name, desc, complete?(prevTokens) -> [{value, label?}] }],
//   entries: [alias entries], history: [strings],
// }
// Returns { token, candidates: [{value, label}] } for the token under the cursor.

function useCounts(history) {
  const counts = Object.create(null);
  for (const h of history) {
    const head = h.trim().split(/\s+/)[0].toLowerCase();
    counts[head] = (counts[head] || 0) + 1;
  }
  return counts;
}

function firstTokenCandidates(env) {
  const uses = useCounts(env.history || []);
  const builtinNames = new Set(env.defs.map((d) => d.name));
  const all = env.defs.map((d) => ({ value: d.name, label: d.desc, kind: d.group, group: 0 }));
  for (const e of env.entries) {
    if (builtinNames.has(e.name)) continue; // shadowed: inactive
    all.push({ value: e.name, label: e.template || e.base, kind: e.template ? 'engine' : 'alias', group: 1 });
  }
  return all.sort((a, b) =>
    a.group - b.group ||
    (uses[b.value] || 0) - (uses[a.value] || 0) ||
    (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

function complete(input, env) {
  const text = input.replace(/^\s+/, '');
  if (!text) return { token: '', candidates: [] };
  const tokens = text.split(/\s+/);
  const token = tokens[tokens.length - 1];
  const prev = tokens.slice(0, -1);
  let pool;

  if (prev.length === 0) {
    if (!token) return { token, candidates: [] };
    pool = firstTokenCandidates(env);
  } else {
    const def = env.defs.find((d) => d.name === prev[0].toLowerCase());
    pool = def && def.complete ? def.complete(prev.slice(1).map((w) => w.toLowerCase())) : [];
  }

  const t = token.toLowerCase();
  return { token, candidates: pool.filter((c) => c.value.toLowerCase().startsWith(t)) };
}

// Edit distance with adjacent swaps (Damerau, optimal string alignment).
function distance(a, b) {
  const d = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// A command or alias one typo away from `head` ('tsks' -> 'tasks'), or null.
// Short words are left alone: 'ns' is as likely a search as a typo of 'n'.
function didYouMean(head, env) {
  const h = String(head).toLowerCase();
  if (h.length < 3) return null;
  const builtinNames = new Set(env.defs.map((d) => d.name));
  if (builtinNames.has(h) || env.entries.some((e) => e.name === h)) return null;
  const names = [...builtinNames, ...env.entries.map((e) => e.name).filter((n) => !builtinNames.has(n))];
  let best = null;
  for (const n of names) {
    if (n.length < 2 || Math.abs(n.length - h.length) > 1) continue;
    if (distance(h, n) === 1 && (!best || n.length > best.length)) best = n;
  }
  return best;
}

function longestCommonPrefix(values) {
  if (!values.length) return '';
  let p = values[0];
  for (const v of values) {
    let i = 0;
    while (i < p.length && i < v.length && p[i].toLowerCase() === v[i].toLowerCase()) i++;
    p = p.slice(0, i);
  }
  return p;
}

// Applies Tab to `input`. Returns { input?, list? }: a new input value, or a
// candidate list to print when completing makes no further progress.
function applyTab(input, env) {
  const { token, candidates } = complete(input, env);
  if (candidates.length === 0) {
    // Nothing starts with the first word: fix a typo instead ('tsks' -> 'tasks').
    const m = /^(\s*)(\S+)([\s\S]*)$/.exec(input);
    const fix = m && didYouMean(m[2], env);
    return fix ? { input: m[1] + fix + (m[3] || ' ') } : {};
  }
  const base = input.slice(0, input.length - token.length);
  if (candidates.length === 1) return { input: base + candidates[0].value + ' ' };
  const lcp = longestCommonPrefix(candidates.map((c) => c.value));
  if (lcp.length > token.length) return { input: base + lcp };
  return { list: candidates };
}

export { complete, applyTab, longestCommonPrefix, useCounts, didYouMean, distance };
