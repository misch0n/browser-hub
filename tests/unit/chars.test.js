import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../js/lib/chars.js';

test('chars: a Cyrillic letter and a zero-width space in a Latin word', () => {
  const r = C.inspect('pаy​pal ok');
  assert.deepEqual(r.hidden.map((c) => [c.index, c.hex, c.flag]), [[3, 'U+200B', 'zero-width space']]);
  assert.deepEqual(r.mixed, [{ word: 'pаy​pal', start: 0, end: 7, scripts: ['Latin', 'Cyrillic'],
    odd: [{ index: 1, ch: 'а', script: 'Cyrillic' }] }]);
  const a = r.chars[1];
  assert.deepEqual([a.cp, a.hex, a.utf8, a.script, a.category, a.flag], [0x430, 'U+0430', 'D0 B0', 'Cyrillic', 'Ll', null]);
  assert.equal(r.chars[3].category, 'Cf');
  assert.deepEqual(C.inspect('pаypal').mixed[0].odd, [{ index: 1, ch: 'а', script: 'Cyrillic' }]);
  // Ties go to Latin as the expected script; one script alone is not mixed.
  assert.deepEqual(C.inspect('а b').mixed, []);
  assert.deepEqual(C.inspect('xа').mixed[0].scripts, ['Latin', 'Cyrillic']);
  assert.deepEqual(C.inspect('Ελλάδα Россия plain').mixed, []);
  // Scripts written together (Japanese, Chinese with Latin) aren't mixing.
  assert.deepEqual(C.inspect('日本語のテキストとAPI').mixed, []);
});

test('chars: bidi controls, odd spaces, controls and the rest are named', () => {
  const r = C.inspect('file‮txt.exe a b c d \u0007\tok﻿­�͸');
  assert.deepEqual(r.hidden.map((c) => c.flag), ['right-to-left override', 'no-break space', 'narrow no-break space',
    'line separator', 'control character', 'byte order mark (zero-width no-break space)', 'soft hyphen', 'private use',
    'replacement character', 'unassigned']);
  assert.equal(r.hidden[0].index, 4);
  assert.equal(r.hidden[0].category, 'Cf');
  assert.equal(r.hidden[1].category, 'Zs');
  assert.equal(r.hidden.at(-1).category, 'Cn');
  assert.deepEqual(C.inspect('⁦ㅤ᠎️').hidden.map((c) => c.flag),
    ['left-to-right isolate', 'Hangul filler', 'Mongolian vowel separator', 'variation selector 16']);
  assert.deepEqual(C.inspect('a\tb\nc\r\n d').hidden, []); // ordinary whitespace is fine
});

test('chars: emoji sequences are one grapheme each and nothing in them is hidden', () => {
  for (const e of ['👩‍💻', '🇧🇬', '👍🏽', '❤️', '1️⃣', '❤️‍🔥', '👨‍👩‍👧', '🏴󠁧󠁢󠁳󠁣󠁴󠁿']) {
    const r = C.inspect(e);
    assert.equal(r.graphemes, 1, e);
    assert.deepEqual(r.hidden, [], e);
    assert.ok(r.chars.length > 1, e);
    assert.ok(r.chars.every((c) => c.grapheme === 0), e);
  }
  const zwj = C.inspect('👩‍💻').chars;
  assert.deepEqual(zwj.map((c) => [c.index, c.hex]), [[0, 'U+1F469'], [2, 'U+200D'], [3, 'U+1F4BB']]);
  assert.deepEqual([zwj[1].flag, zwj[1].benign], ['zero-width joiner', true]);
  // The same joiner or selector outside an emoji is reported.
  assert.equal(C.inspect('a‍b').hidden.length, 1);
  assert.equal(C.inspect('a️').hidden.length, 1);
  assert.equal(C.inspect('x\u{E0041}').hidden[0].flag, 'tag character');
  // A joiner that shapes letters (Persian, Hindi) is normal there.
  assert.deepEqual(C.inspect('می‌خواهم').hidden, []);
});

test('chars: UTF-8 bytes, code points and grapheme counts', () => {
  assert.equal(C.inspect('é').chars[0].utf8, 'C3 A9');
  const g = C.inspect('😀').chars;
  assert.deepEqual(g.map((c) => [c.utf8, c.hex, c.cp, c.category, c.script]), [['F0 9F 98 80', 'U+1F600', 0x1f600, 'So', 'Common']]);
  assert.equal(C.inspect('é').graphemes, 1); // e + combining acute
  assert.equal(C.inspect('é').chars[1].script, 'Inherited');
  assert.equal(C.inspect('é').chars[1].category, 'Mn');
  assert.equal(C.inspect('ab 👩‍💻🇧🇬').graphemes, 5);
  assert.deepEqual(C.inspect(''), { chars: [], hidden: [], mixed: [], graphemes: 0 });
  assert.equal(C.inspect('A1 ').chars.map((c) => c.category).join(' '), 'Lu Nd Zs');
});

test('chars: clean() drops the invisible, keeps emoji whole', () => {
  assert.equal(C.clean('pa​y⁠pal﻿'), 'paypal');
  assert.equal(C.clean('a b c　d'), 'a b c d');
  assert.equal(C.clean('one two'), 'one\ntwo');
  assert.equal(C.clean('file‮txt.exe\u0007'), 'filetxt.exe');
  assert.equal(C.clean('keep\ttabs\nand lines\r\n'), 'keep\ttabs\nand lines\r\n');
  for (const e of ['👩‍💻', '🇧🇬', '👍🏽', '❤️', '🏴󠁧󠁢󠁳󠁣󠁴󠁿']) assert.equal(C.clean(`hi ${e}​`), `hi ${e}`);
  assert.equal(C.clean('a️b'), 'ab');
  assert.equal(C.clean('pаypal'), 'pаypal'); // homoglyphs are reported, not changed
});
