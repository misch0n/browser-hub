import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../../js/lib/bytes.js';

const u8 = (...xs) => Uint8Array.from(xs.flatMap((x) => (typeof x === 'string' ? Array.from(x, (c) => c.charCodeAt(0)) : [x])));
const pad = (b, n) => { const out = new Uint8Array(Math.max(n, b.length)); out.set(b); return out; };

test('bytes: hexdump -C layout as data', () => {
  assert.deepEqual(B.dump(B.encode('Hello, world!')), {
    rows: [{ offset: '00000000', hex: '48 65 6c 6c 6f 2c 20 77  6f 72 6c 64 21         ', ascii: 'Hello, world!' }],
    total: 13, shown: 13,
  });
  const d = B.dump(B.encode('The quick brown fox\n\tjumps'), { width: 16 });
  assert.deepEqual(d.rows.map((r) => r.offset), ['00000000', '00000010']);
  assert.equal(d.rows[0].hex, '54 68 65 20 71 75 69 63  6b 20 62 72 6f 77 6e 20');
  assert.equal(d.rows[1].ascii, 'fox..jumps');
  assert.equal(d.rows[0].hex.length, d.rows[1].hex.length, 'the hex column is padded so ASCII lines up');
  const part = B.dump(new Uint8Array(100), { offset: 20, max: 30, width: 8 });
  assert.deepEqual([part.total, part.shown, part.rows.length, part.rows[0].offset, part.rows[3].offset], [100, 30, 4, '00000014', '0000002c']);
  assert.equal(part.rows[0].hex, '00 00 00 00  00 00 00 00');
  assert.deepEqual(B.dump(new Uint8Array(0)), { rows: [], total: 0, shown: 0 });
});

test('bytes: encode and decode in UTF-8, UTF-16 and Latin-1', () => {
  assert.deepEqual([...B.encode('é€')], [0xc3, 0xa9, 0xe2, 0x82, 0xac]);
  assert.deepEqual([...B.encode('Aé', 'utf16le')], [0x41, 0, 0xe9, 0]);
  assert.deepEqual([...B.encode('Aé', 'utf-16be')], [0, 0x41, 0, 0xe9]);
  assert.deepEqual([...B.encode('😀', 'utf16be')], [0xd8, 0x3d, 0xde, 0x00]);
  assert.deepEqual([...B.encode('café', 'latin1')], [0x63, 0x61, 0x66, 0xe9]);
  assert.match(B.encode('€', 'latin1').error, /'€' isn't in Latin-1/);
  assert.match(B.encode('x', 'ebcdic').error, /unknown encoding/);
  assert.equal(B.decode(u8(0x48, 0xff, 0x69)), 'H�i');
  assert.equal(B.decode(B.encode('héllo 😀')), 'héllo 😀');
  assert.equal(B.decode(B.encode('héllo 😀', 'utf16le'), 'utf16le'), 'héllo 😀');
  assert.equal(B.decode(B.encode('héllo 😀', 'utf16be'), 'utf16be'), 'héllo 😀');
  assert.equal(B.decode(u8(0x63, 0xe9, 0xff), 'latin1'), 'céÿ');
});

test('bytes: hex in all the usual spellings', () => {
  for (const s of ['48 65 6c', '48656c', '0x48,0x65,0x6c', '\\x48\\x65\\x6c', '48:65:6C', '  48, 65, 6c ', '0x48 0x65 0x6c']) {
    assert.deepEqual([...B.fromHex(s)], [0x48, 0x65, 0x6c], s);
  }
  assert.deepEqual([...B.fromHex('0x4,0xa')], [4, 10]);
  assert.match(B.fromHex('486').error, /odd number of hex digits/);
  assert.match(B.fromHex('48 zz').error, /'zz' isn't hex/);
  assert.match(B.fromHex('  ').error, /no hex digits/);
});

test('bytes: numbers in binary, negatives as two\'s complement, BigInt-sized', () => {
  assert.deepEqual(B.binary(255), { kind: 'number', value: '255', unsigned: '255', bits: '1111 1111', hex: 'ff', octal: '377', bytes: 1 });
  assert.deepEqual(B.binary('-1'), { kind: 'number', value: '-1', unsigned: '255', bits: '1111 1111', hex: 'ff', octal: '377', bytes: 1 });
  assert.equal(B.binary('0x1F').bits, '0001 1111');
  assert.equal(B.binary('0x1F').value, '31');
  assert.equal(B.binary('0b1010').value, '10');
  assert.equal(B.binary('0o17').value, '15');
  assert.equal(B.binary('1,000').hex, '03e8');
  const big = B.binary('18446744073709551616'); // 2^64
  assert.deepEqual([big.bytes, big.hex, big.bits.replace(/ /g, '')], [9, '010000000000000000', '1' + '0'.repeat(64)].map((x, i) => (i === 2 ? x.padStart(72, '0') : x)));
  assert.equal(B.binary(2n ** 64n - 1n).hex, 'ffffffffffffffff');
  assert.deepEqual([B.binary(-129).bytes, B.binary(-129).hex], [2, 'ff7f']);
  assert.deepEqual([B.binary(-128).bytes, B.binary('-9223372036854775808').bytes], [1, 8]);
  assert.match(B.binary('-9223372036854775809').error, /-2\^63/);
  assert.match(B.binary(1.5).error, /whole numbers/);
});

test('bytes: text in binary, byte by byte', () => {
  assert.deepEqual(B.binary('Hé'), { kind: 'text', chars: [
    { ch: 'H', bytes: [{ bin: '01001000', hex: '48', dec: 72 }] },
    { ch: 'é', bytes: [{ bin: '11000011', hex: 'c3', dec: 195 }, { bin: '10101001', hex: 'a9', dec: 169 }] },
  ] });
  assert.equal(B.binary('42', { text: true }).chars.length, 2);
  assert.equal(B.binary('1,2').kind, 'text');
  assert.equal(B.binary('😀').chars[0].bytes.length, 4);
  assert.match(B.binary('  ').error, /nothing/);
});

test('bytes: file types from magic numbers', () => {
  const zipEntry = (name, extra = '') => u8('PK', 3, 4, ...new Array(22).fill(0), name.length, 0, 0, 0, name + extra);
  const tar = new Uint8Array(512); tar.set(u8('ustar'), 257);
  const pe = new Uint8Array(128); pe.set(u8('MZ')); pe[60] = 64; pe.set(u8('PE', 0, 0), 64);
  const cases = [
    [u8(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 'IHDR'), 'PNG image', 'image/png', 'png'],
    [u8(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'JFIF'), 'JPEG image', 'image/jpeg', 'jpg'],
    [u8('GIF89a', 1, 0, 1, 0), 'GIF image', 'image/gif', 'gif'],
    [u8('GIF87a', 1, 0), 'GIF image', 'image/gif', 'gif'],
    [u8('RIFF', 0, 0, 0, 0, 'WEBPVP8 '), 'WebP image', 'image/webp', 'webp'],
    [u8('RIFF', 0, 0, 0, 0, 'WAVEfmt '), 'WAV audio', 'audio/wav', 'wav'],
    [pad(u8('BM', 0, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0, 40, 0, 0, 0), 30), 'BMP image', 'image/bmp', 'bmp'],
    [u8(0, 0, 1, 0, 1, 0, 16, 16), 'ICO icon', 'image/x-icon', 'ico'],
    [u8('II', 0x2a, 0, 8, 0, 0, 0), 'TIFF image', 'image/tiff', 'tiff'],
    [u8('MM', 0, 0x2a, 0, 0, 0, 8), 'TIFF image', 'image/tiff', 'tiff'],
    [u8('%PDF-1.7\n'), 'PDF document', 'application/pdf', 'pdf'],
    [zipEntry('hello.txt'), 'ZIP archive', 'application/zip', 'zip'],
    [zipEntry('[Content_Types].xml', '....word/document.xml'), 'Word document', /wordprocessingml/, 'docx'],
    [zipEntry('[Content_Types].xml', '....xl/workbook.xml'), 'Excel workbook', /spreadsheetml/, 'xlsx'],
    [zipEntry('[Content_Types].xml', '....ppt/presentation.xml'), 'PowerPoint presentation', /presentationml/, 'pptx'],
    [zipEntry('mimetype', 'application/epub+zip'), 'EPUB e-book', 'application/epub+zip', 'epub'],
    [zipEntry('META-INF/MANIFEST.MF'), 'Java archive', 'application/java-archive', 'jar'],
    [u8(0x1f, 0x8b, 8, 0), 'gzip archive', 'application/gzip', 'gz'],
    [u8('BZh91AY&SY'), 'bzip2 archive', 'application/x-bzip2', 'bz2'],
    [u8(0xfd, '7zXZ', 0), 'xz archive', 'application/x-xz', 'xz'],
    [u8('7z', 0xbc, 0xaf, 0x27, 0x1c, 0, 4), '7-Zip archive', 'application/x-7z-compressed', '7z'],
    [u8('Rar!', 0x1a, 7, 1, 0), 'RAR archive', 'application/vnd.rar', 'rar'],
    [tar, 'tar archive', 'application/x-tar', 'tar'],
    [u8(0x7f, 'ELF', 2, 1, 1), 'ELF executable', 'application/x-elf', ''],
    [u8(0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1), 'Mach-O executable', 'application/x-mach-binary', ''],
    [u8(0xfe, 0xed, 0xfa, 0xce), 'Mach-O executable', 'application/x-mach-binary', ''],
    [u8(0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2), 'Mach-O universal binary', 'application/x-mach-binary', ''],
    [u8(0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 61), 'Java class file', 'application/java-vm', 'class'],
    [pe, 'Windows executable', 'application/vnd.microsoft.portable-executable', 'exe'],
    [u8('MZ', 0x90, 0), 'DOS/Windows executable', 'application/x-msdownload', 'exe'],
    [u8(0, 'asm', 1, 0, 0, 0), 'WebAssembly module', 'application/wasm', 'wasm'],
    [u8('SQLite format 3', 0, 16, 0), 'SQLite database', 'application/vnd.sqlite3', 'sqlite'],
    [u8('ID3', 4, 0), 'MP3 audio', 'audio/mpeg', 'mp3'],
    [u8(0xff, 0xfb, 0x90, 0x64), 'MP3 audio', 'audio/mpeg', 'mp3'],
    [u8(0, 0, 0, 0x18, 'ftypmp42'), 'MP4 video', 'video/mp4', 'mp4'],
    [u8(0, 0, 0, 0x14, 'ftypqt  '), 'QuickTime movie', 'video/quicktime', 'mov'],
    [u8(0, 0, 0, 0x18, 'ftypheic'), 'HEIC image', 'image/heic', 'heic'],
    [u8('OggS', 0, 2), 'Ogg media', 'audio/ogg', 'ogg'],
    [u8('fLaC', 0), 'FLAC audio', 'audio/flac', 'flac'],
    [u8('MThd', 0, 0, 0, 6), 'MIDI music', 'audio/midi', 'mid'],
    [u8('wOFF', 0, 1), 'WOFF font', 'font/woff', 'woff'],
    [u8('wOF2', 0, 1), 'WOFF2 font', 'font/woff2', 'woff2'],
    [u8('OTTO', 0, 9), 'OpenType font', 'font/otf', 'otf'],
    [u8(0, 1, 0, 0, 0, 12), 'TrueType font', 'font/ttf', 'ttf'],
    [u8(0xef, 0xbb, 0xbf, 'hi'), 'UTF-8 text', 'text/plain', 'txt'],
    [u8(0xff, 0xfe, 'h', 0), 'UTF-16 text', 'text/plain', 'txt'],
    [u8(0xfe, 0xff, 0, 'h'), 'UTF-16 text', 'text/plain', 'txt'],
    [B.encode('just some words\nand a line\n'), 'ASCII text', 'text/plain', 'txt'],
    [B.encode('naïve café ✓'), 'UTF-8 text', 'text/plain', 'txt'],
    [B.encode('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'SVG image', 'image/svg+xml', 'svg'],
    [B.encode('<!DOCTYPE html><html>'), 'HTML document', 'text/html', 'html'],
  ];
  for (const [bytes, type, mime, ext] of cases) {
    const got = B.sniff(bytes);
    assert.ok(got, 'nothing found for ' + type);
    assert.equal(got.type, type);
    if (mime instanceof RegExp) assert.match(got.mime, mime); else assert.equal(got.mime, mime, type);
    assert.equal(got.ext, ext, type);
  }
  assert.equal(B.sniff(u8(0xcf, 0xfa, 0xed, 0xfe)).note, '64-bit, little-endian');
  assert.equal(B.sniff(u8(0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 61)).note, 'version 61');
  assert.match(B.sniff(zipEntry('[Content_Types].xml', 'word/')).note, /ZIP container/);
  assert.equal(B.sniff(new Uint8Array(0)), null);
  assert.equal(B.sniff(u8(0, 0, 0, 0, 0, 0, 0, 0)), null, 'binary noise is not text');
  assert.equal(B.sniff(u8(0x80, 0x81, 0x82, 0xfe)), null);
  assert.equal(B.sniff(B.encode('ok ✓ ✓').subarray(0, 9)).type, 'UTF-8 text', 'a character cut off at the end is still text');
});
