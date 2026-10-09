import { plural, toISO, pad2 } from '../core/util.js';
import { longDate } from '../core/format.js';
import { tokenize } from '../core/args.js';
import { highlight } from '../core/search.js';
import { relative } from '../lib/misc.js';
import { ALGS, verifyJwt, signJwt } from '../lib/jose.js';
import { parseMode, describe as describeMode, apply as applyMode } from '../lib/chmod.js';
import { md5, decodeJWT, diffLists, diffView, parseCron, cronNext, describeCron, parseColor, toHex, toHsl, contrast } from '../lib/dev.js';

// Developer tools: hash, jwt, url, regex, diff, cron, color, chmod. All offline.

const ALGOS = { md5: 'MD5', sha1: 'SHA-1', 'sha-1': 'SHA-1', sha256: 'SHA-256', 'sha-256': 'SHA-256', sha384: 'SHA-384', 'sha-384': 'SHA-384', sha512: 'SHA-512', 'sha-512': 'SHA-512' };

export async function digest(algo, text) {
  if (algo === 'MD5') return md5(text);
  const buf = await globalThis.crypto.subtle.digest(algo, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

const when = (d, now) => [[longDate(toISO(d), toISO(now)) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()), 'date'], [' · ' + relative(d, now), 'dim']];

export default function register(add, { usage }) {
  add({
    name: 'hash', group: 'Security', private: true, // the text may be a secret: not in the shared history
    desc: 'MD5 and SHA checksums of text',
    usage: ['hash <text>', 'hash md5|sha1|sha256|sha384|sha512 <text>'],
    examples: ['hash hello', 'hash sha256 hello'],
    complete: (prev) => (prev.length === 0 ? ['md5', 'sha1', 'sha256', 'sha384', 'sha512'].map((v) => ({ value: v })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const m = /^(\S+)\s+([\s\S]+)$/.exec(rest);
      const one = m && ALGOS[m[1].toLowerCase()];
      if (one) {
        out.head([[one, 'strong'], [' · ' + plural(new TextEncoder().encode(m[2]).length, 'byte') + ' of UTF-8', 'dim']]);
        out.value(await digest(one, m[2]));
        return;
      }
      if (!rest) return usage(ctx, this);
      out.head([['Checksums', 'strong'], [' · ' + plural(new TextEncoder().encode(rest).length, 'byte') + ' of UTF-8', 'dim']]);
      const rows = [];
      for (const a of ['MD5', 'SHA-1', 'SHA-256', 'SHA-512']) rows.push([[[a, 'dim']], [[await digest(a, rest), '']]]);
      out.table(null, rows, { stack: true });
      out.copyable(rows[2][1][0][0]);
      out.dim('hash sha256 <text> gives one, with a copy button');
    },
  });

  add({
    name: 'jwt', group: 'Security', private: true, noHistory: true, // a token is a credential: kept nowhere
    desc: 'decode a JSON Web Token, check its signature, or sign one (HS, RS, PS, ES, EdDSA)',
    usage: ['jwt <token>', 'jwt <token> <key>', 'jwt verify <token> [key]', 'jwt sign <alg> <payload JSON> [key]'],
    examples: ['jwt eyJhbGciOi…', 'jwt verify eyJhbGciOi…   (HS: asks for the secret, hidden)', 'jwt verify eyJhbGciOi… <paste a PEM or JWK public key>',
      'jwt sign HS256 {"sub":"me"}', 'jwt sign ES256 {"sub":"me"} <paste a PKCS#8 private key>'],
    complete: (prev) => (prev.length === 0 ? [{ value: 'verify' }, { value: 'sign' }]
      : prev[0] === 'sign' && prev.length === 1 ? Object.keys(ALGS).map((a) => ({ value: a })) : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const text = rest.trim();
      if (!text) return usage(ctx, this);
      const m = /^(verify|sign)(?:\s+([\s\S]*))?$/i.exec(text);
      const mode = m ? m[1].toLowerCase() : 'decode';
      const body = m ? (m[2] || '').trim() : text;
      const ask = (alg) => ctx.askSecret('Shared secret for ' + alg + ' (hidden; hex:… or base64:… for binary)');

      if (mode === 'sign') {
        const s = /^(\S+)\s+([\s\S]+)$/.exec(body);
        if (!s) return usage(ctx, this);
        const alg = Object.keys(ALGS).find((a) => a.toLowerCase() === s[1].toLowerCase());
        if (!alg) return out.err('Unknown algorithm ' + s[1] + ' (' + Object.keys(ALGS).join(', ') + ')');
        // The payload is the JSON object at the start; anything after it is the key.
        let payload = null, keyText = '';
        const src = s[2];
        for (let i = src.indexOf('}'); i >= 0; i = src.indexOf('}', i + 1)) {
          try { payload = JSON.parse(src.slice(0, i + 1)); keyText = src.slice(i + 1).trim(); break; } catch (e) { /* keep looking */ }
        }
        if (!payload || typeof payload !== 'object') return out.err('The payload is a JSON object: jwt sign ' + alg + ' {"sub":"me"}');
        if (!keyText) {
          if (ALGS[alg].kind !== 'hmac') return out.err(alg + ' signs with a private key: paste it (PEM PRIVATE KEY or JWK) after the payload');
          keyText = await ask(alg);
          if (!keyText) return out.head('Cancelled', 'dim');
        }
        try {
          const token = await signJwt(payload, alg, keyText);
          out.head([['Signed', 'ok'], [' · ' + alg + ' · ' + token.length + ' characters', 'dim']], 'ok');
          out.value(token);
          out.dim('Made on this page with Web Crypto; not kept in history');
        } catch (e) {
          out.err(e.message);
        }
        return;
      }

      const parts = /^(\S+)(?:\s+([\s\S]+))?$/.exec(body);
      if (!parts) return usage(ctx, this);
      let t;
      try {
        t = decodeJWT(parts[1]);
      } catch (e) {
        return out.err(e.message);
      }
      let keyText = (parts[2] || '').trim();
      let check = null;
      const alg = t.header.alg;
      if (mode === 'verify' || keyText) {
        if (!keyText && ALGS[alg] && ALGS[alg].kind === 'hmac') {
          keyText = await ask(alg);
          if (!keyText) return out.head('Cancelled', 'dim');
        }
        if (!keyText) {
          check = { valid: false, alg, reason: ALGS[alg] ? 'paste the public key (PEM or JWK) after the token' : 'unsupported algorithm ' + alg };
        } else {
          try { check = await verifyJwt(parts[1], keyText); } catch (e) { check = { valid: false, alg, reason: e.message }; }
        }
      }
      const now = ctx.now();
      const p = t.payload || {};
      const time = (k) => (typeof p[k] === 'number' ? new Date(p[k] * 1000) : null);
      const exp = time('exp'), nbf = time('nbf');
      const state = exp && exp <= now ? ['expired ' + relative(exp, now), 'err'] : nbf && nbf > now ? ['not valid until ' + relative(nbf, now), 'warn']
        : exp ? ['valid, expires ' + relative(exp, now), 'ok'] : ['no expiry', 'dim'];
      const sig = check ? (check.valid ? [' · signature ✓', 'ok'] : [' · signature ✗', 'err']) : ['', ''];
      const tone = check && !check.valid ? 'err' : state[1] === 'err' ? 'err' : state[1] === 'warn' ? 'warn' : 'ok';
      out.head([['JWT', 'strong'], [' · ' + (alg || 'no alg') + ' · ', 'dim'], state, sig], tone);
      if (check) {
        out.line(check.valid ? [['✓ Signature valid', 'ok strong'], [' · ' + check.alg + ', checked with Web Crypto on this page', 'dim']]
          : [['✗ Signature not valid', 'err strong'], [' · ' + check.reason, 'dim']]);
      }
      const times = [['iat', 'issued'], ['nbf', 'not before'], ['exp', 'expires'], ['auth_time', 'signed in']].filter(([k]) => time(k));
      const who = [['sub', 'subject'], ['iss', 'issuer'], ['aud', 'audience']].filter(([k]) => p[k] !== undefined);
      if (times.length || who.length) {
        out.kv([...who.map(([k, label]) => [label, [[Array.isArray(p[k]) ? p[k].join(', ') : String(p[k]), 'strong']]]),
          ...times.map(([k, label]) => [label, when(time(k), now)])]);
      }
      out.section('Header');
      out.code(JSON.stringify(t.header, null, 2), 'json');
      out.section('Payload');
      out.code(JSON.stringify(p, null, 2), 'json');
      out.dim((check ? '' : 'Signature not checked: jwt verify <token> [key] · ') + 'Not kept in history');
    },
  });

  add({
    name: 'url', group: 'Developer', desc: 'take a URL apart, or percent-encode and decode text',
    usage: ['url <url>', 'url encode <text>', 'url decode <text>'],
    examples: ['url https://example.com:8080/a/b?q=hello%20world&x=1#top', 'url encode a&b=c d', 'url decode a%26b%3Dc%20d'],
    complete: (prev) => (prev.length === 0 ? [{ value: 'encode' }, { value: 'decode' }] : []),
    async run(ctx, rest) {
      const { out } = ctx;
      const m = /^(encode|decode)\s+([\s\S]+)$/i.exec(rest.trim());
      if (m) {
        try {
          out.value(m[1].toLowerCase() === 'encode' ? encodeURIComponent(m[2]) : decodeURIComponent(m[2]));
        } catch (e) {
          out.err('Not valid percent-encoding: ' + m[2]);
        }
        return;
      }
      const text = rest.trim();
      if (!text) return usage(ctx, this);
      let u;
      try {
        u = new URL(/^[a-z][\w+.-]*:/i.test(text) ? text : 'https://' + text);
      } catch (e) {
        return out.err("Not a URL: '" + text + "'");
      }
      out.head([[u.host || u.protocol, 'strong'], [' · ' + u.protocol.replace(/:$/, ''), 'dim']]);
      const rows = [['scheme', [[u.protocol.replace(/:$/, ''), '']]]];
      if (u.username) rows.push(['user', [[decodeURIComponent(u.username), ''], [u.password ? ' (and a password)' : '', 'warn']]]);
      if (u.hostname) rows.push(['host', [[u.hostname, 'strong']]]);
      rows.push(['port', [[u.port || ({ 'https:': '443', 'http:': '80' }[u.protocol] || ''), u.port ? 'num' : 'faint'], [u.port ? '' : ' (default)', 'faint']]]);
      rows.push(['path', [[decodeURIComponent(u.pathname), '']]]);
      if (u.hash) rows.push(['fragment', [[decodeURIComponent(u.hash.slice(1)), '']]]);
      out.kv(rows);
      const params = [...u.searchParams];
      if (params.length) {
        out.section('Query · ' + plural(params.length, 'parameter'));
        out.table(null, params.map(([k, v]) => [[[k, 'id']], [[v, '']]]), { stack: true });
      }
      out.copyable(u.href);
    },
  });

  add({
    name: 'regex', group: 'Developer', desc: 'try a regular expression on some text: every match and its groups',
    usage: ['regex /pattern/flags <text>'],
    examples: ['regex /(\\d{3})-(\\d{4})/ call 555-1234 or 555-9876', 'regex /^(?<user>[^@]+)@(?<domain>.+)$/ me@example.com'],
    async run(ctx, rest) {
      const { out } = ctx;
      const m = /^\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\[])+)\/([a-z]*)(?:\s+([\s\S]*))?$/.exec(rest.trim());
      if (!m) return usage(ctx, this);
      let re;
      try {
        re = new RegExp(m[1], m[2].includes('g') ? m[2] : m[2] + 'g');
      } catch (e) {
        return out.err(e.message);
      }
      const groups = new RegExp('(?:' + m[1] + ')|', m[2].replace(/[gy]/g, '')).exec('').length - 1;
      if (m[3] === undefined) {
        out.head([['Valid', 'ok'], [' · ' + plural(groups, 'group') + ' · add some text after it to try it', 'dim']], 'ok');
        return;
      }
      const text = m[3];
      const found = [];
      let x;
      while ((x = re.exec(text)) && found.length < 100) {
        found.push(x);
        if (x[0] === '') re.lastIndex++;
      }
      if (!found.length) {
        out.head([['No match', 'warn'], [' · /' + m[1] + '/' + m[2], 'dim']], 'warn');
        return;
      }
      out.head([[plural(found.length, 'match', 'matches'), 'strong'], [' · /' + m[1] + '/' + m[2], 'dim']], 'ok');
      out.line(highlight(text, found.filter((f) => f[0]).map((f) => [f.index, f.index + f[0].length])));
      out.table(['#', 'at', 'match', ...(groups ? ['groups'] : [])], found.map((f, i) => [
        [[String(i + 1), 'num']], [[String(f.index), 'dim']], [[f[0] === '' ? '(empty)' : f[0], f[0] === '' ? 'faint' : 'strong']],
        ...(groups ? [f.slice(1).map((g, k) => {
          const name = f.groups && Object.keys(f.groups).find((n) => f.groups[n] === g);
          return [(k ? '  ' : '') + (name || String(k + 1)) + '=' + (g === undefined ? '∅' : g), g === undefined ? 'faint' : ''];
        })] : []),
      ]));
      out.copyable(found[0][0]);
    },
  });

  add({
    name: 'diff', group: 'Developer', desc: 'compare two texts: paste them both after diff, or quote them',
    usage: ['diff <paste> <paste>', 'diff "<text>" "<text>"'],
    examples: ['diff "the quick brown fox" "the quick red fox"'],
    async run(ctx, rest) {
      const { out } = ctx;
      let pair = ctx.pasted && ctx.pasted.length === 2 ? ctx.pasted : null;
      if (!pair) {
        const t = tokenize(rest);
        if (t.length === 2) pair = t.map((x) => x.text);
      }
      if (!pair) {
        usage(ctx, this);
        out.dim('Paste the first text, a space, then the second, and press Enter (each paste shows as a placeholder)');
        return;
      }
      const [a, b] = pair.map((s) => String(s).replace(/\r\n?/g, '\n'));
      if (a === b) return out.head([['Identical', 'ok'], [' · ' + plural(a.split('\n').length, 'line'), 'dim']], 'ok');
      const multi = a.includes('\n') || b.includes('\n');
      if (!multi) {
        // One line each: word by word.
        const ops = diffLists(a.split(/(\s+)/), b.split(/(\s+)/));
        const changed = ops.filter(([o, w]) => o !== '=' && w.trim()).length;
        out.head([['Differs', 'strong'], [' · ' + plural(changed, 'word') + ' changed', 'dim']], 'warn');
        out.line([['− ', 'err'], ...ops.filter(([o]) => o !== '+').map(([o, w]) => [w, o === '-' ? 'err strong' : 'dim'])]);
        out.line([['+ ', 'ok'], ...ops.filter(([o]) => o !== '-').map(([o, w]) => [w, o === '+' ? 'ok strong' : 'dim'])]);
        return;
      }
      let ops;
      try {
        ops = diffLists(a.split('\n'), b.split('\n'));
      } catch (e) {
        return out.err(e.message);
      }
      const minus = ops.filter(([o]) => o === '-').length, plus = ops.filter(([o]) => o === '+').length;
      out.head([['Differs', 'strong'], [' · ', 'faint'], ['−' + minus, 'err'], [' ', ''], ['+' + plus, 'ok'],
        [' · ' + plural(a.split('\n').length, 'line') + ' → ' + plural(b.split('\n').length, 'line'), 'dim']], 'warn');
      out.code(diffView(ops).map((l) => (l.op === '…' ? '… ' + l.text : l.op === '=' ? '  ' + l.text : l.op + ' ' + l.text)).join('\n'), 'diff');
    },
  });

  add({
    name: 'cron', group: 'Developer',
    complete: (prev) => (prev.length === 0 ? ['@hourly', '@daily', '@weekly', '@monthly', '@yearly'].map((v) => ({ value: v })) : []), desc: 'a cron schedule in words, and when it runs next',
    usage: ['cron <minute> <hour> <day> <month> <weekday>', 'cron @daily|@hourly|@weekly|@monthly|@yearly'],
    examples: ['cron */15 * * * *', 'cron 30 9 * * 1-5', 'cron 0 0 1 * *'],
    async run(ctx, rest) {
      const { out } = ctx;
      if (!rest.trim()) return usage(ctx, this);
      let c;
      try {
        c = parseCron(rest);
      } catch (e) {
        return out.err(e.message);
      }
      const now = ctx.now();
      out.head([[describeCron(c), 'strong'], [' · ' + c.parts.join(' '), 'dim']]);
      const next = cronNext(c, now, 5);
      if (!next.length) return out.warn('never runs (no such date)');
      out.section('Next runs · your time');
      out.table(null, next.map((d) => [[[longDate(toISO(d), toISO(now)), 'date']], [[pad2(d.getHours()) + ':' + pad2(d.getMinutes()), 'num']], [[relative(d, now), 'dim']]]));
    },
  });

  add({
    name: 'color', group: 'Developer', desc: 'convert a colour (hex, rgb, hsl) and check contrast',
    usage: ['color <colour>', 'color <text colour> on <background>'],
    examples: ['color #0af', 'color hsl(200, 100%, 50%)', 'color #777 on #fff'],
    async run(ctx, rest) {
      const { out } = ctx;
      const text = rest.trim();
      if (!text) return usage(ctx, this);
      const pairM = /^(.+?)\s+on\s+(.+)$/i.exec(text);
      const parse = (s) => {
        const c = parseColor(s);
        if (!c) out.err("Not a colour: '" + s + "' (try #0af, #00aaff, rgb(0 170 255), hsl(200 100% 50%))");
        return c;
      };
      const grade = (r) => (r >= 7 ? ['AAA', 'ok'] : r >= 4.5 ? ['AA', 'ok'] : r >= 3 ? ['AA large text only', 'warn'] : ['fails', 'err']);
      if (pairM) {
        const fg = parse(pairM[1]);
        const bg = fg && parse(pairM[2]);
        if (!fg || !bg) return;
        const r = contrast(fg, bg);
        const g = grade(r);
        out.head([[r.toFixed(2) + ':1', 'num strong'], [' contrast · ', 'dim'], g], g[1]);
        out.swatch([{ color: toHex({ ...bg, a: 1 }), text: { value: 'Aa', color: toHex({ ...fg, a: 1 }) }, label: toHex(fg) + ' on ' + toHex(bg) }]);
        out.dim('WCAG: 4.5 for text (AA), 3 for large text, 7 for AAA');
        out.copyable(r.toFixed(2));
        return;
      }
      const c = parse(text);
      if (!c) return;
      const hex = toHex(c);
      const hsl = toHsl(c);
      const alpha = c.a < 1 ? ' / ' + c.a : '';
      out.head([[hex, 'strong'], [c.a < 1 ? ' · ' + Math.round(c.a * 100) + '% opaque' : '', 'dim']]);
      const white = { r: 255, g: 255, b: 255 }, black = { r: 0, g: 0, b: 0 };
      out.swatch([{ color: hex, label: '' }, { color: '#ffffff', text: { value: 'Aa', color: toHex({ ...c, a: 1 }) }, label: 'on white' },
        { color: '#000000', text: { value: 'Aa', color: toHex({ ...c, a: 1 }) }, label: 'on black' }]);
      const on = (bg) => { const r = contrast(c, bg); const g = grade(r); return [[r.toFixed(2) + ':1 ', 'num'], g]; };
      out.kv([
        ['hex', [[hex, '']]],
        ['rgb', [['rgb(' + c.r + ' ' + c.g + ' ' + c.b + alpha + ')', '']]],
        ['hsl', [['hsl(' + hsl.h + ' ' + hsl.s + '% ' + hsl.l + '%' + alpha + ')', '']]],
        ['on white', on(white)],
        ['on black', on(black)],
      ]);
      out.copyable(hex);
    },
  });

  // chmod: a Unix mode in every notation, and what symbolic changes do to it.
  add({
    name: 'chmod', group: 'Developer', desc: 'Unix permissions: 755 ⇄ rwxr-xr-x ⇄ u=rwx,g=rx,o=rx, special bits, and what u+x or go-w does',
    usage: ['chmod <mode>', 'chmod <mode> <changes>'],
    examples: ['chmod 755', 'chmod rw-r--r--', 'chmod drwxr-sr-x', 'chmod 4755', 'chmod 644 u+x', 'chmod 777 go-w,o-x', 'chmod 1777'],
    run(ctx, rest) {
      const { out } = ctx;
      const m = /^(\S+)(?:\s+(\S[\s\S]*))?$/.exec(rest.trim());
      if (!m) return usage(ctx, this);
      const p = parseMode(m[1]);
      if (p.error) return out.err(p.error);
      let mode = p.mode;
      const before = describeMode(mode);
      if (m[2]) {
        const r = applyMode(mode, m[2].replace(/\s+/g, ','));
        if (r.error) return out.err(r.error);
        mode = r.mode;
      }
      const d = describeMode(mode);
      const head = m[2]
        ? [[before.short, 'num'], [' ' + before.symbolic, 'dim'], ['  ' + m[2].trim() + '  →  ', 'faint'], [d.short, 'num strong'], [' ' + d.symbolic, 'strong']]
        : [[d.symbolic, 'strong'], ['  ' + d.short, 'num']];
      out.head(head, m[2] ? (mode === p.mode ? 'dim' : 'ok') : undefined);
      out.kv([
        ['octal', [[d.octal, 'num'], [d.short !== d.octal.replace(/^0/, '') ? '' : '  (' + d.short + ')', 'faint']]],
        ['symbolic', [[(p.type && !m[2] ? p.type : '') + d.symbolic, '']]],
        ['chmod', [['chmod ' + d.equation, ''], ['  (or chmod ' + d.short + ')', 'faint']]],
        ...(p.type ? [['type', [[{ d: 'directory', '-': 'file', l: 'symbolic link', b: 'block device', c: 'character device', p: 'named pipe', s: 'socket' }[p.type] || p.type, 'dim']]]] : []),
        ...(d.special.length ? [['special', [[d.special.join(', '), 'warn'], ['  ' + d.special.map((x) => SPECIAL[x]).join('; '), 'faint']]]] : []),
      ]);
      const yes = (b, letter) => [b ? letter : '-', b ? 'ok' : 'faint'];
      out.table(['who', 'read', 'write', 'execute', ''], d.table.map((r) => [
        [[r.who, '']], [yes(r.read, 'r')], [yes(r.write, 'w')], [yes(r.execute, 'x')], [[r.special || '', 'warn']],
      ]));
      out.copyable(d.short);
    },
  });
}

const SPECIAL = {
  setuid: 'runs as the file\u2019s owner',
  setgid: 'runs as its group (on a directory: new files get its group)',
  sticky: 'only owners may delete in it (as /tmp)',
};
