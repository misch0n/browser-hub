// Unix permission modes: read them in octal or as ls shows them, explain them,
// and apply chmod's symbolic changes. Pure.
//
//   parseMode(s)          -> { mode (0–0o7777), type ('d', '-', 'l', … or null) } | { error }
//                            '755', '0755', '4755', '0o755', 'rwxr-xr-x', 'drwxr-sr-x', '-rw-r--r--@'
//   describe(mode)        -> { octal: '0755', short: '755' ('4755' with special bits), symbolic: 'rwxr-xr-x',
//                              equation: 'u=rwx,g=rx,o=rx', table: [{ who, read, write, execute, special }],
//                              special: ['setuid', 'setgid', 'sticky'] (those set) }
//   apply(mode, changes)  -> { mode } | { error }    changes: 'u+x', 'go-w', 'a=r', '+x', 'u=rwx,g=rx,o=',
//                            'u+s', 'g+s', '+t', 'g=u', 'a+X'. No who means all (umask is ignored).
//
// The equation is chmod syntax that gives the mode back from 0: setuid is an `s`
// in the owner's part ('u=rwxs'), setgid in the group's ('g=rxs'), sticky a `t`
// in the others' part ('o=rwxt'); a class with nothing is 'o='. `X` adds execute
// only when someone can already execute (a directory can't be told from a number).

const WHO = [['u', 'owner', 6, 0o4000, 'setuid'], ['g', 'group', 3, 0o2000, 'setgid'], ['o', 'others', 0, 0o1000, 'sticky']];
const TYPES = '-dlbcps';

export function parseMode(input) {
  const s = String(input ?? '').trim();
  const oct = /^(?:0o)?0?([0-7]{3,4})$/i.exec(s);
  if (oct) return { mode: parseInt(oct[1], 8), type: null };
  if (/^\d+$/.test(s)) return { error: `${s} isn't a mode: use 3 or 4 digits from 0 to 7, like 755 or 4755` };
  let sym = s.replace(/[@+.]$/, ''), type = null; // ls marks extended attributes and ACLs after the bits
  if (sym.length === 10) {
    if (!TYPES.includes(sym[0])) return { error: `"${sym[0]}" isn't a file type: use one of ${[...TYPES].join(' ')}` };
    type = sym[0];
    sym = sym.slice(1);
  }
  if (sym.length !== 9) return { error: 'expected an octal mode like 755, or 9 letters like rwxr-xr-x (10 with the type, like drwxr-xr-x)' };
  let mode = 0;
  for (const [k, [, , shift, bit]] of WHO.entries()) {
    const [r, w, x] = sym.slice(k * 3, k * 3 + 3);
    const sp = k === 2 ? 'tT' : 'sS';
    const bad = (c, at, ok) => ({ error: `"${c}" can't be at position ${at + 1 + (type ? 1 : 0)}: expected ${ok}` });
    if (!'r-'.includes(r)) return bad(r, k * 3, 'r or -');
    if (!'w-'.includes(w)) return bad(w, k * 3 + 1, 'w or -');
    if (!('x-' + sp).includes(x)) return bad(x, k * 3 + 2, `x, ${sp[0]}, ${sp[1]} or -`);
    mode |= ((r === 'r') << 2 | (w === 'w') << 1 | (x === 'x' || x === sp[0])) << shift;
    if (sp.includes(x)) mode |= bit;
  }
  return { mode, type };
}

const valid = (m) => Number.isInteger(m) && m >= 0 && m <= 0o7777;

export function describe(mode) {
  if (!valid(mode)) return { error: 'a mode is a number from 0 to 07777' };
  const table = [], parts = [];
  let symbolic = '';
  for (const [k, who, shift, bit, name] of WHO) {
    const b = (mode >> shift) & 7, sp = (mode & bit) !== 0;
    const read = (b & 4) !== 0, write = (b & 2) !== 0, execute = (b & 1) !== 0;
    const s = k === 'o' ? 't' : 's';
    symbolic += (read ? 'r' : '-') + (write ? 'w' : '-') + (sp ? (execute ? s : s.toUpperCase()) : execute ? 'x' : '-');
    table.push({ who, read, write, execute, special: sp ? name : null });
    parts.push(`${k}=${read ? 'r' : ''}${write ? 'w' : ''}${execute ? 'x' : ''}${sp ? s : ''}`);
  }
  const short = (mode & 0o7000 ? mode.toString(8).padStart(4, '0') : (mode & 0o777).toString(8).padStart(3, '0'));
  return { octal: mode.toString(8).padStart(4, '0'), short, symbolic, equation: parts.join(','), table,
    special: WHO.filter(([, , , bit]) => mode & bit).map(([, , , , name]) => name) };
}

// The bits `perms` stands for when applied to the classes in `who`.
function bitsFor(perms, who, mode) {
  let rwx = 0, extra = 0;
  for (const p of perms) {
    if (p === 'r') rwx |= 4;
    else if (p === 'w') rwx |= 2;
    else if (p === 'x') rwx |= 1;
    else if (p === 'X') { if (mode & 0o111) rwx |= 1; }
    else if (p === 's') extra |= (who.includes('u') ? 0o4000 : 0) | (who.includes('g') ? 0o2000 : 0);
    else if (p === 't') extra |= who.includes('o') ? 0o1000 : 0;
  }
  return WHO.reduce((m, [k, , shift]) => who.includes(k) ? m | (rwx << shift) : m, extra);
}

export function apply(mode, changes) {
  if (typeof mode === 'string') {
    const p = parseMode(mode);
    if (p.error) return p;
    mode = p.mode;
  }
  if (!valid(mode)) return { error: 'a mode is a number from 0 to 07777' };
  const text = String(changes ?? '').trim();
  if (!text) return { error: 'no change given: try u+x, go-w or a=r' };
  for (const clause of text.split(',')) {
    const m = /^([ugoa]*)(.*)$/.exec(clause.trim());
    const who = !m[1] || m[1].includes('a') ? 'ugo' : m[1];
    let rest = m[2];
    if (!rest) return { error: `expected +, - or = in "${clause}"` };
    while (rest) {
      const op = /^([-+=])([rwxXst]*|[ugo])(?=[-+=]|$)/.exec(rest);
      if (!op) {
        const bad = /^[-+=]/.test(rest) ? rest.slice(1).match(/[^rwxXst]/)?.[0] : rest[0];
        return { error: /^[-+=]/.test(rest) ? `unknown permission "${bad}" in "${clause}": use r, w, x, X, s, t, or one of u g o` : `expected +, - or = in "${clause}", not "${bad}"` };
      }
      let bits;
      if (/^[ugo]$/.test(op[2])) { // copy another class: g=u
        const [, , shift] = WHO.find(([k]) => k === op[2]);
        const src = (mode >> shift) & 7;
        bits = WHO.reduce((b, [k, , sh]) => who.includes(k) ? b | (src << sh) : b, 0);
      } else bits = bitsFor(op[2], who, mode);
      if (op[1] === '+') mode |= bits;
      else if (op[1] === '-') mode &= ~bits;
      else mode = (mode & ~WHO.reduce((c, [k, , sh, bit]) => who.includes(k) ? c | (7 << sh) | bit : c, 0)) | bits;
      rest = rest.slice(op[0].length);
    }
  }
  return { mode };
}
