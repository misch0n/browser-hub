import { buildUrl } from './aliases.js';

// Every input resolves to exactly one outcome:
//   builtin  - run a built-in command in the page
//   redirect - open an alias / engine target
//   search   - fill an engine's template: `<engine> <phrase>`, or the whole
//              input on the default engine when nothing else matched (fallback)
// env: { isBuiltin(name) -> bool, entries: [alias entries], defaultEngine: name }
function dispatch(input, env) {
  const s = input.trim();
  if (!s) return { kind: 'empty' };
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(s);
  const head = m[1].toLowerCase();
  const rest = m[2] || '';

  if (env.isBuiltin(head)) return { kind: 'builtin', name: head, rest };

  const entry = env.entries.find((e) => e.name === head);
  if (entry) {
    const r = buildUrl(entry, rest);
    // An entry with a template and a phrase is a search on that engine.
    if (entry.template && rest) return { kind: 'search', url: r.url, name: entry.name, query: rest, fallback: false };
    return { kind: 'redirect', url: r.url, note: r.note, name: entry.name };
  }

  const engine = env.entries.find((e) => e.name === env.defaultEngine && e.template);
  if (!engine) {
    return { kind: 'error', message: 'no default engine is set; run: engine default <name>' };
  }
  return { kind: 'search', url: buildUrl(engine, s).url, name: engine.name, query: s, fallback: true };
}

export { dispatch };
