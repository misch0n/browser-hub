import { parseTime, plural } from '../core/util.js';
import { evaluate, formatNumber } from '../lib/calc.js';
import { convert, listUnits } from '../lib/units.js';
import { uuid, b64encode, b64decode, prettyJson, parseEpochInput, fmtUTC, fmtLocal, relative } from '../lib/misc.js';
import { localZone, zoneRows, workOverlap, allZones, resolveZone, zoneLabel } from '../lib/zones.js';

export default function register(add, { st, usage }) {
  add({
    name: 'calc', group: 'Tools', desc: 'arithmetic with ^ % ( ), sqrt, round, sin, ln, pi …',
    usage: ['calc <expr>'],
    examples: ['calc (1200 * 1.2) / 12', 'calc sqrt(2)^2', 'calc 2^10 - 1'],
    async run(ctx, rest) {
      const { out } = ctx;
      if (!rest) return usage(ctx, this);
      try {
        const v = formatNumber(evaluate(rest));
        out.head([[rest.trim(), 'dim'], [' = ', 'faint'], [v, 'num strong']]);
      } catch (e) {
        out.err(e.message);
      }
    },
  });

  add({
    name: 'tz', group: 'Tools', desc: 'time across your zones, with working-hours overlap',
    usage: ['tz [HH:MM]', 'tz ls [filter]', 'tz add <zone> [name]', 'tz name <zone> [name]', 'tz rm <zone>'],
    examples: ['tz', 'tz 15:00', 'tz ls europe', 'tz add America/New_York NYC office', 'tz add tokyo', 'tz name tokyo Kenji'],
    complete: (prev) => {
      if (prev.length === 0) return ['ls', 'add', 'name', 'rm'].map((v) => ({ value: v }));
      if (prev.length === 1 && prev[0] === 'add') return allZones().map((z) => ({ value: z }));
      if (prev.length === 1 && prev[0] === 'name') return [localZone()].concat(st().settings.zones).map((z) => ({ value: z }));
      if (prev.length === 1 && prev[0] === 'rm') return st().settings.zones.map((z) => ({ value: z }));
      return [];
    },
    async run(ctx, rest) {
      const { out } = ctx;
      const local = localZone();
      const names = st().settings.zoneNames;
      const listed = () => [local].concat(st().settings.zones.filter((z) => z !== local));
      // A zone in the list, by IANA name, city or custom name (any case).
      const findListed = (arg) => {
        const a = arg.trim().toLowerCase();
        const z = resolveZone(arg);
        return listed().find((x) => x === z || x.toLowerCase() === a || zoneLabel(x, names).toLowerCase() === a ||
          zoneLabel(x).toLowerCase() === a) || null;
      };
      const nameError = (n) => (n.length > 32 ? 'name is too long (32 characters at most)' : null);
      const unknown = (arg) => {
        out.err("Unknown time zone '" + arg + "'");
        out.dim('Use an IANA name such as Europe/London, or a city such as Tokyo · tz ls lists them');
      };
      const m = /^(ls|add|name|rm)\b\s*([\s\S]*)$/i.exec(rest.trim());
      const sub = m && m[1].toLowerCase();
      const arg = m ? m[2].trim() : '';

      if (sub === 'ls') {
        const now = ctx.now();
        const f = arg.toLowerCase();
        const mine = new Set(listed());
        const all = allZones().filter((z) => !f || z.toLowerCase().includes(f) || zoneLabel(z, names).toLowerCase().includes(f));
        if (!all.length) return out.head('No time zones match "' + arg + '"', 'dim');
        const rows = zoneRows(now, [local].concat(all.filter((z) => z !== local)))
          .filter((r) => !r.ref || all.includes(local));
        out.head([[plural(rows.length, 'time zone'), 'strong'], [f ? ' matching "' + arg + '"' : ' · earliest first', 'dim']]);
        out.table(['zone', 'time', '', 'utc', ''], rows.map((r) => [
          [[r.zone, r.ref ? 'accent' : mine.has(r.zone) ? 'strong' : '']],
          [[r.time, 'num']],
          [[r.date, 'warn']],
          [[r.offset, 'faint']],
          [[r.ref ? '● local' : mine.has(r.zone) ? '● listed' + (zoneLabel(r.zone, names) !== zoneLabel(r.zone) ? ' as ' + zoneLabel(r.zone, names) : '') : '', 'ok']],
        ]));
        if (!f) out.dim('Filter with: tz ls <text> · add one with: tz add <zone> [name]');
        return;
      }

      if (sub === 'add') {
        const [zoneArg, ...nameWords] = arg.split(/\s+/);
        if (!zoneArg) return usage(ctx, this);
        const zone = resolveZone(zoneArg);
        if (!zone) return unknown(zoneArg);
        const name = nameWords.join(' ');
        const err = nameError(name);
        if (err) return out.err(err);
        const isNew = zone !== local && !st().settings.zones.includes(zone);
        if (!isNew && !name) return out.head(zone + (zone === local ? ' is your local zone already' : ' is already listed'), 'dim');
        await ctx.data.mutate('settings', (d) => {
          if (isNew) d.zones.push(zone);
          if (name) d.zoneNames[zone] = name;
        });
        return out.head([[isNew ? 'Added ' : 'Named ', ''], [zone, 'strong'], [name ? ' as ' : '', 'dim'], [name, 'accent']], 'ok');
      }

      if (sub === 'name') {
        const [target, ...nameWords] = arg.split(/\s+/);
        if (!target) return usage(ctx, this);
        const zone = findListed(target);
        if (!zone) {
          out.err("'" + target + "' is not in your list");
          out.dim('Add it with a name: tz add ' + target + ' <name>');
          return;
        }
        const name = nameWords.join(' ');
        const err = nameError(name);
        if (err) return out.err(err);
        await ctx.data.mutate('settings', (d) => {
          if (name) d.zoneNames[zone] = name; else delete d.zoneNames[zone];
        });
        return out.head(name ? [['Named ', ''], [zone, 'strong'], [' as ', 'dim'], [name, 'accent']] : [['Cleared the name of ', ''], [zone, 'strong']], 'ok');
      }

      if (sub === 'rm') {
        if (!arg) return usage(ctx, this);
        const zone = findListed(arg);
        if (!zone) return out.err("'" + arg + "' is not in your list");
        if (zone === local) return out.err(zone + " is your local zone; it can't be removed");
        await ctx.data.mutate('settings', (d) => {
          d.zones = d.zones.filter((z) => z !== zone);
          delete d.zoneNames[zone];
        });
        return out.head([['Removed ', ''], [zone, 'strong']], 'ok');
      }

      const now = ctx.now();
      let instant = now;
      if (rest) {
        const time = parseTime(rest);
        if (!time) return usage(ctx, this);
        instant = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +time.slice(0, 2), +time.slice(3));
      }
      const zones = listed();
      const rows = zoneRows(instant, zones);
      const overlap = zones.length > 1 ? workOverlap(instant, zones) : null;
      out.head([[rest ? rows.find((r) => r.ref).time + ' local' : 'Time zones', 'strong'],
        [overlap ? ' · overlap ' + (overlap.length ? overlap.join(', ') : 'none') : '', overlap && overlap.length ? 'ok' : 'dim']]);
      out.table(['name', 'time', '', 'utc', 'zone', ''], rows.map((r) => [
        [[zoneLabel(r.zone, names), r.ref ? 'accent' : 'strong']],
        [[r.time, 'num']],
        [[r.date, 'warn']],
        [[r.offset, 'faint']],
        [[r.zone, 'faint']],
        [[r.working ? '● working hours' : '○ off hours', r.working ? 'ok' : 'faint']],
      ]));
      if (zones.length === 1) out.dim('Add zones with: tz add <zone> [name] · see them all: tz ls');
    },
  });

  add({
    name: 'epoch', group: 'Tools', desc: 'unix time now, or convert to and from a date',
    usage: ['epoch [timestamp | date]', 'epoch 2026-10-05 09:00[:SS][Z]'],
    examples: ['epoch', 'epoch 1700000000', 'epoch 2026-10-05 09:00'],
    async run(ctx, rest) {
      const { out } = ctx;
      try {
        const d = rest ? parseEpochInput(rest) : ctx.now();
        out.head([[String(Math.floor(d.getTime() / 1000)), 'num strong'], [' seconds', 'dim']]);
        out.kv([
          ['millis', [[String(d.getTime()), 'num']]],
          ['utc', [[fmtUTC(d), 'date']]],
          ['local', [[fmtLocal(d), 'date']]],
          ['relative', [[relative(d, ctx.now()), 'dim']]],
        ]);
      } catch (e) {
        out.err(e.message);
      }
    },
  });

  add({
    name: 'uuid', group: 'Tools', desc: 'generate a v4 UUID',
    usage: ['uuid'],
    async run(ctx) { ctx.out.value(uuid()); },
  });

  add({
    name: 'b64', group: 'Tools', desc: 'base64 encode or decode (UTF-8)',
    usage: ['b64 enc <text>', 'b64 dec <text>'],
    complete: (prev) => (prev.length === 0 ? [{ value: 'enc' }, { value: 'dec' }] : []),
    async run(ctx, rest) {
      const m = /^(enc|dec)(?:\s+([\s\S]*))?$/i.exec(rest);
      if (!m || !m[2]) return usage(ctx, this);
      try {
        ctx.out.value(m[1].toLowerCase() === 'enc' ? b64encode(m[2]) : b64decode(m[2]));
      } catch (e) {
        ctx.out.err(e.message);
      }
    },
  });

  add({
    name: 'json', group: 'Tools', desc: 'validate and pretty-print JSON',
    usage: ['json <text>'],
    async run(ctx, rest) {
      const { out } = ctx;
      if (!rest) return usage(ctx, this);
      let pretty;
      try {
        pretty = prettyJson(rest);
      } catch (e) {
        return out.err('Invalid JSON: ' + e.message);
      }
      const v = JSON.parse(rest);
      const kind = Array.isArray(v) ? plural(v.length, 'item') + ' (array)'
        : v && typeof v === 'object' ? plural(Object.keys(v).length, 'key') + ' (object)' : typeof v;
      out.head([['Valid JSON', 'ok'], [' · ' + kind, 'dim']]);
      out.code(pretty, 'json');
    },
  });

  add({
    name: 'units', group: 'Tools', desc: 'convert length, mass, volume, temperature, data …',
    usage: ['units <value> <from> to <to>'],
    examples: ['units 5 km to mi', 'units 350 f to c', 'units 2 gib to mb'],
    async run(ctx, rest) {
      const { out } = ctx;
      const m = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(.+?)\s+to\s+(.+)$/i.exec(rest);
      if (!m) {
        usage(ctx, this);
        out.section('Known units');
        out.table(null, listUnits().map((l) => {
          const [cat, list] = l.split(': ');
          return [[[cat, 'strong']], [[list, 'dim']]];
        }));
        return;
      }
      try {
        const r = formatNumber(convert(parseFloat(m[1]), m[2].trim(), m[3].trim()), 10);
        out.head([[m[1], 'num'], [' ' + m[2].trim(), 'dim'], [' = ', 'faint'], [r, 'num strong'], [' ' + m[3].trim(), 'accent']]);
      } catch (e) {
        out.err(e.message);
      }
    },
  });
}
