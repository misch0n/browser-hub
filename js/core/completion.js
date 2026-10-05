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
  const all = env.defs.map((d) => ({ value: d.name, label: d.desc, group: 0 }));
  for (const e of env.entries) {
    if (builtinNames.has(e.name)) continue; // shadowed: inactive
    all.push({ value: e.name, label: e.template ? 'engine' : 'alias', group: 1 });
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
    // Empty token at an argument position may still have candidates; complete()
    // handles that, so nothing to do here.
    return {};
  }
  const base = input.slice(0, input.length - token.length);
  if (candidates.length === 1) return { input: base + candidates[0].value + ' ' };
  const lcp = longestCommonPrefix(candidates.map((c) => c.value));
  if (lcp.length > token.length) return { input: base + lcp };
  return { list: candidates };
}

export { complete, applyTab, longestCommonPrefix, useCounts };
