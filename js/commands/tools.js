import { parseTime, isValidZone, canonicalZone, plural } from '../core/util.js';
import { evaluate, formatNumber } from '../lib/calc.js';
import { convert, listUnits } from '../lib/units.js';
import { uuid, b64encode, b64decode, prettyJson, parseEpochInput, fmtUTC, fmtLocal, relative } from '../lib/misc.js';
import { localZone, zoneRows, workOverlap } from '../lib/zones.js';

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
    usage: ['tz [HH:MM]', 'tz add <IANA zone>', 'tz rm <zone>'],
    examples: ['tz', 'tz 15:00', 'tz add America/New_York'],
    complete: (prev) => {
      if (prev.length === 0) return [{ value: 'add' }, { value: 'rm' }];
      if (prev.length === 1 && prev[0] === 'rm') return st().settings.zones.map((z) => ({ value: z }));
      return [];
    },
    async run(ctx, rest) {
      const { out } = ctx;
      const local = localZone();
      const m = /^(add|rm)(?:\s+(\S+))?$/i.exec(rest);
      if (m) {
        const arg = m[2];
        if (!arg) return usage(ctx, this);
        if (m[1].toLowerCase() === 'add') {
          if (!isValidZone(arg)) {
            out.err("Unknown time zone '" + arg + "'");
            out.dim('Use an IANA name such as Europe/London or America/New_York');
            return;
          }
          const zone = canonicalZone(arg);
          if (zone === local) return out.head(zone + ' is your local zone already', 'dim');
          if (st().settings.zones.includes(zone)) return out.head(zone + ' is already listed', 'dim');
          await ctx.data.mutate('settings', (d) => { d.zones.push(zone); });
          return out.head([['Added ', ''], [zone, 'strong']], 'ok');
        }
        const found = st().settings.zones.find((z) => z.toLowerCase() === arg.toLowerCase());
        if (!found) return out.err("'" + arg + "' is not in your list");
        await ctx.data.mutate('settings', (d) => { d.zones = d.zones.filter((z) => z !== found); });
        return out.head([['Removed ', ''], [found, 'strong']], 'ok');
      }

      const now = ctx.now();
      let instant = now;
      if (rest) {
        const time = parseTime(rest);
        if (!time) return usage(ctx, this);
        instant = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +time.slice(0, 2), +time.slice(3));
      }
      const zones = [local].concat(st().settings.zones.filter((z) => z !== local));
      const rows = zoneRows(instant, zones);
      const overlap = zones.length > 1 ? workOverlap(instant, zones) : null;
      out.head([[rest ? rows[0].time + ' local' : 'Time zones', 'strong'],
        [overlap ? ' · overlap ' + (overlap.length ? overlap.join(', ') : 'none') : '', overlap && overlap.length ? 'ok' : 'dim']]);
      out.table(['zone', 'time', '', 'utc', ''], rows.map((r, i) => [
        [[r.zone, i === 0 ? 'accent' : 'strong']],
        [[r.time, 'num']],
        [[r.day, 'warn']],
        [[r.offset, 'faint']],
        [[r.working ? '● working hours' : '○ off hours', r.working ? 'ok' : 'faint']],
      ]));
      if (zones.length === 1) out.dim('Add zones with: tz add <IANA zone>');
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
