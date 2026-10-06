import { buildUrl, expandCommand, commandOf } from './aliases.js';

// Every input resolves to exactly one outcome:
//   builtin  - run a built-in command in the page (also what a command alias
//              expands to: then `alias` is its name and `expanded` the command line)
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
  if (entry && entry.command) {
    const target = commandOf(entry);
    if (!env.isBuiltin(target)) return { kind: 'error', message: "'" + entry.name + "' runs '" + target + "', which is not a built-in command" };
    const x = expandCommand(entry, rest);
    if (x.error) return { kind: 'error', message: x.error };
    const em = /^(\S+)(?:\s+([\s\S]*))?$/.exec(x.input);
    return { kind: 'builtin', name: em[1].toLowerCase(), rest: em[2] || '', alias: entry.name, expanded: x.input };
  }
  if (entry) {
    const r = buildUrl(entry, rest);
    if (r.error) return { kind: 'error', message: r.error };
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
