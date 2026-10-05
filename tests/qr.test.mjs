// QR codes made by js/lib/qr.js, read back by an independent decoder (jsQR).
// Needs jsQR: npm install --no-save --no-package-lock jsqr@1.4.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { encodeQR, qrPath, QR_MAX_BYTES, alignmentPositions } from '../js/lib/qr.js';

const jsQR = createRequire(import.meta.url)('jsqr');

// The symbol as RGBA pixels: `scale` pixels per module, a 4-module light border.
function decode(q, scale = 3) {
  const n = (q.size + 8) * scale;
  const px = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < q.size; y++) {
    for (let x = 0; x < q.size; x++) {
      if (!q.modules[y][x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + 4) * scale + dy) * n + (x + 4) * scale + dx) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
      }
    }
  }
  const r = jsQR(px, n, n, { inversionAttempts: 'dontInvert' });
  return r && { text: r.data, version: r.version };
}

test('qr: decodes back to the same text, at every level and mask', () => {
  for (const text of ['hi', 'https://example.com/a/path?q=1', 'Grüße, мир, 日本 ✓ 🎉', 'x'.repeat(100)]) {
    for (const ecl of ['L', 'M', 'Q', 'H']) {
      for (let mask = 0; mask < 8; mask++) {
        const q = encodeQR(text, { ecl, mask, exact: true });
        assert.equal(q.ecl, ecl);
        assert.equal(decode(q)?.text, text, text + ' ' + ecl + ' mask ' + mask);
      }
    }
  }
});

test('qr: every version, chosen by length; the best mask; levels raised for free', () => {
  const seen = new Set();
  for (let n = 1; n <= QR_MAX_BYTES; n = Math.ceil(n * 1.12) + 1) {
    const text = Array.from({ length: n }, (_, i) => 'abcdefghijklmnopqrstuvwxyz0123456789'[(i * 7 + n) % 36]).join('');
    for (const ecl of ['L', 'H']) {
      let q;
      try { q = encodeQR(text, { ecl, exact: true }); } catch (e) { assert.match(e.message, /too long/); continue; }
      seen.add(q.version);
      assert.equal(q.size, q.version * 4 + 17);
      // jsQR 1.4.0 has version 23's alignment patterns at 74 instead of 78; at
      // level L there is too little redundancy for it to read past that.
      if (q.version === 23 && q.ecl === 'L') continue;
      const got = decode(q, q.version > 20 ? 2 : 3);
      assert.equal(got?.text, text, 'length ' + n + ' ' + ecl);
      assert.equal(got.version, q.version);
    }
  }
  assert.ok(seen.size >= 30, 'versions covered: ' + [...seen].sort((a, b) => a - b).join(','));
  // Exactly at the limits.
  assert.equal(encodeQR('a'.repeat(QR_MAX_BYTES), { ecl: 'L' }).version, 40);
  assert.throws(() => encodeQR('a'.repeat(QR_MAX_BYTES + 1), { ecl: 'L' }), /too long for a QR code: 2954 bytes \(at most 2953 at level L\)/);
  assert.equal(encodeQR('a'.repeat(17), { ecl: 'L', exact: true }).version, 1); // v1-L holds 17 bytes
  assert.equal(encodeQR('a'.repeat(18), { ecl: 'L', exact: true }).version, 2);
  // Default level M, raised when it costs nothing: 'hi' fits version 1 at H.
  assert.equal(encodeQR('hi').ecl, 'H');
  assert.equal(encodeQR('a'.repeat(14)).ecl, 'M'); // v1: M holds 14, Q holds 11
  assert.throws(() => encodeQR('x', { ecl: 'Z' }), /L, M, Q or H/);
  // The chosen mask is deterministic and decodes.
  const a = encodeQR('https://misch0n.github.io/browser-hub/');
  assert.deepEqual(encodeQR('https://misch0n.github.io/browser-hub/').modules, a.modules);
  assert.equal(decode(a).text, 'https://misch0n.github.io/browser-hub/');
});

test('qr: alignment pattern positions match the standard\'s table', () => {
  assert.deepEqual(alignmentPositions(1), []);
  assert.deepEqual(alignmentPositions(2), [6, 18]);
  assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
  assert.deepEqual(alignmentPositions(23), [6, 30, 54, 78, 102]);
  assert.deepEqual(alignmentPositions(32), [6, 34, 60, 86, 112, 138]);
  assert.deepEqual(alignmentPositions(36), [6, 24, 50, 76, 102, 128, 154]);
  assert.deepEqual(alignmentPositions(40), [6, 30, 58, 86, 114, 142, 170]);
});

test('qr: the SVG path draws runs of dark modules inside the quiet zone', () => {
  assert.equal(qrPath([[true, true, false], [false, true, false], [false, false, false]], 4), 'M4 4h2v1h-2zM5 5h1v1h-1z');
});
