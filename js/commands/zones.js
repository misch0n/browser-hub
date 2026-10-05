import { parseTime, plural } from '../core/util.js';
import { oneValue } from '../core/args.js';
import { localZone, zoneRows, workOverlap, allZones, resolveZone, zoneLabel, partsIn, zonedToDate } from '../lib/zones.js';

// Time zones, in the shared grammar:
//   zones · zones all [filter] · zones add <zone> [name] · zones tokyo
//   zones tokyo edit [name [<name>]] · zones tokyo rm
// and tz, the clock across them: tz · tz 15:00 · tz 15:00 tokyo.
// A zone is named by its IANA name, its city, or the name you gave it.

const MAX_NAME = 32;

export default function register(add, { st, records }) {
  const local = () => localZone();
  const names = () => st().settings.zoneNames;
  const listed = () => [local()].concat(st().settings.zones.filter((z) => z !== local()));
  // A listed zone, by IANA name, city or custom name (any case).
  const findListed = (arg) => {
    const a = String(arg).trim().toLowerCase();
    const z = resolveZone(arg);
    return listed().find((x) => x === z || x.toLowerCase() === a || zoneLabel(x, names()).toLowerCase() === a ||
      zoneLabel(x).toLowerCase() === a.replace(/_/g, ' ')) || null;
  };
  const unknown = (out, arg) => {
    out.err("Unknown time zone '" + arg + "'");
    out.dim('Use an IANA name such as Europe/London, or a city such as Tokyo · zones all lists them');
  };

  function showZone(ctx, zone, opts = {}) {
    const { out } = ctx;
    const [r] = zoneRows(ctx.now(), [local(), zone].filter((z, i, a) => a.indexOf(z) === i)).filter((x) => x.zone === zone);
    out.head(opts.head || [['zone ', 'dim'], [zone, 'id'], [zone === local() ? ' · your local zone' : '', 'dim']]);
    out.fields([
      ['name', names()[zone] ? [[names()[zone], 'accent']] : [[zoneLabel(zone), 'dim'], [' (the city; none set)', 'faint']],
        { command: 'zones ' + zone + ' edit name', current: names()[zone] || '', open: opts.open === 'name' }],
      ['time', [[r.time, 'num'], [r.date ? ' ' + r.date : '', 'warn']]],
      ['utc', [[r.offset, 'faint']]],
      ['hours', [[r.working ? '● working hours' : '○ off hours', r.working ? 'ok' : 'faint']]],
    ]);
    out.dim('Tap the name to change it, or: zones ' + zone + ' edit name <name>' + (zone === local() ? '' : ' · zones ' + zone + ' rm'));
  }

  async function setName(ctx, zone, field, value) {
    const { out } = ctx;
    if (!['name', 'label', 'title'].includes(String(field).toLowerCase())) {
      out.err('Zones have no field ' + field);
      out.dim('Fields: name');
      return;
    }
    if (value === null) {
      ctx.setInput('zones ' + zone + ' edit name ' + (names()[zone] || ''));
      out.head([['Editing ', ''], ['zones ' + zone + ' name', 'id']], 'info');
      out.dim('Change the name and press Enter (none clears it) · Esc cancels');
      return;
    }
    const name = /^(none|-|clear)$/i.test(value.trim()) ? '' : value.trim();
    if (name.length > MAX_NAME) return out.err('name is too long (' + MAX_NAME + ' characters at most)');
    await ctx.data.mutate('settings', (d) => {
      if (name) d.zoneNames[zone] = name; else delete d.zoneNames[zone];
    });
    showZone(ctx, zone, { head: [[name ? 'Named ' : 'Cleared the name of ', ''], [zone, 'id'], [name ? ' ' + name : '', 'accent']] });
    out.tone('ok');
  }

  async function removeZone(ctx, zone) {
    const { out } = ctx;
    if (zone === local()) return out.err(zone + " is your local zone; it can't be removed");
    await ctx.data.mutate('settings', (d) => {
      d.zones = d.zones.filter((z) => z !== zone);
      delete d.zoneNames[zone];
    });
    out.head([['Removed ', ''], [zone, 'strong']], 'ok');
  }

  // zones add <zone> [name]
  async function addZone(ctx, rest) {
    const { out } = ctx;
    const [zoneArg] = rest.trim().split(/\s+/);
    if (!zoneArg) return out.err('zones add <zone> [name]  (an IANA name such as Asia/Tokyo, or a city)');
    const zone = resolveZone(zoneArg);
    if (!zone) return unknown(out, zoneArg);
    const name = oneValue(rest.trim().slice(zoneArg.length)).trim();
    if (name.length > MAX_NAME) return out.err('name is too long (' + MAX_NAME + ' characters at most)');
    const isNew = zone !== local() && !st().settings.zones.includes(zone);
    if (!isNew && !name) return out.head(zone + (zone === local() ? ' is your local zone already' : ' is already listed'), 'dim');
    await ctx.data.mutate('settings', (d) => {
      if (isNew) d.zones.push(zone);
      if (name) d.zoneNames[zone] = name;
    });
    out.head([[isNew ? 'Added ' : 'Named ', ''], [zone, 'strong', { run: 'zones ' + zone }], [name ? ' as ' : '', 'dim'], [name, 'accent']], 'ok');
  }

  // zones: yours, with the time in each; zones all [filter]: every zone there is.
  function listZones(ctx, rest) {
    const { out } = ctx;
    const words = rest.trim().split(/\s+/).filter(Boolean);
    if (words[0] && words[0].toLowerCase() === 'all') return listAll(ctx, words.slice(1).join(' '));
    if (words.length) {
      out.err("'" + rest.trim() + "' is not one of your zones");
      out.dim('zones add ' + words[0] + ' adds it · zones all ' + words[0] + ' looks for it');
      return;
    }
    return clock(ctx, '');
  }

  function listAll(ctx, filter) {
    const { out } = ctx;
    const now = ctx.now();
    const f = filter.toLowerCase();
    const mine = new Set(listed());
    const all = allZones().filter((z) => !f || z.toLowerCase().includes(f) || zoneLabel(z, names()).toLowerCase().includes(f));
    if (!all.length) return out.head('No time zones match "' + filter + '"', 'dim');
    const rows = zoneRows(now, [local()].concat(all.filter((z) => z !== local())))
      .filter((r) => !r.ref || all.includes(local()));
    out.head([[plural(rows.length, 'time zone'), 'strong'], [f ? ' matching "' + filter + '"' : ' · earliest first', 'dim']]);
    out.table(['zone', 'time', '', 'utc', ''], rows.map((r) => [
      [[r.zone, r.ref ? 'accent' : mine.has(r.zone) ? 'strong' : '', mine.has(r.zone) ? { run: 'zones ' + r.zone } : undefined]],
      [[r.time, 'num']],
      [[r.date, 'warn']],
      [[r.offset, 'faint']],
      [[r.ref ? '● local' : mine.has(r.zone) ? '● listed' + (zoneLabel(r.zone, names()) !== zoneLabel(r.zone) ? ' as ' + zoneLabel(r.zone, names()) : '') : '', 'ok']],
    ]));
    if (!f) out.dim('Filter with: zones all <text> · add one with: zones add <zone> [name]');
  }

  // The clock across your zones: now, a local time, or a time in another zone.
  function clock(ctx, rest) {
    const { out } = ctx;
    const now = ctx.now();
    let instant = now;
    let from = null;
    if (rest) {
      const [, hhmm, where] = /^(\S+)(?:\s+([\s\S]+))?$/.exec(rest.trim());
      const time = parseTime(hhmm);
      if (!time) {
        out.err("tz: '" + hhmm + "' is not a time (HH:MM)");
        out.dim('tz · tz 15:00 · tz 15:00 tokyo · manage your zones with: zones');
        return;
      }
      const h = +time.slice(0, 2), mi = +time.slice(3);
      if (where) {
        const w = oneValue(where).trim();
        from = findListed(w) || resolveZone(w);
        if (!from) return unknown(out, w);
      }
      if (from && from !== local()) {
        // That wall time on the zone's own today.
        const [y, mo, d] = partsIn(now, from).date.split('-').map(Number);
        instant = zonedToDate(y, mo, d, h, mi, 0, from);
      } else {
        instant = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, mi);
      }
    }
    const zones = listed().concat(from && !listed().includes(from) ? [from] : []);
    const rows = zoneRows(instant, zones);
    const overlap = zones.length > 1 ? workOverlap(instant, zones) : null;
    const localRow = rows.find((r) => r.ref);
    const fromRow = from && from !== local() ? rows.find((r) => r.zone === from) : null;
    const title = !rest ? [['Time zones', 'strong']]
      : fromRow ? [[fromRow.time + ' ' + zoneLabel(from, names()), 'strong'], [fromRow.date ? ' ' + fromRow.date : '', 'warn'],
        [' = ', 'faint'], [localRow.time + ' local', 'strong']]
        : [[localRow.time + ' local', 'strong']];
    out.head([...title,
      [overlap ? ' · overlap ' + (overlap.length ? overlap.join(', ') : 'none') : '', overlap && overlap.length ? 'ok' : 'dim']]);
    out.table(['name', 'time', '', 'utc', 'zone', ''], rows.map((r) => [
      [[zoneLabel(r.zone, names()), r.ref ? 'accent' : r === fromRow ? 'info' : 'strong', listed().includes(r.zone) ? { run: 'zones ' + r.zone } : undefined]],
      [[r.time, 'num']],
      [[r.date, 'warn']],
      [[r.offset, 'faint']],
      [[r.zone, 'faint']],
      [[r.working ? '● working hours' : '○ off hours', r.working ? 'ok' : 'faint']],
    ]));
    if (zones.length === 1) out.dim('Add zones with: zones add <zone> [name] · see them all: zones all');
  }

  const adapter = {
    noun: 'zones', label: 'zone', fields: ['name'],
    target: (word) => {
      const z = findListed(word);
      if (z) return { item: z };
      return null;
    },
    key: (zone) => zone,
    show: (ctx, zone, opts) => showZone(ctx, zone, opts),
    setField: (ctx, zone, field, value) => setName(ctx, zone, field, value),
    remove: (ctx, zone) => removeZone(ctx, zone),
    ids: () => listed().map((z) => ({ value: z, label: zoneLabel(z, names()) })),
  };
  const spec = { list: listZones, add: addZone, addArgs: '<zone> [name]', filter: '[all [filter]]', id: '<zone>' };

  add({
    name: 'zones', group: 'Tools', desc: 'your time zones: list, add, name and remove them',
    usage: records.usageFor(adapter, spec),
    examples: ['zones', 'zones all europe', 'zones add tokyo Kenji', 'zones add America/New_York', 'zones tokyo', 'zones tokyo edit',
      'zones tokyo edit name Kenji\'s team', 'zones tokyo rm'],
    complete: (prev) => records.complete(adapter, prev, { first: [{ value: 'all' }] }),
    run: (ctx, rest) => records.route(ctx, adapter, rest, spec),
  });

  add({
    name: 'tz', group: 'Tools', desc: 'the time across your zones, now or at a given time, with working-hours overlap',
    usage: ['tz', 'tz <HH:MM>', 'tz <HH:MM> <zone>'],
    examples: ['tz', 'tz 15:00', 'tz 15:00 tokyo', 'tz 9:30 NYC office'],
    complete: () => [],
    run(ctx, rest) {
      // The older zone management forms: tz add / name / rm / ls.
      const m = /^(add|name|rm|ls)\b\s*([\s\S]*)$/i.exec(rest.trim());
      if (m) {
        const sub = m[1].toLowerCase();
        const arg = m[2].trim();
        if (sub === 'add') return addZone(ctx, arg);
        if (sub === 'ls') return listAll(ctx, arg);
        const [target] = arg.split(/\s+/);
        const zone = target && findListed(target);
        if (!zone) {
          if (!target) return ctx.out.err('tz ' + sub + ' <zone>');
          ctx.out.err("'" + target + "' is not in your list");
          if (sub === 'name') ctx.out.dim('Add it with a name: zones add ' + target + ' <name>');
          return;
        }
        if (sub === 'rm') return removeZone(ctx, zone);
        return setName(ctx, zone, 'name', oneValue(arg.slice(target.length)).trim() || 'none');
      }
      return clock(ctx, rest.trim());
    },
  });
}
