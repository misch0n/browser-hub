import { parseId, truncate, firstLine, byIdNum, plural, todayISO } from '../core/util.js';
import { dayLabel } from '../core/format.js';

export default function register(add, { st, usage }) {
  add({
    name: 'n', group: 'Notes', desc: 'capture a note',
    usage: ['n <text>', 'n edit <id>', 'n rm <id>'],
    examples: ['n call the plumber about the boiler', 'n edit n3', 'n rm n3'],
    complete: (prev) => {
      if (prev.length === 0) return [{ value: 'edit' }, { value: 'rm' }];
      if (prev.length === 1 && (prev[0] === 'edit' || prev[0] === 'rm')) {
        return st().notes.items.slice().sort(byIdNum).map((n) => ({ value: n.id, label: truncate(firstLine(n.text), 50) }));
      }
      return [];
    },
    async run(ctx, rest) {
      const { out } = ctx;
      if (!rest) return usage(ctx, this);
      // Subcommands only in their exact shapes; anything else is note text,
      // so "n edit the slides" or "n rm the weeds" are captured, never applied.
      //   n edit <id>           load the note into the prompt
      //   n edit n<N>: <text>   save (the form the prompt is loaded with)
      //   n rm <id>
      const words = rest.split(/\s+/);
      const sub = words[0].toLowerCase();
      const save = sub === 'edit' ? /^edit\s+n?(\d+):(?:\s+([\s\S]*))?$/i.exec(rest) : null;
      const target = (sub === 'edit' || sub === 'rm') && words.length === 2 ? parseId('n', words[1]) : null;
      if (!save && !target) {
        const id = await ctx.data.allocId('n');
        const stamp = ctx.now().toISOString();
        await ctx.data.mutate('notes', (d) => { d.items.push({ id, text: rest, created: stamp, updated: stamp }); });
        out.head([['Added note ', ''], [id, 'id']], 'ok');
        return;
      }
      const id = save ? 'n' + +save[1] : target;
      const note = st().notes.items.find((n) => n.id === id);
      if (!note) return out.err('No note ' + id);
      if (sub === 'rm') {
        await ctx.data.mutate('notes', (d) => { d.items = d.items.filter((n) => n.id !== id); });
        out.head([['Removed note ', ''], [id, 'id']], 'ok');
        out.line(note.text, 'gone');
        return;
      }
      if (!save) {
        ctx.setInput('n edit ' + id + ': ' + note.text);
        out.head([['Editing ', ''], [id, 'id']], 'info');
        out.dim('Change the text and press Enter to save · Esc cancels');
        return;
      }
      const text = (save[2] || '').trim();
      if (!text) return out.err('A note needs some text; to delete it use: n rm ' + id);
      const stamp = ctx.now().toISOString();
      await ctx.data.mutate('notes', (d) => {
        const n = d.items.find((x) => x.id === id);
        if (n) { n.text = text; n.updated = stamp; }
      });
      out.head([['Updated note ', ''], [id, 'id']], 'ok');
    },
  });

  add({
    name: 'notes', group: 'Notes', desc: 'list notes, newest first',
    usage: ['notes [filter]'],
    async run(ctx, rest) {
      const { out } = ctx;
      const f = rest.toLowerCase();
      const list = st().notes.items.filter((n) => !f || n.text.toLowerCase().includes(f)).sort((a, b) => byIdNum(b, a));
      if (!list.length) {
        out.head(f ? 'No notes match "' + rest + '"' : 'No notes yet', 'dim');
        if (!f) out.dim('Add one with: n <text>');
        return;
      }
      const today = todayISO(ctx.now());
      out.head([[plural(list.length, 'note'), 'strong'], [f ? ' matching "' + rest + '"' : '', 'dim']]);
      out.table(['id', 'date', 'note'], list.map((n) => [
        [[n.id, 'id']],
        [[dayLabel(n.created.slice(0, 10), today), 'dim']],
        n.text,
      ]));
    },
  });
}
