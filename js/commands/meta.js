import { todayISO, plural } from '../core/util.js';
import { usageSegs, bytes, kindSeg } from '../core/format.js';
import { merge } from '../core/importer.js';
import { DEFAULTS } from '../core/data.js';
import { SHORTCUT_GROUPS, keyLabel, isApple } from '../core/keys.js';
import { describe } from '../core/undo.js';
import { sessions } from '../core/log.js';
import { relative } from '../lib/misc.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024;


export default function register(add, helpers) {
  const { st, usage, isBuiltin, defs, byName } = helpers;
  add({
    name: 'help', group: 'Meta', ephemeral: true, // a big reference block: kept out of the shared history, gone after the next command
    desc: 'list commands, or everything about one',
    usage: ['help [command]'],
    complete: (prev) => (prev.length === 0 ? defs.filter((d) => !d.hidden).map((d) => ({ value: d.name, label: d.desc })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      if (rest) {
        const def = byName.get(rest.toLowerCase());
        if (!def) return out.err("No built-in command '" + rest + "'");
        return helpers.fullHelp(ctx, def);
      }
      const doc = st().aliases;
      const mine = doc.entries.filter((e) => !isBuiltin(e.name));
      const engines = mine.filter((e) => e.template).sort((a, b) => (a.name < b.name ? -1 : 1));
      const aliases = mine.filter((e) => !e.template).sort((a, b) => (a.name < b.name ? -1 : 1));
      const shown = defs.filter((x) => !x.hidden);
      out.head([['Help', 'strong'], [' · ' + shown.length + ' commands · tap one for everything about it', 'dim']]);
      // One row per command, by category; the tag says what kind of name it is.
      const rows = [];
      const groups = new Map(); // categories in the order they first appear
      for (const d of shown) groups.set(d.group, [...(groups.get(d.group) || []), d]);
      for (const [group, list] of groups) {
        rows.push({ section: [[group, ''], ['  ', ''], ['⚙ built-in', 'k-cmd']] });
        for (const d of list) rows.push([[[d.name, 'accent', { run: 'help ' + d.name }]], [[d.desc, 'dim']]]);
      }
      rows.push({ section: [['Your search engines', ''], ['  ', ''], ['⌕ engine', 'k-engine']] });
      if (!engines.length) rows.push([[['none yet', 'faint']], [['alias <name> <url with {}>', 'dim']]]);
      for (const e of engines) {
        rows.push([[[e.name, 'accent', { run: 'aliases ' + e.name }]], [[e.template, 'url'], [e.name === doc.defaultEngine ? '  ★ default' : '', 'accent']]]);
      }
      rows.push({ section: [['Your aliases', ''], ['  ', ''], ['↗ alias', 'k-alias']] });
      if (!aliases.length) rows.push([[['none yet', 'faint']], [['alias <name> <url>', 'dim']]]);
      for (const e of aliases) rows.push([[[e.name, 'accent', { run: 'aliases ' + e.name }]], [[e.base, 'url']]]);
      out.table(null, rows, { stack: true });
      out.dim('Notes, tasks, events, snippets, links and aliases share one grammar: tasks · tasks add <text> · tasks <id> · tasks <id> edit · tasks <id> rm');
      out.dim('Anything else is searched with ' + doc.defaultEngine + ' · Tab completes, Tab again lists the choices · keys (or ?) for shortcuts');
    },
  });

  add({
    name: 'keys', group: 'Meta', ephemeral: true, desc: 'keyboard shortcuts, labelled for this computer',
    usage: ['keys'],
    async run(ctx) {
      const { out } = ctx;
      const os = ctx.os || 'other';
      out.head([['Keyboard shortcuts', 'strong'], [' · ' + (isApple(os) ? 'Mac keys: ⌃ Control, ⌥ Option' : 'Ctrl and Alt'), 'dim']]);
      const rows = [];
      for (const g of SHORTCUT_GROUPS) {
        rows.push({ section: g.name });
        for (const it of g.items) {
          const caps = it.keys.flatMap((k, i) => (i ? [[' ', ''], [keyLabel(k, os), 'kbd']] : [[keyLabel(k, os), 'kbd']]));
          rows.push([caps, [[!isApple(os) && it.pc ? it.pc : it.desc, 'dim']]]);
        }
      }
      out.table(null, rows, { stack: true });
      out.dim('On a phone, the keys button under the prompt shows buttons for the most useful ones');
    },
  });

  // undo / redo: the same command, two directions.
  const stepCommand = (dir) => ({
    name: dir, group: 'Meta', noUndo: true,
    desc: dir === 'undo' ? 'undo the last change (again for the one before)' : 'redo what undo took back',
    usage: [dir, dir + ' list', dir + ' force'],
    examples: dir === 'undo' ? ['undo', 'undo list'] : ['redo'],
    complete: (prev) => (prev.length === 0 ? [{ value: 'list' }, { value: 'force' }] : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const arg = rest.trim().toLowerCase();
      if (arg === 'ls' || arg === 'list') {
        const list = ctx.data.steps()[dir].slice().reverse();
        if (!list.length) return out.head('Nothing to ' + dir, 'dim');
        out.head([[plural(list.length, 'step'), 'strong'], [' to ' + dir + ', newest first', 'dim']]);
        out.table(null, list.map((x, i) => [[[String(i + 1), 'num']], [[x.label, i ? '' : 'strong']], [[describe(x.patches), 'dim']],
          [[relative(new Date(x.at), ctx.now()), 'faint']]]));
        return;
      }
      if (arg && arg !== 'force') return usage(ctx, this);
      const r = await ctx.data[dir](arg === 'force');
      if (r.empty) return out.head('Nothing to ' + dir, 'dim');
      if (r.conflict) {
        out.err("Can't " + dir + " '" + r.step.label + "': changed since: " + r.conflict.join(', '));
        out.dim(dir + ' force puts those back anyway, overwriting the newer change');
        return;
      }
      out.head([[dir === 'undo' ? 'Undid ' : 'Redid ', ''], [r.step.label, 'strong']], 'ok');
      out.dim(describe(r.step.patches));
      const more = ctx.data.steps();
      out.line([[dir === 'undo' ? 'redo' : 'undo', 'accent', { run: dir === 'undo' ? 'redo' : 'undo' }],
        [dir === 'undo' ? ' puts it back' : ' takes it back again', 'faint'],
        [more[dir].length ? ' · ' + plural(more[dir].length, 'more step') + ' to ' + dir : '', 'faint']]);
    },
  });
  add(stepCommand('undo'));
  add(stepCommand('redo'));

  add({
    name: 'clear', group: 'Meta', desc: 'clear the history: this device\'s session, or every device\'s',
    usage: ['clear', 'clear current', 'clear all'],
    examples: ['clear', 'clear all', 'undo'],
    complete: (prev) => (prev.length === 0 ? [{ value: 'current', label: 'this device' }, { value: 'all', label: 'every device' }] : []),
    async run(ctx, rest) {
      const arg = rest.trim().toLowerCase() || 'current';
      if (arg !== 'current' && arg !== 'all') return usage(ctx, this);
      // Hides everything up to now, on every device once synced; undo brings it back.
      const at = ctx.now().toISOString();
      const dev = ctx.device ? ctx.device.id : 'this';
      await ctx.data.mutate('log', (d) => {
        if (arg === 'all') d.cleared.all = at;
        else d.cleared.devices[dev] = at;
      });
      ctx.clearOutput(at, arg === 'all' ? 'Cleared the history of every device' : 'Cleared this device\'s history');
    },
  });

  add({
    name: 'session', group: 'Meta', noUndo: true, desc: 'the shared history by device: list sessions, or choose which to show',
    usage: ['session', 'session show all', 'session show current', 'session show <device>'],
    examples: ['session', 'session show current', 'session show all', 'session show iPhone · Safari'],
    complete: (prev) => {
      if (prev.length === 0) return [{ value: 'show' }];
      if (prev.length === 1 && prev[0] === 'show') return [{ value: 'all', label: 'every device' }, { value: 'current', label: 'this device' }];
      return [];
    },
    async run(ctx, rest) {
      const { out } = ctx;
      const words = rest.trim().split(/\s+/).filter(Boolean);
      const list = sessions(st().log);
      const here = ctx.device ? ctx.device.id : null;
      const viewName = (v) => (v === 'all' ? 'every device' : v === 'current' ? 'this device' : (list.find((s) => s.device === v) || {}).name || v);
      if (!words.length) {
        const v = ctx.logView ? ctx.logView() : 'all';
        out.head([[plural(list.length, 'session'), 'strong'], [' · showing ', 'dim'], [viewName(v), 'accent']]);
        if (!list.length) return out.dim('Nothing in the history yet');
        out.table(['device', '', 'commands', 'last'], list.map((s) => [
          [[s.name || s.device, s.device === here ? 'accent' : 'strong', { run: 'session show ' + (s.device === here ? 'current' : s.device) }]],
          [[s.device === here ? '● this device' : '', 'ok']],
          [[String(s.count), 'num']],
          [[relative(new Date(s.last), ctx.now()), 'dim']],
        ]));
        out.dim('session show all · session show current · session show <device> · clear current|all');
        return;
      }
      if (words[0].toLowerCase() !== 'show' || words.length < 2) return usage(ctx, this);
      const want = words.slice(1).join(' ').toLowerCase();
      let v = want === 'all' ? 'all' : want === 'current' || want === 'this' ? 'current' : null;
      if (!v) {
        const s = list.find((x) => x.device.toLowerCase() === want || (x.name || '').toLowerCase() === want);
        if (!s) return out.err("No session '" + words.slice(1).join(' ') + "' · session lists them");
        v = s.device === here ? 'current' : s.device;
      }
      ctx.setLogView(v);
      out.head([['Showing ', ''], [viewName(v), 'accent']], 'ok');
    },
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
        ['snippets', [[String(count('snippets')), 'num']]],
        ['links', [[String(count('later')), 'num']]],
        ['foods', [[String(count('foods')), 'num']]],
        ['aliases', [[String(c.aliases ? c.aliases.entries.length : 0), 'num']]],
        ['size', [[bytes(text.length), 'dim']]],
      ]);
    },
  });

  add({
    name: 'import', group: 'Meta', desc: 'load a file: an export, an xsearch export, or calendar events (.ics)',
    usage: ['import'],
    run(ctx) {
      const picked = ctx.pickFile('.json,application/json,.ics,text/calendar');
      return (async () => {
        const { out } = ctx;
        const file = await picked;
        if (!file) return out.head('Import cancelled', 'dim');
        if (file.size > MAX_FILE_BYTES) return out.err('The file is too large (5 MB max)');
        if (/\.ics$/i.test(file.name || '') || /^\s*BEGIN:VCALENDAR/i.test((await file.text()).slice(0, 200))) {
          return helpers.importICS(ctx, file);
        }
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
        // One undo step for the whole import.
        for (const c of Object.keys(r.collections)) ctx.data.noteChange(c, current[c], st()[c]);
        const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
        out.head([['Imported ', ''], [file.name, 'strong']], r.lines.some((l) => l.startsWith('skipped')) || r.invalid ? 'warn' : total ? 'ok' : 'dim');
        out.kv(Object.keys(r.counts).map((k) => [k, [[String(r.counts[k]), r.counts[k] ? 'num' : 'faint']]]));
        if (r.invalid) out.warn(plural(r.invalid, 'invalid entry', 'invalid entries') + ' skipped');
        for (const l of r.lines) (l.startsWith('skipped') ? out.warn : out.info)(l);
      })();
    },
  });
}
