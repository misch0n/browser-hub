import { todayISO, plural } from '../core/util.js';
import { usageSegs, bytes } from '../core/format.js';
import { merge } from '../core/importer.js';
import { DEFAULTS } from '../core/data.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const SHORTCUTS = [
  ['Enter', 'run the command'],
  ['Tab', 'complete; press again to list candidates'],
  ['↑ ↓', 'walk command history'],
  ['/', 'command palette (on an empty prompt)'],
  ['?', 'these shortcuts (on an empty prompt)'],
  ['Esc', 'clear the prompt, close the palette or widget drawer'],
];

export default function register(add, { st, usage, isBuiltin, defs, byName }) {
  add({
    name: 'help', group: 'Meta', desc: 'list commands, or details for one',
    usage: ['help [command]'],
    complete: (prev) => (prev.length === 0 ? defs.map((d) => ({ value: d.name, label: d.desc })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      if (rest) {
        const def = byName.get(rest.toLowerCase());
        if (!def) return out.err("No built-in command '" + rest + "'");
        out.head([[def.name, 'accent'], [' · ' + def.desc, 'dim']]);
        out.section('Usage');
        out.table(null, def.usage.map((u) => [usageSegs(u)]));
        if (def.examples) {
          out.section('Examples');
          out.table(null, def.examples.map((x) => [[['› ', 'faint'], [x, '']]]));
        }
        return;
      }
      out.head([['Commands', 'strong'], [' · ' + defs.length + ' built-in', 'dim']]);
      // One table, so descriptions line up across groups.
      const rows = [];
      let group = null;
      for (const d of defs) {
        if (d.group !== group) { group = d.group; rows.push({ section: group }); }
        rows.push([usageSegs(d.usage[0]), [[d.desc, 'dim']]]);
      }
      out.table(null, rows);
      out.section('Everything else');
      out.line([['Unknown input is searched with ', 'dim'], [st().aliases.defaultEngine, 'accent'],
        [' · help <command> for details · ? for shortcuts', 'dim']]);
    },
  });

  add({
    name: 'clear', group: 'Meta', desc: 'clear the output',
    usage: ['clear'],
    async run(ctx) { ctx.clearOutput(); },
  });

  add({
    name: 'history', group: 'Meta', desc: 'show recent commands',
    usage: ['history [n]'],
    async run(ctx, rest) {
      const { out } = ctx;
      let n = 20;
      if (rest) {
        if (!/^\d{1,3}$/.test(rest) || +rest < 1) return usage(ctx, this);
        n = +rest;
      }
      const items = st().history.items;
      const start = Math.max(0, items.length - n);
      const shown = items.slice(start);
      out.head([['Last ' + plural(shown.length, 'command'), 'strong'], [' of ' + items.length, 'dim']]);
      out.table(null, shown.map((h, i) => {
        const head = h.split(/\s+/)[0].toLowerCase();
        const sp = h.indexOf(' ');
        return [
          [[String(start + i + 1), 'faint']],
          [[sp < 0 ? h : h.slice(0, sp), isBuiltin(head) ? 'accent' : 'info'], [sp < 0 ? '' : h.slice(sp), '']],
        ];
      }));
    },
  });

  add({
    name: 'export', group: 'Meta', desc: 'download all data as one JSON file',
    usage: ['export'],
    async run(ctx) {
      const { out } = ctx;
      await ctx.data.load();
      const data = await ctx.store.exportAll();
      const name = 'control-center-' + todayISO(ctx.now()) + '.json';
      const text = JSON.stringify(data, null, 2);
      ctx.download(name, text, 'application/json');
      await ctx.data.markExported();
      const c = data.collections;
      const count = (k) => (c[k] && Array.isArray(c[k].items) ? c[k].items.length : 0);
      out.head([['Exported ', ''], [name, 'strong']], 'ok');
      out.kv([
        ['notes', [[String(count('notes')), 'num']]],
        ['tasks', [[String(count('tasks')), 'num']]],
        ['events', [[String(count('events')), 'num']]],
        ['aliases', [[String(c.aliases ? c.aliases.entries.length : 0), 'num']]],
        ['size', [[bytes(text.length), 'dim']]],
      ]);
    },
  });

  add({
    name: 'import', group: 'Meta', desc: 'load a JSON export, skipping conflicts',
    usage: ['import'],
    run(ctx) {
      const picked = ctx.pickFile('.json,application/json');
      return (async () => {
        const { out } = ctx;
        const file = await picked;
        if (!file) return out.head('Import cancelled', 'dim');
        if (file.size > MAX_FILE_BYTES) return out.err('The file is too large (5 MB max)');
        let parsed;
        try {
          parsed = JSON.parse(await file.text());
        } catch (e) {
          return out.err('Not valid JSON: ' + e.message);
        }
        await ctx.data.load();
        const current = {};
        for (const k of Object.keys(DEFAULTS)) current[k] = st()[k];
        const r = merge(current, parsed, isBuiltin, ctx.now);
        // All or nothing: if storage fills up halfway, put the old data back so
        // a retry doesn't duplicate what was already written.
        const before = await ctx.store.exportAll();
        try {
          await ctx.store.importAll({ collections: r.collections });
        } catch (e) {
          await ctx.store.importAll(before).catch(() => {});
          await ctx.data.load();
          return out.err('Import failed, nothing was changed: ' + e.message);
        }
        await ctx.data.load();
        const total = r.counts.notes + r.counts.tasks + r.counts.events + r.counts.aliases + r.counts.zones;
        out.head([['Imported ', ''], [file.name, 'strong']], r.lines.some((l) => l.startsWith('skipped')) || r.invalid ? 'warn' : total ? 'ok' : 'dim');
        out.kv(Object.keys(r.counts).map((k) => [k, [[String(r.counts[k]), r.counts[k] ? 'num' : 'faint']]]));
        if (r.invalid) out.warn(plural(r.invalid, 'invalid entry', 'invalid entries') + ' skipped');
        for (const l of r.lines) (l.startsWith('skipped') ? out.warn : out.info)(l);
      })();
    },
  });
}
