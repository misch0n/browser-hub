import { cmp, plural } from '../core/util.js';
import { validateEntry } from '../core/aliases.js';

// "https://www.google.com/search?q={}" -> "https://www.google.com/"
function siteRoot(template) {
  const m = /^(https?:\/\/[^/?#{}]+)/i.exec(template);
  return m ? m[1] + '/' : template;
}

export default function register(add, { st, usage, isBuiltin }) {
  const entries = () => st().aliases.entries;
  const engineNames = () => entries().filter((e) => e.template).map((e) => ({ value: e.name, label: 'engine' }));
  const aliasNames = () => entries().map((e) => ({ value: e.name, label: e.template ? 'engine' : 'alias' }));

  const flags = (e) => {
    const f = [];
    if (e.name === st().aliases.defaultEngine) f.push(['★ default', 'accent']);
    if (isBuiltin(e.name)) f.push(['inactive: shadowed by built-in', 'warn']);
    return f.flatMap((s, i) => (i ? [[' ', ''], s] : [s]));
  };

  const details = (out, e) => out.kv([
    ['base', [[e.base, 'url']]],
    ['template', e.template ? [[e.template, 'url']] : [['none', 'faint']]],
    ['escape', [[e.escape, 'dim']]],
  ]);

  add({
    name: 'alias', group: 'Aliases & engines', desc: 'define URL aliases and search engines',
    usage: [
      'alias <name> <base> [template] [--path] [--force]',
      'alias <name> <template> [--path] [--force]',
      'alias set <name> ... [--force]',
      'alias rm <name>', 'alias ls [filter]', 'alias show <name>',
    ],
    examples: [
      'alias gh https://github.com/ https://github.com/{} --path',
      'alias yt https://www.youtube.com/results?search_query={}',
      'alias w https://en.wikipedia.org/w/index.php?search=%s',
      'alias mail https://mail.google.com/',
    ],
    complete: (prev) => {
      if (prev.length === 0) return ['set', 'rm', 'ls', 'show'].map((v) => ({ value: v }));
      if (prev.length === 1 && ['set', 'rm', 'show'].includes(prev[0])) return aliasNames();
      return [];
    },
    async run(ctx, rest) {
      const { out } = ctx;
      if (!rest) return usage(ctx, this);
      const words = rest.split(/\s+/);
      const sub = words[0].toLowerCase();
      const doc = st().aliases;

      if (sub === 'ls') {
        const f = (words[1] || '').toLowerCase();
        const list = entries().filter((e) => !f || e.name.includes(f) || e.base.toLowerCase().includes(f))
          .sort((a, b) => cmp(a.name, b.name));
        if (!list.length) return out.head('No aliases' + (f ? ' match "' + f + '"' : ''), 'dim');
        const engines = list.filter((e) => e.template).length;
        out.head([[plural(list.length, 'alias', 'aliases'), 'strong'], [' · ' + plural(engines, 'engine'), 'dim']]);
        out.table(['name', 'kind', 'opens', ''], list.map((e) => [
          [[e.name, isBuiltin(e.name) ? 'faint' : 'accent']],
          [[e.template ? 'engine' : 'alias', e.template ? 'info' : 'dim']],
          [[e.template || e.base, 'url']],
          flags(e),
        ]));
        return;
      }
      if (sub === 'show' || sub === 'rm') {
        if (words.length !== 2) return usage(ctx, this);
        const name = words[1].toLowerCase();
        const e = entries().find((x) => x.name === name);
        if (!e) return out.err("No alias '" + name + "'");
        if (sub === 'show') {
          out.head([[e.name, 'accent'], [e.template ? '  engine' : '  alias', 'dim'], ['  ', ''], ...flags(e)]);
          details(out, e);
          return;
        }
        if (name === doc.defaultEngine) {
          out.err("'" + name + "' is the default engine");
          out.dim('Choose another first: engine default <name>');
          return;
        }
        await ctx.data.mutate('aliases', (d) => { d.entries = d.entries.filter((x) => x.name !== name); });
        return out.head([['Removed ', ''], [name, 'accent']], 'ok');
      }

      // Define: `alias [set] <name> <base> [template] [--path] [--force]`
      const positional = [];
      let force = false, path = false;
      for (const w of words) {
        if (w === '--force') force = true;
        else if (w === '--path') path = true;
        else if (w.startsWith('--')) return out.err("Unknown option '" + w + "'");
        else positional.push(w);
      }
      if (positional[0] && positional[0].toLowerCase() === 'set') positional.shift();
      if (positional.length < 2 || positional.length > 3) return usage(ctx, this);
      // `%s` is the placeholder browsers use; accept it as `{}`.
      let [name, base, template] = positional.map((w, i) => (i ? w.split('%s').join('{}') : w));
      // `alias <name> <template>`: a lone URL with `{}` is an engine; it opens its own site bare.
      if (!template && base.includes('{}')) {
        template = base;
        base = siteRoot(template);
      }
      if (path && !template) return out.err('--path only applies to aliases with a template');
      const v = validateEntry({ name, base, template, escape: path ? 'path' : 'query' }, isBuiltin);
      if (v.error) return out.err(v.error);
      const entry = v.entry;
      const existing = entries().find((e) => e.name === entry.name);
      if (existing && !force) {
        out.err("Alias '" + entry.name + "' already exists");
        details(out, existing);
        out.dim('Add --force to overwrite it');
        return;
      }
      if (existing && entry.name === doc.defaultEngine && !entry.template) {
        return out.err("'" + entry.name + "' is the default engine and needs a template");
      }
      await ctx.data.mutate('aliases', (d) => {
        const i = d.entries.findIndex((e) => e.name === entry.name);
        if (i >= 0) d.entries[i] = entry; else d.entries.push(entry);
      });
      out.head([[existing ? 'Updated ' : 'Added ', ''], [entry.name, 'accent'], [entry.template ? '  engine' : '  alias', 'dim']], 'ok');
      details(out, entry);
    },
  });

  add({
    name: 'engine', group: 'Aliases & engines', desc: 'show or set the default search engine',
    usage: ['engine', 'engine default <name>'],
    complete: (prev) => {
      if (prev.length === 0) return [{ value: 'default' }];
      if (prev.length === 1 && prev[0] === 'default') return engineNames();
      return [];
    },
    async run(ctx, rest) {
      const { out } = ctx;
      const doc = st().aliases;
      if (!rest) {
        const e = entries().find((x) => x.name === doc.defaultEngine);
        out.head([['Default engine ', ''], [doc.defaultEngine, 'accent']]);
        if (e) out.line([[e.template, 'url']]);
        out.dim('Anything that is not a command or alias is searched here');
        return;
      }
      const m = /^default\s+(\S+)$/i.exec(rest);
      if (!m) return usage(ctx, this);
      const name = m[1].toLowerCase();
      const e = entries().find((x) => x.name === name);
      if (!e) return out.err("No alias '" + name + "'");
      if (!e.template) return out.err("'" + name + "' has no template, so it can't be a search engine");
      if (isBuiltin(name)) return out.err("'" + name + "' is shadowed by a built-in command");
      await ctx.data.mutate('aliases', (d) => { d.defaultEngine = name; });
      out.head([['Default engine is now ', ''], [name, 'accent']], 'ok');
    },
  });
}
