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
    name: 'widgets', group: 'View', desc: 'toggle widgets in the side panel',
    usage: ['widgets', 'widgets <name> [on|off]', 'widgets show|hide'],
    examples: ['widgets', 'widgets calendar', 'widgets zones on', 'widgets hide'],
    complete: (prev) => {
      if (prev.length === 0) {
        return WIDGETS.map((w) => ({ value: w.id, label: w.desc })).concat([{ value: 'show', label: 'show the panel' }, { value: 'hide', label: 'hide the panel' }]);
      }
      if (prev.length === 1 && isWidget(prev[0])) return [{ value: 'on' }, { value: 'off' }];
      return [];
    },
    async run(ctx, rest) {
      const { out } = ctx;
      const words = rest.toLowerCase().split(/\s+/).filter(Boolean);
      const s = st().settings;
      if (!words.length) {
        out.head([['Widgets', 'strong'], [' · ' + s.widgets.length + ' of ' + WIDGETS.length + ' on', 'dim'],
          [s.panel ? '' : ' · panel hidden', 'warn']]);
        out.table(null, WIDGETS.map((w) => {
          const on = s.widgets.includes(w.id);
          return [[[on ? '●' : '○', on ? 'ok' : 'faint']], [[w.id, on ? 'strong' : 'dim']], [[w.desc, 'dim']]];
        }));
        out.dim('Toggle with: widgets <name> · show or hide the panel: widgets show|hide');
        return;
      }
      if (words.length === 1 && (words[0] === 'show' || words[0] === 'hide')) {
        const show = words[0] === 'show';
        await ctx.data.mutate('settings', (d) => { d.panel = show; });
        ctx.revealPanel?.(show);
        return out.head(show ? 'Widget panel shown' : 'Widget panel hidden', 'ok');
      }
      const [id, mode] = words;
      if (!isWidget(id) || words.length > 2 || (mode && mode !== 'on' && mode !== 'off')) {
        if (!isWidget(id)) out.err("No widget '" + id + "'");
        return usage(ctx, this);
      }
      const isOn = s.widgets.includes(id);
      const want = mode ? mode === 'on' : !isOn;
      if (want !== isOn) {
        // Keep the catalogue order so the panel layout is stable.
        await ctx.data.mutate('settings', (d) => {
          const set = new Set(d.widgets.filter(isWidget));
          if (want) set.add(id); else set.delete(id);
          d.widgets = WIDGETS.map((w) => w.id).filter((w) => set.has(w));
          if (want) d.panel = true;
        });
      }
      if (want) ctx.revealPanel?.(true);
      out.head([[id, 'strong'], [want ? ' on' : ' off', want ? 'ok' : 'dim']], 'ok');
    },
  });
}
