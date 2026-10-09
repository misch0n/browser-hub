import { plural } from '../core/util.js';
import { inspect, clean } from '../lib/chars.js';
import { password, pin, passphrase, bits, SETS, countText, words, CASES, CASE_NAMES, parseCIDR, parseIP, formatIP, contains, ipKind } from '../lib/text.js';

// pw, count, case, cidr, char.

const n2s = (n) => BigInt(n).toLocaleString('en');

export default function register(add, { usage }) {
  add({
    name: 'pw', group: 'Security', private: true, noUndo: true, // a fresh password never goes into the shared history
    desc: 'a random password, passphrase or PIN, made on this device',
    usage: ['pw [length]', 'pw words [count]', 'pw pin [digits]', 'pw simple [length]'],
    examples: ['pw', 'pw 32', 'pw words', 'pw words 8', 'pw pin', 'pw simple 16'],
    complete: (prev) => (prev.length === 0 ? ['words', 'pin', 'simple'].map((v) => ({ value: v })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const m = /^(?:(words|pin|simple)\s*)?(\d+)?$/i.exec(rest.trim());
      if (!m) return usage(ctx, this);
      const kind = (m[1] || 'chars').toLowerCase();
      const n = m[2] ? +m[2] : null;
      const range = { chars: [8, 128, 20], simple: [8, 128, 20], words: [3, 12, 6], pin: [4, 12, 6] }[kind];
      const size = n === null ? range[2] : n;
      if (size < range[0] || size > range[1]) return out.err((kind === 'words' ? 'Words' : kind === 'pin' ? 'Digits' : 'Length') + ': ' + range[0] + ' to ' + range[1]);
      let value, strength;
      if (kind === 'words') {
        const { WORDS } = await import('../lib/wordlist.js');
        value = passphrase(WORDS, size);
        strength = bits(WORDS.length, size) + ' bits · ' + size + ' words from the EFF list of ' + WORDS.length.toLocaleString('en');
      } else if (kind === 'pin') {
        value = pin(size);
        strength = bits(10, size) + ' bits · fine to unlock a device, too weak for an account';
      } else {
        const use = kind === 'simple' ? ['lower', 'upper', 'digits'] : ['lower', 'upper', 'digits', 'symbols'];
        value = password(size, use);
        const pool = use.map((k) => SETS[k]).join('').length;
        strength = bits(pool, size) + ' bits · ' + (kind === 'simple' ? 'letters and digits' : 'letters, digits and symbols') + ', no look-alikes (l 1 I O 0)';
      }
      out.head([['New ' + (kind === 'words' ? 'passphrase' : kind === 'pin' ? 'PIN' : 'password'), 'strong'], [' · ' + strength, 'dim']], 'ok');
      out.value(value);
      out.dim('Made here with the browser\'s secure random numbers; not kept in history');
    },
  });

  add({
    name: 'count', group: 'Text', desc: 'characters, words, lines and reading time of some text',
    usage: ['count <text>'],
    examples: ['count paste a long text after count'],
    async run(ctx, rest) {
      const { out } = ctx;
      if (!rest) return usage(ctx, this);
      const c = countText(rest);
      out.head([[plural(c.words, 'word'), 'num strong'], [' · ' + plural(c.characters, 'character'), 'dim']]);
      const mins = c.readingMinutes;
      out.kv([
        ['characters', [[c.characters.toLocaleString('en'), 'num'], [' · ' + c.noSpaces.toLocaleString('en') + ' without spaces', 'dim']]],
        ['bytes', [[c.bytes.toLocaleString('en'), 'num'], [' UTF-8', 'dim']]],
        ['words', [[c.words.toLocaleString('en'), 'num']]],
        ['sentences', [[String(c.sentences), 'num']]],
        ['lines', [[String(c.lines), 'num'], [c.paragraphs > 1 ? ' · ' + c.paragraphs + ' paragraphs' : '', 'dim']]],
        ['reading', [[mins < 1 ? 'under a minute' : '≈ ' + plural(Math.round(mins), 'minute'), 'dim']]],
      ]);
      out.copyable(String(c.words));
    },
  });

  add({
    name: 'case', group: 'Text', desc: 'change case: camelCase, snake_case, kebab-case, Title Case …',
    usage: ['case <text>', 'case camel|pascal|snake|kebab|constant|title|sentence|lower|upper|dot <text>'],
    examples: ['case user account id', 'case snake parseHTTPResponse', 'case title the quick brown fox'],
    complete: (prev) => (prev.length === 0 ? Object.keys(CASES).map((k) => ({ value: k, label: CASE_NAMES[k] })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const m = /^(\S+)\s+([\s\S]+)$/.exec(rest.trim());
      const style = m && CASES[m[1].toLowerCase()] ? m[1].toLowerCase() : null;
      const text = style ? m[2] : rest.trim();
      const ws = words(text);
      if (!ws.length) return usage(ctx, this);
      if (style) {
        out.head([[CASE_NAMES[style], 'strong']]);
        out.value(CASES[style](ws));
        return;
      }
      out.head([[plural(ws.length, 'word'), 'strong'], [' · tap one for a copy button', 'dim']]);
      out.table(null, Object.keys(CASES).map((k) => [[[CASE_NAMES[k], 'dim']], [[CASES[k](ws), 'strong', { run: 'case ' + k + ' ' + text }]]]));
      out.copyable(CASES.camel(ws));
    },
  });

  add({
    name: 'cidr', group: 'Developer', desc: 'an IP range or address: network, mask, first and last, size, kind',
    usage: ['cidr <address>/<prefix>', 'cidr <address>', 'cidr <range> <address>'],
    examples: ['cidr 10.0.1.5/22', 'cidr 192.168.1.10', 'cidr 2001:db8::/48', 'cidr 10.0.0.0/22 10.0.3.9'],
    async run(ctx, rest) {
      const { out } = ctx;
      const [a, b, extra] = rest.trim().split(/\s+/).filter(Boolean);
      if (!a || extra) return usage(ctx, this);
      let r;
      try {
        r = parseCIDR(a);
      } catch (e) {
        return out.err(e.message);
      }
      const v = r.family;
      const fmt = (n) => formatIP(n, v);
      if (b) {
        const ip = parseIP(b);
        if (!ip) return out.err("'" + b + "' is not an IP address");
        const yes = contains(r, ip);
        out.head([[fmt(ip.n), 'strong'], [yes ? ' is in ' : ' is not in ', yes ? 'ok' : 'err'], [fmt(r.network) + '/' + r.prefix, 'strong']], yes ? 'ok' : 'err');
        return;
      }
      const width = v === 4 ? 32 : 128;
      const single = r.prefix === width;
      out.head([[single ? fmt(r.address) : fmt(r.network) + '/' + r.prefix, 'strong'], [' · IPv' + v + ' · ' + ipKind({ family: v, n: r.network }), 'dim']]);
      const rows = [];
      if (!single && r.address !== r.network) rows.push(['address', [[fmt(r.address), ''], [' (inside the range)', 'faint']]]);
      if (!single) {
        rows.push(['network', [[fmt(r.network) + '/' + r.prefix, '']]]);
        if (v === 4) {
          rows.push(['netmask', [[fmt(r.mask), '']]]);
          rows.push(['wildcard', [[fmt(((1n << 32n) - 1n) ^ r.mask), 'dim']]]);
        }
        const hosts = v === 4 && r.prefix <= 30;
        rows.push(['first', [[fmt(hosts ? r.network + 1n : r.network), '']]]);
        rows.push(['last', [[fmt(hosts ? r.last - 1n : r.last), '']]]);
        if (v === 4 && r.prefix <= 30) rows.push(['broadcast', [[fmt(r.last), 'dim']]]);
        rows.push(['addresses', [[n2s(r.size), 'num'], [hosts ? ' · ' + n2s(r.size - 2n) + ' usable hosts' : '', 'dim']]]);
      } else {
        rows.push(['as a number', [[r.address.toString(), 'num']]]);
        if (v === 4) rows.push(['binary', [[[24n, 16n, 8n, 0n].map((s) => ((r.address >> s) & 255n).toString(2).padStart(8, '0')).join('.'), 'dim']]]);
        if (v === 6) rows.push(['in full', [[Array.from({ length: 8 }, (_, i) => ((r.address >> BigInt(112 - 16 * i)) & 0xffffn).toString(16).padStart(4, '0')).join(':'), 'dim']]]);
      }
      out.kv(rows);
      out.copyable(single ? fmt(r.address) : fmt(r.network) + '/' + r.prefix);
    },
  });

  // char: every character of some text, with the invisible and look-alike ones called out.
  add({
    name: 'char', group: 'Text', desc: 'hidden and odd characters: code points, bytes, scripts; invisible ones and look-alike letters flagged',
    usage: ['char <text>', 'char clean <text>'],
    examples: ['char pаypal.com', 'char café', 'char 👩‍💻', 'char clean <paste>'],
    complete: (prev) => (prev.length === 0 ? [{ value: 'clean', label: 'remove the invisible ones' }] : []),
    run(ctx, rest) {
      const { out } = ctx;
      const cm = /^clean\s([\s\S]+)$/i.exec(rest);
      const text = cm ? cm[1] : rest.replace(/^\s/, '');
      if (!text) return usage(ctx, this);
      if (cm) {
        const c = clean(text);
        const gone = [...text].length - [...c].length;
        out.head(gone || c !== text ? [['Cleaned', ''], [' · ' + plural(gone, 'invisible character') + ' removed', 'dim']] : 'Nothing to clean', gone || c !== text ? 'ok' : 'dim');
        return out.value(c);
      }
      const r = inspect(text);
      const pos = new Map(r.chars.map((c, i) => [c.index, i + 1])); // 1-based, by character
      const shown = (c) => (c.flag && !c.benign) || /^[\p{C}\p{Z}]$/u.test(c.ch) ? '⟨' + c.hex + '⟩' : c.ch;
      const tone = r.hidden.length || r.mixed.length ? 'warn' : 'ok';
      out.head([[plural(r.chars.length, 'character'), 'strong'], [r.graphemes !== r.chars.length ? ' · ' + r.graphemes + ' as seen' : '', 'dim'],
        [r.hidden.length ? ' · ' + r.hidden.length + ' hidden or odd' : '', 'warn'], [r.mixed.length ? ' · ' + plural(r.mixed.length, 'word') + ' mixing scripts' : '', 'warn'],
        [!r.hidden.length && !r.mixed.length ? ' · nothing hidden' : '', 'ok']], tone);
      if (r.hidden.length) {
        out.section([['Hidden or odd', 'warn']]);
        out.table(['at', 'code', 'what', 'UTF-8'], r.hidden.map((c) => [[[String(pos.get(c.index)), 'num']], [[c.hex, 'id']], [[c.flag, '']], [[c.utf8, 'dim']]]));
        out.line([['char clean …', 'accent', { run: 'char clean ' + text }], [' gives the text without them', 'faint']]);
      }
      if (r.mixed.length) {
        out.section([['Words mixing scripts', 'warn'], ['  look-alike letters, as in a fake web address', 'faint']]);
        out.table(['word', 'scripts', 'odd letters'], r.mixed.map((w) => [[[w.word, 'strong']], [[w.scripts.join(' + '), '']],
          [[w.odd.map((o) => o.ch + ' (' + o.script + ', at ' + pos.get(o.index) + ')').join(', '), 'warn']]]));
      }
      const LIMIT = 300;
      out.section('Characters');
      out.table(['at', 'char', 'code', 'UTF-8', 'script', 'kind'], r.chars.slice(0, LIMIT).map((c, i) => [
        [[String(i + 1), 'faint']], [[shown(c), c.flag && !c.benign ? 'warn' : 'strong']], [[c.hex, 'id']], [[c.utf8, 'dim']],
        [[c.script, c.script === 'Common' ? 'faint' : '']], [[c.flag ? c.flag + (c.benign ? ' (part of an emoji)' : '') : CATEGORY[c.category] || c.category, c.flag && !c.benign ? 'warn' : 'dim']],
      ]));
      if (r.chars.length > LIMIT) out.dim('First ' + LIMIT + ' shown');
    },
  });
}

const CATEGORY = { Lu: 'capital letter', Ll: 'small letter', Lt: 'title-case letter', Lm: 'modifier letter', Lo: 'letter', Mn: 'combining mark', Mc: 'combining mark',
  Me: 'enclosing mark', Nd: 'digit', Nl: 'letter number', No: 'number', Pc: 'connector', Pd: 'dash', Ps: 'opening bracket', Pe: 'closing bracket',
  Pi: 'opening quote', Pf: 'closing quote', Po: 'punctuation', Sm: 'math symbol', Sc: 'currency', Sk: 'modifier symbol', So: 'symbol', Zs: 'space',
  Cc: 'control', Cf: 'format' };
