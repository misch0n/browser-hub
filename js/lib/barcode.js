// 1D barcodes, made here: Code 128, Code 39, EAN-13, EAN-8, UPC-A,
// Interleaved 2 of 5 and Codabar, with their check digits.
//
// encodeBarcode(type, text, opts) -> { type, text, modules: [0|1], quietZone }
// `modules` has one entry per narrow module (1 = bar), `text` is what to print
// under the bars (with any computed check digit), `quietZone` the light margin
// each side wants, in modules. Throws an Error with a readable message when the
// text can't be encoded.
//
// barcodeSvg(result, opts) -> an SVG string; barcodeWidth(result, opts) -> its width in px.

export const BARCODE_TYPES = [
  { id: 'code128', name: 'Code 128', chars: 'any ASCII text' },
  { id: 'code39', name: 'Code 39', chars: 'A-Z 0-9 space - . $ / + % (check digit with check)' },
  { id: 'ean13', name: 'EAN-13', chars: '12 digits, or 13 with the check digit' },
  { id: 'ean8', name: 'EAN-8', chars: '7 digits, or 8 with the check digit' },
  { id: 'upca', name: 'UPC-A', chars: '11 digits, or 12 with the check digit' },
  { id: 'itf', name: 'Interleaved 2 of 5', chars: 'an even number of digits (odd with check)' },
  { id: 'codabar', name: 'Codabar', chars: '0-9 - $ : / . + between start/stop letters A-D' },
];

const ALIASES = { code128: 'code128', code39: 'code39', ean13: 'ean13', ean: 'ean13', ean8: 'ean8', upca: 'upca', upc: 'upca', itf: 'itf', i25: 'itf', interleaved2of5: 'itf', codabar: 'codabar' };

// Bar/space widths (bar first) to modules.
function expand(widths, out = []) {
  widths.forEach((w, i) => { for (let k = 0; k < w; k++) out.push(i % 2 ? 0 : 1); });
  return out;
}
// A string of 0/1 to modules.
const bits = (s) => [...s].map(Number);

// --- Code 128 ---------------------------------------------------------------

// Bar/space widths of symbol values 0-105; 106 is the stop (with its final bar).
const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 ' +
  '221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 ' +
  '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 ' +
  '212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 ' +
  '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 ' +
  '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 ' +
  '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 ' +
  '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 ' +
  '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 ' +
  '214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 ' +
  '114131 311141 411131 211412 211214 211232 2331112').split(' ').map((p) => [...p].map(Number));
const START = { A: 103, B: 104, C: 105 };
const SWITCH = { A: { B: 100, C: 99 }, B: { A: 101, C: 99 }, C: { A: 101, B: 100 } };
const SHIFT = 98;
const SETS = ['B', 'A', 'C']; // ties go to the first

// The value of character code `c` in code set A or B, or -1.
function c128Value(set, c) {
  if (set === 'A') return c < 32 ? c + 64 : c < 96 ? c - 32 : -1;
  return c >= 32 && c < 128 ? c - 32 : -1;
}
const isDigit = (c) => c >= 48 && c <= 57;

// Fewest symbols, by dynamic programming over (position, current set): set C
// takes digit pairs, A control characters, B the rest; a single character of
// the other of A/B can go in with a SHIFT.
function code128Values(text) {
  const codes = [...text].map((ch) => ch.codePointAt(0));
  codes.forEach((c, i) => {
    if (c > 127) throw new Error('Code 128 can only encode ASCII (not "' + [...text][i] + '")');
  });
  const n = codes.length;
  // total[i][s]: symbols to finish from i while in set s; take[i][s]: the same,
  // starting with a symbol that encodes data (no switch first).
  const total = Array.from({ length: n + 1 }, () => ({}));
  const take = Array.from({ length: n + 1 }, () => ({}));
  for (const s of SETS) total[n][s] = { cost: 0 };
  for (let i = n - 1; i >= 0; i--) {
    for (const s of SETS) {
      let best = { cost: Infinity };
      if (s === 'C') {
        if (i + 1 < n && isDigit(codes[i]) && isDigit(codes[i + 1])) {
          best = { cost: 1 + total[i + 2].C.cost, vals: [(codes[i] - 48) * 10 + codes[i + 1] - 48], next: i + 2 };
        }
      } else {
        const v = c128Value(s, codes[i]);
        const other = s === 'A' ? 'B' : 'A';
        if (v >= 0) best = { cost: 1 + total[i + 1][s].cost, vals: [v], next: i + 1 };
        else if (2 + total[i + 1][s].cost < best.cost) {
          best = { cost: 2 + total[i + 1][s].cost, vals: [SHIFT, c128Value(other, codes[i])], next: i + 1 };
        }
      }
      take[i][s] = { ...best, set: s };
    }
    for (const s of SETS) {
      let best = take[i][s];
      for (const t of SETS) {
        if (t !== s && 1 + take[i][t].cost < best.cost) best = { ...take[i][t], cost: 1 + take[i][t].cost, switchTo: t };
      }
      total[i][s] = best;
    }
  }
  let set = SETS.reduce((a, b) => (take[0][b].cost < take[0][a].cost ? b : a));
  const values = [START[set]];
  for (let i = 0; i < n;) {
    const step = i === 0 ? take[0][set] : total[i][set];
    if (step.switchTo) {
      values.push(SWITCH[set][step.switchTo]);
      set = step.switchTo;
    }
    values.push(...step.vals);
    i = step.next;
  }
  return values;
}

function code128(text) {
  const values = code128Values(text);
  const check = values.reduce((sum, v, i) => sum + v * Math.max(i, 1), 0) % 103;
  const modules = [];
  for (const v of [...values, check, 106]) expand(C128[v], modules);
  return { text, modules, quietZone: 10 };
}

// --- Code 39 ----------------------------------------------------------------

const C39_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
// Nine elements each (bar first), a 1 bit for each of the three wide ones.
const C39 = [0x034, 0x121, 0x061, 0x160, 0x031, 0x130, 0x070, 0x025, 0x124, 0x064,
  0x109, 0x049, 0x148, 0x019, 0x118, 0x058, 0x00d, 0x10c, 0x04c, 0x01c,
  0x103, 0x043, 0x142, 0x013, 0x112, 0x052, 0x007, 0x106, 0x046, 0x016,
  0x181, 0x0c1, 0x1c0, 0x091, 0x190, 0x0d0, 0x085, 0x184, 0x0c4, 0x0a8,
  0x0a2, 0x08a, 0x02a];
const C39_STAR = 0x094;
const WIDE = 3; // wide elements are three narrow modules (Code 39, ITF, Codabar)

// `n` elements from the bit pattern `p` (most significant first), then a narrow gap.
function wideNarrow(p, n, out) {
  const widths = [];
  for (let i = n - 1; i >= 0; i--) widths.push((p >>> i) & 1 ? WIDE : 1);
  return expand(widths, out);
}

function code39(text, opts) {
  const up = text.toUpperCase();
  const values = [...up].map((ch) => {
    const v = C39_CHARS.indexOf(ch);
    if (v < 0) throw new Error('Code 39 can\'t encode "' + ch + '" (it takes A-Z, 0-9, space and - . $ / + %)');
    return v;
  });
  if (opts.check) values.push(values.reduce((a, b) => a + b, 0) % 43);
  const modules = [];
  for (const p of [C39_STAR, ...values.map((v) => C39[v]), C39_STAR]) {
    if (modules.length) modules.push(0); // narrow gap between characters
    wideNarrow(p, 9, modules);
  }
  return { text: values.map((v) => C39_CHARS[v]).join(''), modules, quietZone: 10 };
}

// --- EAN / UPC --------------------------------------------------------------

const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_R = EAN_L.map((p) => p.replace(/./g, (b) => (b === '1' ? '0' : '1')));
const EAN_G = EAN_R.map((p) => [...p].reverse().join(''));
// L/G parity of the left half of an EAN-13, chosen by its first digit.
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

// The mod-10 check digit of EAN, UPC and ITF: weights 3, 1, 3, ... from the right.
export function mod10(digits) {
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = 4 - w) sum += Number(digits[i]) * w;
  return (10 - (sum % 10)) % 10;
}

// Digits (spaces and dashes ignored), with the check digit added or verified.
function withCheck(name, text, len) {
  const d = text.replace(/[\s-]/g, '');
  if (!/^\d*$/.test(d) || (d.length !== len - 1 && d.length !== len)) {
    throw new Error(name + ' takes ' + (len - 1) + ' or ' + len + ' digits');
  }
  const check = mod10(d.slice(0, len - 1));
  if (d.length === len && Number(d[len - 1]) !== check) throw new Error('the check digit should be ' + check);
  return d.slice(0, len - 1) + check;
}

// Guard, left digits (with parity), centre guard, right digits, guard.
function eanModules(left, parity, right) {
  let s = '101';
  [...left].forEach((c, i) => { s += (parity[i] === 'G' ? EAN_G : EAN_L)[c]; });
  s += '01010';
  for (const c of right) s += EAN_R[c];
  return bits(s + '101');
}

function ean13(text) {
  const d = withCheck('EAN-13', text, 13);
  return { text: d, modules: eanModules(d.slice(1, 7), EAN_PARITY[d[0]], d.slice(7)), quietZone: 11 };
}
function upca(text) {
  const d = withCheck('UPC-A', text, 12); // an EAN-13 with a leading 0
  return { text: d, modules: eanModules(d.slice(0, 6), 'LLLLLL', d.slice(6)), quietZone: 9 };
}
function ean8(text) {
  const d = withCheck('EAN-8', text, 8);
  return { text: d, modules: eanModules(d.slice(0, 4), 'LLLL', d.slice(4)), quietZone: 7 };
}

// --- Interleaved 2 of 5 -----------------------------------------------------

// Five elements per digit, two wide (1 bits); pairs of digits interleave, the
// first as bars and the second as spaces.
const ITF = [0b00110, 0b10001, 0b01001, 0b11000, 0b00101, 0b10100, 0b01100, 0b00011, 0b10010, 0b01010];

function itf(text, opts) {
  let d = text.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(d)) throw new Error(d ? 'ITF takes digits only' : 'nothing to encode');
  if (opts.check) d += mod10(d);
  if (d.length % 2) {
    throw new Error(opts.check ? 'ITF needs an odd number of digits when it adds a check digit' : 'ITF needs an even number of digits');
  }
  const widths = [1, 1, 1, 1]; // start
  for (let i = 0; i < d.length; i += 2) {
    const a = ITF[d[i]], b = ITF[d[i + 1]];
    for (let k = 4; k >= 0; k--) widths.push((a >>> k) & 1 ? WIDE : 1, (b >>> k) & 1 ? WIDE : 1);
  }
  widths.push(WIDE, 1, 1); // stop
  return { text: d, modules: expand(widths), quietZone: 10 };
}

// --- Codabar ----------------------------------------------------------------

const CODABAR_CHARS = '0123456789-$:/.+ABCD';
// Seven elements each (bar first), a 1 bit for each wide one.
const CODABAR = [0x003, 0x006, 0x009, 0x060, 0x012, 0x042, 0x021, 0x024, 0x030, 0x048,
  0x00c, 0x018, 0x045, 0x051, 0x054, 0x015, 0x01a, 0x029, 0x00b, 0x00e];

function codabar(text) {
  let s = text.toUpperCase();
  const isGuard = (c) => c !== undefined && 'ABCD'.includes(c);
  if (isGuard(s[0]) !== isGuard(s[s.length - 1]) || (s.length === 1 && isGuard(s))) {
    throw new Error('Codabar needs both a start and a stop letter (A-D), or neither');
  }
  if (!isGuard(s[0])) s = 'A' + s + 'A';
  const body = s.slice(1, -1);
  if (!body) throw new Error('nothing to encode');
  for (const ch of body) {
    if (!'0123456789-$:/.+'.includes(ch)) {
      throw new Error('Codabar can\'t encode "' + ch + '" (it takes digits and - $ : / . + between start/stop letters A-D)');
    }
  }
  const modules = [];
  for (const ch of s) {
    if (modules.length) modules.push(0);
    wideNarrow(CODABAR[CODABAR_CHARS.indexOf(ch)], 7, modules);
  }
  return { text: s, modules, quietZone: 10 };
}

// --- Entry points -----------------------------------------------------------

const ENCODERS = { code128, code39, ean13, ean8, upca, itf, codabar };

export function encodeBarcode(type, text, opts = {}) {
  const id = ALIASES[String(type).toLowerCase().replace(/[\s_-]/g, '')];
  if (!id) throw new Error('unknown barcode type "' + type + '" (try ' + BARCODE_TYPES.map((t) => t.id).join(', ') + ')');
  text = String(text ?? '');
  if (!text) throw new Error('nothing to encode');
  return { type: id, ...ENCODERS[id](text, opts) };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Control characters aren't allowed in XML: show their Unicode pictures instead.
const printable = (s) => s.replace(/[\x00-\x1f\x7f]/g, (c) => String.fromCharCode(c === '\x7f' ? 0x2421 : 0x2400 + c.charCodeAt(0)));
const num = (x) => String(Math.round(x * 1000) / 1000);
const positive = (x, dflt) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : dflt);

function layout(result, opts = {}) {
  const scale = positive(opts.scale, 2);
  const margin = opts.margin !== undefined && Number(opts.margin) >= 0 ? Number(opts.margin) : result.quietZone;
  return { scale, margin, width: (result.modules.length + 2 * margin) * scale };
}

// Width of the SVG in pixels (bars plus margins).
export function barcodeWidth(result, opts) {
  return layout(result, opts).width;
}

// Where everything goes, in px: bars as [x, width] runs, the text (or null).
// The SVG and the PNG export both draw from this.
export function barcodeGeometry(result, opts = {}) {
  const { scale, margin, width } = layout(result, opts);
  const barHeight = positive(opts.height, 60);
  const showText = opts.text !== false;
  const pad = 4 * scale;
  const fontSize = Math.max(10, Math.round(scale * 7));
  const height = pad + barHeight + (showText ? fontSize * 1.25 : 0) + pad;
  const bars = [];
  const m = result.modules;
  for (let x = 0; x < m.length;) {
    if (!m[x]) { x++; continue; }
    let run = 1;
    while (x + run < m.length && m[x + run]) run++;
    bars.push([(x + margin) * scale, run * scale]);
    x += run;
  }
  return {
    width, height, top: pad, barHeight, bars,
    text: showText ? { x: width / 2, y: pad + barHeight + fontSize, size: fontSize, font: opts.font || 'monospace', value: printable(result.text) } : null,
  };
}

// The bars as one path of rectangles on a white background, with the text
// centred underneath. `margin` is in modules (default: the quiet zone).
export function barcodeSvg(result, opts = {}) {
  const g = barcodeGeometry(result, opts);
  const d = g.bars.map(([x, w]) => 'M' + num(x) + ' ' + num(g.top) + 'h' + num(w) + 'v' + num(g.barHeight) + 'h-' + num(w) + 'z').join('');
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + num(g.width) + '" height="' + num(g.height) +
    '" viewBox="0 0 ' + num(g.width) + ' ' + num(g.height) + '">' +
    '<rect width="100%" height="100%" fill="#fff"/>' +
    '<path fill="#000" shape-rendering="crispEdges" d="' + d + '"/>';
  if (g.text) {
    svg += '<text x="' + num(g.text.x) + '" y="' + num(g.text.y) + '" text-anchor="middle" font-family="' +
      esc(g.text.font) + '" font-size="' + g.text.size + '" fill="#000">' + esc(g.text.value) + '</text>';
  }
  return svg + '</svg>';
}
