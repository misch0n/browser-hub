import { cmp, plural } from '../core/util.js';
import { validateEntry, siteRoot, normalizeTemplate, commandOf } from '../core/aliases.js';
import { tokenize } from '../core/args.js';
import { kindSeg, usageSegs } from '../core/format.js';

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

// `<name> <command …>`: an alias that runs a built-in command, when the word
// after the name is a built-in (quoted or not). -> { name, command, force } or null
function parseCommandDefinition(rest, isBuiltin) {
  const toks = tokenize(rest);
  let i = 0;
  if (toks[0] && !toks[0].quoted && toks[0].text.toLowerCase() === 'set') i = 1;
  const nameTok = toks[i], next = toks[i + 1];
  if (!nameTok || !next || /^https?:/i.test(next.text)) return null;
  let command = next.quoted && toks.length === i + 2 ? next.text : rest.slice(next.start).trim();
  if (!isBuiltin((command.split(/\s+/)[0] || '').toLowerCase())) return null;
  let force = false;
  if (/\s--force$/.test(command)) { force = true; command = command.replace(/\s--force$/, ''); }
  return { name: nameTok.text, command, force };
}

export default function register(add, { st, isBuiltin, records }) {
  const entries = () => st().aliases.entries;
  const engineNames = () => entries().filter((e) => e.template).map((e) => ({ value: e.name, label: 'engine' }));

  const kindOf = (e) => (e.command ? 'command' : e.template ? 'engine' : 'alias');
  const flags = (e) => {
    const f = [];
    if (e.name === st().aliases.defaultEngine) f.push(['★ default', 'accent']);
    if (isBuiltin(e.name)) f.push(['inactive: shadowed by built-in', 'warn']);
    if (e.command && !isBuiltin(commandOf(e))) f.push(["broken: '" + commandOf(e) + "' is not a command", 'warn']);
    return f.flatMap((s, i) => (i ? [[' ', ''], s] : [s]));
  };

  const details = (out, e) => out.kv(e.command ? [['runs', [[e.command, 'strong']]]] : [
    ['base', [[e.base, 'url']]],
    ['template', e.template ? [[e.template, 'url']] : [['none', 'faint']]],
    ['escape', [[e.escape, 'dim']]],
  ]);

  function listAliases(ctx, rest) {
    const { out } = ctx;
    const f = rest.trim().toLowerCase();
    const list = entries().filter((e) => !f || [e.name, e.base, e.template, e.command].some((x) => (x || '').toLowerCase().includes(f)))
      .sort((a, b) => cmp(a.name, b.name));
    if (!list.length) return out.head('No aliases' + (f ? ' match "' + f + '"' : ''), 'dim');
    const engines = list.filter((e) => e.template).length;
    const commands = list.filter((e) => e.command).length;
    out.head([[plural(list.length, 'alias', 'aliases'), 'strong'], [' · ' + plural(engines, 'engine') + (commands ? ' · ' + plural(commands, 'command alias', 'command aliases') : ''), 'dim']]);
    out.table(['name', 'kind', 'opens or runs', ''], list.map((e) => [
      [[e.name, isBuiltin(e.name) ? 'faint' : 'accent', { run: 'aliases ' + e.name }]],
      [kindSeg(kindOf(e))],
      e.command ? [[e.command, 'strong']] : [[e.template || e.base, 'url']],
      flags(e),
    ]));
  }

  // aliases add <name> <command …> [--force]: an alias that runs a built-in command.
  async function addCommandAlias(ctx, def) {
    const { out } = ctx;
    const v = validateEntry({ name: def.name, command: def.command }, isBuiltin);
    if (v.error) return out.err(v.error);
    const entry = v.entry;
    const existing = entries().find((e) => e.name === entry.name);
    if (existing && !def.force) {
      out.err("Alias '" + entry.name + "' already exists");
      details(out, existing);
      out.dim('Change it with: aliases ' + entry.name + ' edit · or add --force to replace it');
      return;
    }
    if (existing && entry.name === st().aliases.defaultEngine) return out.err("'" + entry.name + "' is the default engine and needs a template");
    await ctx.data.mutate('aliases', (d) => {
      const i = d.entries.findIndex((e) => e.name === entry.name);
      if (i >= 0) d.entries[i] = entry; else d.entries.push(entry);
    });
    out.head([[existing ? 'Updated ' : 'Added ', ''], [entry.name, 'accent', { run: 'aliases ' + entry.name }], ['  runs ', 'dim'], [commandOf(entry), 'accent']], 'ok');
    details(out, entry);
    out.dim(/\{[1-9]?\}/.test(entry.command) ? 'What you type after ' + entry.name + ' fills the placeholders' : entry.name + ' <more> runs ' + entry.command + ' <more>');
  }

  // aliases add <name> <base> [template] [--path] [--force]
  async function addAlias(ctx, rest) {
    const { out } = ctx;
    const cmd = parseCommandDefinition(rest, isBuiltin);
    if (cmd) return addCommandAlias(ctx, cmd);
    const def = parseDefinition(rest);
    if (def.error) return out.err(def.error);
    if (!def.name || def.urls.length < 1 || def.urls.length > 2) {
      out.head([['Usage', ''], [' · aliases add', 'dim']], 'err');
      out.table(null, [[usageSegs('aliases add <name> <url>')], [usageSegs('aliases add <name> <url with {}> [--path]')],
        [usageSegs('aliases add <name> <base> <template> [--path] [--force]')], [usageSegs('aliases add <name> <command> [{} | {1} {2} …] [--force]')]]);
      return;
    }
    const { name, force, path } = def;
    let [base, template] = def.urls;
    // A lone URL with a placeholder is an engine; it opens its own site bare.
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
      out.dim('Change it with: aliases ' + entry.name + ' edit · or add --force to replace it');
      return;
    }
    if (existing && entry.name === st().aliases.defaultEngine && !entry.template) {
      return out.err("'" + entry.name + "' is the default engine and needs a template");
    }
    await ctx.data.mutate('aliases', (d) => {
      const i = d.entries.findIndex((e) => e.name === entry.name);
      if (i >= 0) d.entries[i] = entry; else d.entries.push(entry);
    });
    out.head([[existing ? 'Updated ' : 'Added ', ''], [entry.name, 'accent', { run: 'aliases ' + entry.name }], [entry.template ? '  engine' : '  alias', 'dim']], 'ok');
    details(out, entry);
  }

  async function makeDefault(ctx, e) {
    const { out } = ctx;
    if (e.command) return out.err("'" + e.name + "' runs a command, so it can't be a search engine");
    if (!e.template) return out.err("'" + e.name + "' has no template, so it can't be a search engine");
    if (isBuiltin(e.name)) return out.err("'" + e.name + "' is shadowed by a built-in command");
    await ctx.data.mutate('aliases', (d) => { d.defaultEngine = e.name; });
    out.head([['Default engine is now ', ''], [e.name, 'accent']], 'ok');
  }

  const spec = {
    list: listAliases, add: addAlias, verbs: { default: makeDefault },
    addArgs: '<name> <url> [template] [--path] [--force] | <name> <command>', filter: '[filter]',
  };
  const show = (ctx, e) => records.show(ctx, 'alias', e, { head: [[e.name, 'accent'], [e.command ? '  command alias' : e.template ? '  engine' : '  alias', 'dim'], ['  ', ''], ...flags(e)] });
  const routeSpec = (short) => ({ ...spec, short, show });

  add({
    name: 'aliases', group: 'Aliases & engines', desc: 'list, add, show, edit and remove your aliases, search engines and command aliases',
    usage: records.usageFor('alias', spec),
    examples: [
      'aliases', 'aliases add gh https://github.com/ https://github.com/{} --path', 'aliases add yt https://www.youtube.com/results?search_query={}',
      'aliases add jira https://jira.example.com/browse/{1}-{2}', 'aliases add bug https://jira.example.com/issues/?jql=project="APP" AND text ~ "%s"',
      'aliases add groc tasks add {} #groceries', 'aliases add tt tasks', 'aliases add rename zones {1} edit name {2}',
      'aliases gh', 'aliases gh edit', 'aliases gh edit template https://github.com/search?q={}', 'aliases groc edit command tasks add {} #shop',
      'aliases ddg default', 'aliases gh rm',
    ],
    complete: (prev) => records.complete('alias', prev, { verbs: spec.verbs }),
    run: (ctx, rest) => records.route(ctx, 'alias', rest, routeSpec(false)),
  });

  add({
    name: 'alias', group: 'Aliases & engines', aliasOf: 'aliases', desc: 'short for aliases; alias <name> <url or command> adds one',
    usage: ['alias <name> <url>', 'alias <name> <url with {} or %s> [--path]', 'alias <name> <base> <template> [--path] [--force]',
      'alias <name> <command> [{} | {1} {2} …] [--force]',
      'alias <name> [edit [<field> [<value>]] | default | rm]'],
    examples: ['alias gh https://github.com/ https://github.com/{} --path', 'alias w https://en.wikipedia.org/w/index.php?search=%s', 'alias gh edit template https://github.com/{}',
      'alias groc tasks add {} #groceries', 'alias tt tasks'],
    complete: (prev) => records.complete('alias', prev, { verbs: spec.verbs }),
    run(ctx, rest) {
      const words = rest.trim().split(/\s+/);
      const sub = (words[0] || '').toLowerCase();
      // Older forms: alias ls [filter], alias set …
      if (sub === 'ls') return listAliases(ctx, rest.trim().slice(2));
      if (sub === 'set') return addAlias(ctx, rest);
      return records.route(ctx, 'alias', records.legacy('alias', rest, ['default']) ?? rest, routeSpec(true));
    },
  });

  add({
    name: 'engine', group: 'Aliases & engines', desc: 'show or set the default search engine',
    usage: ['engine', 'engine <name>'],
    examples: ['engine', 'engine ddg'],
    complete: (prev) => {
      if (prev.length === 0) return engineNames();
      if (prev.length === 1 && prev[0] === 'default') return engineNames();
      return [];
    },
    async run(ctx, rest) {
      const { out } = ctx;
      const doc = st().aliases;
      if (!rest) {
        const e = entries().find((x) => x.name === doc.defaultEngine);
        out.head([['Default engine ', ''], [doc.defaultEngine, 'accent', { run: 'aliases ' + doc.defaultEngine }]]);
        if (e) out.line([[e.template, 'url']]);
        out.dim('Anything that is not a command or alias is searched here · change it with: engine <name>');
        return;
      }
      // engine <name> (engine default <name>, the older form)
      const m = /^(?:default\s+)?(\S+)$/i.exec(rest.trim());
      if (!m) return out.err('engine <name>  (or: aliases <name> default)');
      const e = entries().find((x) => x.name === m[1].toLowerCase());
      if (!e) return out.err("No alias '" + m[1] + "'");
      return makeDefault(ctx, e);
    },
  });
}
