// Barcodes made by js/lib/barcode.js, read back by an independent decoder (ZXing).
// Needs: npm install --no-save --no-package-lock jsqr@1.4.0 @zxing/library
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { encodeBarcode, barcodeSvg, barcodeWidth, BARCODE_TYPES, mod10 } from '../js/lib/barcode.js';

const require = createRequire(import.meta.url);
const zx = require('@zxing/library');
const EAN8Reader = require('@zxing/library/cjs/core/oned/EAN8Reader.js').default;
const UPCAReader = require('@zxing/library/cjs/core/oned/UPCAReader.js').default;

// The symbol as a grey-scale image: `px` pixels per module, quiet zones white.
function decode(result, reader, { px = 2, hints } = {}) {
  const width = (result.modules.length + 2 * result.quietZone) * px;
  const height = 8;
  const lum = new Uint8ClampedArray(width * height).fill(255);
  for (let y = 0; y < height; y++) {
    result.modules.forEach((m, x) => {
      if (m) lum.fill(0, y * width + (x + result.quietZone) * px, y * width + (x + result.quietZone + 1) * px);
    });
  }
  const bitmap = new zx.BinaryBitmap(new zx.GlobalHistogramBinarizer(new zx.RGBLuminanceSource(lum, width, height)));
  try {
    return reader.decode(bitmap, hints).getText();
  } catch (e) {
    return null;
  }
}
const hint = (key, value) => new Map([[key, value]]);

// Runs of equal modules: bar and space widths.
function widths(modules) {
  const out = [];
  modules.forEach((m, i) => { if (i && m === modules[i - 1]) out[out.length - 1]++; else out.push(1); });
  return out;
}

test('barcode: types listed and resolved', () => {
  assert.deepEqual(BARCODE_TYPES.map((t) => t.id), ['code128', 'code39', 'ean13', 'ean8', 'upca', 'itf', 'codabar']);
  for (const t of BARCODE_TYPES) assert.ok(t.name && t.chars);
  assert.equal(encodeBarcode('EAN-13', '590123412345').type, 'ean13');
  assert.equal(encodeBarcode('UPC', '03600029145').type, 'upca');
  assert.equal(encodeBarcode('Code_128', 'x').type, 'code128');
  assert.throws(() => encodeBarcode('pdf417', 'x'), /unknown barcode type "pdf417" \(try code128, /);
  for (const t of BARCODE_TYPES) assert.throws(() => encodeBarcode(t.id, ''), /nothing to encode/);
});

test('code128: decodes back, whatever the mix of code sets', () => {
  const reader = new zx.Code128Reader();
  const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('') + '\x7f';
  const control = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join('');
  const inputs = [
    'x', '1', '12', '123', '1234', '12345', '0000', '00000000000000000001', '9876543210987',
    'Hello, World!', 'hello world', 'abc123', 'abc1234', 'abc12345def', '1234abcd', 'a1b2c3d4',
    'ABC-123/456.789', 'https://example.com/?q=a&b=c#x', '~`!@#$%^&*()_+{}|:"<>?[]\\;\',./',
    'PJJ123C', 'tab\there', 'line\r\nbreak', '\x00\x01NUL', 'mix\x1flow\x7fhigh', 'a\tb\tc', 'A\nb\nC',
    'Ab12\x0334567cD\x04', ascii, control, control + ascii + control,
  ];
  // Every value of set C, as digit pairs.
  for (let i = 0; i < 100; i += 10) inputs.push(Array.from({ length: 10 }, (_, k) => String(i + k).padStart(2, '0')).join(''));
  for (const text of inputs) {
    const r = encodeBarcode('code128', text);
    assert.equal(r.text, text);
    assert.equal(r.quietZone, 10);
    assert.ok(r.modules.every((m) => m === 0 || m === 1));
    assert.equal((r.modules.length - 2) % 11, 0); // 11 per symbol, stop is 13
    assert.equal(decode(r, reader), text, JSON.stringify(text));
  }
});

test('code128: the bar patterns match ZXing\'s table, and the symbols are as short as they get', () => {
  // The round trips use them all; this pins each to ZXing's table exactly.
  const P = zx.Code128Reader.CODE_PATTERNS;
  const symbol = (text, k) => widths(encodeBarcode('code128', text).modules.slice(11 * k, 11 * k + 11));
  for (let v = 0; v < 100; v++) assert.deepEqual(symbol(String(v).padStart(2, '0'), 1), [...P[v]], 'value ' + v);
  assert.deepEqual(symbol('1234a', 3), [...P[100]]); // set C -> B
  assert.deepEqual(symbol('1234\n', 3), [...P[101]]); // set C -> A
  assert.deepEqual(symbol('a\nb', 2), [...P[98]]); // shift
  assert.deepEqual(symbol('\n', 0), [...P[103]]); // start A
  assert.deepEqual(symbol('a', 0), [...P[104]]); // start B
  assert.deepEqual(symbol('12', 0), [...P[105]]); // start C
  const stop = encodeBarcode('code128', 'a').modules.slice(-13);
  assert.deepEqual(widths(stop), [...P[106]]); // 2331112, with the final bar
  // Lengths in symbols (start + data + check + stop): set C halves digit runs.
  const symbols = (t) => (encodeBarcode('code128', t).modules.length - 2) / 11;
  assert.equal(symbols('12'), 1 + 1 + 2);
  assert.equal(symbols('1234567890'), 1 + 5 + 2);
  assert.equal(symbols('123456789'), 1 + 4 + 1 + 1 + 2); // C, then switch for the odd digit
  assert.equal(symbols('abc'), 1 + 3 + 2);
  assert.equal(symbols('abc123456'), 1 + 3 + 1 + 3 + 2);
  assert.equal(symbols('a\nb'), 1 + 1 + 2 + 1 + 2); // a shift, not two switches
  assert.equal(symbols('\n\n\n'), 1 + 3 + 2); // straight into set A
});

test('code128: the reference symbol PJJ123C has check value 55', () => {
  // Start B 104 + 1*48 + 2*42 + 3*42 + 4*17 + 5*18 + 6*19 + 7*35 = 879 = 8*103 + 55.
  const r = encodeBarcode('code128', 'PJJ123C');
  assert.equal(r.modules.length, 11 * 9 + 13);
  assert.equal(r.modules.slice(-24, -13).join(''), '11101000110'); // value 55: 311321
  assert.equal(r.modules.slice(0, 11).join(''), '11010010000'); // Start B
  assert.equal(r.modules.slice(-13).join(''), '1100011101011'); // stop
});

test('code128: rejects non-ASCII', () => {
  assert.throws(() => encodeBarcode('code128', 'café'), /Code 128 can only encode ASCII \(not "é"\)/);
  assert.throws(() => encodeBarcode('code128', '🎉'), /not "🎉"/);
});

test('code39: decodes back, with and without the mod-43 check', () => {
  const plain = new zx.Code39Reader();
  const checked = new zx.Code39Reader(true);
  const all = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
  for (const text of ['A', '0', 'CODE39', 'CODE 39', 'HELLO-WORLD', '$12.50', 'A/B+C%D', all, '1234567890', 'Z.Z']) {
    const r = encodeBarcode('code39', text);
    assert.equal(r.text, text);
    assert.equal(decode(r, plain), text, text);
    const c = encodeBarcode('code39', text, { check: true });
    assert.equal(c.text.length, text.length + 1);
    assert.equal(c.text.slice(0, -1), text);
    // ZXing verifies the check character and strips it.
    assert.equal(decode(c, checked), text, text + ' (checked)');
    assert.equal(decode(c, plain), c.text);
  }
  // Lowercase is read as uppercase.
  assert.equal(encodeBarcode('code39', 'abc').text, 'ABC');
  // C 12 + O 24 + D 13 + E 14 + space 38 + 3 + 9 = 113 = 2*43 + 27 -> 'R'.
  assert.equal(encodeBarcode('code39', 'CODE 39', { check: true }).text, 'CODE 39R');
  // * is bWbwBwBwb: narrow bar, wide space, ...
  assert.deepEqual(widths(encodeBarcode('code39', 'A').modules).slice(0, 10), [1, 3, 1, 1, 3, 1, 3, 1, 1, 1]);
  assert.throws(() => encodeBarcode('code39', 'a@b'), /Code 39 can't encode "@"/);
  assert.throws(() => encodeBarcode('code39', '*A*'), /can't encode "\*"/);
});

test('code39: the bar patterns match ZXing\'s table', () => {
  const all = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
  const w = widths(encodeBarcode('code39', all).modules);
  // Skip the start and its gap; then 9 elements + gap per character.
  for (let i = 0; i < all.length; i++) {
    const el = w.slice(10 * (i + 1), 10 * (i + 1) + 9);
    const bitsOf = el.reduce((acc, x) => (acc << 1) | (x === 3 ? 1 : 0), 0);
    assert.equal(bitsOf, zx.Code39Reader.CHARACTER_ENCODINGS[zx.Code39Reader.ALPHABET_STRING.indexOf(all[i])], all[i]);
  }
});

test('ean13: computes or verifies the check digit; decodes back', () => {
  const reader = new zx.EAN13Reader();
  assert.equal(encodeBarcode('ean13', '590123412345').text, '5901234123457');
  assert.equal(encodeBarcode('ean13', '400638133393').text, '4006381333931');
  assert.equal(encodeBarcode('ean13', '978030640615').text, '9780306406157'); // an ISBN
  assert.equal(encodeBarcode('ean13', '5901234123457').text, '5901234123457');
  assert.equal(encodeBarcode('ean13', '590123 412345-7').text, '5901234123457');
  assert.throws(() => encodeBarcode('ean13', '5901234123450'), /^Error: the check digit should be 7$/);
  assert.throws(() => encodeBarcode('ean13', '12345'), /^Error: EAN-13 takes 12 or 13 digits$/);
  assert.throws(() => encodeBarcode('ean13', '59012341234a'), /EAN-13 takes 12 or 13 digits/);
  const r = encodeBarcode('ean13', '590123412345');
  assert.equal(r.modules.length, 95);
  assert.equal(r.quietZone, 11);
  assert.equal(decode(r, reader), '5901234123457');
  // Every leading digit (every parity pattern) and every digit in every place.
  for (let first = 0; first < 10; first++) {
    for (let k = 0; k < 10; k++) {
      const data = String(first) + Array.from({ length: 11 }, (_, i) => (i * 3 + k * 7 + first) % 10).join('');
      const e = encodeBarcode('ean13', data);
      assert.equal(e.text, data + mod10(data));
      assert.equal(decode(e, reader), e.text, data);
    }
  }
});

test('ean8 and upca: check digits and round trips', () => {
  const ean8 = new EAN8Reader();
  const upc = new UPCAReader();
  assert.equal(encodeBarcode('ean8', '9638507').text, '96385074');
  assert.equal(encodeBarcode('ean8', '96385074').text, '96385074');
  assert.throws(() => encodeBarcode('ean8', '96385070'), /the check digit should be 4/);
  assert.throws(() => encodeBarcode('ean8', '963850'), /EAN-8 takes 7 or 8 digits/);
  assert.equal(encodeBarcode('ean8', '9638507').modules.length, 67);
  assert.equal(encodeBarcode('upca', '03600029145').text, '036000291452');
  assert.equal(encodeBarcode('upca', '036000291452').text, '036000291452');
  assert.throws(() => encodeBarcode('upca', '036000291453'), /the check digit should be 2/);
  assert.throws(() => encodeBarcode('upca', '0360002914'), /UPC-A takes 11 or 12 digits/);
  // A UPC-A is the EAN-13 with a leading zero, bar for bar.
  assert.deepEqual(encodeBarcode('upca', '03600029145').modules, encodeBarcode('ean13', '003600029145').modules);
  for (let k = 0; k < 40; k++) {
    const d7 = Array.from({ length: 7 }, (_, i) => (i * 7 + k * 3 + (k >> 2)) % 10).join('');
    const e = encodeBarcode('ean8', d7);
    assert.equal(decode(e, ean8), e.text, d7);
    const d11 = Array.from({ length: 11 }, (_, i) => (i * 3 + k * 7 + (k >> 3)) % 10).join('');
    const u = encodeBarcode('upca', d11);
    assert.equal(u.text, d11 + mod10(d11));
    assert.equal(decode(u, upc), u.text, d11);
  }
});

test('itf: even digit counts, optional check digit, decodes back', () => {
  const reader = new zx.ITFReader();
  const hints = hint(zx.DecodeHintType.ALLOWED_LENGTHS, Int32Array.from({ length: 40 }, (_, i) => 2 * i + 2));
  for (const text of ['00', '12', '1234', '123456', '00123456', '9876543210', '0123456789012345678901234567890123456789']) {
    const r = encodeBarcode('itf', text);
    assert.equal(r.text, text);
    assert.equal(decode(r, reader, { hints }), text, text);
  }
  for (let n = 1; n <= 9; n++) {
    for (let k = 0; k < 10; k++) {
      const pairs = Array.from({ length: n * 2 }, (_, i) => (i * 7 + k * 3 + n) % 10).join('');
      assert.equal(decode(encodeBarcode('itf', pairs), reader, { hints }), pairs, pairs);
    }
  }
  // Odd length plus a check digit: 1234567 -> weights 3,1,3,... from the right
  // 7*3 + 6 + 5*3 + 4 + 3*3 + 2 + 1*3 = 60 -> 0.
  const c = encodeBarcode('itf', '1234567', { check: true });
  assert.equal(c.text, '12345670');
  assert.equal(decode(c, reader, { hints }), '12345670');
  assert.equal(encodeBarcode('itf', '0001234', { check: true }).text, '0001234' + mod10('0001234'));
  // ITF-14 from a GTIN-13 with indicator 1: 1540014128876 -> sum 97 -> check 3.
  assert.equal(encodeBarcode('itf', '1540014128876', { check: true }).text, '15400141288763');
  assert.throws(() => encodeBarcode('itf', '123'), /^Error: ITF needs an even number of digits$/);
  assert.throws(() => encodeBarcode('itf', '1234', { check: true }), /ITF needs an odd number of digits when it adds a check digit/);
  assert.throws(() => encodeBarcode('itf', '12a4'), /ITF takes digits only/);
  // Narrow:wide is 1:3; start is four narrow elements, stop wide-narrow-narrow.
  const w = widths(encodeBarcode('itf', '12').modules);
  assert.deepEqual(w.slice(0, 4), [1, 1, 1, 1]);
  assert.deepEqual(w.slice(-3), [3, 1, 1]);
  assert.deepEqual(w.slice(4, 14), [3, 1, 1, 3, 1, 1, 1, 1, 3, 3]); // 1 = WNNNW bars, 2 = NWNNW spaces
});

test('codabar: start/stop letters, defaults, decodes back', () => {
  const reader = new zx.CodaBarReader();
  assert.equal(encodeBarcode('codabar', '123').text, 'A123A');
  assert.equal(encodeBarcode('codabar', 'b12-34d').text, 'B12-34D');
  // ZXing-js returns the start and stop letters as part of the text.
  // (Its table has a wrong entry for "+" (nnwwwww), so "+" is checked against
  // the published pattern below instead.)
  const inputs = ['123', '0', '0123456789', 'A40156B', 'C1-2$3:4/5.6D', 'D9876543210C', 'B$1.25A', '31117013206375', '12:30/45-6'];
  for (const text of inputs) {
    const r = encodeBarcode('codabar', text);
    assert.equal(decode(r, reader), r.text, text);
  }
  for (let k = 0; k < 40; k++) {
    const body = Array.from({ length: 2 + (k % 12) }, (_, i) => '0123456789-$:/.'[(i * 5 + k * 7) % 15]).join('');
    const start = 'ABCD'[k % 4], stop = 'ABCD'[(k >> 2) % 4];
    const r = encodeBarcode('codabar', start + body + stop);
    assert.equal(decode(r, reader), start + body + stop);
  }
  // Published patterns (bar first, n = narrow, w = wide): "+" is nnwnwnw, "A" nnwwnwn.
  const w = widths(encodeBarcode('codabar', 'A+A').modules);
  assert.deepEqual(w.slice(0, 8), [1, 1, 3, 3, 1, 3, 1, 1]);
  assert.deepEqual(w.slice(8, 15), [1, 1, 3, 1, 3, 1, 3]);
  assert.throws(() => encodeBarcode('codabar', 'A123'), /needs both a start and a stop letter/);
  assert.throws(() => encodeBarcode('codabar', '12A3'), /Codabar can't encode "A"/);
  assert.throws(() => encodeBarcode('codabar', '12x'), /Codabar can't encode "X"/);
  assert.throws(() => encodeBarcode('codabar', 'AB'), /nothing to encode/);
});

test('barcode: decodes at one and three pixels per module too', () => {
  const cases = [
    ['code128', 'Hello 12345678', new zx.Code128Reader()],
    ['code39', 'CODE 39', new zx.Code39Reader()],
    ['ean13', '5901234123457', new zx.EAN13Reader()],
    ['itf', '12345678', new zx.ITFReader()],
    ['codabar', 'A1234B', new zx.CodaBarReader()],
  ];
  for (const px of [1, 3]) {
    for (const [type, text, reader] of cases) {
      assert.equal(decode(encodeBarcode(type, text), reader, { px }), text, type + ' at ' + px + 'px');
    }
  }
});

test('barcodeSvg: background, merged bars, escaped text', () => {
  const r = encodeBarcode('code128', 'a<b>&"c\'\x01');
  const svg = barcodeSvg(r);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="(\d+)" height="[\d.]+" viewBox="0 0 \1 [\d.]+">/);
  assert.match(svg, /<rect width="100%" height="100%" fill="#fff"\/>/);
  assert.equal(svg.match(/<path /g).length, 1);
  assert.ok(svg.includes('>a&lt;b&gt;&amp;&quot;c&#39;␁</text>'));
  assert.ok(!/[\x00-\x08]/.test(svg));
  // Width: modules plus the quiet zone each side, at 2 px a module.
  assert.equal(barcodeWidth(r), (r.modules.length + 20) * 2);
  assert.ok(svg.includes('width="' + barcodeWidth(r) + '"'));
  // One rectangle per bar (adjacent bar modules merged), each its own width.
  const rects = [...svg.matchAll(/M([\d.]+) ([\d.]+)h([\d.]+)v60h-\3z/g)];
  const bars = widths(r.modules).filter((_, i) => i % 2 === 0);
  assert.equal(rects.length, bars.length);
  assert.deepEqual(rects.map((m) => Number(m[3])), bars.map((b) => b * 2));
  assert.equal(Number(rects[0][1]), 20); // starts after the quiet zone

  const custom = barcodeSvg(encodeBarcode('ean13', '590123412345'), { height: 40, scale: 1.5, margin: 2, text: false, font: 'x"y' });
  assert.ok(!custom.includes('<text'));
  assert.ok(custom.includes('width="148.5"')); // (95 + 4) * 1.5
  assert.match(custom, /v40h/);
  const font = barcodeSvg(encodeBarcode('ean13', '590123412345'), { font: 'a"<b' });
  assert.ok(font.includes('font-family="a&quot;&lt;b"'));
  assert.ok(font.includes('>5901234123457</text>'));
  assert.equal(barcodeWidth(encodeBarcode('ean8', '9638507'), { scale: 3, margin: 0 }), 67 * 3);
});
