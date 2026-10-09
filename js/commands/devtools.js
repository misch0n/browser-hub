import { plural } from '../core/util.js';
import { tokenize } from '../core/args.js';
import { readCsv, delimiterName } from '../lib/csv.js';
import { parseNumber, toBase, group, fitWidth, widthView } from '../lib/numbase.js';
import { dedupe, sortLines, trimText, replaceText, stats, lorem, lines } from '../lib/textops.js';
import { secretBytes, bytesToB64url } from '../lib/jose.js';
import { readRegex, regexCode, literals, flagNames } from '../lib/escape.js';
import { HTTP_STATUS, STATUS_CLASS, findStatus, MIME, findMime } from '../lib/reference.js';
import { encode, decode, dump, fromHex, binary, sniff } from '../lib/bytes.js';

// csv, base, text, hmac, escape, http, mime, hexdump, bin.

const FILE_PEEK = 4096; // bytes of a picked file shown by hexdump file

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const toB64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };

export default function register(add, { usage }) {
  add({
    name: 'csv', group: 'Developer', desc: 'view CSV (or tab, semicolon, pipe separated) as a table to sort and filter',
    usage: ['csv <paste>', 'csv comma|semicolon|tab|pipe <paste>', 'csv noheader <paste>', 'csv json <paste>'],
    examples: ['csv <paste a spreadsheet export>', 'csv semicolon <paste>', 'csv json <paste>'],
    complete: (prev) => (prev.length === 0 ? ['comma', 'semicolon', 'tab', 'pipe', 'noheader', 'json'].map((v) => ({ value: v })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      let text = ctx.pasted && ctx.pasted.length === 1 ? null : rest;
      const opts = {};
      let asJson = false;
      // Options first, then the data (usually a paste).
      let head = rest;
      for (;;) {
        const m = /^\s*(comma|semicolon|tab|pipe|noheader|header|json)\b\s*/i.exec(head);
        if (!m) break;
        const w = m[1].toLowerCase();
        if (w === 'json') asJson = true;
        else if (w === 'noheader') opts.header = false;
        else if (w === 'header') opts.header = true;
        else opts.delimiter = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' }[w];
        head = head.slice(m[0].length);
      }
      text = ctx.pasted && ctx.pasted.length === 1 ? ctx.pasted[0] : head;
      if (!text.trim()) return usage(ctx, this);
      let t;
      try {
        t = readCsv(text, opts);
      } catch (e) {
        return out.err(e.message);
      }
      if (asJson) {
        const objs = t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, t.numeric[i] && r[i] !== '' ? Number(r[i].replace(',', '.')) : r[i]])));
        out.head([['JSON', 'strong'], [' · ' + plural(objs.length, 'object'), 'dim']]);
        return out.code(JSON.stringify(objs, null, 2), 'json');
      }
      out.head([[plural(t.rows.length, 'row') + ' × ' + plural(t.columns.length, 'column'), 'strong'],
        [' · ' + delimiterName(t.delimiter) + '-separated · ' + (t.header ? 'first row is the header' : 'no header row'), 'dim']]);
      out.dataTable({ columns: t.columns, rows: t.rows, numeric: t.numeric });
      out.dim('Tap a column to sort (again to reverse) · type to filter · csv json for JSON · csv noheader if the first row is data');
    },
  });

  add({
    name: 'base', group: 'Developer', desc: 'numbers in binary, octal, decimal, hex or any base 2–36, any size, with bit-width views',
    usage: ['base <number>', 'base <number> from <base>', 'base <number> to <base>', 'base <number> bits 8|16|32|64'],
    examples: ['base 255', 'base 0xff', 'base 0b1010', 'base zz from 36', 'base 1000 to 7', 'base -1 bits 16', 'base 123456789012345678901234567890'],
    complete: (prev) => (prev.length === 1 ? ['from', 'to', 'bits'].map((v) => ({ value: v })) : prev[prev.length - 1] === 'bits' ? ['8', '16', '32', '64'].map((v) => ({ value: v })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const m = /^(\S+)((?:\s+(?:from|to|bits)\s+\d+)*)\s*$/i.exec(rest.trim());
      if (!m) return usage(ctx, this);
      const opt = (k) => { const x = new RegExp('\\b' + k + '\\s+(\\d+)', 'i').exec(m[2]); return x ? Number(x[1]) : null; };
      const from = opt('from'), to = opt('to'), bits = opt('bits');
      let n, base;
      try {
        ({ value: n, base } = parseNumber(m[1], from || undefined));
        if (to !== null) toBase(n, to);
      } catch (e) {
        return out.err(e.message);
      }
      out.head([[n.toString(), 'num strong'], [' · read as base ' + base + (n < 0n ? ' · negative' : '') + ' · ' + plural(n < 0n ? (-n).toString(2).length : n.toString(2).length, 'bit') + ' of magnitude', 'dim']]);
      const rows = [
        ['binary', [[group(toBase(n, 2), 4), 'num']]],
        ['octal', [[toBase(n, 8), 'num']]],
        ['decimal', [[group(n.toString(), 3, ','), 'num']]],
        ['hex', [[toBase(n, 16).toUpperCase(), 'num']]],
      ];
      if (to !== null && ![2, 8, 10, 16].includes(to)) rows.push(['base ' + to, [[toBase(n, to), 'num strong']]]);
      out.kv(rows);
      const w = bits || fitWidth(n);
      if (w) {
        try {
          const v = widthView(n, w);
          out.section([['In ' + w + ' bits', ''], [bits ? '' : '  (the smallest that fits)', 'faint']]);
          out.kv([
            ['unsigned', [[v.unsigned.toString(), 'num']]],
            ['signed', [[v.signed.toString(), 'num'], [' (two’s complement)', 'faint']]],
            ['hex', [[v.hex.toUpperCase(), 'num']]],
            ['binary', [[v.binary, 'num']]],
            ['bytes, big-endian', [[v.bytesBE.toUpperCase(), 'num']]],
            ['bytes, little-endian', [[v.bytesLE.toUpperCase(), 'num']]],
          ]);
        } catch (e) {
          out.warn(e.message);
        }
      }
      out.copyable(to !== null ? toBase(n, to) : n.toString());
    },
  });

  const TEXT_OPS = ['dedupe', 'sort', 'reverse', 'trim', 'replace', 'count', 'upper', 'lower', 'title', 'lorem', 'number'];
  add({
    name: 'text', group: 'Text', desc: 'line tools: dedupe, sort, trim, find and replace, counts, case, lorem ipsum',
    usage: ['text dedupe <text>', 'text sort [desc] [numeric] [unique] <text>', 'text reverse <text>', 'text trim <text>',
      'text replace <find> <with> <text>', 'text count <text>', 'text upper|lower|title <text>', 'text number <text>', 'text lorem [n] [words|sentences|paragraphs]'],
    examples: ['text dedupe <paste>', 'text sort numeric desc <paste>', 'text replace "foo" "bar" <paste>', 'text replace /(\\d+)px/g $1rem <paste>', 'text lorem 3', 'text lorem 50 words'],
    complete: (prev) => (prev.length === 0 ? TEXT_OPS.map((v) => ({ value: v })) : prev[0] === 'sort' ? ['desc', 'numeric', 'unique'].map((v) => ({ value: v }))
      : prev[0] === 'lorem' && prev.length === 2 ? ['words', 'sentences', 'paragraphs'].map((v) => ({ value: v })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest.trim());
      if (!m || !TEXT_OPS.includes(m[1].toLowerCase())) return usage(ctx, this);
      const op = m[1].toLowerCase();
      let body = m[2] || '';
      const result = (head, text) => {
        out.head(head);
        out.code(text || ' ');
        out.copyable(text);
      };
      if (op === 'lorem') {
        const l = /^(\d+)?\s*(words?|sentences?|paragraphs?)?$/i.exec(body.trim());
        if (!l) return usage(ctx, this);
        const n = Math.min(Number(l[1] || (l[2] && /^w/i.test(l[2]) ? 50 : 3)), 1000);
        const unit = (l[2] || 'paragraphs').toLowerCase();
        return result([['Lorem ipsum', 'strong'], [' · ' + n + ' ' + unit.replace(/s?$/, n === 1 ? '' : 's'), 'dim']], lorem(n, unit));
      }
      if (!body) return usage(ctx, this);
      if (op === 'replace') {
        const toks = tokenize(body);
        if (toks.length < 3) return out.err('text replace <find> <with> <text> (quote words with spaces)');
        const text = body.slice(toks[1].end).replace(/^[ \t]/, '');
        try {
          const r = replaceText(text, toks[0].text, toks[1].text);
          return result([['Replaced', 'strong'], [' · ' + plural(r.count, 'match', 'matches'), r.count ? 'dim' : 'warn']], r.text);
        } catch (e) {
          return out.err(e.message);
        }
      }
      if (op === 'sort') {
        const o = {};
        for (;;) {
          const w = /^(desc|reverse|numeric|num|unique|asc)\b\s*/i.exec(body);
          if (!w) break;
          const k = w[1].toLowerCase();
          if (k === 'desc' || k === 'reverse') o.desc = true; else if (k.startsWith('num')) o.numeric = true; else if (k === 'unique') o.unique = true;
          body = body.slice(w[0].length);
        }
        const sorted = sortLines(body, o);
        return result([['Sorted', 'strong'], [' · ' + plural(lines(sorted).length, 'line') + (o.numeric ? ' · by number' : '') + (o.desc ? ' · descending' : '') + (o.unique ? ' · unique' : ''), 'dim']], sorted);
      }
      if (op === 'dedupe') {
        const r = dedupe(body);
        return result([['Deduplicated', 'strong'], [' · ' + plural(r.removed, 'duplicate') + ' removed · ' + plural(lines(r.text).length, 'line') + ' left', 'dim']], r.text);
      }
      if (op === 'reverse') return result([['Reversed', 'strong'], [' · line order', 'dim']], lines(body).reverse().join('\n'));
      if (op === 'trim') return result([['Trimmed', 'strong'], [' · spaces at line ends and extra blank lines', 'dim']], trimText(body));
      if (op === 'number') return result([['Numbered', 'strong']], lines(body).map((l, i) => String(i + 1).padStart(String(lines(body).length).length) + '  ' + l).join('\n'));
      if (op === 'count') {
        const s = stats(body);
        out.head([[plural(s.words, 'word'), 'num strong'], [' · ' + plural(s.characters, 'character') + ' · ' + plural(s.lines, 'line'), 'dim']]);
        out.kv([['bytes', [[s.bytes.toLocaleString('en'), 'num'], [' UTF-8', 'dim']]], ['unique lines', [[String(new Set(lines(body)).size), 'num']]]]);
        return;
      }
      const map = { upper: (t) => t.toUpperCase(), lower: (t) => t.toLowerCase(), title: (t) => t.toLowerCase().replace(/(^|[\s\-‐(“"'])(\p{L})/gu, (x, a, b) => a + b.toUpperCase()) };
      return result([[op[0].toUpperCase() + op.slice(1) + ' case', 'strong']], map[op](body));
    },
  });

  const HMAC_ALGS = { sha1: 'SHA-1', 'sha-1': 'SHA-1', sha256: 'SHA-256', 'sha-256': 'SHA-256', sha384: 'SHA-384', 'sha-384': 'SHA-384', sha512: 'SHA-512', 'sha-512': 'SHA-512' };
  add({
    name: 'hmac', group: 'Security', private: true, noHistory: true, // the key is a secret
    desc: 'HMAC of a message with a key (text, hex: or base64:), SHA-1/256/384/512',
    usage: ['hmac [sha1|sha256|sha384|sha512] <key> <message>'],
    examples: ['hmac sha256 secret hello world', 'hmac sha512 hex:0b0b0b0b "Hi There"', 'hmac "my key" message'],
    complete: (prev) => (prev.length === 0 ? ['sha1', 'sha256', 'sha384', 'sha512'].map((v) => ({ value: v })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const toks = tokenize(rest);
      let i = 0;
      const algo = toks[0] && HMAC_ALGS[toks[0].text.toLowerCase()] ? HMAC_ALGS[toks[i++].text.toLowerCase()] : 'SHA-256';
      if (toks.length < i + 2) return usage(ctx, this);
      const keyTok = toks[i];
      const message = rest.slice(keyTok.end).replace(/^[ \t]/, '');
      const msg = toks.length === i + 2 && toks[i + 1].quoted ? toks[i + 1].text : message;
      let key;
      try {
        key = secretBytes(keyTok.text);
      } catch (e) {
        return out.err('The key: ' + e.message);
      }
      if (!key.length) return out.err('The key is empty');
      const k = await globalThis.crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: algo }, false, ['sign']);
      const mac = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
      out.head([['HMAC-' + algo, 'strong'], [' · key ' + plural(key.length, 'byte') + ' · message ' + plural(new TextEncoder().encode(msg).length, 'byte'), 'dim']]);
      out.section('hex');
      out.value(toHex(mac));
      out.section('base64');
      out.value(toB64(mac));
      out.dim('base64url: ' + bytesToB64url(mac) + ' · made with Web Crypto on this page; not kept in history');
      out.copyable(toHex(mac));
    },
  });

  add({
    name: 'escape', group: 'Developer', desc: 'a regex or a string, written correctly for JS, Python, Java, C#, Go, PHP, Ruby, Rust, JSON',
    usage: ['escape <text>', 'escape /<regex>/<flags>'],
    examples: ['escape C:\\Users\\me "quoted"', 'escape /^\\d{3}-\\d{4}$/i', 'escape /https?:\\/\\/\\S+/g'],
    async run(ctx, rest) {
      const { out } = ctx;
      const text = ctx.pasted && ctx.pasted.length === 1 ? ctx.pasted[0] : rest.replace(/^ /, '');
      if (!text.trim()) return usage(ctx, this);
      const re = readRegex(text);
      let rows;
      try {
        if (re) new RegExp(re.source, re.flags.replace(/[x]/g, ''));
        rows = re ? regexCode(re.source, re.flags) : literals(text);
      } catch (e) {
        return out.err(e.message);
      }
      out.head(re ? [['Regex', 'strong'], [' · ' + re.source.length + ' characters' + (re.flags ? ' · ' + flagNames(re.flags).join(', ') : ''), 'dim']]
        : [['String literal', 'strong'], [' · ' + plural([...text].length, 'character'), 'dim']]);
      out.table(null, rows.map((r) => [[[r.name, 'dim']], [[r.code, r.lang === 'note' ? 'faint' : 'strong'], [r.note ? '  · ' + r.note : '', 'faint']]]), { stack: true });
      out.copyable(rows[0].code.split('   or   ')[0]);
    },
  });

  add({
    name: 'http', group: 'Web', desc: 'HTTP status codes: what each means and when it is used',
    usage: ['http', 'http <code>', 'http 4xx', 'http <words>'],
    examples: ['http 404', 'http 3xx', 'http rate limit', 'http teapot'],
    complete: (prev) => (prev.length === 0 ? ['1xx', '2xx', '3xx', '4xx', '5xx'].map((v) => ({ value: v, label: STATUS_CLASS[v[0]] })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const list = findStatus(rest);
      if (!list.length) return out.err('No status code matches "' + rest.trim() + '"');
      if (list.length === 1) {
        const [code, name, what, use] = list[0];
        out.head([[String(code), 'num strong'], [' ' + name, 'strong'], [' · ' + STATUS_CLASS[String(code)[0]], 'dim']], code < 400 ? 'ok' : code < 500 ? 'warn' : 'err');
        out.kv([['means', [[what, '']]], ['seen', [[use, 'dim']]]]);
        out.copyable(code + ' ' + name);
        return;
      }
      out.head([[plural(list.length, 'status code'), 'strong'], [rest.trim() ? ' for "' + rest.trim() + '"' : ' · tap one for details', 'dim']]);
      const rows = [];
      let cls = null;
      for (const [code, name, what] of list) {
        if (String(code)[0] !== cls) { cls = String(code)[0]; rows.push({ section: [[cls + 'xx ' + STATUS_CLASS[cls], '']] }); }
        rows.push([[[String(code), 'num', { run: 'http ' + code }]], [[name, 'strong']], [[what, 'dim']]]);
      }
      out.table(null, rows, { stack: true });
    },
  });

  add({
    name: 'mime', group: 'Web', desc: 'MIME types: from a file extension to its type, or a type to its extensions',
    usage: ['mime <extension | file name>', 'mime <type>', 'mime image/*', 'mime <part of a type>'],
    examples: ['mime png', 'mime report.docx', 'mime application/json', 'mime video/*', 'mime xml'],
    async run(ctx, rest) {
      const { out } = ctx;
      const q = rest.trim();
      if (!q) return usage(ctx, this);
      const list = findMime(q);
      if (!list.length) return out.err('No MIME type known for "' + q + '"');
      if (list.length === 1 && list[0].by === 'extension') {
        out.head([['.' + list[0].ext, 'strong'], [' is', 'dim']]);
        out.value(list[0].type);
        const others = Object.entries(MIME).filter(([e, t]) => t === list[0].type && e !== list[0].ext).map(([e]) => '.' + e);
        if (others.length) out.dim('Also ' + others.join(' '));
        return;
      }
      out.head([[plural(list.length, 'type'), 'strong'], [' for "' + q + '"', 'dim']]);
      out.table(null, list.map((x) => [[[x.type, 'strong']], [[x.exts.map((e) => '.' + e).join(' '), 'dim']]]), { stack: true });
      out.copyable(list[0].type);
    },
  });

  // hexdump: bytes as `hexdump -C` shows them, of text, of hex, or of a local file.
  const ENC = ['utf8', 'utf16le', 'utf16be', 'latin1'];
  function showDump(ctx, bytes, head, opts = {}) {
    const { out } = ctx;
    const d = dump(bytes, { max: opts.max });
    out.head(head);
    if (!bytes.length) return out.dim('No bytes');
    out.code(d.rows.map((r) => r.offset + '  ' + r.hex + '  |' + r.ascii + '|').join('\n'));
    if (d.shown < d.total) out.dim('First ' + plural(d.shown, 'byte') + ' of ' + d.total.toLocaleString('en'));
    out.copyable(Array.from(bytes.subarray(0, d.shown), (b) => b.toString(16).padStart(2, '0')).join(' '));
  }
  add({
    name: 'hexdump', group: 'Developer', private: true, // the text may be a secret: not in the shared history
    desc: 'bytes as a hex dump: of text (UTF-8, UTF-16, Latin-1), of hex back to text, or of a local file with its type',
    usage: ['hexdump <text>', 'hexdump utf16le|utf16be|latin1 <text>', 'hexdump hex <bytes>', 'hexdump file'],
    examples: ['hexdump Hello, world!', 'hexdump utf16le héllo', 'hexdump hex 48 65 6c 6c 6f', 'hexdump file'],
    complete: (prev) => (prev.length === 0 ? [{ value: 'file', label: 'a local file, read here' }, { value: 'hex', label: 'bytes back to text' }, ...ENC.slice(1).map((v) => ({ value: v }))] : []),
    run(ctx, rest) {
      const { out } = ctx;
      const t = rest.replace(/^\s/, '');
      if (/^file\s*$/i.test(t)) {
        const picked = ctx.pickFile(''); // before any await: the browser needs the key press
        return (async () => {
          const file = await picked;
          if (!file) return out.head('No file chosen', 'dim');
          const bytes = new Uint8Array(await file.slice(0, FILE_PEEK).arrayBuffer());
          const kind = sniff(bytes);
          showDump(ctx, bytes, [[file.name, 'strong'], [' · ' + file.size.toLocaleString('en') + ' bytes', 'dim'],
            [' · ' + (kind ? kind.type + (kind.note ? ' (' + kind.note + ')' : '') : 'type unknown'), kind ? 'accent' : 'faint']]);
          if (file.size > FILE_PEEK) out.dim('First ' + FILE_PEEK.toLocaleString('en') + ' bytes of ' + file.size.toLocaleString('en') + ' · read on this device, never uploaded');
          else out.dim('Read on this device, never uploaded');
        })();
      }
      const hm = /^hex\s+([\s\S]+)$/i.exec(t);
      if (hm) {
        const b = fromHex(hm[1]);
        if (b.error) return out.err(b.error);
        const kind = sniff(b);
        showDump(ctx, b, [[plural(b.length, 'byte'), 'strong'], [kind ? ' · looks like ' + kind.type : '', 'dim']]);
        out.section('As UTF-8');
        return out.value(decode(b, 'utf8'));
      }
      const em = /^(utf-?8|utf-?16le|utf-?16be|latin-?1)\s([\s\S]+)$/i.exec(t);
      const enc = em ? em[1].toLowerCase().replace('-', '') : 'utf8';
      const text = em ? em[2] : t;
      if (!text) return usage(ctx, this);
      const b = encode(text, enc);
      if (b.error) return out.err(b.error);
      showDump(ctx, b, [[plural(b.length, 'byte'), 'strong'], [' · ' + plural([...text].length, 'character') + ' in ' + enc.toUpperCase().replace('UTF', 'UTF-').replace('LATIN1', 'Latin-1'), 'dim']], { max: 65536 });
    },
  });

  add({
    name: 'bin', group: 'Developer', desc: 'binary: a number (two\u2019s complement when negative) or each character\u2019s bytes',
    usage: ['bin <number>', 'bin 0x1f | 0b1010 | 0o17', 'bin text <text>', 'bin <text>'],
    examples: ['bin 255', 'bin -1', 'bin 0xCAFE', 'bin 18446744073709551616', 'bin héllo', 'bin text 42'],
    run(ctx, rest) {
      const { out } = ctx;
      const tm = /^text\s([\s\S]+)$/i.exec(rest.trim());
      const r = binary(tm ? tm[1] : rest.trim(), { text: !!tm });
      if (!rest.trim()) return usage(ctx, this);
      if (r.error) return out.err(r.error);
      if (r.kind === 'number') {
        out.head([[r.bits, 'num strong']]);
        out.kv([
          ['decimal', [[r.value, 'num'], [r.unsigned && r.unsigned !== r.value ? '  (unsigned ' + r.unsigned + ')' : '', 'faint']]],
          ['hex', [['0x' + r.hex.toUpperCase(), 'num']]],
          ['octal', [['0o' + r.octal, 'num']]],
          ['size', [[plural(r.bytes, 'byte'), 'dim']]],
        ]);
        return out.copyable(r.bits.replace(/ /g, ''));
      }
      out.head([[plural(r.chars.length, 'character'), 'strong'], [' · ' + plural(r.chars.reduce((n, c) => n + c.bytes.length, 0), 'byte') + ' in UTF-8', 'dim']]);
      out.table(['char', 'binary', 'hex', 'dec'], r.chars.slice(0, 200).map((c) => [[[c.ch, 'strong']],
        [[c.bytes.map((b) => b.bin).join(' '), 'num']], [[c.bytes.map((b) => b.hex).join(' '), 'dim']], [[c.bytes.map((b) => b.dec).join(' '), 'dim']]]));
      out.copyable(r.chars.flatMap((c) => c.bytes.map((b) => b.bin)).join(' '));
    },
  });
}

export { HTTP_STATUS };
