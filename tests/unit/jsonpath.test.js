import test from 'node:test';
import assert from 'node:assert/strict';
import * as J from '../../js/lib/jsonpath.js';

const DOC = {
  store: {
    book: [
      { title: 'Sayings', author: 'Nigel', price: 8.95 },
      { title: 'Sword', author: 'Evelyn', price: 12.99, isbn: '0-553' },
      { title: 'Moby', author: 'Herman', price: 8.99 },
    ],
    bicycle: { color: 'red', price: 19.95 },
  },
  'first name': 'Ada',
  'a.b': 1,
  list: [10, 20, 30, 40, 50],
};
const q = (e, v = DOC) => J.query(v, e);
const paths = (e, v) => q(e, v).results.map((r) => r.path);
const values = (e, v) => q(e, v).results.map((r) => r.value);

test('jsonpath: keys, indexes and the root', () => {
  for (const e of ['.', '$', '$.', '', ' . ']) assert.deepEqual(q(e).results, [{ path: '$', value: DOC }], e);
  assert.deepEqual(q('.store.bicycle.color').results, [{ path: '$.store.bicycle.color', value: 'red' }]);
  assert.deepEqual(values('$.store.book[0].title'), ['Sayings']);
  assert.deepEqual(values('store.book[1].author'), ['Evelyn']); // no leading dot
  assert.deepEqual(values('.store.book.[2].title'), ['Moby']); // jq-style .[n]
  assert.deepEqual(q('.store.book[-1]').results.map((r) => [r.path, r.value.title]), [['$.store.book[2]', 'Moby']]);
  assert.deepEqual(values('.list[-5]'), [10]);
  assert.deepEqual(values('$.list[ 1 ]'), [20]);
});

test('jsonpath: quoted keys with spaces, dots and escapes', () => {
  assert.deepEqual(q('["first name"]').results, [{ path: '$["first name"]', value: 'Ada' }]);
  assert.deepEqual(values("$['first name']"), ['Ada']);
  assert.deepEqual(q('["a.b"]').results, [{ path: '$["a.b"]', value: 1 }]);
  assert.deepEqual(values('.store["bicycle"]["color"]'), ['red']);
  assert.deepEqual(values('["say \\"hi\\""]', { 'say "hi"': 2 }), [2]);
  assert.deepEqual(values("['it\\'s']", { "it's": 3 }), [3]);
});

test('jsonpath: wildcards, slices and recursive descent', () => {
  assert.deepEqual(values('.store.book[*].author'), ['Nigel', 'Evelyn', 'Herman']);
  assert.deepEqual(values('.store.bicycle.*'), ['red', 19.95]);
  assert.deepEqual(paths('.store.*'), ['$.store.book', '$.store.bicycle']);
  assert.deepEqual(values('.list[1:3]'), [20, 30]);
  assert.deepEqual(values('.list[-2:]'), [40, 50]);
  assert.deepEqual(values('.list[:2]'), [10, 20]);
  assert.deepEqual(values('.list[::2]'), [10, 30, 50]);
  assert.deepEqual(values('.list[::-1]'), [50, 40, 30, 20, 10]);
  assert.deepEqual(values('.list[3:1:-1]'), [40, 30]);
  assert.deepEqual(values('.list[-10:10]'), [10, 20, 30, 40, 50]);
  assert.deepEqual(values('.list[4:2]'), []);
  // Document order: a match comes before the matches nested inside it.
  assert.deepEqual(paths('..price'), ['$.store.book[0].price', '$.store.book[1].price', '$.store.book[2].price', '$.store.bicycle.price']);
  assert.deepEqual(paths('..a', { a: { a: { b: 1 } }, c: [{ a: 2 }] }), ['$.a', '$.a.a', '$.c[0].a']);
  assert.deepEqual(paths('$..book[0].title'), ['$.store.book[0].title']);
  assert.deepEqual(values('..[0]', [[1, 2], [3]]), [[1, 2], 1, 3]);
  assert.equal(q('..*').results.length, 26); // every node but the root
  assert.deepEqual(values('.store..isbn'), ['0-553']);
});

test('jsonpath: missing things are no results, not errors', () => {
  for (const e of ['.nope', '.store.book[3]', '.store.book[-4]', '.store.bicycle.color.x', '.list.key', '.store.book.title',
    '.store.bicycle[0]', '["0"]', '..nothing', '.list[5:]', '.store.bicycle.color[*]']) assert.deepEqual(q(e), { results: [] }, e);
  assert.deepEqual(q('.a', null), { results: [] });
  assert.deepEqual(q('[0]', ['x']), { results: [{ path: '$[0]', value: 'x' }] });
  assert.deepEqual(q('.x', { x: null }), { results: [{ path: '$.x', value: null }] });
});

test('jsonpath: bad expressions say what and where', () => {
  assert.deepEqual(q('.a['), { error: 'unclosed [', at: 2 });
  assert.deepEqual(q('.a[1:'), { error: 'unclosed [', at: 2 });
  assert.deepEqual(q('.a..'), { error: 'expected a key after ..', at: 4 });
  assert.deepEqual(q('.a.'), { error: 'expected a key after .', at: 3 });
  assert.deepEqual(q('a b'), { error: 'unexpected space', at: 1 });
  assert.deepEqual(q('.a-b'), { error: 'unexpected "-"', at: 2 });
  assert.deepEqual(q('.a[]'), { error: 'empty brackets', at: 2 });
  assert.deepEqual(q('.a[x]'), { error: 'unexpected "x" in brackets', at: 3 });
  assert.deepEqual(q('.a[1 2]'), { error: 'unexpected "2" in brackets', at: 5 });
  assert.deepEqual(q('.a["b]'), { error: 'unclosed string', at: 3 });
  assert.deepEqual(q('.a[::0]'), { error: "slice step can't be 0", at: 2 });
  assert.deepEqual(q('.#'), { error: 'unexpected "#"', at: 1 });
});

test('jsonpath: canonical paths', () => {
  assert.equal(J.pathOf([]), '$');
  assert.equal(J.pathOf(['store', 'book', 0, 'first name']), '$.store.book[0]["first name"]');
  assert.equal(J.pathOf(['a.b', '0', '_ok', '$x', '9lives', 'é']), '$["a.b"]["0"]._ok.$x["9lives"]["é"]');
  assert.equal(J.pathOf(['say "hi"']), '$["say \\"hi\\""]');
  // Every path a query gives back finds the same value again.
  for (const r of q('..*').results) assert.deepEqual(q(r.path).results, [r], r.path);
});
