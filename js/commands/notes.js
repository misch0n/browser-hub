import { byIdNum, plural, todayISO } from '../core/util.js';
import { dayLabel } from '../core/format.js';
import { oneValue } from '../core/args.js';

// notes, and n: the same with plain text adding a note (n call the plumber).

// In lists, a note of several lines shows its first, and how many more.
const noteLine = (text) => {
  const lines = text.split('\n');
  return lines.length > 1 ? [[lines[0], ''], ['  +' + (lines.length - 1) + (lines.length === 2 ? ' line' : ' lines'), 'faint']] : [[text, '']];
};

async function addNote(ctx, rest) {
  const text = oneValue(rest); // n "rm the weeds" is a note, quotes and all taken off
  if (!text.trim()) return ctx.out.err('A note needs some text');
  const id = await ctx.data.allocId('n');
  const stamp = ctx.now().toISOString();
  await ctx.data.mutate('notes', (d) => { d.items.push({ id, text, created: stamp, updated: stamp }); });
  ctx.out.head([['Added note ', ''], [id, 'id', { run: 'notes ' + id }]], 'ok');
}

export default function register(add, { st, records }) {
  function listNotes(ctx, rest) {
    const { out } = ctx;
    const f = rest.toLowerCase();
    const list = st().notes.items.filter((n) => !f || n.text.toLowerCase().includes(f)).sort((a, b) => byIdNum(b, a));
    if (!list.length) {
      out.head(f ? 'No notes match "' + rest + '"' : 'No notes yet', 'dim');
      if (!f) out.dim('Add one with: notes add <text>  (or n <text>)');
      return;
    }
    const today = todayISO(ctx.now());
    out.head([[plural(list.length, 'note'), 'strong'], [f ? ' matching "' + rest + '"' : '', 'dim']]);
    out.table(['id', 'date', 'note'], list.map((n) => [
      [[n.id, 'id', { run: 'notes ' + n.id }]],
      [[dayLabel(todayISO(new Date(n.created)), today), 'dim']], // local day, not the UTC one
      noteLine(n.text),
    ]));
  }

  const spec = { list: listNotes, add: addNote, addArgs: '<text>', filter: '[filter]' };

  add({
    name: 'notes', group: 'Notes', desc: 'list, add, show, edit and remove notes',
    usage: records.usageFor('note', spec),
    examples: ['notes', 'notes plumber', 'notes add call the plumber', 'notes n3', 'notes n3 edit', 'notes n3 edit text call the plumber today', 'notes n3 rm'],
    complete: (prev) => records.complete('note', prev),
    run: (ctx, rest) => records.route(ctx, 'note', rest, spec),
  });

  add({
    name: 'n', group: 'Notes', aliasOf: 'notes', desc: 'short for notes; n <text> adds a note',
    usage: ['n <text>', 'n "<text that starts like a command>"', 'n <id> [edit [<field> [<value>]] | rm]'],
    examples: ['n call the plumber about the boiler', 'n "rm the weeds"', 'n n3 edit text call the plumber today'],
    complete: (prev) => records.complete('note', prev),
    async run(ctx, rest) {
      if (!rest.trim()) return listNotes(ctx, '');
      // The old prompt-edit form: n edit n3: <new text>
      const save = /^edit\s+n?(\d+):(?:\s+([\s\S]*))?$/i.exec(rest);
      if (save) {
        const note = records.target('note', 'n' + save[1], false);
        if (!note || !note.item) return ctx.out.err('No note n' + +save[1]);
        return records.setField(ctx, 'note', note.item, 'text', (save[2] || '').trim());
      }
      return records.route(ctx, 'note', records.legacy('note', rest) ?? rest, { ...spec, short: true });
    },
  });
}
