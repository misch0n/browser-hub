import { parseId, parseDate, truncate, byIdNum, plural, todayISO } from '../core/util.js';
import { dueSeg, tagSegs } from '../core/format.js';
import { sortTasks } from '../core/agenda.js';
import { tokenize } from '../core/args.js';

export default function register(add, { st, usage, records }) {
  add({
    name: 't', group: 'Tasks', desc: 'add a task',
    usage: ['t <text> [due:<date>] [#tag]', 't done <id>', 't rm <id>', 't show <id>', 't edit <id>.<field> <value>'],
    examples: ['t buy flour due:tomorrow #home', 't file taxes due:2026-04-15', 't "done: write the report"', 't done t3',
      't edit t3.due fri', 't edit t3.tags #home #errands', 't edit t3.text buy rye flour'],
    complete: (prev) => {
      if (prev.length === 0) return ['done', 'rm', 'show', 'edit'].map((v) => ({ value: v }));
      if (prev.length === 1 && ['done', 'rm', 'show', 'edit'].includes(prev[0])) {
        return st().tasks.items
          .filter((t) => prev[0] !== 'done' || !t.done)
          .sort(byIdNum).map((t) => ({ value: t.id, label: truncate(t.text, 50) }));
      }
      return [];
    },
    async run(ctx, rest) {
      const { out } = ctx;
      if (!rest) return usage(ctx, this);
      const today = todayISO(ctx.now());
      const words = rest.split(/\s+/);
      const first = words[0].toLowerCase();
      if (first === 'edit' && await records.edit(ctx, 'task', rest.slice(4))) return;
      if ((first === 'show' || first === 'edit') && words.length === 2 && parseId('t', words[1])) return records.showCmd(ctx, 'task', words[1]);
      // `t done <id>` / `t rm <id>` only in that exact shape; "t done laundry" is a task.
      const target = (first === 'done' || first === 'rm') && words.length === 2 ? parseId('t', words[1]) : null;
      if (target) {
        const id = target;
        const task = st().tasks.items.find((t) => t.id === id);
        if (!task) return out.err('No task ' + id);
        if (first === 'rm') {
          await ctx.data.mutate('tasks', (d) => { d.items = d.items.filter((t) => t.id !== id); });
          out.head([['Removed task ', ''], [id, 'id']], 'ok');
          out.line(task.text, 'gone');
          return;
        }
        if (task.done) return out.head([[id, 'id'], [' is already done', '']], 'dim');
        const stamp = ctx.now().toISOString();
        await ctx.data.mutate('tasks', (d) => {
          const t = d.items.find((x) => x.id === id);
          if (t) { t.done = true; t.doneAt = stamp; }
        });
        out.head([['Completed ', ''], [id, 'id']], 'ok');
        out.line(task.text, 'gone');
        return;
      }

      let due = null;
      const tags = [];
      const text = [];
      // Quoted words are always text: t "due:friday is a word" #home
      for (const tok of tokenize(rest)) {
        const w = tok.text;
        if (tok.quoted) {
          text.push(w);
        } else if (/^due:/i.test(w)) {
          due = parseDate(w.slice(4), ctx.now());
          if (!due) {
            out.err("Can't read the date '" + w.slice(4) + "'");
            out.dim('Try 2026-10-31, today, tomorrow, fri, +3d or +2w');
            return;
          }
        } else if (/^#[\w-]+$/.test(w)) {
          const tag = w.slice(1).toLowerCase();
          if (!tags.includes(tag)) tags.push(tag);
        } else {
          text.push(w);
        }
      }
      if (!text.join('').trim()) return usage(ctx, this);
      const id = await ctx.data.allocId('t');
      const stamp = ctx.now().toISOString();
      const task = { id, text: text.join(' '), due, tags, done: false, created: stamp, doneAt: null };
      await ctx.data.mutate('tasks', (d) => { d.items.push(task); });
      out.head([['Added task ', ''], [id, 'id', { run: 't show ' + id }]], 'ok');
      const segs = [[task.text, '']];
      if (due) segs.push(['  ', ''], ['due ', 'faint'], dueSeg(due, today));
      if (tags.length) segs.push(['  ', ''], ...tagSegs(tags).flatMap((s, i) => (i ? [[' ', ''], s] : [s])));
      out.line(segs);
    },
  });

  add({
    name: 'tasks', group: 'Tasks', desc: 'list open tasks, overdue first',
    usage: ['tasks [#tag] [all]'],
    examples: ['tasks', 'tasks #home', 'tasks all'],
    async run(ctx, rest) {
      const { out } = ctx;
      let all = false, tag = null;
      for (const w of rest.split(/\s+/).filter(Boolean)) {
        if (w.toLowerCase() === 'all') all = true;
        else if (/^#[\w-]+$/.test(w)) tag = w.slice(1).toLowerCase();
        else return usage(ctx, this);
      }
      const today = todayISO(ctx.now());
      const list = sortTasks(st().tasks.items.filter((t) => (all || !t.done) && (!tag || t.tags.includes(tag))));
      const open = list.filter((t) => !t.done);
      const overdue = open.filter((t) => t.due && t.due < today).length;
      const scope = tag ? ' tagged #' + tag : '';
      if (!list.length) {
        out.head((all ? 'No tasks' : 'No open tasks') + scope, 'dim');
        if (!tag) out.dim('Add one with: t <text> [due:<date>] [#tag]');
        return;
      }
      out.head([
        [plural(open.length, 'open task'), 'strong'],
        [all ? ' · ' + (list.length - open.length) + ' done' : '', 'dim'],
        [overdue ? ' · ' + overdue + ' overdue' : '', 'err'],
        [scope, 'tag'],
      ], overdue ? 'warn' : undefined);
      out.table(['id', '', 'due', 'task', 'tags'], list.map((t) => [
        [[t.id, t.done ? 'faint' : 'id', { run: 't show ' + t.id }]],
        [[t.done ? '✓' : '○', t.done ? 'ok' : 'faint']],
        [dueSeg(t.due, today, t.done)],
        [[t.text, t.done ? 'gone' : '']],
        tagSegs(t.tags).flatMap((s, i) => (i ? [[' ', ''], s] : [s])),
      ]));
    },
  });
}
