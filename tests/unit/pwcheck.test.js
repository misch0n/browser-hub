import test from 'node:test';
import assert from 'node:assert/strict';
import { check, duration } from '../../js/lib/pwcheck.js';
import { WORDS } from '../../js/lib/wordlist.js';

const kinds = (r) => r.patterns.map((p) => p.kind);
const find = (r, kind) => r.patterns.find((p) => p.kind === kind);

test('pwcheck: common passwords and look-alike swaps are very weak', () => {
  const pw = check('password');
  assert.equal(pw.verdict, 'very weak');
  assert.deepEqual(pw.patterns, [{ kind: 'common', text: 'password', start: 0, end: 8, note: 'common password (#2)' }]);
  assert.deepEqual([pw.length, pw.classes, pw.crack.offline < 1], [8, ['lower'], true]);
  assert.ok(pw.poolBits > 37 && pw.poolBits < 38, 'naive 8 × log2(26)');
  const leet = check('P@ssw0rd');
  assert.equal(leet.verdict, 'very weak');
  assert.deepEqual(kinds(leet), ['leet']);
  assert.match(leet.patterns[0].note, /password in disguise/);
  assert.deepEqual(leet.classes, ['lower', 'upper', 'digit', 'symbol']);
  assert.ok(leet.advice.some((a) => /look-alike/.test(a)));
  assert.equal(check('qwerty123').verdict, 'very weak', 'one of the twenty most used passwords');
  assert.equal(check('LETMEIN').patterns[0].kind, 'common');
});

test('pwcheck: verdicts climb with real strength', () => {
  const summer = check('Summer2024!');
  assert.equal(summer.verdict, 'weak');
  assert.deepEqual(kinds(summer), ['common', 'date']);
  const tr = check('Tr0ub1e&3', { words: WORDS });
  assert.equal(tr.verdict, 'weak');
  assert.deepEqual(tr.patterns[0], { kind: 'leet', text: 'Tr0ub1e', start: 0, end: 7, note: 'the word trouble in disguise' });
  // 'troubador' isn't in the EFF list, so the xkcd example only counts as random characters.
  assert.ok(['fair', 'strong', 'very strong'].includes(check('Tr0ub4dor&3', { words: WORDS }).verdict));
  const phrase = check('correct horse battery staple', { words: WORDS });
  assert.deepEqual(phrase.patterns.filter((p) => p.kind === 'word').map((p) => [p.text, p.start, p.end]), [['correct', 0, 7], ['battery', 14, 21], ['staple', 22, 28]]);
  assert.ok(phrase.bits < phrase.poolBits && ['strong', 'very strong'].includes(phrase.verdict), phrase.verdict);
  assert.equal(check('battery staple', { words: WORDS }).verdict, 'weak', 'two words are not enough');
  const random = check('xK9#mQ2vL7$pR4wN8zT!');
  assert.equal(random.verdict, 'very strong');
  assert.equal(random.bits, random.poolBits);
  assert.ok(random.advice.some((a) => /password manager/.test(a)));
  assert.equal(check('').verdict, 'very weak');
  assert.throws(() => check(null), /text/);
});

test('pwcheck: sequences, repeats, dates and keyboard walks, with positions', () => {
  assert.deepEqual(find(check('K#q!abcdefq'), 'sequence'), { kind: 'sequence', text: 'abcdef', start: 4, end: 10, note: 'ascending' });
  assert.deepEqual(find(check('Kq9876'), 'sequence'), { kind: 'sequence', text: '9876', start: 2, end: 6, note: 'descending' });
  assert.equal(find(check('Gzyx'), 'sequence').text, 'zyx');
  assert.deepEqual(find(check('Kaaaa'), 'repeat'), { kind: 'repeat', text: 'aaaa', start: 1, end: 5, note: "'a' ×4" });
  assert.equal(find(check('Xp1212'), 'repeat').text, '1212');
  assert.deepEqual(find(check('ab@abc!abc!abc!'), 'repeat'), { kind: 'repeat', text: 'abc!abc!abc!', start: 3, end: 15, note: "'abc!' ×3" });
  assert.deepEqual(find(check('born19-05-1990x'), 'date'), { kind: 'date', text: '19-05-1990', start: 4, end: 14, note: 'date' });
  assert.equal(find(check('Kx05/19/90'), 'date').text, '05/19/90');
  assert.equal(find(check('Kx19900519'), 'date').text, '19900519');
  assert.deepEqual(find(check('Xu1990'), 'date'), { kind: 'date', text: '1990', start: 2, end: 6, note: 'year' });
  assert.deepEqual(find(check('Hzxcvbn'), 'keyboard'), { kind: 'keyboard', text: 'zxcvbn', start: 1, end: 7, note: 'keyboard row' });
  assert.equal(find(check('K!asdfgh'), 'keyboard').text, 'asdfgh');
  const walk = check('Mx1qaz@2wsx');
  assert.deepEqual(walk.patterns.filter((p) => p.kind === 'keyboard').map((p) => [p.text, p.start, p.end, p.note]), [['1qaz', 2, 6, 'keyboard walk'], ['2wsx', 7, 11, 'keyboard walk']]);
  assert.ok(walk.advice.some((a) => /keyboard/.test(a)));
  assert.deepEqual(find(check('hello😀world'), 'common'), { kind: 'common', text: 'hello', start: 0, end: 5, note: 'common password (#36)' });
  assert.equal(check('hello😀world').length, 11, 'an emoji counts as one character');
  assert.deepEqual(check('a😀').classes, ['lower', 'other']);
});

test('pwcheck: long input stays quick', () => {
  const t = Date.now();
  check('ab'.repeat(200), { words: WORDS });
  check(Array.from({ length: 256 }, (_, i) => String.fromCharCode(33 + ((i * 37) % 94))).join(''), { words: WORDS });
  assert.ok(Date.now() - t < 1000);
});

test('pwcheck: durations in plain words', () => {
  assert.equal(duration(0), 'instantly');
  assert.equal(duration(0.4), 'instantly');
  assert.equal(duration(1), '1 second');
  assert.equal(duration(45), '45 seconds');
  assert.equal(duration(90), '2 minutes');
  assert.equal(duration(3 * 3600), '3 hours');
  assert.equal(duration(86400), '1 day');
  assert.equal(duration(40 * 86400), '1 month');
  assert.equal(duration(5 * 31557600), '5 years');
  assert.equal(duration(250 * 31557600), '3 centuries');
  assert.equal(duration(2e6 * 31557600), '20,000 centuries');
  assert.equal(duration(Infinity), 'longer than the universe has existed');
  assert.equal(duration(NaN), 'instantly');
});
