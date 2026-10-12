import test from 'node:test';
import assert from 'node:assert/strict';
import { extractUrls } from '../../js/lib/links.js';
import { makeApp } from '../helpers.mjs';

const PASTE = `Apple (Bulgaria) - Official Site
https://www.apple.com/bg/
Alien (film) - Wikipedia
https://en.wikipedia.org/wiki/Alien_(film)
GitHub · misch0n/browser-hub https://github.com/misch0n/browser-hub/actions, see (https://example.com/a?b=1&c=2).
www.example.org/path; and again https://www.apple.com/bg/
javascript:alert(1) file:///etc/passwd ftp://x.org localhost:3000 http://intranet`;

test('links: addresses out of pasted text, in order, once, without the punctuation around them', () => {
  const r = extractUrls(PASTE);
  assert.deepEqual(r.urls, [
    'https://www.apple.com/bg/',
    'https://en.wikipedia.org/wiki/Alien_(film)',
    'https://github.com/misch0n/browser-hub/actions',
    'https://example.com/a?b=1&c=2',
    'https://www.example.org/path',
  ]);
  assert.equal(r.duplicates, 1);
  assert.deepEqual(extractUrls('nothing here, just Node.js and v1.2').urls, []);
});

test('tabs: the addresses as a list to open; nothing found says so', async () => {
  const app = await makeApp();
  const out = await app.run('tabs ' + PASTE);
  assert.equal(out[0], '# 5 addresses · 1 duplicate left out');
  assert.equal(out.tone, 'ok');
  assert.equal(out[1], 'TABS https://www.apple.com/bg/ https://en.wikipedia.org/wiki/Alien_(film) https://github.com/misch0n/browser-hub/actions https://example.com/a?b=1&c=2 https://www.example.org/path');
  assert.equal(out.copied.split('\n').length, 5);
  assert.match((await app.run('tabs just some words'))[0], /^err: No web addresses/);
  assert.match((await app.run('tabs'))[0], /Usage/);
});
