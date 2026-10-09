import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../../js/lib/chmod.js';

const sym = (s) => P.describe(P.parseMode(s).mode).symbolic;
const oct = (s) => P.describe(P.parseMode(s).mode).short;
const ch = (mode, c) => { const r = P.apply(mode, c); return r.error ? r : P.describe(r.mode).symbolic; };

test('chmod: octal and symbolic, both ways', () => {
  assert.deepEqual(P.parseMode('755'), { mode: 0o755, type: null });
  assert.deepEqual(P.parseMode('0755'), { mode: 0o755, type: null });
  assert.deepEqual(P.parseMode('0o644'), { mode: 0o644, type: null });
  assert.deepEqual(P.parseMode('04755'), { mode: 0o4755, type: null });
  assert.equal(sym('755'), 'rwxr-xr-x');
  assert.equal(sym('644'), 'rw-r--r--');
  assert.equal(sym('000'), '---------');
  assert.equal(sym('4755'), 'rwsr-xr-x');
  assert.equal(sym('2755'), 'rwxr-sr-x');
  assert.equal(sym('1777'), 'rwxrwxrwt');
  assert.equal(sym('7644'), 'rwSr-Sr-T');
  assert.equal(oct('rwxr-xr-x'), '755');
  assert.equal(oct('rw-r--r--'), '644');
  assert.equal(oct('rwsr-xr-x'), '4755');
  assert.equal(oct('rwSr--r--'), '4644'); // setuid without execute
  assert.equal(oct('rwxr-s---'), '2750');
  assert.equal(oct('rwxrwxrwT'), '1776');
  assert.deepEqual(P.parseMode('drwxr-xr-x'), { mode: 0o755, type: 'd' });
  assert.deepEqual(P.parseMode('-rw-r--r--'), { mode: 0o644, type: '-' });
  assert.deepEqual(P.parseMode('lrwxrwxrwx'), { mode: 0o777, type: 'l' });
  assert.deepEqual(P.parseMode('drwxr-xr-x@'), { mode: 0o755, type: 'd' }); // macOS ls marks
  for (let m = 0; m <= 0o7777; m++) assert.equal(P.parseMode(P.describe(m).symbolic).mode, m);
});

test('chmod: describe', () => {
  assert.deepEqual(P.describe(0o755), {
    octal: '0755', short: '755', symbolic: 'rwxr-xr-x', equation: 'u=rwx,g=rx,o=rx', special: [],
    table: [
      { who: 'owner', read: true, write: true, execute: true, special: null },
      { who: 'group', read: true, write: false, execute: true, special: null },
      { who: 'others', read: true, write: false, execute: true, special: null },
    ],
  });
  const s = P.describe(0o4755);
  assert.deepEqual([s.octal, s.short, s.equation, s.special, s.table[0].special], ['4755', '4755', 'u=rwxs,g=rx,o=rx', ['setuid'], 'setuid']);
  assert.equal(P.describe(0o640).equation, 'u=rw,g=r,o=');
  assert.equal(P.describe(0o2777).equation, 'u=rwx,g=rwxs,o=rwx');
  assert.equal(P.describe(0o3777).equation, 'u=rwx,g=rwxs,o=rwxt');
  assert.deepEqual(P.describe(0o7000).special, ['setuid', 'setgid', 'sticky']);
  assert.equal(P.describe(0o1777).equation, 'u=rwx,g=rwx,o=rwxt');
  assert.equal(P.describe(0o644).octal, '0644');
  assert.equal(P.describe(0o7).short, '007');
  // The equation is chmod syntax that gives the mode back.
  for (let m = 0; m <= 0o7777; m += 7) assert.equal(P.apply(0, P.describe(m).equation).mode, m);
  assert.ok(P.describe(0o10000).error);
  assert.ok(P.describe(-1).error);
});

test('chmod: apply symbolic changes', () => {
  assert.equal(ch(0o644, 'u+x'), 'rwxr--r--');
  assert.equal(ch(0o666, 'go-w'), 'rw-r--r--');
  assert.equal(ch(0o777, 'a=r'), 'r--r--r--');
  assert.equal(ch(0o644, '+x'), 'rwxr-xr-x');
  assert.equal(ch(0, 'u=rwx,g=rx,o='), 'rwxr-x---');
  assert.equal(ch(0o777, 'o-rwx'), 'rwxrwx---');
  assert.equal(ch(0o755, 'u+s'), 'rwsr-xr-x');
  assert.equal(ch(0o755, 'g+s'), 'rwxr-sr-x');
  assert.equal(ch(0o777, '+t'), 'rwxrwxrwt');
  assert.equal(ch(0o644, 'u+s'), 'rwSr--r--');
  assert.equal(ch(0o4755, 'u-s'), 'rwxr-xr-x');
  assert.equal(ch(0o4755, 'u=rw'), 'rw-r-xr-x'); // = clears the class's special bit too
  assert.equal(ch(0o755, '+s'), 'rwsr-sr-x');
  assert.equal(ch(0o750, 'o=g'), 'rwxr-xr-x');
  assert.equal(ch(0o700, 'go=u-w'), 'rwxr-xr-x');
  assert.equal(ch(0o600, 'u+r-w+x'), 'r-x------');
  assert.equal(ch(0o644, 'a+X'), 'rw-r--r--'); // nobody could execute: X adds nothing
  assert.equal(ch(0o744, 'a+X'), 'rwxr-xr-x');
  assert.equal(ch(0o644, ' u+x , g+w '), 'rwxrw-r--');
  assert.equal(ch('rw-r--r--', 'u+x'), 'rwxr--r--');
  assert.equal(ch(0o644, 'u+'), 'rw-r--r--');
});

test('chmod: bad input is refused with a reason', () => {
  assert.match(P.parseMode('888').error, /888 isn't a mode/);
  assert.match(P.parseMode('75').error, /3 or 4 digits/);
  assert.match(P.parseMode('rwxrwxrw').error, /9 letters/);
  assert.match(P.parseMode('rwxrwxrwq').error, /"q" can't be at position 9: expected x, t, T or -/);
  assert.match(P.parseMode('rwtr-xr-x').error, /position 3: expected x, s, S or -/);
  assert.match(P.parseMode('xrwxr-xr-x').error, /"x" isn't a file type/);
  assert.match(P.parseMode('-rwxr-xr-q').error, /position 10/);
  assert.match(P.parseMode('').error, /expected an octal mode/);
  assert.match(P.apply(0o644, 'u+q').error, /unknown permission "q" in "u\+q"/);
  assert.match(P.apply(0o644, 'u').error, /expected \+, - or = in "u"/);
  assert.match(P.apply(0o644, 'z+x').error, /expected \+, - or =.*"z"/);
  assert.match(P.apply(0o644, 'u+x,,g+w').error, /expected/);
  assert.match(P.apply(0o644, '').error, /no change/);
  assert.match(P.apply(0o644, 'g=uo').error, /unknown permission "u"/);
  assert.match(P.apply(0o20000, 'u+x').error, /07777/);
  assert.match(P.apply('999', 'u+x').error, /isn't a mode/);
});
