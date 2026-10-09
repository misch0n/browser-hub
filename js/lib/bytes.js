// Byte inspection: text to bytes and back, hex dumps, hex parsing, numbers and
// text in binary, and file types from their magic numbers. Pure, no DOM.
//   encode(text, enc)       -> Uint8Array | { error }   enc: utf8 (default), utf16le, utf16be, latin1
//   decode(bytes, enc)      -> string                   bad UTF-8 becomes U+FFFD
//   dump(bytes, { offset, width, max }) -> { rows: [{ offset, hex, ascii }], total, shown }
//   fromHex(s)              -> Uint8Array | { error }   '48 65', '4865', '0x48,0x65', '\x48\x65', '48:65'
//   binary(input, { text }) -> { kind: 'number', value, unsigned, bits, hex, octal, bytes }
//                            | { kind: 'text', chars: [{ ch, bytes: [{ bin, hex, dec }] }] } | { error }
//   sniff(bytes)            -> { type, mime, ext, note? } | null

const ENCODINGS = ['utf8', 'utf16le', 'utf16be', 'latin1'];
const normEnc = (enc = 'utf8') => String(enc).toLowerCase().replace(/[-_ ]/g, '').replace(/^(iso88591|binary)$/, 'latin1');
const hex2 = (b) => b.toString(16).padStart(2, '0');

export function encode(text, enc) {
  const e = normEnc(enc), s = String(text);
  if (e === 'utf8') return new TextEncoder().encode(s);
  if (e === 'utf16le' || e === 'utf16be') {
    const out = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i), [a, b] = [c & 0xff, c >> 8];
      out[2 * i] = e === 'utf16le' ? a : b;
      out[2 * i + 1] = e === 'utf16le' ? b : a;
    }
    return out;
  }
  if (e === 'latin1') {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c > 0xff) return { error: `'${String.fromCodePoint(s.codePointAt(i))}' isn't in Latin-1` };
      out[i] = c;
    }
    return out;
  }
  return { error: `unknown encoding '${enc}' (${ENCODINGS.join(', ')})` };
}

export function decode(bytes, enc) {
  const e = normEnc(enc), b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (e === 'utf8') return new TextDecoder('utf-8').decode(b);
  if (e === 'latin1') { let s = ''; for (const x of b) s += String.fromCharCode(x); return s; }
  if (e === 'utf16le' || e === 'utf16be') {
    let s = '';
    for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(e === 'utf16le' ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
    return s + (b.length % 2 ? '�' : '');
  }
  throw new Error(`unknown encoding '${enc}'`);
}

// A hexdump -C layout as data. The hex column is padded to full width so the
// ASCII column lines up; for widths of 8 or more it splits into two halves.
export function dump(bytes, { offset = 0, width = 16, max } = {}) {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  width = Math.max(1, Math.min(64, Math.floor(width) || 16));
  const start = Math.max(0, Math.min(b.length, Math.floor(offset) || 0));
  const end = max == null ? b.length : Math.min(b.length, start + Math.max(0, Math.floor(max)));
  const half = width >= 8 && width % 2 === 0 ? width / 2 : 0;
  const cells = (row) => Array.from({ length: width }, (_, i) => (i < row.length ? hex2(row[i]) : '  '));
  const join = (c) => (half ? c.slice(0, half).join(' ') + '  ' + c.slice(half).join(' ') : c.join(' '));
  const rows = [];
  for (let at = start; at < end; at += width) {
    const row = b.subarray(at, Math.min(end, at + width));
    rows.push({
      offset: at.toString(16).padStart(8, '0'),
      hex: join(cells(row)),
      ascii: Array.from(row, (x) => (x >= 0x20 && x <= 0x7e ? String.fromCharCode(x) : '.')).join(''),
    });
  }
  return { rows, total: b.length, shown: end - start };
}

export function fromHex(s) {
  const tokens = String(s).trim().split(/\\x|[\s,:;]+/).filter(Boolean);
  let digits = '';
  for (let t of tokens) {
    const prefixed = /^0x/i.test(t);
    if (prefixed) t = t.slice(2);
    if (!/^[0-9a-f]+$/i.test(t)) return { error: `'${t}' isn't hex` };
    digits += prefixed && t.length % 2 ? '0' + t : t;
  }
  if (!digits) return { error: 'no hex digits' };
  if (digits.length % 2) return { error: `odd number of hex digits (${digits.length})` };
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(digits.slice(2 * i, 2 * i + 2), 16);
  return out;
}

// ---- binary -------------------------------------------------------------------------

const NUMBER = /^([+-]?)(0x[0-9a-f_]+|0b[01_]+|0o[0-7_]+|\d{1,3}(?:,\d{3})+|\d[\d_]*)$/i;
const nibbles = (s) => s.replace(/(.{4})(?=.)/g, '$1 ');

// A number (decimal, 0x, 0b, 0o; any size up to 1024 bits) or text, byte by byte.
// Negative numbers show as two's complement in the smallest of 8/16/32/64 bits.
export function binary(input, { text = false } = {}) {
  const s = typeof input === 'bigint' || typeof input === 'number' ? String(input) : String(input ?? '').trim();
  if (typeof input === 'number' && !Number.isSafeInteger(input)) return { error: 'whole numbers only' };
  const m = !text && NUMBER.exec(s);
  if (!m) {
    if (!s) return { error: 'nothing to show' };
    const enc = new TextEncoder();
    return { kind: 'text', chars: Array.from(s, (ch) => ({ ch, bytes: Array.from(enc.encode(ch), (d) => ({ bin: d.toString(2).padStart(8, '0'), hex: hex2(d), dec: d })) })) };
  }
  const digits = m[2].replace(/[_,]/g, '');
  const v = (m[1] === '-' ? -1n : 1n) * BigInt(/^0[xbo]/i.test(digits) ? digits.toLowerCase() : digits.replace(/^0+(?=\d)/, ''));
  let pattern, width;
  if (v < 0n) {
    width = [8, 16, 32, 64].find((w) => v >= -(1n << BigInt(w - 1)));
    if (!width) return { error: 'too small: negative numbers go down to -2^63' };
    pattern = (1n << BigInt(width)) + v;
  } else {
    if (v >= 1n << 1024n) return { error: 'too large: at most 1024 bits' };
    pattern = v;
    width = Math.max(8, Math.ceil(v.toString(2).length / 8) * 8);
  }
  return {
    kind: 'number', value: v.toString(), unsigned: pattern.toString(),
    bits: nibbles(pattern.toString(2).padStart(width, '0')),
    hex: pattern.toString(16).padStart(width / 4, '0'), octal: pattern.toString(8), bytes: width / 8,
  };
}

// ---- file types ---------------------------------------------------------------------

const ascii = (b, at, n) => String.fromCharCode(...b.subarray(at, at + n));
const has = (b, at, ...xs) => b.length >= at + xs.length && xs.every((x, i) => (typeof x === 'string' ? x.charCodeAt(0) : x) === b[at + i]);
const str = (b, at, s) => b.length >= at + s.length && ascii(b, at, s.length) === s;
const u32be = (b, at) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const t = (type, mime, ext, note) => (note ? { type, mime, ext, note } : { type, mime, ext });

function zip(b) {
  const head = ascii(b, 0, Math.min(b.length, 4096)), zipNote = 'a ZIP container';
  const mt = /^mimetype(application\/[\w.+-]+)/.exec(ascii(b, 30, 80));
  if (mt && mt[1] === 'application/epub+zip') return t('EPUB e-book', mt[1], 'epub', zipNote);
  if (mt && mt[1].includes('opendocument')) {
    const kind = mt[1].split('.').pop();
    return t('OpenDocument ' + kind, mt[1], { text: 'odt', spreadsheet: 'ods', presentation: 'odp' }[kind] || 'odf', zipNote);
  }
  if (head.includes('[Content_Types].xml') || /^(word|xl|ppt)\//m.test(head.replace(/[^\x20-\x7e]/g, '\n'))) {
    if (head.includes('word/')) return t('Word document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx', zipNote);
    if (head.includes('xl/')) return t('Excel workbook', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx', zipNote);
    if (head.includes('ppt/')) return t('PowerPoint presentation', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx', zipNote);
    return t('Office document', 'application/zip', 'zip', zipNote);
  }
  if (head.includes('AndroidManifest.xml')) return t('Android app', 'application/vnd.android.package-archive', 'apk', zipNote);
  if (str(b, 30, 'META-INF/')) return t('Java archive', 'application/java-archive', 'jar', zipNote);
  return t('ZIP archive', 'application/zip', 'zip');
}

const BRANDS = [
  [/^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)$/, () => t('HEIC image', 'image/heic', 'heic')],
  [/^avi[fs]$/, () => t('AVIF image', 'image/avif', 'avif')],
  [/^qt {2}$/, () => t('QuickTime movie', 'video/quicktime', 'mov')],
  [/^M4[AB] $/, () => t('MPEG-4 audio', 'audio/mp4', 'm4a')],
  [/^3g/, () => t('3GP video', 'video/3gpp', '3gp')],
  [/^crx $/, () => t('Canon raw image', 'image/x-canon-cr3', 'cr3')],
];

function text(b) {
  let n = b.length;
  for (let k = 1; k <= 3 && n - k >= 0; k++) if ((b[n - k] & 0xc0) === 0xc0) { n -= k; break; } // a cut-off last character
  let s;
  try { s = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, n)); } catch { return null; }
  if (!s.length) return null;
  const control = (s.match(/[\0-\x08\x0e-\x1f\x7f]/g) || []).length;
  if (s.includes('\0') || control > s.length / 50) return null;
  const head = s.slice(0, 512).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return t('SVG image', 'image/svg+xml', 'svg');
  if (head.startsWith('<?xml')) return t('XML document', 'application/xml', 'xml');
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return t('HTML document', 'text/html', 'html');
  if (head.startsWith('#!')) return t('script', 'text/plain', 'sh', head.slice(2).split('\n')[0].trim());
  return /^[\0-\x7f]*$/.test(s) ? t('ASCII text', 'text/plain', 'txt') : t('UTF-8 text', 'text/plain', 'txt');
}

export function sniff(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
  if (!b.length) return null;
  if (has(b, 0, 0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a)) return t('PNG image', 'image/png', 'png');
  if (has(b, 0, 0xff, 0xd8, 0xff)) return t('JPEG image', 'image/jpeg', 'jpg');
  if (str(b, 0, 'GIF87a') || str(b, 0, 'GIF89a')) return t('GIF image', 'image/gif', 'gif', ascii(b, 3, 3));
  if (str(b, 0, 'RIFF') && b.length >= 12) {
    const kind = ascii(b, 8, 4);
    if (kind === 'WEBP') return t('WebP image', 'image/webp', 'webp');
    if (kind === 'WAVE') return t('WAV audio', 'audio/wav', 'wav');
    if (kind === 'AVI ') return t('AVI video', 'video/x-msvideo', 'avi');
  }
  if (str(b, 0, 'BM') && b.length >= 18 && [12, 40, 52, 56, 64, 108, 124].includes(b[14] | (b[15] << 8))) return t('BMP image', 'image/bmp', 'bmp');
  if (has(b, 0, 0, 0, 1, 0) && b.length >= 6 && b[4] + b[5] > 0) return t('ICO icon', 'image/x-icon', 'ico');
  if (has(b, 0, 'I', 'I', 0x2a, 0) || has(b, 0, 'M', 'M', 0, 0x2a)) return t('TIFF image', 'image/tiff', 'tiff', b[0] === 0x49 ? 'little-endian' : 'big-endian');
  if (str(b, 0, '%PDF-')) return t('PDF document', 'application/pdf', 'pdf', 'version ' + ascii(b, 5, 3));
  if (has(b, 0, 'P', 'K', 3, 4)) return zip(b);
  if (has(b, 0, 'P', 'K', 5, 6)) return t('ZIP archive', 'application/zip', 'zip', 'empty');
  if (has(b, 0, 0x1f, 0x8b)) return t('gzip archive', 'application/gzip', 'gz');
  if (str(b, 0, 'BZh')) return t('bzip2 archive', 'application/x-bzip2', 'bz2');
  if (has(b, 0, 0xfd, '7', 'z', 'X', 'Z', 0)) return t('xz archive', 'application/x-xz', 'xz');
  if (has(b, 0, '7', 'z', 0xbc, 0xaf, 0x27, 0x1c)) return t('7-Zip archive', 'application/x-7z-compressed', '7z');
  if (str(b, 0, 'Rar!\x1a\x07')) return t('RAR archive', 'application/vnd.rar', 'rar');
  if (has(b, 0, 0x28, 0xb5, 0x2f, 0xfd)) return t('Zstandard archive', 'application/zstd', 'zst');
  if (str(b, 257, 'ustar')) return t('tar archive', 'application/x-tar', 'tar');
  if (has(b, 0, 0x7f, 'E', 'L', 'F')) return t('ELF executable', 'application/x-elf', '', b[4] === 2 ? '64-bit' : '32-bit');
  const magic = b.length >= 4 ? u32be(b, 0) : 0;
  const macho = { 0xfeedface: '32-bit, big-endian', 0xfeedfacf: '64-bit, big-endian', 0xcefaedfe: '32-bit, little-endian', 0xcffaedfe: '64-bit, little-endian' }[magic];
  if (macho) return t('Mach-O executable', 'application/x-mach-binary', '', macho);
  if (magic === 0xcafebabe && b.length >= 8) {
    // Both start CAFEBABE: a universal binary counts its architectures (a few), a
    // class file carries its version (45 and up).
    const n = u32be(b, 4);
    if (n > 0 && n < 30) return t('Mach-O universal binary', 'application/x-mach-binary', '', n + ' architecture' + (n > 1 ? 's' : ''));
    return t('Java class file', 'application/java-vm', 'class', 'version ' + (b[6] << 8 | b[7]));
  }
  if (str(b, 0, 'MZ')) {
    const pe = b.length >= 64 ? (b[60] | (b[61] << 8) | (b[62] << 16)) : -1;
    return pe > 0 && str(b, pe, 'PE\0\0') ? t('Windows executable', 'application/vnd.microsoft.portable-executable', 'exe', 'PE') : t('DOS/Windows executable', 'application/x-msdownload', 'exe');
  }
  if (has(b, 0, 0, 'a', 's', 'm')) return t('WebAssembly module', 'application/wasm', 'wasm');
  if (str(b, 0, 'SQLite format 3\0')) return t('SQLite database', 'application/vnd.sqlite3', 'sqlite');
  if (b.length >= 12 && str(b, 4, 'ftyp')) {
    const brand = ascii(b, 8, 4), hit = BRANDS.find(([re]) => re.test(brand));
    return { ...(hit ? hit[1]() : t('MP4 video', 'video/mp4', 'mp4')), note: 'brand ' + brand.trim() };
  }
  if (str(b, 0, 'OggS')) return str(b, 28, 'OpusHead') ? t('Opus audio', 'audio/ogg', 'opus') : t('Ogg media', 'audio/ogg', 'ogg');
  if (str(b, 0, 'fLaC')) return t('FLAC audio', 'audio/flac', 'flac');
  if (str(b, 0, 'MThd')) return t('MIDI music', 'audio/midi', 'mid');
  if (str(b, 0, 'wOFF')) return t('WOFF font', 'font/woff', 'woff');
  if (str(b, 0, 'wOF2')) return t('WOFF2 font', 'font/woff2', 'woff2');
  if (str(b, 0, 'OTTO')) return t('OpenType font', 'font/otf', 'otf');
  if (has(b, 0, 0, 1, 0, 0, 0) || str(b, 0, 'true')) return t('TrueType font', 'font/ttf', 'ttf');
  if (str(b, 0, 'ttcf')) return t('font collection', 'font/collection', 'ttc');
  if (str(b, 0, 'ID3')) return t('MP3 audio', 'audio/mpeg', 'mp3', 'ID3 tag');
  if (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) {
    const layer = (b[1] >> 1) & 3;
    if (layer === 1) return t('MP3 audio', 'audio/mpeg', 'mp3');
    if (layer === 0) return t('AAC audio', 'audio/aac', 'aac');
  }
  if (has(b, 0, 0xef, 0xbb, 0xbf)) return t('UTF-8 text', 'text/plain', 'txt', 'with BOM');
  if (has(b, 0, 0xff, 0xfe, 0, 0)) return t('UTF-32 text', 'text/plain', 'txt', 'little-endian, with BOM');
  if (has(b, 0, 0xff, 0xfe)) return t('UTF-16 text', 'text/plain', 'txt', 'little-endian, with BOM');
  if (has(b, 0, 0xfe, 0xff)) return t('UTF-16 text', 'text/plain', 'txt', 'big-endian, with BOM');
  if (str(b, 0, '{\\rtf')) return t('RTF document', 'application/rtf', 'rtf');
  if (str(b, 0, '%!PS')) return t('PostScript document', 'application/postscript', 'ps');
  return text(b);
}
