import { cmp, plural } from '../core/util.js';
import { validateEntry, siteRoot, normalizeTemplate } from '../core/aliases.js';
import { tokenize, quote } from '../core/args.js';

// The URLs in an `alias` definition. A URL may contain spaces (a JQL query):
// words after an unquoted URL that aren't URLs or options belong to it, kept
// exactly as typed, quotes included. A quoted URL is taken as it is. `\/`, from JSON copies, is
// read as `/`.
// -> { name, urls: [string], force, path } or { error }
function parseDefinition(rest) {
  const toks = tokenize(rest);
  let force = false, path = false;
  let i = 0;
  if (toks[0] && !toks[0].quoted && toks[0].text.toLowerCase() === 'set') i = 1;
  const name = toks[i] ? toks[i].text : '';
  const urls = [];
  let open = null; // the unquoted URL still taking words: { start, end }
  const close = () => { if (open) { urls.push(rest.slice(open.start, open.end)); open = null; } };
  for (const t of toks.slice(i + 1)) {
    if (!t.quoted && t.text === '--force') { force = true; close(); continue; }
    if (!t.quoted && t.text === '--path') { path = true; close(); continue; }
    if (!t.quoted && t.text.startsWith('--')) return { error: "Unknown option '" + t.text + "'" };
    const isUrl = /^https?:/i.test(t.text);
    // A quoted URL is complete as it is; any other quoted word is part of the
    // URL being read (the "Migrated From Bugzilla Id" in a JQL query).
    if (t.quoted && (isUrl || !open)) { close(); urls.push(t.text); continue; }
    if ((isUrl && !t.quoted) || !open) { close(); open = { start: t.start, end: t.end }; continue; }
    open.end = t.end;
  }
  close();
  return { name, urls: urls.map((u) => normalizeTemplate(u.split('\\/').join('/'))), force, path };
}

export default function register(add, { st, usage, isBuiltin, records }) {
  const entries = () => st().aliases.entries;
  const engineNames = () => entries().filter((e) => e.template).map((e) => ({ value: e.name, label: 'engine' }));
  const aliasNames = () => entries().map((e) => ({ value: e.name, label: e.template ? 'engine' : 'alias' }));

  const flags = (e) => {
    const f = [];
    if (e.name === st().aliases.defaultEngine) f.push(['★ default', 'accent']);
    if (isBuiltin(e.name)) f.push(['inactive: shadowed by built-in', 'warn']);
    return f.flatMap((s, i) => (i ? [[' ', ''], s] : [s]));
  };

  // `alias set …` that recreates `e`.
  const definition = (e) => ['alias set', e.name, quote(e.base), e.template ? quote(e.template) : null,
    e.escape === 'path' ? '--path' : null, '--force'].filter(Boolean).join(' ');

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
      'alias edit <name>', 'alias edit <name>.<field> <value>',
    ],
    examples: [
      'alias gh https://github.com/ https://github.com/{} --path',
      'alias yt https://www.youtube.com/results?search_query={}',
      'alias w https://en.wikipedia.org/w/index.php?search=%s',
      'alias mail https://mail.google.com/',
      'alias jira https://jira.example.com/browse/{1}-{2}',
      'alias bug https://jira.example.com/issues/?jql=project="APP" AND text ~ "%s"',
      'alias edit gh.template https://github.com/search?q={}',
    ],
    complete: (prev) => {
      if (prev.length === 0) return ['set', 'rm', 'ls', 'show', 'edit'].map((v) => ({ value: v }));
      if (prev.length === 1 && ['set', 'rm', 'show', 'edit'].includes(prev[0])) return aliasNames();
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
          [[e.name, isBuiltin(e.name) ? 'faint' : 'accent', { run: 'alias show ' + e.name }]],
          [[e.template ? 'engine' : 'alias', e.template ? 'info' : 'dim']],
          [[e.template || e.base, 'url']],
          flags(e),
        ]));
        return;
      }
      if (sub === 'edit') {
        if (await records.edit(ctx, 'alias', rest.slice(4))) return;
        if (words.length !== 2) return usage(ctx, this);
        const e = entries().find((x) => x.name === words[1].toLowerCase());
        if (!e) return out.err("No alias '" + words[1] + "'");
        // The whole definition in the prompt, ready to change.
        ctx.setInput(definition(e));
        records.show(ctx, 'alias', e, [['Editing ', ''], [e.name, 'accent']]);
        out.dim('The whole definition is in the prompt: change it and press Enter · Esc cancels');
        return;
      }
      if (sub === 'show' || sub === 'rm') {
        if (words.length !== 2) return usage(ctx, this);
        const name = words[1].toLowerCase();
        const e = entries().find((x) => x.name === name);
        if (!e) return out.err("No alias '" + name + "'");
        if (sub === 'show') {
          return records.show(ctx, 'alias', e, [[e.name, 'accent'], [e.template ? '  engine' : '  alias', 'dim'], ['  ', ''], ...flags(e)]);
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
      const def = parseDefinition(rest);
      if (def.error) return out.err(def.error);
      if (!def.name || def.urls.length < 1 || def.urls.length > 2) return usage(ctx, this);
      const { name, force, path } = def;
      let [base, template] = def.urls;
      // `alias <name> <template>`: a lone URL with a placeholder is an engine; it opens its own site bare.
      if (!template && /\{[1-9]?\}/.test(base)) {
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
