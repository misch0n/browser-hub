import { byIdNum, plural, todayISO } from '../core/util.js';
import { dayLabel } from '../core/format.js';
import { tokenize } from '../core/args.js';
import { KINDS, fieldName } from '../core/records.js';
import { diagramKind, STARTER, libraryFile, readLibrary } from '../lib/diagrams.js';

// diagrams: Mermaid diagrams you keep (synced, in the grammar of notes and
// tasks). mermaid: the live editor, or one drawing of pasted code.
//
// The editor works on a draft kept on this device (saved as you type, never
// synced); saving is a command (diagrams d1 save, or diagrams add <name>),
// so it shows in the history and undo takes it back like anything else.

const DRAFT = 'diagram-draft'; // { code, target: id | null, at }

export default function register(add, { st, records }) {
  const draftOf = (ctx) => {
    const d = ctx.store && ctx.store.getLocal(DRAFT);
    return d && typeof d.code === 'string' ? d : null;
  };
  const setDraft = (ctx, code, target) => ctx.store && ctx.store.setLocal(DRAFT, { code, target: target || null, at: ctx.now().toISOString() });
  const byId = (id) => st().diagrams.items.find((d) => d.id === id) || null;

  // The live editor on the draft: for `item` (resuming unsaved changes to it), or a new diagram.
  function openEditor(ctx, item) {
    const { out } = ctx;
    let draft = draftOf(ctx);
    let resumed = false;
    if (item) {
      resumed = !!(draft && draft.target === item.id && draft.code !== item.code);
      if (!resumed) setDraft(ctx, item.code, item.id);
    } else if (!draft || draft.target) {
      setDraft(ctx, draft && draft.target === null ? draft.code : STARTER, null);
    }
    draft = draftOf(ctx) || { code: item ? item.code : STARTER };
    out.head(item ? [['Editing ', ''], ['diagrams ' + item.id, 'id'], [' · ' + item.name, 'strong']] : [['New diagram', 'strong'], [' · Mermaid', 'dim']], 'info');
    if (resumed) out.warn('Unsaved changes from before are back · diagrams ' + item.id + ' to see the saved one');
    out.diagramEditor({
      code: draft.code,
      title: item ? item.name : 'new diagram',
      fileName: item ? item.name : 'diagram',
      onChange: (code) => setDraft(ctx, code, item ? item.id : null),
      save: item ? { label: 'Save', command: 'diagrams ' + item.id + ' save' } : { label: 'Save as…', input: 'diagrams add ' },
    });
    out.dim('Changes are kept on this device as you type · ' + (item ? 'Save writes them to ' + item.id : 'Save as… names it') + ' · mermaid.js.org has the syntax');
  }

  function showDiagram(ctx, item) {
    const { out } = ctx;
    out.head([['Diagram ', 'dim'], [item.id, 'id'], [' · ', 'dim'], [item.name, 'strong'], [' · ' + diagramKind(item.code), 'dim']]);
    out.diagram(item.code, item.name);
    out.fields([
      ['name', [[item.name, 'strong']], { command: 'diagrams ' + item.id + ' edit name', current: item.name }],
      ['code', [[diagramKind(item.code) + ' · ' + plural(item.code.split('\n').length, 'line'), '', { run: 'diagrams ' + item.id + ' edit' }], ['  live editor', 'faint']]],
    ]);
    out.dim('diagrams ' + item.id + ' edit · diagrams ' + item.id + ' code · diagrams ' + item.id + ' rm');
  }

  // The shared grammar, with the editor for `edit` and for the code field.
  const base = () => records.adapterFor('diagram');
  const adapter = () => {
    const A = base();
    return {
      ...A,
      show: (ctx, item, opts) => (opts && opts.open ? openEditor(ctx, item) : showDiagram(ctx, item)),
      setField: (ctx, item, field, value) => (fieldName('diagram', field) === 'code' && value === null ? openEditor(ctx, item) : A.setField(ctx, item, field, value)),
    };
  };

  function list(ctx, rest) {
    const { out } = ctx;
    const f = rest.trim().toLowerCase();
    const items = st().diagrams.items.filter((d) => !f || d.name.toLowerCase().includes(f) || d.code.toLowerCase().includes(f)).sort(byIdNum);
    if (!items.length) {
      out.head(f ? 'No diagrams match "' + rest.trim() + '"' : 'No diagrams yet', 'dim');
      out.line([['mermaid', 'accent', { run: 'mermaid' }], [' opens the editor; diagrams add <name> <code> keeps one', 'dim']]);
      return;
    }
    const today = todayISO(ctx.now());
    out.head([[plural(items.length, 'diagram'), 'strong'], [f ? ' matching "' + rest.trim() + '"' : ' · tap one to see it', 'dim']]);
    out.table(['id', 'name', 'kind', 'changed'], items.map((d) => [
      [[d.id, 'id', { run: 'diagrams ' + d.id }]], [[d.name, 'strong']], [[diagramKind(d.code), 'dim']],
      [[dayLabel(todayISO(new Date(d.updated)), today), 'faint']],
    ]));
    out.dim('mermaid for a new one · diagrams export / import for the whole library');
  }

  // diagrams add <name> [code]: the code given, or the editor's draft.
  async function addDiagram(ctx, rest) {
    const { out } = ctx;
    const t = tokenize(rest)[0];
    if (!t) return out.err('diagrams add <name> [code] · without code it keeps what the editor holds');
    const name = KINDS.diagram.fields.name.parse(t.text);
    if (name.error) return out.err('The name ' + name.error);
    let code = rest.slice(t.end).replace(/^[ \t]*\n?/, '');
    const draft = draftOf(ctx);
    const fromDraft = !code.trim();
    if (fromDraft) {
      if (!draft || !draft.code.trim()) return out.err('Nothing to keep: give the code (diagrams add ' + t.text + ' <code>), or write it in the editor first (mermaid)');
      code = draft.code;
    }
    const c = KINDS.diagram.fields.code.parse(code);
    if (c.error) return out.err('The code ' + c.error);
    const id = await ctx.data.allocId('d');
    const stamp = ctx.now().toISOString();
    await ctx.data.mutate('diagrams', (d) => { d.items.push({ id, name: name.value, code: c.value, created: stamp, updated: stamp }); });
    if (fromDraft) setDraft(ctx, c.value, id); // the editor now edits the kept one
    out.head([['Added diagram ', ''], [id, 'id', { run: 'diagrams ' + id }], [' · ' + name.value, 'strong']], 'ok');
    out.diagram(c.value, name.value);
  }

  const spec = {
    list, add: addDiagram, addArgs: '<name> [code]', filter: '[filter]',
    verbs: {
      // The editor's draft becomes this diagram's code.
      async save(ctx, item) {
        const { out } = ctx;
        const draft = draftOf(ctx);
        if (!draft || draft.target !== item.id) return out.err('The editor isn’t open on ' + item.id + ': diagrams ' + item.id + ' edit');
        if (draft.code === item.code) return out.head([['No changes to ', 'dim'], [item.id, 'id']], 'info');
        const c = KINDS.diagram.fields.code.parse(draft.code);
        if (c.error) return out.err('The code ' + c.error);
        await ctx.data.mutate('diagrams', (d) => {
          const x = d.items.find((y) => y.id === item.id);
          if (x) { x.code = c.value; x.updated = ctx.now().toISOString(); }
        });
        out.head([['Saved ', 'ok'], ['diagrams ' + item.id, 'id', { run: 'diagrams ' + item.id }], [' · ' + item.name + ' · ' + plural(c.value.split('\n').length, 'line'), 'dim']], 'ok');
      },
      code(ctx, item) {
        ctx.out.head([['Code of ', 'dim'], [item.id, 'id'], [' · ' + item.name, 'strong']]);
        ctx.out.code(item.code);
      },
    },
    verbUsage: ['save', 'code'],
  };

  add({
    name: 'diagrams', group: 'Diagrams', desc: 'Mermaid diagrams you keep: list, add, see, edit live, rename, export',
    usage: [...records.usageFor(adapter(), spec), 'diagrams export', 'diagrams import'],
    examples: ['diagrams', 'diagrams add flow <paste Mermaid code>', 'diagrams add flow   (keeps what the editor holds)', 'diagrams d1',
      'diagrams d1 edit', 'diagrams d1 edit name Sign-up flow', 'diagrams d1 save', 'diagrams export', 'diagrams import'],
    complete: (prev) => records.complete(adapter(), prev, { verbs: spec.verbs, first: [{ value: 'export' }, { value: 'import' }] }),
    async run(ctx, rest) {
      const w = rest.trim().toLowerCase();
      if (w === 'export') return exportLibrary(ctx);
      if (w === 'import') return importLibrary(ctx);
      if (w === 'new') return openEditor(ctx, null);
      return records.route(ctx, adapter(), rest, spec);
    },
  });

  function exportLibrary(ctx) {
    const { out } = ctx;
    const items = st().diagrams.items.slice().sort(byIdNum);
    if (!items.length) return out.head('No diagrams to export', 'dim');
    const name = 'diagrams-' + todayISO(ctx.now()) + '.json';
    ctx.download(name, JSON.stringify(libraryFile(items, ctx.now()), null, 2), 'application/json');
    out.head([['Exported ', ''], [name, 'strong'], [' · ' + plural(items.length, 'diagram'), 'dim']], 'ok');
  }

  async function importLibrary(ctx) {
    const { out } = ctx;
    const picked = ctx.pickFile('.json,application/json'); // reached before any await
    const file = await picked;
    if (!file) return out.head('Nothing imported', 'dim');
    if (file.size > 5 * 1024 * 1024) return out.err('The file is too large (5 MB max)');
    let lib;
    try {
      lib = readLibrary(await file.text());
    } catch (e) {
      return out.err((file.name ? file.name + ': ' : '') + e.message);
    }
    const have = st().diagrams.items;
    const fresh = lib.diagrams.filter((d) => !have.some((x) => x.name === d.name && x.code === d.code));
    const ids = [];
    for (const d of fresh) ids.push(await ctx.data.allocId('d'));
    const stamp = ctx.now().toISOString();
    const ok = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
    if (fresh.length) {
      await ctx.data.mutate('diagrams', (doc) => {
        fresh.forEach((d, i) => doc.items.push({ id: ids[i], name: d.name, code: d.code, created: ok(d.created) ? d.created : stamp, updated: ok(d.updated) ? d.updated : stamp }));
      });
    }
    out.head([['Imported ', ''], [plural(fresh.length, 'diagram'), 'strong']], fresh.length ? 'ok' : 'info');
    const skipped = lib.diagrams.length - fresh.length;
    if (skipped) out.dim(plural(skipped, 'diagram') + ' already here, skipped');
    if (lib.invalid) out.warn(plural(lib.invalid, 'entry', 'entries') + ' without a name or code, left out');
    if (fresh.length) out.table(null, fresh.map((d, i) => [[[ids[i], 'id', { run: 'diagrams ' + ids[i] }]], [[d.name, 'strong']], [[diagramKind(d.code), 'dim']]]));
  }

  add({
    name: 'mermaid', group: 'Diagrams', desc: 'draw a Mermaid diagram: the live editor, or a picture of pasted code',
    usage: ['mermaid', 'mermaid <code>'],
    examples: ['mermaid', 'mermaid <paste Mermaid code>', 'mermaid graph LR; a-->b'],
    async run(ctx, rest) {
      const { out } = ctx;
      const code = rest.replace(/^[ \t]*\n?/, '').replace(/\s+$/, '');
      if (!code) return openEditor(ctx, null);
      const c = KINDS.diagram.fields.code.parse(code);
      if (c.error) return out.err('The code ' + c.error);
      setDraft(ctx, c.value, null);
      out.head([['Mermaid', 'strong'], [' · ' + diagramKind(c.value), 'dim']]);
      out.diagram(c.value, 'diagram');
      out.line([['diagrams add <name>', 'accent'], [' keeps it · ', 'dim'], ['mermaid', 'accent', { run: 'mermaid' }], [' edits it', 'dim']]);
    },
  });
}
