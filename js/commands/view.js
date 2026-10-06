import { THEMES, WIDGETS, isTheme, isWidget } from '../core/catalog.js';

export default function register(add, { st, usage, records }) {
  add({
    name: 'theme', group: 'View', desc: 'list colour themes, or switch theme',
    usage: ['theme [name]'],
    examples: ['theme', 'theme nord', 'theme auto'],
    complete: (prev) => (prev.length === 0 ? THEMES.map((t) => ({ value: t.id, label: t.desc })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const current = st().settings.theme;
      if (!rest) {
        out.head([['Themes', 'strong'], [' · current ', 'dim'], [current, 'accent']]);
        out.table(null, THEMES.map((t) => [
          [{ swatch: t.id }],
          [[t.id, t.id === current ? 'accent' : 'strong']],
          [[t.desc, 'dim']],
          [[t.id === current ? '● current' : '', 'ok']],
        ]));
        out.dim('Switch with: theme <name>');
        return;
      }
      const id = rest.trim().toLowerCase();
      if (!isTheme(id)) {
        out.err("No theme '" + rest + "'");
        out.dim('Available: ' + THEMES.map((t) => t.id).join(', '));
        return;
      }
      await ctx.data.mutate('settings', (d) => { d.theme = id; });
      out.head([['Theme set to ', ''], [id, 'accent']], 'ok');
    },
  });

  // Widgets, in the shared grammar:
  //   widgets · widgets add <name> (turn on) · widgets zones · widgets zones edit [on|position <value>]
  //   widgets zones on|off · widgets zones move top|up|down|bottom|<n> · widgets zones rm (turn off)
  // plus widgets show|hide for the panel and widgets order <names…>.
  const on = () => st().settings.widgets.filter(isWidget);
  const def = (id) => WIDGETS.find((w) => w.id === id);
  const showOrder = (out, list) => out.dim('Order: ' + list.map((id, i) => (i + 1) + '. ' + id).join('  '));

  function listWidgets(ctx, rest) {
    const { out } = ctx;
    const s = st().settings;
    const arg = rest.trim().toLowerCase();
    if (arg) {
      out.err("widgets: '" + rest.trim() + "' is not a widget");
      out.dim('Widgets: ' + WIDGETS.map((w) => w.id).join(', ') + ' · the panel: widgets show|hide');
      return;
    }
    out.head([['Widgets', 'strong'], [' · ' + s.widgets.length + ' of ' + WIDGETS.length + ' on', 'dim'],
      [s.panel ? '' : ' · panel hidden', 'warn']]);
    // Widgets that are on, in panel order, then the rest.
    const order = on().concat(WIDGETS.map((w) => w.id).filter((id) => !s.widgets.includes(id)));
    out.table(null, order.map((id) => {
      const pos = s.widgets.indexOf(id);
      return [[[pos >= 0 ? String(pos + 1) : '', 'num']], [[pos >= 0 ? '●' : '○', pos >= 0 ? 'ok' : 'faint']],
        [[id, pos >= 0 ? 'strong' : 'dim', { run: 'widgets ' + id }]], [[def(id).desc, 'dim']]];
    }));
    out.dim('widgets <name> on|off · widgets <name> move top|up|down|bottom|<n> · the panel: widgets show|hide');
  }

  function showWidget(ctx, id, opts = {}) {
    const { out } = ctx;
    const pos = st().settings.widgets.indexOf(id);
    out.head(opts.head || [['widget ', 'dim'], [id, 'id']]);
    out.fields([
      ['on', pos >= 0 ? [['● on', 'ok']] : [['○ off', 'faint']], { command: 'widgets ' + id + ' edit on', current: pos >= 0 ? 'yes' : 'no', open: opts.open === 'on' }],
      ['position', pos >= 0 ? [[String(pos + 1), 'num'], [' of ' + on().length, 'faint']] : [['—', 'faint']],
        ...(pos >= 0 ? [{ command: 'widgets ' + id + ' edit position', current: String(pos + 1) }] : [])],
      ['shows', [[def(id).desc, 'dim']]],
    ]);
    out.dim('Tap a value to change it, or: widgets ' + id + ' ' + (pos >= 0 ? 'off · widgets ' + id + ' move top|up|down|bottom|<n>' : 'on'));
  }

  async function turn(ctx, id, want) {
    const { out } = ctx;
    const isOn = st().settings.widgets.includes(id);
    if (want !== isOn) {
      // A widget turned on goes to the bottom; the others keep their places.
      await ctx.data.mutate('settings', (d) => {
        const list = d.widgets.filter((w) => isWidget(w) && w !== id);
        if (want) { list.push(id); d.panel = true; }
        d.widgets = list;
      });
    }
    if (want) ctx.revealPanel?.(true);
    out.head([[id, 'strong', { run: 'widgets ' + id }], [want ? ' on' : ' off', want ? 'ok' : 'dim']], 'ok');
  }

  async function move(ctx, id, where) {
    const { out } = ctx;
    const s = st().settings;
    where = String(where || '').trim().toLowerCase();
    if (!where) return out.err('widgets ' + id + ' move top|up|down|bottom|<position>');
    if (!s.widgets.includes(id)) {
      out.err(id + ' is off');
      out.dim('Turn it on first: widgets ' + id + ' on');
      return;
    }
    const from = s.widgets.indexOf(id);
    const last = s.widgets.length - 1;
    let to;
    if (where === 'up') to = from - 1;
    else if (where === 'down') to = from + 1;
    else if (where === 'top') to = 0;
    else if (where === 'bottom') to = last;
    else if (/^\d+$/.test(where)) to = +where - 1;
    else return out.err("Can't move to '" + where + "': top, up, down, bottom or a position");
    to = Math.max(0, Math.min(last, to));
    if (to === from) {
      out.head([[id, 'strong'], [' is already ' + (to === 0 ? 'first' : to === last ? 'last' : 'at ' + (to + 1)), 'dim']]);
      return showOrder(out, s.widgets);
    }
    const next = await ctx.data.mutate('settings', (d) => {
      const list = d.widgets.filter((w) => w !== id);
      list.splice(Math.min(to, list.length), 0, id);
      d.widgets = list;
      return list;
    });
    out.head([['Moved ', ''], [id, 'strong'], [' to ' + (next.indexOf(id) + 1), 'dim']], 'ok');
    showOrder(out, next);
  }

  async function setField(ctx, id, field, value) {
    const { out } = ctx;
    const f = String(field).toLowerCase();
    if (f !== 'on' && f !== 'position') {
      out.err('Widgets have no field ' + field);
      out.dim('Fields: on, position');
      return;
    }
    if (value === null) {
      const pos = st().settings.widgets.indexOf(id);
      ctx.setInput('widgets ' + id + ' edit ' + f + ' ' + (f === 'on' ? (pos >= 0 ? 'yes' : 'no') : String(pos + 1)));
      out.head([['Editing ', ''], ['widgets ' + id + ' ' + f, 'id']], 'info');
      return;
    }
    if (f === 'position') return move(ctx, id, value);
    const v = value.trim().toLowerCase();
    if (['yes', 'y', 'on', 'true', '1'].includes(v)) return turn(ctx, id, true);
    if (['no', 'n', 'off', 'false', '0'].includes(v)) return turn(ctx, id, false);
    out.err('on is yes or no');
  }

  const adapter = {
    noun: 'widgets', label: 'widget', fields: ['on', 'position'],
    target: (word) => (isWidget(String(word).toLowerCase()) ? { item: String(word).toLowerCase() } : null),
    key: (id) => id,
    show: (ctx, id, opts) => showWidget(ctx, id, opts),
    setField: (ctx, id, field, value) => setField(ctx, id, field, value),
    remove: (ctx, id) => turn(ctx, id, false),
    ids: () => WIDGETS.map((w) => ({ value: w.id, label: w.desc })),
  };
  const verbs = {
    on: (ctx, id) => turn(ctx, id, true),
    off: (ctx, id) => turn(ctx, id, false),
    move: (ctx, id, where) => move(ctx, id, where),
  };
  const spec = {
    list: listWidgets, verbs, addArgs: '<name>', id: '<name>', verbUsage: ['on', 'off', 'move top|up|down|bottom|<n>'],
    add: (ctx, rest) => {
      const id = rest.trim().toLowerCase();
      if (!isWidget(id)) return ctx.out.err(id ? "No widget '" + id + "'" : 'widgets add <name> · ' + WIDGETS.map((w) => w.id).join(', '));
      return turn(ctx, id, true);
    },
  };

  add({
    name: 'widgets', group: 'View', desc: 'the side panel: list, turn on and off, and order widgets',
    usage: [...records.usageFor(adapter, spec), 'widgets show|hide', 'widgets order <name> [name …]'],
    examples: ['widgets', 'widgets add zones', 'widgets zones', 'widgets zones move top', 'widgets tasks move 2', 'widgets clock off',
      'widgets zones edit position 1', 'widgets order zones clock agenda', 'widgets hide'],
    complete: (prev) => {
      if (prev.length === 0) return [{ value: 'show', label: 'show the panel' }, { value: 'hide', label: 'hide the panel' }, { value: 'order', label: 'set the order' },
        { value: 'add' }, ...WIDGETS.map((w) => ({ value: w.id, label: w.desc }))];
      if (prev[0] === 'order') return on().map((id) => ({ value: id })).filter((c) => !prev.includes(c.value));
      if (prev[0] === 'move' && prev.length === 1) return on().map((id) => ({ value: id }));
      if (prev.length === 2 && prev[1] === 'move') return ['top', 'up', 'down', 'bottom'].map((v) => ({ value: v }));
      return records.complete(adapter, prev, { verbs });
    },
    async run(ctx, rest) {
      const { out } = ctx;
      const words = rest.toLowerCase().split(/\s+/).filter(Boolean);
      // The panel itself.
      if (words.length === 1 && (words[0] === 'show' || words[0] === 'hide')) {
        const show = words[0] === 'show';
        await ctx.data.mutate('settings', (d) => { d.panel = show; });
        ctx.revealPanel?.(show);
        return out.head(show ? 'Widget panel shown' : 'Widget panel hidden', 'ok');
      }
      // The whole order at once: named widgets first (turning on any that were off), the rest after.
      if (words[0] === 'order') {
        const ids = words.slice(1);
        if (!ids.length) return usage(ctx, this);
        const bad = ids.find((id) => !isWidget(id));
        if (bad) return out.err("No widget '" + bad + "'");
        if (new Set(ids).size !== ids.length) return out.err('Each widget can be named once');
        const next = await ctx.data.mutate('settings', (d) => {
          d.widgets = ids.concat(d.widgets.filter((w) => isWidget(w) && !ids.includes(w)));
          d.panel = true;
          return d.widgets;
        });
        ctx.revealPanel?.(true);
        out.head('Widget order set', 'ok');
        return showOrder(out, next);
      }
      // The older order: widgets move <name> <where>.
      if (words[0] === 'move' && words.length === 3 && isWidget(words[1])) return move(ctx, words[1], words[2]);
      return records.route(ctx, adapter, rest, spec);
    },
  });

  // Text size, per device: a phone may want it bigger, a wide screen smaller.
  const STEPS = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.7];
  add({
    name: 'font', group: 'View', noUndo: true, desc: 'make the text bigger or smaller on this device',
    usage: ['font', 'font bigger | smaller', 'font <percent>', 'font reset'],
    examples: ['font bigger', 'font smaller', 'font 120%', 'font reset'],
    complete: (prev) => (prev.length === 0 ? ['bigger', 'smaller', 'reset'].map((v) => ({ value: v })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const now = ctx.fontScale ? ctx.fontScale() : 1;
      const pct = (f) => Math.round(f * 100) + '%';
      const a = rest.trim().toLowerCase();
      let next;
      if (!a) {
        out.head([['Text size ', ''], [pct(now), 'num strong'], [' on this device', 'dim']]);
        out.line([['font smaller', 'accent', { run: 'font smaller' }], [' · ', 'faint'], ['font bigger', 'accent', { run: 'font bigger' }],
          [' · ', 'faint'], ['font reset', 'accent', { run: 'font reset' }], [' · font 120%', 'dim']]);
        return;
      }
      if (/^(bigger|larger|up|\+|more|increase)$/.test(a)) next = STEPS.find((x) => x > now + 0.001) || STEPS[STEPS.length - 1];
      else if (/^(smaller|down|-|less|decrease)$/.test(a)) next = [...STEPS].reverse().find((x) => x < now - 0.001) || STEPS[0];
      else if (/^(reset|normal|default|100%?)$/.test(a)) next = 1;
      else {
        const m = /^(\d{2,3})\s?%?$/.exec(a);
        if (!m) return usage(ctx, this);
        next = Number(m[1]) / 100;
        if (next < 0.7 || next > 2) return out.err('Between 70% and 200%');
      }
      if (ctx.setFontScale) ctx.setFontScale(next);
      out.head([['Text size ', ''], [pct(next), 'num strong'], [next === now ? ' (already)' : ' on this device', 'dim']], 'ok');
      if (next === STEPS[STEPS.length - 1] && /^(bigger|larger|up|\+|more|increase)$/.test(a)) out.dim('That is the largest step; font 200% goes further');
      else if (next === STEPS[0] && /^(smaller|down|-|less|decrease)$/.test(a)) out.dim('That is the smallest step');
    },
  });
}
