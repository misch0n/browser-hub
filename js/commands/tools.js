import { plural } from '../core/util.js';
import { evaluate, formatNumber } from '../lib/calc.js';
import { convert, listUnits } from '../lib/units.js';
import { uuid, b64encode, b64decode, prettyJson, parseEpochInput, fmtUTC, fmtLocal, relative } from '../lib/misc.js';

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
        out.copyable(v);
      } catch (e) {
        out.err(e.message);
      }
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
        out.copyable(String(Math.floor(d.getTime() / 1000)));
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
        out.copyable(r);
      } catch (e) {
        out.err(e.message);
      }
    },
  });
}
