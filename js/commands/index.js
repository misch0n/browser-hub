import find from './find.js';
import notes from './notes.js';
import tasks from './tasks.js';
import calendar from './calendar.js';
import tools from './tools.js';
import zones from './zones.js';
import aliases from './aliases.js';
import view from './view.js';
import meta from './meta.js';
import sync from './sync.js';
import config from './config.js';
import clip from './clip.js';
import dates from './dates.js';
import dev from './dev.js';
import text from './text.js';
import keep from './keep.js';
import timers from './timers.js';
import bounce from './bounce.js';
import cook from './cook.js';
import chance from './chance.js';
import devtools from './devtools.js';
import security from './security.js';
import browser from './browser.js';
import net from './net.js';
import diagrams from './diagrams.js';
import graph from './graph.js';
import { usageSegs } from '../core/format.js';
import { createRecords } from './records.js';
import { removes } from '../core/undo.js';

// Built-in commands. Each def is
//   { name, group, desc, usage: [...], examples?: [...], complete?(prevArgs) -> [{ value, label? }],
//     run(ctx, rest),
//     noUndo? (never an undo step), private? (kept out of the shared history), noHistory? (not
//     kept for ↑ either), ephemeral? (not in the shared history, and gone from the screen when
//     the next command runs: help), hidden? (an older name: still works, not listed) }
// `group` is the category help lists it under; docs/commands.md is generated from these defs
// (npm run docs). Commands talk to the page only through ctx (built in main.js):
//   ctx.out            structured output (ui/transcript.js): head, table, kv, fields, code, value, …;
//                      table rows are arrays of cells, or { section } for a full-width heading
//   ctx.data           collections: state, mutate(col, fn), allocId(prefix) (never localStorage)
//   ctx.store          getLocal/setLocal/removeLocal: values kept on this device only
//   ctx.now()          the clock (fixed in tests)
//   ctx.pasted         the full texts of the paste placeholders in the input, in order
//   ctx.askSecret(label) -> Promise<text>: masked input, never echoed or kept ('' when cancelled)
//   ctx.setInput(text) put text in the prompt     ctx.navigateAfter = url: open it once recorded
//   ctx.reloadAfter = true: reload the page from the server once recorded (refresh)
//   ctx.pickFile(accept) -> Promise<File|null>    ctx.download(name, text, mime)
//   ctx.fetch, ctx.env  the network and the browser globals, when tests replace them
//   ctx.device, ctx.os, ctx.pageURL, ctx.sync, ctx.records, ctx.clearOutput(at, message),
//   ctx.revealPanel(show), ctx.fontScale()/setFontScale(f), ctx.logView/setLogView, ctx.setDeviceName
// A run() that opens a file picker must reach it synchronously (before any await).
export function createCommands(getCtx) {
  const defs = [];
  const byName = new Map();
  const st = () => getCtx().data.state;
  const isBuiltin = (name) => byName.has(name);

  // Everything about one command: what it does, every form, examples. `help <name>`
  // shows it; so does a command run without what it needs (head: Usage).
  const fullHelp = (ctx, def, asUsage) => {
    const { out } = ctx;
    if (asUsage) {
      out.head([['Usage', ''], [' · ' + def.name, 'dim']], 'err');
      out.line([[def.desc, 'dim']]);
    } else {
      out.head([[def.name, 'accent'], [' · ' + def.desc, 'dim']]);
    }
    out.section('Usage');
    out.table(null, def.usage.map((u) => [usageSegs(u)]));
    if (def.examples) {
      out.section('Examples');
      out.table(null, def.examples.map((x) => [[['› ', 'faint'], [x, '']]])); // not tappable: some change or remove things
    }
  };
  const usage = (ctx, def) => fullHelp(ctx, def, true);

  const add = (def) => {
    defs.push(def);
    byName.set(def.name, def);
  };
  const records = createRecords({ st, isBuiltin });
  const helpers = { st, usage, fullHelp, isBuiltin, defs, byName, records };
  for (const register of [find, notes, tasks, calendar, keep, diagrams, timers, dates, tools, text, dev, clip, bounce, cook, chance, devtools, security, browser, net, zones, aliases, view, graph, sync, config, meta]) register(add, helpers);

  // Runs a built-in as one undoable step (unless it is undo/redo itself).
  // Anything thrown is reported in the command's output. A step that removed
  // something offers undo right there.
  async function run(name, rest, ctx) {
    const def = byName.get(name);
    try {
      if (def.noUndo || !ctx.data.transaction) {
        await def.run(ctx, rest);
        return;
      }
      const { patches } = await ctx.data.transaction(name + (rest ? ' ' + rest : ''), () => def.run(ctx, rest));
      if (removes(patches)) ctx.out.line([['↶ ', 'faint'], ['undo', 'accent', { run: 'undo' }], [' brings it back', 'faint']]);
    } catch (e) {
      ctx.out.err(e && e.message ? e.message : String(e));
    }
  }

  return { defs, byName, isBuiltin, run };
}
