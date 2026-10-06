import { plural } from '../core/util.js';
import { evaluate, formatNumber } from '../lib/calc.js';
import { convert, listUnits } from '../lib/units.js';
import { encodeQR } from '../lib/qr.js';
import { encodeBarcode, BARCODE_TYPES, barcodeWidth } from '../lib/barcode.js';
import { uuid, b64encode, b64decode, prettyJson, parseEpochInput, fmtUTC, fmtLocal, relative } from '../lib/misc.js';

// calc, epoch, uuid, b64, json, units, qr, barcode: small offline tools.

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
    usage: ['b64 encode <text>', 'b64 decode <text>'],
    complete: (prev) => (prev.length === 0 ? [{ value: 'encode' }, { value: 'decode' }] : []),
    async run(ctx, rest) {
      const m = /^(enc|encode|dec|decode)(?:\s+([\s\S]*))?$/i.exec(rest);
      if (!m || !m[2]) return usage(ctx, this);
      try {
        ctx.out.value(m[1].toLowerCase().startsWith('enc') ? b64encode(m[2]) : b64decode(m[2]));
      } catch (e) {
        ctx.out.err(e.message);
      }
    },
  });

  add({
    name: 'json', group: 'Tools', desc: 'validate and pretty-print JSON, in colour, as a tree, or minified',
    usage: ['json <text>', 'json tree <text>', 'json min <text>'],
    examples: ['json {"a":1,"b":[true,null,"x"]}', 'json tree <paste>', 'json min <paste>'],
    complete: (prev) => (prev.length === 0 ? [{ value: 'tree', label: 'collapsible' }, { value: 'min', label: 'minified' }] : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const m = /^(tree|min|minify)\s+([\s\S]+)$/i.exec(rest.trim());
      const mode = m ? m[1].toLowerCase() : 'pretty';
      const text = m ? m[2] : rest;
      if (!text.trim()) return usage(ctx, this);
      let v;
      try {
        v = JSON.parse(text);
      } catch (e) {
        // Where it went wrong, with the line and column.
        const pos = /position (\d+)/.exec(e.message);
        if (pos) {
          const at = Number(pos[1]);
          const before = text.slice(0, at);
          const lineNo = before.split('\n').length, col = at - before.lastIndexOf('\n');
          out.err('Invalid JSON at line ' + lineNo + ', column ' + col + ': ' + e.message.replace(/ in JSON at position \d+.*$/, ''));
          out.code(text.split('\n')[lineNo - 1].slice(Math.max(0, col - 40), col + 40) + '\n' + ' '.repeat(Math.min(col - 1, 40)) + '^');
        } else {
          out.err('Invalid JSON: ' + e.message);
        }
        return;
      }
      const kind = Array.isArray(v) ? plural(v.length, 'item') + ' (array)'
        : v && typeof v === 'object' ? plural(Object.keys(v).length, 'key') + ' (object)' : typeof v;
      out.head([['Valid JSON', 'ok'], [' · ' + kind, 'dim']]);
      if (mode === 'tree') return out.jsonTree(text);
      if (mode !== 'pretty') {
        const min = JSON.stringify(v);
        out.dim(text.length + ' → ' + min.length + ' characters');
        return out.value(min);
      }
      out.code(prettyJson(text), 'json');
    },
  });

  add({
    name: 'units', group: 'Tools',
    // units <value> <from> to <to>: unit names, then 'to', then unit names again.
    complete(prev) {
      const names = () => listUnits().flatMap((l) => l.split(': ')[1].split(/[\s,]+/)).filter(Boolean).map((u) => ({ value: u }));
      if (prev.length === 1) return names();
      if (prev.length === 2) return [{ value: 'to' }];
      if (prev.length === 3 && prev[2] === 'to') return names();
      return [];
    }, desc: 'convert length, mass, volume, temperature, data …',
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

  add({
    name: 'qr', group: 'Tools', desc: 'a QR code for text or a link, to scan with a phone',
    usage: ['qr <text>'],
    examples: ['qr https://misch0n.github.io/browser-hub/', 'qr call me back on 0123 456'],
    async run(ctx, rest) {
      const { out } = ctx;
      const text = rest.trim();
      if (!text) return usage(ctx, this);
      let q;
      try {
        q = encodeQR(text);
      } catch (e) {
        return out.err(e.message);
      }
      const bytes = new TextEncoder().encode(text).length;
      out.head([['QR code', 'strong'], [' · ' + plural(bytes, 'byte') + ' · version ' + q.version + ' · error correction ' + q.ecl, 'dim']]);
      out.qr(text, q.ecl);
      out.dim((text.length > 80 ? text.slice(0, 79) + '…' : text) + ' · save it with SVG or PNG');
    },
  });

  const KINDS = ['code128', 'code39', 'ean13', 'ean8', 'upca', 'itf', 'codabar', 'ean', 'upc', 'i25', 'qr'];
  add({
    name: 'barcode', group: 'Tools', desc: 'a barcode: Code 128, Code 39, EAN-13/8, UPC-A, ITF, Codabar (or QR), to save as SVG or PNG',
    usage: ['barcode <text>', 'barcode code128|code39|ean13|ean8|upca|itf|codabar|qr <text>',
      'barcode <type> [height <px>] [scale <px per bar>] [margin <bars>] [notext] [check] <text>'],
    examples: ['barcode HELLO-123', 'barcode ean13 590123412345', 'barcode upca 03600029145', 'barcode code39 check WIDGET-7',
      'barcode itf height 100 scale 3 1234567890', 'barcode codabar A40156B', 'barcode notext code128 order 1182'],
    complete: (prev) => (prev.length === 0 ? KINDS.slice(0, 7).concat('qr').map((v) => ({ value: v })) : ['height', 'scale', 'margin', 'notext', 'check'].map((v) => ({ value: v }))),
    async run(ctx, rest) {
      const { out } = ctx;
      // Options come first; everything after them is the text, spaces and all.
      let s = rest.replace(/^\s+/, '');
      const spec = { type: 'code128' };
      let check = false;
      for (;;) {
        const m = /^(code128|code39|ean13|ean8|ean|upca|upc|itf|i25|codabar|qr|notext|check|(height|scale|margin)\s+(\d+(?:\.\d+)?))(?:\s+|$)/i.exec(s);
        if (!m) break;
        const w = m[1].toLowerCase();
        if (m[2]) spec[m[2].toLowerCase()] = Number(m[3]);
        else if (w === 'notext') spec.showText = false;
        else if (w === 'check') check = true;
        else spec.type = w;
        s = s.slice(m[0].length);
      }
      const text = s.replace(/\s+$/, '');
      if (!text) return usage(ctx, this);
      if (spec.type === 'qr') {
        let q;
        try { q = encodeQR(text); } catch (e) { return out.err(e.message); }
        out.head([['QR code', 'strong'], [' · version ' + q.version + ' · error correction ' + q.ecl, 'dim']]);
        out.qr(text, q.ecl);
        return;
      }
      if (spec.height !== undefined && !(spec.height >= 10 && spec.height <= 600)) return out.err('height is 10 to 600 px');
      if (spec.scale !== undefined && !(spec.scale >= 1 && spec.scale <= 10)) return out.err('scale is 1 to 10 px per bar');
      if (spec.margin !== undefined && spec.margin > 50) return out.err('margin is 0 to 50 bars');
      let r;
      try {
        r = encodeBarcode(spec.type, text, { check });
      } catch (e) {
        return out.err(e.message);
      }
      spec.type = r.type;
      spec.text = r.text; // with any check digit worked out, so a replay draws the same
      const info = BARCODE_TYPES.find((t) => t.id === r.type);
      const given = ['ean13', 'ean8', 'upca', 'itf'].includes(r.type) ? text.replace(/[\s-]/g, '') : r.type === 'code128' ? text : text.toUpperCase();
      const extra = r.text.length > given.length && r.text.startsWith(given) ? r.text.slice(given.length) : '';
      const added = extra ? ' · check ' + (/^\d$/.test(extra) ? 'digit ' : 'character ') + extra + ' added' : '';
      out.head([[info.name, 'strong'], [' · ' + plural([...r.text].length, 'character') + added + ' · ' + Math.round(barcodeWidth(r, { scale: spec.scale, margin: spec.margin })) + ' px wide', 'dim']]);
      out.barcode(spec);
      out.dim(info.chars + ' · save it with SVG or PNG');
      out.copyable(r.text);
    },
  });
}
