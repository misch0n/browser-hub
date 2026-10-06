// A regex or a literal string written correctly for each language, raw and
// verbatim forms where they exist, with the regex flags each language takes.

const LIT = {
  js: (s) => JSON.stringify(s).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'),
  json: (s) => JSON.stringify(s),
  python: (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + "'",
  java: (s) => cstyle(s),
  csharp: (s) => cstyle(s),
  go: (s) => cstyle(s),
  php: (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'",
  ruby: (s) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'",
  rust: (s) => cstyle(s),
};

function cstyle(s) {
  let o = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (ch === '\\') o += '\\\\';
    else if (ch === '"') o += '\\"';
    else if (ch === '\n') o += '\\n';
    else if (ch === '\r') o += '\\r';
    else if (ch === '\t') o += '\\t';
    else if (c < 0x20 || c === 0x7f) o += '\\u' + c.toString(16).padStart(4, '0');
    else o += ch;
  }
  return o + '"';
}

// The raw forms: no escaping inside, when the text allows it.
const raw = {
  python: (s) => (/^[^'\n]*$/.test(s) && !/\\$/.test(s) ? "r'" + s + "'" : (/^[^"\n]*$/.test(s) && !/\\$/.test(s) ? 'r"' + s + '"' : null)),
  csharp: (s) => '@"' + s.replace(/"/g, '""') + '"',
  go: (s) => (s.includes('`') ? null : '`' + s + '`'),
  rust: (s) => { let h = ''; while (s.includes('"' + h)) h += '#'; return 'r' + h + '"' + s + '"' + h; },
  java: (s) => (s.includes('"""') || !s.includes('\n') ? null : '"""\n' + s.replace(/\\/g, '\\\\') + '"""'),
};

export const LANGUAGES = [
  ['js', 'JavaScript'], ['python', 'Python'], ['java', 'Java'], ['csharp', 'C#'], ['go', 'Go'], ['php', 'PHP'], ['ruby', 'Ruby'], ['rust', 'Rust'], ['json', 'JSON string'],
];

// A string literal in each language: [{ lang, name, code, note? }]
export function literals(s) {
  return LANGUAGES.map(([lang, name]) => {
    const forms = [LIT[lang](s)];
    const r = raw[lang] && raw[lang](s);
    if (r && r !== forms[0]) forms.push(r);
    return { lang, name, code: forms.join('   or   ') };
  });
}

const FLAG_NAMES = { i: 'ignore case', m: 'multiline', s: 'dot matches newline', g: 'global', u: 'unicode', y: 'sticky', x: 'extended', d: 'indices', v: 'unicode sets' };

// '/a\/b/gi' -> { source: 'a/b', flags: 'gi' } or null when not a regex literal.
export function readRegex(text) {
  const m = /^\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\[])+)\/([a-z]*)$/s.exec(String(text).trim());
  if (!m) return null;
  return { source: m[1].replace(/\\\//g, '/'), flags: m[2] };
}

// The regex in each language: [{ lang, name, code, note? }]
export function regexCode(source, flags) {
  const f = new Set(flags);
  const notes = [];
  const unknown = [...f].filter((x) => !FLAG_NAMES[x]);
  if (unknown.length) throw new Error('unknown flag ' + unknown.join(''));
  const jsSrc = source.replace(/\//g, '\\/');
  const pyFlags = [['i', 're.IGNORECASE'], ['m', 're.MULTILINE'], ['s', 're.DOTALL'], ['x', 're.VERBOSE']].filter(([k]) => f.has(k)).map(([, v]) => v);
  const javaFlags = [['i', 'Pattern.CASE_INSENSITIVE'], ['m', 'Pattern.MULTILINE'], ['s', 'Pattern.DOTALL'], ['x', 'Pattern.COMMENTS'], ['u', 'Pattern.UNICODE_CASE']].filter(([k]) => f.has(k)).map(([, v]) => v);
  const csFlags = [['i', 'RegexOptions.IgnoreCase'], ['m', 'RegexOptions.Multiline'], ['s', 'RegexOptions.Singleline'], ['x', 'RegexOptions.IgnorePatternWhitespace']].filter(([k]) => f.has(k)).map(([, v]) => v);
  const inline = [...'ims'].filter((k) => f.has(k)).join('');
  const goSrc = (inline ? '(?' + inline + ')' : '') + source;
  const phpDelim = source.includes('/') ? '#' : '/';
  const phpPat = phpDelim + (phpDelim === '#' ? source.replace(/#/g, '\\#') : source) + phpDelim + [...'imsxu'].filter((k) => f.has(k)).join('');
  // Ruby: /m means dot matches newline (JavaScript's s), and ^ $ always work per line.
  const rubyFlags = (f.has('i') ? 'i' : '') + (f.has('s') ? 'm' : '') + (f.has('x') ? 'x' : '');
  if (f.has('m') || f.has('s')) notes.push(['ruby', "Ruby's ^ and $ are always per line; its /m is JavaScript's s"]);
  if (f.has('x')) notes.push(['go', 'Go (RE2) has no extended mode: whitespace and # comments are matched literally']);
  if (f.has('g')) notes.push(['all', 'g is a JavaScript matching mode: other languages choose it at the call (findall, FindAll, Matches)']);
  const rustSrc = (inline + (f.has('x') ? 'x' : '') ? '(?' + inline + (f.has('x') ? 'x' : '') + ')' : '') + source;
  const code = {
    js: '/' + jsSrc + '/' + flags + '   or   new RegExp(' + LIT.js(source) + (flags ? ", '" + flags + "'" : '') + ')',
    python: 're.compile(' + (raw.python(source) || LIT.python(source)) + (pyFlags.length ? ', ' + pyFlags.join(' | ') : '') + ')',
    java: 'Pattern.compile(' + cstyle(source) + (javaFlags.length ? ', ' + javaFlags.join(' | ') : '') + ')',
    csharp: 'new Regex(' + raw.csharp(source) + (csFlags.length ? ', ' + csFlags.join(' | ') : '') + ')',
    go: 'regexp.MustCompile(' + (raw.go(goSrc) || cstyle(goSrc)) + ')',
    php: "preg_match('" + phpPat.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "', $subject)",
    ruby: '/' + source.replace(/\//g, '\\/') + '/' + rubyFlags,
    rust: 'Regex::new(' + raw.rust(rustSrc) + ').unwrap()',
    json: LIT.json(source) + (flags ? '   (flags "' + flags + '" kept separately)' : ''),
  };
  return LANGUAGES.map(([lang, name]) => ({ lang, name, code: code[lang], note: notes.filter(([l]) => l === lang).map(([, n]) => n).join('; ') || null }))
    .concat(notes.filter(([l]) => l === 'all').map(([, n]) => ({ lang: 'note', name: 'note', code: n })));
}

export const flagNames = (flags) => [...flags].map((f) => FLAG_NAMES[f] || f);
