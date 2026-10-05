import { oneValue } from '../core/args.js';

// config: you and this device. One record, so the shared grammar without ids:
//   config · config edit · config edit <field> <value>
// name is yours on every device (a synced setting); device names this
// device (kept on it), and tags what it does in the shared history.

const MAX = 40;
const FIELDS = { name: 'name', me: 'name', device: 'device', this: 'device' };

export default function register(add, { st }) {
  function show(ctx, opts = {}) {
    const { out } = ctx;
    const dev = ctx.device || { id: '?', name: '?' };
    const name = st().settings.name;
    out.head(opts.head || [['Config', 'strong']]);
    out.fields([
      ['name', name ? [[name, 'accent']] : [['not set', 'faint']], { command: 'config edit name', current: name || '', open: opts.open === 'name' }],
      ['device', [[dev.name, 'strong']], { command: 'config edit device', current: dev.name }],
      ['device id', [[dev.id, 'faint'], [' · fixed, marks what this device did', 'faint']]],
    ]);
    out.dim('name is the same on every device; device is this one only · tap a value, or: config edit <field> <value>');
  }

  async function set(ctx, fieldArg, value) {
    const { out } = ctx;
    const field = FIELDS[String(fieldArg).toLowerCase()];
    if (!field) {
      out.err('config has no field ' + fieldArg);
      out.dim('Fields: name, device');
      return;
    }
    if (value === null) {
      ctx.setInput('config edit ' + field + ' ' + (field === 'name' ? st().settings.name || '' : ctx.device.name));
      out.head([['Editing ', ''], ['config ' + field, 'id']], 'info');
      return;
    }
    const v = value.trim();
    if (v.length > MAX) return out.err(field + ' is too long (' + MAX + ' characters at most)');
    if (field === 'name') {
      const clear = !v || /^(none|-|clear)$/i.test(v);
      await ctx.data.mutate('settings', (d) => { d.name = clear ? null : v; });
    } else {
      if (!v) return out.err('A device needs a name');
      ctx.setDeviceName(v);
    }
    show(ctx, { head: [['Updated ', ''], ['config ' + field, 'id']] });
    out.tone('ok');
  }

  add({
    name: 'config', group: 'Meta', desc: 'your name and this device\'s name',
    usage: ['config', 'config edit', 'config edit <field> <value>'],
    examples: ['config', 'config edit name Michael', 'config edit device Work laptop', 'config edit name none'],
    complete: (prev) => {
      if (prev.length === 0) return [{ value: 'edit' }];
      if (prev.length === 1 && prev[0] === 'edit') return [{ value: 'name' }, { value: 'device' }];
      return [];
    },
    async run(ctx, rest) {
      const words = rest.trim().split(/\s+/).filter(Boolean);
      if (!words.length) return show(ctx);
      if (words[0].toLowerCase() !== 'edit') {
        ctx.out.err("config: '" + words[0] + "' is not an action");
        ctx.out.dim('config · config edit · config edit <field> <value>');
        return;
      }
      if (!words[1]) return show(ctx, { open: 'name', head: [['Editing ', ''], ['config', 'id'], [' · tap any value, Enter saves, Esc leaves it', 'dim']] });
      const v = rest.trim().replace(/^\S+\s+\S+\s*/, '');
      return set(ctx, words[1], v ? oneValue(v) : null);
    },
  });
}
