import { leadingDate, plural, todayISO } from '../core/util.js';
import { dueSeg, tagSegs, usageSegs } from '../core/format.js';
import { sortTasks } from '../core/agenda.js';
import { tokenize } from '../core/args.js';
import { parseRepeat, nextDue, firstDue, repeatLabel } from '../core/repeat.js';

// tasks, and t: the same with plain text adding a task (t buy milk).

export default function register(add, { st, records }) {
  const addHelp = (ctx) => {
    ctx.out.head([['Usage', ''], [' · tasks add', 'dim']], 'err');
    ctx.out.table(null, [[usageSegs('tasks add <text> [due:<date>] [every:<rule>] [#tag]')], [usageSegs('t <text> [due:<date>] [every:<rule>] [#tag]')]]);
  };

  async function addTask(ctx, rest) {
    const { out } = ctx;
    const today = todayISO(ctx.now());
    let due = null;
    let repeat = null;
    const tags = [];
    const text = [];
    // Quoted words are always text: t "due:friday is a word" #home
    const toks = tokenize(rest);
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i];
      const w = tok.text;
      if (tok.quoted) {
        text.push(w);
      } else if (/^due:/i.test(w)) {
        // due:friday, or a date in a few words: due:next friday, due:12 oct, due:in 3 days
        const words = [w.slice(4), ...toks.slice(i + 1, i + 3).filter((t) => !t.quoted).map((t) => t.text)];
        const found = leadingDate(words.filter(Boolean), ctx.now());
        if (!found || !w.slice(4)) {
          out.err("Can't read the date '" + w.slice(4) + "'");
          out.dim('Try friday, next friday, 12 oct, tomorrow, in 3 days, +2w or 2026-10-31');
          return;
        }
        due = found.date;
        i += found.used - 1;
      } else if (/^(every|repeat):/i.test(w)) {
        repeat = parseRepeat(w.slice(w.indexOf(':') + 1));
        if (!repeat) {
          out.err("Can't read the repeat '" + w.slice(w.indexOf(':') + 1) + "'");
          out.dim('Try every:day, every:weekday, every:week, every:2w, every:month, every:mon,thu');
          return;
        }
      } else if (/^#[\w-]+$/.test(w)) {
        const tag = w.slice(1).toLowerCase();
        if (!tags.includes(tag)) tags.push(tag);
      } else {
        text.push(w);
      }
    }
    if (!text.join('').trim()) return addHelp(ctx);
    const id = await ctx.data.allocId('t');
    const stamp = ctx.now().toISOString();
    if (repeat && !due) due = firstDue(repeat, today);
    const task = { id, text: text.join(' '), due, tags, done: false, created: stamp, doneAt: null };
    if (repeat) task.repeat = repeat;
    await ctx.data.mutate('tasks', (d) => { d.items.push(task); });
    out.head([['Added task ', ''], [id, 'id', { run: 'tasks ' + id }]], 'ok');
    const segs = [[task.text, '']];
    if (due) segs.push(['  ', ''], ['due ', 'faint'], dueSeg(due, today));
    if (repeat) segs.push(['  ↻ ' + repeatLabel(repeat), 'faint']);
    if (tags.length) segs.push(['  ', ''], ...tagSegs(tags).flatMap((s, i) => (i ? [[' ', ''], s] : [s])));
    out.line(segs);
  }

  async function done(ctx, task) {
    const { out } = ctx;
    const id = task.id;
    const today = todayISO(ctx.now());
    if (task.done) return out.head([[id, 'id'], [' is already done', '']], 'dim');
    const stamp = ctx.now().toISOString();
    if (task.repeat) {
      // Recurring: never finished, the due date moves on.
      const next = nextDue(task.repeat, task.due, today);
      await ctx.data.mutate('tasks', (d) => {
        const t = d.items.find((x) => x.id === id);
        if (t) { t.due = next; t.lastDone = stamp; t.doneCount = (t.doneCount || 0) + 1; }
      });
      out.head([['Completed ', ''], [id, 'id', { run: 'tasks ' + id }], [' · next ', 'dim'], dueSeg(next, today)], 'ok');
      out.line([[task.text, ''], ['  ↻ ' + repeatLabel(task.repeat), 'faint']]);
      return;
    }
    await ctx.data.mutate('tasks', (d) => {
      const t = d.items.find((x) => x.id === id);
      if (t) { t.done = true; t.doneAt = stamp; }
    });
    out.head([['Completed ', ''], [id, 'id']], 'ok');
    out.line(task.text, 'gone');
  }

  function listTasks(ctx, rest) {
    const { out } = ctx;
    let all = false, tag = null;
    for (const w of rest.split(/\s+/).filter(Boolean)) {
      if (w.toLowerCase() === 'all') all = true;
      else if (/^#[\w-]+$/.test(w)) tag = w.slice(1).toLowerCase();
      else {
        out.err("tasks: '" + w + "' is not a task id, add, all or #tag");
        out.dim('tasks · tasks all · tasks #home · tasks add <text> · tasks <id>');
        return;
      }
    }
    const today = todayISO(ctx.now());
    const list = sortTasks(st().tasks.items.filter((t) => (all || !t.done) && (!tag || t.tags.includes(tag))));
    const open = list.filter((t) => !t.done);
    const overdue = open.filter((t) => t.due && t.due < today).length;
    const scope = tag ? ' tagged #' + tag : '';
    if (!list.length) {
      out.head((all ? 'No tasks' : 'No open tasks') + scope, 'dim');
      if (!tag) out.dim('Add one with: tasks add <text> [due:<date>] [#tag]  (or t <text>)');
      return;
    }
    out.head([
      [plural(open.length, 'open task'), 'strong'],
      [all ? ' · ' + (list.length - open.length) + ' done' : '', 'dim'],
      [overdue ? ' · ' + overdue + ' overdue' : '', 'err'],
      [scope, 'tag'],
    ], overdue ? 'warn' : undefined);
    out.table(['id', '', 'due', 'task', 'tags'], list.map((t) => [
      [[t.id, t.done ? 'faint' : 'id', { run: 'tasks ' + t.id }]],
      [[t.done ? '✓' : '○', t.done ? 'ok' : 'faint']],
      [dueSeg(t.due, today, t.done)],
      [[t.text, t.done ? 'gone' : ''], [t.repeat ? '  ↻ ' + repeatLabel(t.repeat) : '', 'faint']],
      tagSegs(t.tags).flatMap((s, i) => (i ? [[' ', ''], s] : [s])),
    ]));
  }

  const spec = { list: listTasks, add: addTask, verbs: { done }, addArgs: '<text> [due:<date>] [every:<rule>] [#tag]', filter: '[all] [#tag]' };
  const first = [{ value: 'all' }];

  add({
    name: 'tasks', group: 'Tasks', desc: 'list, add, show, edit, complete and remove tasks',
    usage: records.usageFor('task', spec),
    examples: ['tasks', 'tasks #home', 'tasks add buy flour due:tomorrow #home', 'tasks add water the plants every:mon,thu',
      'tasks t3', 'tasks t3 edit', 'tasks t3 edit due fri', 'tasks t3 edit name buy rye flour', 'tasks t3 edit repeat none', 'tasks t3 done', 'tasks t3 rm'],
    complete: (prev) => records.complete('task', prev, { verbs: spec.verbs, first }),
    run: (ctx, rest) => records.route(ctx, 'task', rest, spec),
  });

  add({
    name: 't', group: 'Tasks', aliasOf: 'tasks', desc: 'short for tasks; t <text> adds a task',
    usage: ['t <text> [due:<date>] [every:<rule>] [#tag]', 't "<text that starts like a command>"', 't <id> [edit [<field> [<value>]] | done | rm]'],
    examples: ['t buy flour due:tomorrow #home', 't pay rent every:month due:2026-11-01', 't "done: write the report"', 't t3 done', 't t3 edit due fri'],
    complete: (prev) => records.complete('task', prev, { verbs: spec.verbs, first }),
    run: (ctx, rest) => records.route(ctx, 'task', records.legacy('task', rest, ['done']) ?? rest, { ...spec, short: true }),
  });
}
