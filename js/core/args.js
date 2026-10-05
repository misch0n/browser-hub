// Splitting command arguments. Quotes are optional: plain words work as they
// always have, and quotes are there to say what you mean when it matters:
//
//   t "done laundry"           a task called "done laundry", not `t done <id>`
//   t "due:friday is a word"   text, not a due date
//   zones add tokyo "Kenji's team"
//
// A quote only opens a quoted argument at the start of a word, and only
// closes at a matching quote followed by whitespace or the end. Anything else
// is literal, so `project="UBMVC"` or `it's` need no escaping. Inside a quoted
// argument, \" (or \') and \\ stand for the character itself.

// -> [{ text, quoted, start, end }]; start/end index the raw input.
export function tokenize(input) {
  const s = String(input);
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const start = i;
    const q = s[i];
    if (q === '"' || q === "'") {
      let text = '';
      let j = i + 1;
      let closed = -1;
      while (j < s.length) {
        if (s[j] === '\\' && (s[j + 1] === q || s[j + 1] === '\\')) { text += s[j + 1]; j += 2; continue; }
        if (s[j] === q && (j + 1 === s.length || /\s/.test(s[j + 1]))) { closed = j; break; }
        text += s[j];
        j++;
      }
      if (closed >= 0) {
        out.push({ text, quoted: true, start, end: closed + 1 });
        i = closed + 1;
        continue;
      }
    }
    let j = i;
    while (j < s.length && !/\s/.test(s[j])) j++;
    out.push({ text: s.slice(i, j), quoted: false, start, end: j });
    i = j;
  }
  return out;
}

// The argument as one value: the inside of the quotes when the whole thing is
// one quoted argument, otherwise the text exactly as typed (inner spacing kept).
export function oneValue(input) {
  const s = String(input).trim();
  const t = tokenize(s);
  if (t.length === 1 && t[0].quoted) return t[0].text;
  return s;
}

// Quotes `value` so tokenize() reads it back as a single argument; plain
// values are left alone.
export function quote(value) {
  const v = String(value);
  if (v && !/\s/.test(v) && !/^["']/.test(v)) return v;
  const q = v.includes('"') && !v.includes("'") ? "'" : '"';
  return q + v.replace(/\\/g, '\\\\').split(q).join('\\' + q) + q;
}
