import { byIdNum, plural, todayISO } from '../core/util.js';
import { dayLabel } from '../core/format.js';
import { oneValue, tokenize } from '../core/args.js';
import { KINDS, linkURL } from '../core/records.js';

// snippets (snip): named pieces of text to copy again and again.
// later: links to read later.
// Both follow the grammar of notes and tasks (commands/records.js).

const firstLine = (text) => {
  const lines = text.split('\n');
  return [[lines[0].length > 70 ? lines[0].slice(0, 69) + '…' : lines[0], 'dim'], [lines.length > 1 ? '  +' + plural(lines.length - 1, 'line') : '', 'faint']];
};

const siteOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; } };

export default function register(add, { st, records }) {
  // ---- snippets ----

  function listSnippets(ctx, rest) {
    const { out } = ctx;
    const f = rest.toLowerCase();
    const list = st().snippets.items.filter((s) => !f || s.name.includes(f) || s.text.toLowerCase().includes(f)).sort((a, b) => (a.name < b.name ? -1 : 1));
    if (!list.length) {
      out.head(f ? 'No snippets match "' + rest + '"' : 'No snippets yet', 'dim');
      if (!f) out.dim('Add one with: snippets add <name> <text>  (or snip <name> <text>), then snip <name> to copy it');
      return;
    }
    out.head([[plural(list.length, 'snippet'), 'strong'], [f ? ' matching "' + rest + '"' : ' · snip <name> copies one', 'dim']]);
    out.table(['id', 'name', 'text'], list.map((s) => [[[s.id, 'id', { run: 'snippets ' + s.id }]], [[s.name, 'accent']], firstLine(s.text)]));
  }

  async function addSnippet(ctx, rest) {
    const { out } = ctx;
    const t = tokenize(rest)[0];
    if (!t) return out.err('A snippet needs a name and some text: snippets add <name> <text>');
    const name = KINDS.snippet.fields.name.parse(t.text);
    if (name.error) return out.err('The name ' + name.error);
    const text = oneValue(rest.slice(t.end).replace(/^[ \t]+/, ''));
    if (!text.trim()) return out.err("Snippet '" + name.value + "' needs some text: snip " + name.value + ' <text>');
    if (st().snippets.items.some((s) => s.name === name.value)) {
      out.err("There is already a snippet named '" + name.value + "'");
      return out.line([['snip ' + name.value + ' edit text <new text>', 'accent'], [' changes it', 'dim']]);
    }
    const id = await ctx.data.allocId('s');
    const stamp = ctx.now().toISOString();
    await ctx.data.mutate('snippets', (d) => { d.items.push({ id, name: name.value, text, created: stamp, updated: stamp }); });
    out.head([['Added snippet ', ''], [name.value, 'accent', { run: 'snip ' + name.value }], [' · ' + id, 'dim']], 'ok');
  }

  // One snippet, ready to copy: its text with a copy button, then its fields.
  function copySnippet(ctx, s) {
    const { out } = ctx;
    out.head([['Snippet ', 'dim'], [s.name, 'accent'], [' · ' + s.id, 'dim']]);
    if (s.text.includes('\n')) out.code(s.text); else out.value(s.text);
    out.line([['snippets ' + s.id + ' edit', 'accent', { run: 'snippets ' + s.id + ' edit' }], [' to change it', 'faint']]);
  }

  const snippetSpec = { list: listSnippets, add: addSnippet, addArgs: '<name> <text>', filter: '[filter]', id: '<id | name>', show: copySnippet };

  add({
    name: 'snippets', group: 'Snippets', desc: 'named pieces of text to copy again: list, add, show, edit, remove',
    usage: records.usageFor('snippet', snippetSpec),
    examples: ['snippets', 'snippets add sig Best regards, Mihail', 'snippets sig', 'snippets s2 edit text Cheers, M', 'snippets s2 rm'],
    complete: (prev) => records.complete('snippet', prev),
    run: (ctx, rest) => records.route(ctx, 'snippet', rest, snippetSpec),
  });

  add({
    name: 'snip', group: 'Snippets', desc: 'short for snippets: snip <name> shows one to copy, snip <name> <text> adds one',
    usage: ['snip <name>', 'snip <name> <text>', 'snip <name> [edit [<field> [<value>]] | rm]'],
    examples: ['snip addr 1 Long Street, Sofia', 'snip addr', 'snip addr edit text 2 Long Street, Sofia'],
    complete: (prev) => records.complete('snippet', prev),
    run: (ctx, rest) => records.route(ctx, 'snippet', rest, { ...snippetSpec, short: true }),
  });

  // ---- later ----

  function listLater(ctx, rest) {
    const { out } = ctx;
    const all = /^all$/i.test(rest.trim());
    const f = all ? '' : rest.trim().toLowerCase();
    const items = st().later.items;
    const list = items.filter((l) => (all || f || !l.read) && (!f || l.url.toLowerCase().includes(f) || (l.title || '').toLowerCase().includes(f)))
      .sort((a, b) => (a.read - b.read) || byIdNum(b, a));
    const unread = items.filter((l) => !l.read).length;
    if (!list.length) {
      out.head(f ? 'No links match "' + rest.trim() + '"' : items.length ? 'Nothing left to read · ' + plural(items.length, 'link') + ' read' : 'Nothing saved to read later', 'dim');
      if (!items.length) out.dim('Save one with: later <url> [title]');
      else if (!all && !f) out.line([['later all', 'accent', { run: 'later all' }], [' shows the read ones', 'dim']]);
      return;
    }
    const today = todayISO(ctx.now());
    out.head([[plural(unread, 'link') + ' to read', 'strong'], [all ? ' · and ' + (items.length - unread) + ' read' : f ? ' · matching "' + rest.trim() + '"' : '', 'dim']]);
    out.table(['id', 'link', 'site', 'saved'], list.map((l) => [
      [[l.id, l.read ? 'faint' : 'id', { run: 'later ' + l.id }]],
      [[l.title || l.url.replace(/^https?:\/\/(www\.)?/, ''), l.read ? 'gone' : 'strong']],
      [[siteOf(l.url), 'dim']],
      [[dayLabel(todayISO(new Date(l.created)), today), 'faint']],
    ]));
    out.dim('later <id> open · later <id> done' + (!all && unread < items.length ? ' · later all' : ''));
  }

  async function addLater(ctx, rest) {
    const { out } = ctx;
    const t = tokenize(rest)[0];
    const url = t && linkURL(t.text);
    if (!url) return out.err(t ? "'" + t.text + "' is not a web address (https://…)" : 'later <url> [title]');
    const title = oneValue(rest.slice(t.end).trim()) || null;
    if (title && title.length > 200) return out.err('The title is too long (200 characters at most)');
    const dup = st().later.items.find((l) => l.url === url && !l.read);
    if (dup) return out.head([['Already saved as ', 'dim'], [dup.id, 'id', { run: 'later ' + dup.id }]], 'info');
    const id = await ctx.data.allocId('l');
    await ctx.data.mutate('later', (d) => { d.items.push({ id, url, title, read: false, readAt: null, created: ctx.now().toISOString() }); });
    out.head([['Saved for later ', ''], [id, 'id', { run: 'later ' + id }], [' · ' + (title || siteOf(url)), 'dim']], 'ok');
  }

  async function markRead(ctx, link, read) {
    await ctx.data.mutate('later', (d) => {
      const l = d.items.find((x) => x.id === link.id);
      if (l) { l.read = read; l.readAt = read ? ctx.now().toISOString() : null; }
    });
  }

  const laterSpec = {
    list: listLater, add: addLater, addArgs: '<url> [title]', filter: '[all | filter]',
    verbs: {
      // Marks it read and opens it (after this command is in the history).
      async open(ctx, link) {
        await markRead(ctx, link, true);
        ctx.out.head([['Opening ', ''], [link.title || siteOf(link.url), 'strong'], [' · marked read', 'dim']], 'info');
        ctx.out.dim(link.url);
        ctx.navigateAfter = link.url;
      },
      async done(ctx, link) {
        await markRead(ctx, link, true);
        ctx.out.head([['Read ', 'ok'], [link.id, 'id'], [' · ' + (link.title || siteOf(link.url)), 'dim']], 'ok');
      },
    },
  };

  add({
    name: 'later', group: 'Read later', desc: 'links to read later: later <url> saves one, later lists them',
    usage: ['later <url> [title]', ...records.usageFor('link', laterSpec)],
    examples: ['later https://example.com/long-read A long read', 'later', 'later l2 open', 'later l2 done', 'later all'],
    complete: (prev) => records.complete('link', prev, { verbs: laterSpec.verbs, first: [{ value: 'all' }] }),
    run(ctx, rest) {
      // A web address first: save it (later <url> works like later add <url>).
      const first = tokenize(rest)[0];
      if (first && !/^l\d+$/i.test(first.text) && first.text.toLowerCase() !== 'add' && /[./]/.test(first.text) && linkURL(first.text)) return addLater(ctx, rest);
      return records.route(ctx, 'link', rest, laterSpec);
    },
  });
}
