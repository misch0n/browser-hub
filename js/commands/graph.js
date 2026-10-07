import { readPrefs, PREFS_KEY, SORTS } from '../core/graph.js';

// graph: graph mode of the prompt (experimental; core/graph.js reads the
// grammar, ui/graph.js draws it). Typing `graph ` before a command turns the
// screen above the prompt into a map of what can come next, beside an
// unchanged input; Enter runs the command exactly as without it. The command itself only explains the mode and sets its ranking:
//   graph                   what graph mode is, and the prompt put into it
//   graph :sort [freq|alpha] how the fan is ranked on this device
// Use counts and the ranking are kept on this device only (store key 'graph').

export default function register(add) {
  add({
    name: 'graph', group: 'View', desc: 'graph mode (experimental): every next step of a command shown as you type it',
    usage: ['graph <command …>', 'graph :sort [freq | alpha]'],
    examples: ['graph cook convert 2 cups flour', 'graph :sort alpha'],
    noUndo: true,
    complete(prev) {
      if (prev.length === 0) return [{ value: ':sort', label: 'rank the fan by use or a to z' }];
      if (prev.length === 1 && prev[0] === ':sort') return SORTS.map((v) => ({ value: v }));
      return [];
    },
    run(ctx, rest) {
      const { out } = ctx;
      const prefs = readPrefs(ctx.store.getLocal(PREFS_KEY));
      const m = /^:sort(?:\s+(\S+))?\s*$/i.exec(rest.trim());
      if (m) {
        const want = m[1] ? m[1].toLowerCase() : null;
        if (want && !SORTS.includes(want)) return out.err('graph :sort takes freq or alpha, not ' + m[1]);
        if (want) ctx.store.setLocal(PREFS_KEY, { sort: want, counts: prefs.counts });
        const sort = want || prefs.sort;
        out.head([[want ? 'Graph mode ranks ' : 'Graph mode is ranking ', ''], [sort === 'freq' ? 'by use' : 'a to z', 'strong']], want ? 'ok' : 'info');
        out.line([['Both rank the closest matches first; then ', 'dim'], [sort === 'freq' ? 'what you run most, then a to z' : 'a to z', 'dim']]);
        out.line([['Switch: ', 'dim'], ...SORTS.filter((s) => s !== sort).map((s) => ['graph :sort ' + s, 'accent', { run: 'graph :sort ' + s }])]);
        return;
      }
      if (rest.trim()) return out.err('Graph mode runs commands from the prompt: type graph, a space, then the command');
      out.head([['Graph mode', 'strong'], [' · experimental · a map of every command as you type it', 'dim']]);
      out.table(null, [
        [[['graph <command>', 'accent']], [['above the prompt: the path so far, the other choices at each word, and the letter tree of what can come next', 'dim']]],
        [[['typing · tab · ↑↓ · esc', 'accent']], [['as always: the input is the normal prompt; tap a word or value to put it in', 'dim']]],
        [[['↵', 'accent']], [['runs the command, exactly as without graph (typos put right)', 'dim']]],
      ], { stack: true });
      out.dim('Typos and half-remembered words still find their place; ranked ' + (prefs.sort === 'freq' ? 'by use' : 'a to z') + ' (graph :sort)');
      ctx.setInput('graph ');
    },
  });
}
