// Hidden and odd characters in text: what each code point is, which ones are
// invisible or deceptive, and which words mix scripts (likely homoglyphs). Pure.
//
//   inspect(text) -> { chars: [{ index, cp, hex, ch, utf8, script, category, grapheme, flag, benign? }],
//                      hidden: [chars with a flag that isn't benign],
//                      mixed: [{ word, start, end, scripts, odd: [{ index, ch, script }] }],
//                      graphemes }
//   clean(text)   -> the text without the invisible characters; odd spaces become ' ',
//                    line/paragraph separators '\n'; joiners, variation selectors and
//                    tags inside emoji are kept.
//
// `index` is the offset in UTF-16 code units (what String#slice uses). Names come
// from a small built-in table, not the full Unicode name list.

const SCRIPTS = ['Latin', 'Cyrillic', 'Greek', 'Arabic', 'Hebrew', 'Han', 'Hiragana', 'Katakana', 'Hangul', 'Thai',
  'Devanagari', 'Armenian', 'Georgian', 'Cherokee', 'Common', 'Inherited']
  .map((s) => [s, new RegExp(`^\\p{Script=${s}}$`, 'u')]);
const CATEGORIES = ['Lu', 'Ll', 'Lt', 'Lm', 'Lo', 'Mn', 'Mc', 'Me', 'Nd', 'Nl', 'No', 'Pc', 'Pd', 'Ps', 'Pe', 'Pi', 'Pf', 'Po',
  'Sm', 'Sc', 'Sk', 'So', 'Zs', 'Zl', 'Zp', 'Cc', 'Cf', 'Cs', 'Co', 'Cn']
  .map((c) => [c, new RegExp(`^\\p{gc=${c}}$`, 'u')]);
// Scripts that are written together without spaces; they don't count as mixing.
const CJK = new Set(['Han', 'Hiragana', 'Katakana', 'Hangul']);

export const script = (ch) => (SCRIPTS.find(([, re]) => re.test(ch)) || ['Other'])[0];
export const category = (ch) => (CATEGORIES.find(([, re]) => re.test(ch)) || ['Cn'])[0];

// cp -> [name, what clean() does: 'drop' | 'space' | 'line' | 'keep']
const NAMES = new Map([
  [0x200b, 'zero-width space'], [0x200c, 'zero-width non-joiner'], [0x200d, 'zero-width joiner'], [0x2060, 'word joiner'],
  [0xfeff, 'byte order mark (zero-width no-break space)'], [0x00ad, 'soft hyphen'], [0x034f, 'combining grapheme joiner'],
  [0x200e, 'left-to-right mark'], [0x200f, 'right-to-left mark'], [0x061c, 'Arabic letter mark'],
  [0x202a, 'left-to-right embedding'], [0x202b, 'right-to-left embedding'], [0x202c, 'pop directional formatting'],
  [0x202d, 'left-to-right override'], [0x202e, 'right-to-left override'], [0x2066, 'left-to-right isolate'],
  [0x2067, 'right-to-left isolate'], [0x2068, 'first strong isolate'], [0x2069, 'pop directional isolate'],
  [0x2061, 'function application'], [0x2062, 'invisible times'], [0x2063, 'invisible separator'], [0x2064, 'invisible plus'],
  [0x180e, 'Mongolian vowel separator'], [0x3164, 'Hangul filler'], [0x115f, 'Hangul choseong filler'],
  [0x1160, 'Hangul jungseong filler'], [0xffa0, 'halfwidth Hangul filler'],
].map(([cp, name]) => [cp, [name, 'drop']]));
[[0x00a0, 'no-break space'], [0x202f, 'narrow no-break space'], [0x2000, 'en quad'], [0x2001, 'em quad'],
  [0x2002, 'en space'], [0x2003, 'em space'], [0x2004, 'three-per-em space'], [0x2005, 'four-per-em space'],
  [0x2006, 'six-per-em space'], [0x2007, 'figure space'], [0x2008, 'punctuation space'], [0x2009, 'thin space'],
  [0x200a, 'hair space'], [0x205f, 'medium mathematical space'], [0x3000, 'ideographic space'], [0x1680, 'ogham space mark'],
].forEach(([cp, name]) => NAMES.set(cp, [name, 'space']));
NAMES.set(0x2028, ['line separator', 'line']).set(0x2029, ['paragraph separator', 'line']);
NAMES.set(0xfffd, ['replacement character', 'keep']);

const PICTO = /^\p{Extended_Pictographic}$/u;
const EMOJI = /^\p{Emoji}$/u;

// [name, action] for a code point at position i of cps, or null. Context decides
// whether a joiner or selector is part of an emoji (benign) or stray.
function flagOf(cps, i, cat) {
  const cp = cps[i], ch = String.fromCodePoint(cp);
  if (cp >= 0xfe00 && cp <= 0xfe0f) return [`variation selector ${cp - 0xfe00 + 1}`, 'drop', i > 0 && EMOJI.test(String.fromCodePoint(cps[i - 1]))];
  if (cp >= 0xe0000 && cp <= 0xe007f) {
    let j = i;
    while (j > 0 && cps[j - 1] >= 0xe0020 && cps[j - 1] <= 0xe007f) j--;
    return ['tag character', 'drop', j > 0 && cps[j - 1] === 0x1f3f4]; // 🏴 + tags = subdivision flag
  }
  if (cp === 0x200d) {
    const prev = cps.slice(0, i).reverse().find((c) => !(c >= 0xfe00 && c <= 0xfe0f) && !(c >= 0x1f3fb && c <= 0x1f3ff));
    if (prev && PICTO.test(String.fromCodePoint(prev)) && i + 1 < cps.length && PICTO.test(String.fromCodePoint(cps[i + 1]))) return [NAMES.get(cp)[0], 'drop', true];
  }
  if ((cp === 0x200c || cp === 0x200d) && i > 0 && i + 1 < cps.length) {
    // Joiners shape letters in Arabic and Indic scripts; there they're normal.
    const a = String.fromCodePoint(cps[i - 1]), b = String.fromCodePoint(cps[i + 1]), s = script(a);
    if (/^[\p{L}\p{M}]$/u.test(a) && /^[\p{L}\p{M}]$/u.test(b) && s === script(b) && !['Latin', 'Cyrillic', 'Greek', 'Common', 'Other'].includes(s)) return [NAMES.get(cp)[0], 'drop', true];
  }
  if (NAMES.has(cp)) return NAMES.get(cp);
  if (cat === 'Cc') return ch === '\t' || ch === '\n' || ch === '\r' ? null : ['control character', 'drop'];
  if (cat === 'Cf') return ['format character', 'drop'];
  if (cat === 'Cs') return ['lone surrogate', 'drop'];
  if (cat === 'Co') return ['private use', 'keep'];
  if (cat === 'Cn') return ['unassigned', 'keep'];
  return null;
}

const hex2 = (b) => b.toString(16).toUpperCase().padStart(2, '0');
const enc = new TextEncoder();

function graphemeStarts(t) {
  if (typeof Intl === 'undefined' || !Intl.Segmenter) return null;
  return new Set([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)].map((s) => s.index));
}

export function inspect(text) {
  const t = String(text ?? '');
  const parts = [...t], cps = parts.map((c) => c.codePointAt(0));
  const starts = graphemeStarts(t);
  const chars = [];
  let index = 0, g = -1;
  parts.forEach((ch, i) => {
    if (!starts || starts.has(index)) g++;
    const cat = category(ch), f = flagOf(cps, i, cat);
    const c = { index, cp: cps[i], hex: 'U+' + cps[i].toString(16).toUpperCase().padStart(4, '0'), ch,
      utf8: [...enc.encode(ch)].map(hex2).join(' '), script: script(ch), category: cat, grapheme: g, flag: f ? f[0] : null };
    if (f && f[2]) c.benign = true;
    chars.push(c);
    index += ch.length;
  });
  return { chars, hidden: chars.filter((c) => c.flag && !c.benign), mixed: mixedWords(t, chars), graphemes: g + 1 };
}

// Words (runs of letters, marks, digits and invisible format characters) whose
// letters come from more than one script. The minority letters are the odd ones.
function mixedWords(t, chars) {
  const at = new Map(chars.map((c) => [c.index, c]));
  const out = [];
  for (const m of t.matchAll(/[\p{L}\p{M}\p{N}\p{Cf}]+/gu)) {
    const letters = [];
    for (let i = m.index; i < m.index + m[0].length;) {
      const c = at.get(i);
      if (/^\p{L}$/u.test(c.ch) && !['Common', 'Inherited'].includes(c.script) && !CJK.has(c.script)) letters.push(c);
      i += c.ch.length;
    }
    const count = new Map();
    letters.forEach((c) => count.set(c.script, (count.get(c.script) || 0) + 1));
    if (count.size < 2) continue;
    const scripts = [...count.keys()].sort((a, b) => count.get(b) - count.get(a) || (b === 'Latin') - (a === 'Latin'));
    out.push({ word: m[0], start: m.index, end: m.index + m[0].length, scripts,
      odd: letters.filter((c) => c.script !== scripts[0]).map((c) => ({ index: c.index, ch: c.ch, script: c.script })) });
  }
  return out;
}

export function clean(text) {
  const t = String(text ?? '');
  const cps = [...t].map((c) => c.codePointAt(0));
  let out = '';
  cps.forEach((cp, i) => {
    const ch = String.fromCodePoint(cp), f = flagOf(cps, i, category(ch));
    if (!f || f[2] || f[1] === 'keep') out += ch;
    else if (f[1] === 'space') out += ' ';
    else if (f[1] === 'line') out += '\n';
  });
  return out;
}
