import { oneValue } from '../core/args.js';
import { findCity } from '../lib/astro.js';

// config: you and this device. One record, so the shared grammar without ids:
//   config · config edit · config edit <field> <value>
// name is yours on every device (a synced setting); device names this
// device (kept on it), and tags what it does in the shared history; place is
// where sun and moon are worked out for (a city from the list, or lat,lon; synced).

const MAX = 40;
const FIELDS = { name: 'name', me: 'name', device: 'device', this: 'device', place: 'place', location: 'place', city: 'place' };

const placeText = (p) => (p ? p.name + ' (' + p.lat.toFixed(2) + ', ' + p.lon.toFixed(2) + ')' : '');

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
      ['place', st().settings.place ? [[placeText(st().settings.place), '']] : [['not set (sun and moon use Sofia)', 'faint']],
        { command: 'config edit place', current: st().settings.place ? st().settings.place.name : '', open: opts.open === 'place' }],
    ]);
    out.dim('name and place are the same on every device; device is this one only · tap a value, or: config edit <field> <value>');
  }

  async function set(ctx, fieldArg, value) {
    const { out } = ctx;
    const field = FIELDS[String(fieldArg).toLowerCase()];
    if (!field) {
      out.err('config has no field ' + fieldArg);
      out.dim('Fields: name, device, place');
      return;
    }
    if (value === null) {
      const cur = field === 'name' ? st().settings.name || '' : field === 'place' ? (st().settings.place ? st().settings.place.name : '') : ctx.device.name;
      ctx.setInput('config edit ' + field + ' ' + cur);
      out.head([['Editing ', ''], ['config ' + field, 'id']], 'info');
      return;
    }
    const v = value.trim();
    if (v.length > MAX) return out.err(field + ' is too long (' + MAX + ' characters at most)');
    if (field === 'place') {
      let place = null;
      if (!/^(none|-|clear|)$/i.test(v)) {
        const ll = /^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(v);
        if (ll && Math.abs(+ll[1]) <= 90 && Math.abs(+ll[2]) <= 180) {
          let zone = null;
          try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch (e) { zone = null; }
          place = { name: (+ll[1]).toFixed(4) + ', ' + (+ll[2]).toFixed(4), lat: +ll[1], lon: +ll[2], zone };
        } else {
          const c = findCity(v);
          if (!c) return out.err("No city '" + v + "' in the list; give latitude and longitude instead: config edit place 42.70,23.32");
          place = { name: c.name, lat: c.lat, lon: c.lon, zone: c.zone };
        }
      }
      await ctx.data.mutate('settings', (d) => { d.place = place; });
      show(ctx, { head: [['Updated ', ''], ['config place', 'id']] });
      out.tone('ok');
      return;
    }
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
    name: 'config', group: 'Meta', desc: 'your name, this device\'s name, and your place (for sun and moon)',
    usage: ['config', 'config edit', 'config edit <field> <value>'],
    examples: ['config', 'config edit name Michael', 'config edit device Work laptop', 'config edit place sofia', 'config edit place 42.70,23.32', 'config edit name none'],
    complete: (prev) => {
      if (prev.length === 0) return [{ value: 'edit' }];
      if (prev.length === 1 && prev[0] === 'edit') return [{ value: 'name' }, { value: 'device' }, { value: 'place' }];
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
