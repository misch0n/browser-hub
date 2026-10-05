import notes from './notes.js';
import tasks from './tasks.js';
import calendar from './calendar.js';
import tools from './tools.js';
import aliases from './aliases.js';
import view from './view.js';
import meta from './meta.js';
import { usageSegs } from '../core/format.js';
import { createRecords } from './records.js';

// Built-in commands. Each def is
//   { name, group, desc, usage: [...], examples?: [...], complete?(prevArgs), run(ctx, rest) }
// and talks to the page only through ctx:
//   ctx.out     structured output for this command (see ui/transcript.js); table rows
//               are arrays of cells, or { section } for a full-width group heading
//   ctx.data    collections + mutate/allocId (never localStorage directly)
//   ctx.store, ctx.now(), ctx.setInput(text), ctx.clearOutput(),
//   ctx.pickFile(accept), ctx.download(name, text, mime), ctx.revealPanel(show)
// A run() that opens a file picker must reach it synchronously (before any await).
export function createCommands(getCtx) {
  const defs = [];
  const byName = new Map();
  const st = () => getCtx().data.state;
  const isBuiltin = (name) => byName.has(name);

  const usage = (ctx, def) => {
    ctx.out.head([['Usage', ''], [' · ' + def.name, 'dim']], 'err');
    ctx.out.table(null, def.usage.map((u) => [usageSegs(u)]));
  };

  const add = (def) => {
    defs.push(def);
    byName.set(def.name, def);
  };
  const records = createRecords({ st, isBuiltin });
  const helpers = { st, usage, isBuiltin, defs, byName, records };
  for (const register of [notes, tasks, calendar, tools, aliases, view, meta]) register(add, helpers);

  // Runs a built-in. Anything thrown is reported in the command's output.
  async function run(name, rest, ctx) {
    try {
      await byName.get(name).run(ctx, rest);
    } catch (e) {
      ctx.out.err(e && e.message ? e.message : String(e));
    }
  }

  return { defs, byName, isBuiltin, run };
}
