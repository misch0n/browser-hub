import { THEMES, WIDGETS, isTheme, isWidget } from '../core/catalog.js';

export default function register(add, { st, usage }) {
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

  add({
    name: 'widgets', group: 'View', desc: 'toggle and reorder widgets in the side panel',
    usage: ['widgets', 'widgets <name> [on|off]', 'widgets move <name> up|down|top|bottom|<position>',
      'widgets order <name> [name …]', 'widgets show|hide'],
    examples: ['widgets', 'widgets calendar', 'widgets zones on', 'widgets move zones top', 'widgets move tasks 2',
      'widgets order zones clock agenda', 'widgets hide'],
    complete: (prev) => {
      const ids = WIDGETS.map((w) => ({ value: w.id, label: w.desc }));
      const on = () => st().settings.widgets.map((id) => ({ value: id }));
      if (prev.length === 0) {
        return ids.concat([
          { value: 'move', label: 'move a widget' }, { value: 'order', label: 'set the widget order' },
          { value: 'show', label: 'show the panel' }, { value: 'hide', label: 'hide the panel' },
        ]);
      }
      if (prev[0] === 'move') {
        if (prev.length === 1) return on();
        if (prev.length === 2) return ['up', 'down', 'top', 'bottom'].map((v) => ({ value: v }));
        return [];
      }
      if (prev[0] === 'order') return on().filter((c) => !prev.includes(c.value));
      if (prev.length === 1 && isWidget(prev[0])) return [{ value: 'on' }, { value: 'off' }];
      return [];
    },
    async run(ctx, rest) {
      const { out } = ctx;
      const words = rest.toLowerCase().split(/\s+/).filter(Boolean);
      const s = st().settings;
      const showOrder = (list) => out.dim('Order: ' + list.map((id, i) => (i + 1) + '. ' + id).join('  '));
      if (!words.length) {
        out.head([['Widgets', 'strong'], [' · ' + s.widgets.length + ' of ' + WIDGETS.length + ' on', 'dim'],
          [s.panel ? '' : ' · panel hidden', 'warn']]);
        // Widgets that are on, in panel order, then the rest.
        const order = s.widgets.filter(isWidget).concat(WIDGETS.map((w) => w.id).filter((id) => !s.widgets.includes(id)));
        out.table(null, order.map((id) => {
          const w = WIDGETS.find((x) => x.id === id);
          const pos = s.widgets.indexOf(id);
          return [[[pos >= 0 ? String(pos + 1) : '', 'num']], [[pos >= 0 ? '●' : '○', pos >= 0 ? 'ok' : 'faint']],
            [[w.id, pos >= 0 ? 'strong' : 'dim']], [[w.desc, 'dim']]];
        }));
        out.dim('Toggle with: widgets <name> · reorder: widgets move <name> up|down|top|bottom|<n> · panel: widgets show|hide');
        return;
      }
      if (words.length === 1 && (words[0] === 'show' || words[0] === 'hide')) {
        const show = words[0] === 'show';
        await ctx.data.mutate('settings', (d) => { d.panel = show; });
        ctx.revealPanel?.(show);
        return out.head(show ? 'Widget panel shown' : 'Widget panel hidden', 'ok');
      }

      if (words[0] === 'move') {
        const [, id, where] = words;
        if (!id || !where || words.length > 3) return usage(ctx, this);
        if (!isWidget(id)) return out.err("No widget '" + id + "'");
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
        else return usage(ctx, this);
        to = Math.max(0, Math.min(last, to));
        if (to === from) {
          out.head([[id, 'strong'], [' is already ' + (to === 0 ? 'first' : to === last ? 'last' : 'at ' + (to + 1)), 'dim']]);
          return showOrder(s.widgets);
        }
        const next = await ctx.data.mutate('settings', (d) => {
          const list = d.widgets.filter((w) => w !== id);
          list.splice(Math.min(to, list.length), 0, id);
          d.widgets = list;
          return list;
        });
        out.head([['Moved ', ''], [id, 'strong'], [' to ' + (next.indexOf(id) + 1), 'dim']], 'ok');
        return showOrder(next);
      }

      if (words[0] === 'order') {
        const ids = words.slice(1);
        if (!ids.length) return usage(ctx, this);
        const bad = ids.find((id) => !isWidget(id));
        if (bad) return out.err("No widget '" + bad + "'");
        if (new Set(ids).size !== ids.length) return out.err('Each widget can be named once');
        // Named widgets come first (turning on any that were off); the rest keep their order after them.
        const next = await ctx.data.mutate('settings', (d) => {
          d.widgets = ids.concat(d.widgets.filter((w) => isWidget(w) && !ids.includes(w)));
          d.panel = true;
          return d.widgets;
        });
        ctx.revealPanel?.(true);
        out.head('Widget order set', 'ok');
        return showOrder(next);
      }

      const [id, mode] = words;
      if (!isWidget(id) || words.length > 2 || (mode && mode !== 'on' && mode !== 'off')) {
        if (!isWidget(id)) out.err("No widget '" + id + "'");
        return usage(ctx, this);
      }
      const isOn = s.widgets.includes(id);
      const want = mode ? mode === 'on' : !isOn;
      if (want !== isOn) {
        // A widget turned on goes to the bottom; the others keep their places.
        await ctx.data.mutate('settings', (d) => {
          const list = d.widgets.filter((w) => isWidget(w) && w !== id);
          if (want) { list.push(id); d.panel = true; }
          d.widgets = list;
        });
      }
      if (want) ctx.revealPanel?.(true);
      out.head([[id, 'strong'], [want ? ' on' : ' off', want ? 'ok' : 'dim']], 'ok');
    },
  });
}
